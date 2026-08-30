/**
 * The OpenAI review provider, and any OpenAI-compatible endpoint.
 *
 * Deliberately the same shape as the Anthropic one: same system prompt, same
 * JSON schema, same `ReviewProvider` contract, no tools. The provider swap
 * changes who reviews, never what Navigator is allowed to do with the answer —
 * every response still goes through the same validation and sanitising.
 *
 * Two request paths. OpenAI itself gets the Responses API, which is where the
 * Codex-family models live. A configured `baseUrl` — Groq, Cerebras, Ollama,
 * LM Studio — gets Chat Completions, because that is the endpoint those
 * services actually implement.
 */

import OpenAI from 'openai';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { buildGuidanceSystemPrompt, buildGuidanceUserPrompt } from './guidancePrompt.js';
import { buildRecallSystemPrompt, buildRecallUserPrompt } from './recallPrompt.js';
import { REVIEW_OUTPUT_SCHEMA } from './schema.js';
import { GUIDANCE_OUTPUT_SCHEMA } from './guidanceSchema.js';
import { RECALL_OUTPUT_SCHEMA } from './recallSchema.js';
import { readUsage } from './usage.js';
import type { ReviewEffort } from './types.js';
import {
  ReviewUnavailableError,
  type GuidanceProvider,
  type GuidanceRequest,
  type ProviderResponse,
  type RecallProvider,
  type RecallRequest,
  type ReviewProvider,
  type ReviewRequest,
} from './provider.js';

/** Codex-family model, chosen because the whole job is reading diffs. */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.1-codex-max';

/** Reasoning models spend tokens before they answer; leave room for both. */
const MAX_OUTPUT_TOKENS = 8192;

/**
 * What OpenAI accepts, which is a shorter ladder than Anthropic's.
 *
 * `xhigh` and `max` have no counterpart, so they land on `high` rather than
 * being dropped: the developer asked for as much thinking as possible, and
 * `high` is as much as this provider has.
 */
type OpenAIEffort = 'low' | 'medium' | 'high';

function toOpenAIEffort(effort: ReviewEffort | undefined): OpenAIEffort | undefined {
  switch (effort) {
    case 'low':
    case 'medium':
    case 'high':
      return effort;
    case 'xhigh':
    case 'max':
      return 'high';
    default:
      return undefined;
  }
}

const REVIEW_SCHEMA_NAME = 'navigator_review';
const GUIDANCE_SCHEMA_NAME = 'navigator_guidance';
const RECALL_SCHEMA_NAME = 'navigator_recall';

/** One job the model can be asked to do: its prompts, schema and wording. */
interface Job {
  readonly system: string;
  readonly user: string;
  readonly schema: object;
  readonly schemaName: string;
  /** Completes "the model declined to ...". */
  readonly declined: string;
}

export interface OpenAIProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Absent or empty leaves the model's own default in place. */
  readonly effort?: ReviewEffort;
  /**
   * An OpenAI-compatible base URL. Empty means OpenAI itself.
   * Setting it switches the request to Chat Completions.
   */
  readonly baseUrl?: string;
  /** Custom fetch implementation. Used by tests to pin the request shape. */
  readonly fetch?: typeof globalThis.fetch;
}

export class OpenAIReviewProvider implements ReviewProvider, GuidanceProvider, RecallProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly compatible: boolean;
  private readonly effort: OpenAIEffort | undefined;

  constructor(options: OpenAIProviderOptions) {
    const baseUrl = options.baseUrl?.trim();
    this.compatible = baseUrl !== undefined && baseUrl.length > 0;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      // A review is a deliberate, user-initiated action: failing fast and
      // letting the developer run it again beats a command that silently hangs.
      maxRetries: 0,
      ...(this.compatible ? { baseURL: baseUrl } : {}),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    this.model = options.model?.trim() || DEFAULT_OPENAI_MODEL;
    this.effort = toOpenAIEffort(options.effort);
  }

  review(request: ReviewRequest): Promise<ProviderResponse> {
    return this.run(
      {
        system: buildSystemPrompt(request.intensity),
        user: buildUserPrompt(request.annotatedDiff),
        schema: REVIEW_OUTPUT_SCHEMA,
        schemaName: REVIEW_SCHEMA_NAME,
        declined: 'review this change',
      },
      request.signal,
    );
  }

  guide(request: GuidanceRequest): Promise<ProviderResponse> {
    return this.run(
      {
        system: buildGuidanceSystemPrompt(),
        user: buildGuidanceUserPrompt(request.question) + (request.context ?? ''),
        schema: GUIDANCE_OUTPUT_SCHEMA,
        schemaName: GUIDANCE_SCHEMA_NAME,
        declined: 'answer',
      },
      request.signal,
    );
  }

  recall(request: RecallRequest): Promise<ProviderResponse> {
    return this.run(
      {
        system: buildRecallSystemPrompt(),
        user: buildRecallUserPrompt(request.description),
        schema: RECALL_OUTPUT_SCHEMA,
        schemaName: RECALL_SCHEMA_NAME,
        declined: 'answer',
      },
      request.signal,
    );
  }

  private run(job: Job, signal: AbortSignal | undefined): Promise<ProviderResponse> {
    return this.compatible ? this.viaChatCompletions(job, signal) : this.viaResponses(job, signal);
  }

  /** OpenAI proper: the Responses API, where the Codex models live. */
  private async viaResponses(job: Job, signal: AbortSignal | undefined): Promise<ProviderResponse> {
    let response;
    try {
      response = await this.client.responses.create(
        {
          model: this.model,
          instructions: job.system,
          input: job.user,
          max_output_tokens: MAX_OUTPUT_TOKENS,
          ...(this.effort === undefined ? {} : { reasoning: { effort: this.effort } }),
          text: {
            format: {
              type: 'json_schema',
              name: job.schemaName,
              schema: job.schema as Record<string, unknown>,
              strict: true,
            },
          },
        },
        { signal },
      );
    } catch (error) {
      throw new ReviewUnavailableError(describeOpenAIError(error), { cause: error });
    }

    if (response.status === 'incomplete') {
      const reason = response.incomplete_details?.reason ?? 'unknown reason';
      throw new ReviewUnavailableError(`the review was cut short (${reason})`);
    }

    const text = response.output_text.trim();
    if (text.length === 0) {
      throw new ReviewUnavailableError(
        findResponsesRefusal(response, job.declined) ?? 'the model returned an empty response',
      );
    }
    return { text };
  }

  /**
   * Any OpenAI-compatible endpoint: Chat Completions.
   *
   * Structured output support varies across these services, so a rejected
   * schema falls back to a plain request once. The response is validated the
   * same way either way — `parseReviewResponse` already tolerates JSON that
   * arrives wrapped in prose or a fence.
   */
  private async viaChatCompletions(job: Job, signal: AbortSignal | undefined): Promise<ProviderResponse> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: job.system },
      { role: 'user', content: job.user },
    ];
    const warnings: string[] = [];

    let completion;
    try {
      completion = await this.createCompletion(job, messages, signal, true);
    } catch (error) {
      if (!isStructuredOutputRejection(error)) {
        throw new ReviewUnavailableError(describeOpenAIError(error), { cause: error });
      }
      warnings.push(
        'the endpoint rejected the JSON schema; retried without it and validated the answer locally',
      );
      try {
        completion = await this.createCompletion(job, messages, signal, false);
      } catch (retryError) {
        throw new ReviewUnavailableError(describeOpenAIError(retryError), { cause: retryError });
      }
    }

    const choice = completion.choices[0];
    if (choice === undefined) {
      throw new ReviewUnavailableError('the endpoint returned no choices');
    }
    if (choice.finish_reason === 'length') {
      throw new ReviewUnavailableError('the review was cut short (max_tokens)');
    }
    if (typeof choice.message.refusal === 'string' && choice.message.refusal.length > 0) {
      throw new ReviewUnavailableError(
        `the model declined to ${job.declined} (${choice.message.refusal})`,
      );
    }

    const text = (choice.message.content ?? '').trim();
    if (text.length === 0) {
      throw new ReviewUnavailableError('the model returned an empty response');
    }
    const usage = readUsage(completion.usage);
    return usage === undefined ? { text, warnings } : { text, warnings, usage };
  }

  private createCompletion(
    job: Job,
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    signal: AbortSignal | undefined,
    withSchema: boolean,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    return this.client.chat.completions.create(
      {
        model: this.model,
        messages,
        max_tokens: MAX_OUTPUT_TOKENS,
        ...(this.effort === undefined ? {} : { reasoning_effort: this.effort }),
        ...(withSchema
          ? {
              response_format: {
                type: 'json_schema' as const,
                json_schema: {
                  name: job.schemaName,
                  schema: job.schema as Record<string, unknown>,
                  strict: true,
                },
              },
            }
          : {}),
      },
      { signal },
    );
  }
}

/** True when the endpoint refused the request because of the JSON schema. */
export function isStructuredOutputRejection(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError)) {
    return false;
  }
  if (error.status !== 400 && error.status !== 404 && error.status !== 422) {
    return false;
  }
  return /response_format|json_schema|structured output|schema/i.test(error.message);
}

/** Surfaces a content refusal as a reason rather than an empty response. */
function findResponsesRefusal(response: OpenAI.Responses.Response, declined: string): string | undefined {
  for (const item of response.output) {
    if (item.type !== 'message') {
      continue;
    }
    for (const content of item.content) {
      if (content.type === 'refusal') {
        return `the model declined to ${declined} (${content.refusal})`;
      }
    }
  }
  return undefined;
}

export function describeOpenAIError(error: unknown): string {
  if (error instanceof OpenAI.AuthenticationError) {
    return 'the API key was rejected';
  }
  if (error instanceof OpenAI.RateLimitError) {
    return 'rate limited by the endpoint';
  }
  if (error instanceof OpenAI.APIUserAbortError) {
    return 'the review was cancelled';
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return 'could not reach the endpoint';
  }
  if (error instanceof OpenAI.APIError) {
    return `API error${error.status === undefined ? '' : ` ${error.status}`}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

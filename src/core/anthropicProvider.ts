/**
 * The Anthropic client.
 *
 * The request is deliberately narrow: a system prompt Navigator wrote, one
 * piece of context, and a JSON schema with no field that could carry a patch.
 * There is no tool the model could use to touch the workspace, and the caller
 * cannot supply its own prompt — it picks one of the jobs below.
 */

import Anthropic from '@anthropic-ai/sdk';
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

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

/**
 * Room set aside for each job's answer, in tokens.
 *
 * A reservation rather than a cost — but some endpoints bill the reservation
 * against a rate limit, so asking for the maximum on every job is waste that
 * surfaces as a refusal somewhere else (see `openaiProvider.ts`, where it
 * actually did). A review may carry up to `maxObservations` findings; guidance
 * and recall answer with a few short strings.
 */
const REVIEW_MAX_TOKENS = 4096;
const GUIDANCE_MAX_TOKENS = 2048;
const RECALL_MAX_TOKENS = 1024;

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Absent or empty leaves the model's own default in place. */
  readonly effort?: ReviewEffort;
  /** Custom fetch implementation. Used by tests to pin the request shape. */
  readonly fetch?: typeof globalThis.fetch;
}

export class AnthropicReviewProvider implements ReviewProvider, GuidanceProvider, RecallProvider {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: ReviewEffort;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      // A review is a deliberate, user-initiated action: failing fast and
      // letting the developer run it again beats a command that silently hangs.
      maxRetries: 0,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    this.model = options.model?.trim() || DEFAULT_ANTHROPIC_MODEL;
    this.effort = options.effort ?? '';
  }

  review(request: ReviewRequest): Promise<ProviderResponse> {
    return this.ask(
      buildSystemPrompt(request.intensity),
      buildUserPrompt(request.annotatedDiff),
      REVIEW_OUTPUT_SCHEMA,
      REVIEW_MAX_TOKENS,
      'review this change',
      request.signal,
    );
  }

  guide(request: GuidanceRequest): Promise<ProviderResponse> {
    return this.ask(
      buildGuidanceSystemPrompt(),
      buildGuidanceUserPrompt(request.question) + (request.context ?? ''),
      GUIDANCE_OUTPUT_SCHEMA,
      GUIDANCE_MAX_TOKENS,
      'answer',
      request.signal,
    );
  }

  recall(request: RecallRequest): Promise<ProviderResponse> {
    return this.ask(
      buildRecallSystemPrompt(),
      buildRecallUserPrompt(request.description),
      RECALL_OUTPUT_SCHEMA,
      RECALL_MAX_TOKENS,
      'answer',
      request.signal,
    );
  }

  private async ask(
    system: string,
    user: string,
    schema: object,
    maxTokens: number,
    job: string,
    signal: AbortSignal | undefined,
  ): Promise<ProviderResponse> {
    let message;
    try {
      message = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: maxTokens,
          system,
          messages: [{ role: 'user', content: user }],
          output_config: {
            format: { type: 'json_schema', schema: schema as Record<string, unknown> },
            // Omitted entirely when unset, so the model's own default applies
            // rather than Navigator picking one on the developer's behalf.
            ...(this.effort === '' ? {} : { effort: this.effort }),
          },
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        },
        { signal },
      );
    } catch (error) {
      throw new ReviewUnavailableError(describeApiError(error), { cause: error });
    }

    if (message.stop_reason === 'refusal') {
      throw new ReviewUnavailableError(`the model declined to ${job}`);
    }

    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (text.length === 0) {
      throw new ReviewUnavailableError('the model returned an empty response');
    }

    const usage = readUsage(message.usage);
    return usage === undefined ? { text } : { text, usage };
  }
}

export function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'the Anthropic API key was rejected';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'rate limited by the Anthropic API';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'could not reach the Anthropic API';
  }
  if (error instanceof Anthropic.APIUserAbortError) {
    return 'the review was cancelled';
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error${error.status === undefined ? '' : ` ${error.status}`}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

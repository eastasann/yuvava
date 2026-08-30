/**
 * The OpenAI/Codex review provider.
 *
 * Deliberately the same shape as the Anthropic one: same system prompt, same
 * JSON schema, same `ReviewProvider` contract, no tools. The provider swap
 * changes who reviews, never what Navigator is allowed to do with the answer —
 * every response still goes through the same validation and sanitising.
 */

import OpenAI from 'openai';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { REVIEW_OUTPUT_SCHEMA } from './schema.js';
import { ReviewUnavailableError, type ReviewProvider, type ReviewRequest, type ReviewResponse } from './provider.js';

/** Codex-family model, chosen because the whole job is reading diffs. */
export const DEFAULT_OPENAI_MODEL = 'gpt-5.1-codex-max';

/** Reasoning models spend tokens before they answer; leave room for both. */
const MAX_OUTPUT_TOKENS = 8192;

export interface OpenAIProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  /** Custom fetch implementation. Used by tests to pin the request shape. */
  readonly fetch?: typeof globalThis.fetch;
}

export class OpenAIReviewProvider implements ReviewProvider {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: OpenAIProviderOptions) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      // A review is a deliberate, user-initiated action: failing fast and
      // letting the developer run it again beats a command that silently hangs.
      maxRetries: 0,
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    this.model = options.model?.trim() || DEFAULT_OPENAI_MODEL;
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    let response;
    try {
      response = await this.client.responses.create(
        {
          model: this.model,
          instructions: buildSystemPrompt(request.intensity),
          input: buildUserPrompt(request.annotatedDiff),
          max_output_tokens: MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: 'json_schema',
              name: 'navigator_review',
              schema: REVIEW_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
              strict: true,
            },
          },
        },
        { signal: request.signal },
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
      const refusal = findRefusal(response);
      throw new ReviewUnavailableError(
        refusal ?? 'the model returned an empty response',
      );
    }

    return { text };
  }
}

/** Surfaces a content refusal as a reason rather than an empty response. */
function findRefusal(response: OpenAI.Responses.Response): string | undefined {
  for (const item of response.output) {
    if (item.type !== 'message') {
      continue;
    }
    for (const content of item.content) {
      if (content.type === 'refusal') {
        return `the model declined to review this change (${content.refusal})`;
      }
    }
  }
  return undefined;
}

export function describeOpenAIError(error: unknown): string {
  if (error instanceof OpenAI.AuthenticationError) {
    return 'the OpenAI API key was rejected';
  }
  if (error instanceof OpenAI.RateLimitError) {
    return 'rate limited by the OpenAI API';
  }
  if (error instanceof OpenAI.APIUserAbortError) {
    return 'the review was cancelled';
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return 'could not reach the OpenAI API';
  }
  if (error instanceof OpenAI.APIError) {
    return `OpenAI API error${error.status === undefined ? '' : ` ${error.status}`}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

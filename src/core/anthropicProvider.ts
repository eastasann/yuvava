/**
 * The only place Navigator talks to a model.
 *
 * The request is deliberately narrow: a system prompt, one diff, and a JSON
 * schema whose only prose field is `message`. There is no tool the model could
 * use to touch the workspace, and no response field that could carry a patch.
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { REVIEW_OUTPUT_SCHEMA } from './schema.js';
import { ReviewUnavailableError, type ReviewProvider, type ReviewRequest, type ReviewResponse } from './provider.js';

export const DEFAULT_MODEL = 'claude-opus-5';

/** Reviews are short; the schema keeps them shorter. */
const MAX_TOKENS = 4096;

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface AnthropicProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
}

export class AnthropicReviewProvider implements ReviewProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(options: AnthropicProviderOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey, maxRetries: 1 });
    this.model = options.model?.trim() || DEFAULT_MODEL;
  }

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    let message;
    try {
      message = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: MAX_TOKENS,
          system: buildSystemPrompt(request.intensity),
          messages: [{ role: 'user', content: buildUserPrompt(request.annotatedDiff) }],
          output_config: { format: { type: 'json_schema', schema: REVIEW_OUTPUT_SCHEMA } },
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
        },
        { signal: request.signal },
      );
    } catch (error) {
      throw new ReviewUnavailableError(describeApiError(error), { cause: error });
    }

    if (message.stop_reason === 'refusal') {
      throw new ReviewUnavailableError('the model declined to review this change');
    }

    const text = message.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    if (text.length === 0) {
      throw new ReviewUnavailableError('the model returned an empty response');
    }

    return { text };
  }
}

function describeApiError(error: unknown): string {
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

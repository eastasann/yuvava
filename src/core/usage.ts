/**
 * What one request cost, as far as the endpoint will say.
 *
 * There was no way to find out. Reasoning tokens are billed at the output
 * rate and dominate the total for a job like this — small input, thinking
 * before answering — so the cost of a review could only be given as a range
 * three times as wide as its own midpoint. One real number ends that.
 *
 * Three wire shapes, one reader. Anthropic and the OpenAI Responses API use
 * `input_tokens` / `output_tokens`; Chat Completions uses `prompt_tokens` /
 * `completion_tokens`; and an OpenAI-compatible endpoint may report nothing at
 * all, which is not an error.
 */

export interface TokenUsage {
  readonly input?: number;
  readonly output?: number;
  /** Reasoning or thinking tokens, billed as output where they are reported. */
  readonly thinking?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

function nested(container: unknown, keys: readonly string[]): number | undefined {
  if (!isRecord(container)) {
    return undefined;
  }
  for (const key of keys) {
    const found = count(container[key]);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

/**
 * Reads whatever the endpoint reported. Undefined when it reported nothing
 * usable — a fact worth logging, not a failure.
 */
export function readUsage(raw: unknown): TokenUsage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }

  const input = count(raw.input_tokens) ?? count(raw.prompt_tokens);
  const output = count(raw.output_tokens) ?? count(raw.completion_tokens);
  const thinking =
    nested(raw.output_tokens_details, ['thinking_tokens', 'reasoning_tokens']) ??
    nested(raw.completion_tokens_details, ['reasoning_tokens', 'thinking_tokens']);

  if (input === undefined && output === undefined && thinking === undefined) {
    return undefined;
  }
  return {
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
    ...(thinking === undefined ? {} : { thinking }),
  };
}

/** One log line. Says so plainly when the endpoint reported nothing. */
export function describeUsage(usage: TokenUsage | undefined): string {
  if (usage === undefined) {
    return 'tokens: not reported by this endpoint';
  }
  const parts: string[] = [];
  if (usage.input !== undefined) {
    parts.push(`${usage.input} in`);
  }
  if (usage.output !== undefined) {
    parts.push(`${usage.output} out`);
  }
  if (usage.thinking !== undefined) {
    parts.push(`${usage.thinking} thinking`);
  }
  return `tokens: ${parts.join(', ')}`;
}

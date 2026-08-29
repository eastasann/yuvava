/**
 * The contract with the model, and its enforcement.
 *
 * `REVIEW_OUTPUT_SCHEMA` is sent as a structured-output JSON schema, but the
 * response is still validated here: LOOP.md §14 requires that a malformed,
 * partial or hostile response degrade gracefully instead of breaking the
 * extension. Anything that does not validate is dropped, with a reason.
 */

import { SEVERITIES, type Severity } from './types.js';

/** JSON schema handed to the model via `output_config.format`. */
export const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      description: 'Problems worth the developer\'s attention. Empty when there are none.',
      items: {
        type: 'object',
        properties: {
          file: {
            type: 'string',
            description: 'Repository-relative path, exactly as it appears in the diff.',
          },
          line: {
            type: 'integer',
            description: 'Line number from the diff gutter, in the changed file.',
          },
          endLine: {
            type: 'integer',
            description: 'Last line of the affected range. Repeat "line" when it is a single line.',
          },
          severity: {
            type: 'string',
            enum: ['error', 'warning', 'info'],
          },
          category: {
            type: 'string',
            description: 'One of: correctness, edge-case, error-handling, concurrency, security, performance, complexity, regression-risk.',
          },
          message: {
            type: 'string',
            description:
              'One or two sentences: what is wrong and why it matters. Never contains code, a patch, or a suggested replacement.',
          },
          symbol: {
            type: 'string',
            description:
              'An identifier appearing on that line, used only to place the underline. Empty string when there is no obvious one.',
          },
        },
        // Every field is required, and the two that are conceptually optional
        // carry a documented empty value instead. This keeps one schema valid
        // under both Anthropic structured outputs and OpenAI strict mode,
        // which requires `required` to list every property.
        required: ['file', 'line', 'endLine', 'severity', 'category', 'message', 'symbol'],
        additionalProperties: false,
      },
    },
  },
  required: ['issues'],
  additionalProperties: false,
} as const;

/** An issue as reported by the model, before anchoring to the diff. */
export interface RawIssue {
  readonly file: string;
  readonly line: number;
  readonly endLine?: number;
  readonly severity: Severity;
  readonly category: string;
  readonly message: string;
  readonly symbol?: string;
}

export interface ParsedReview {
  readonly issues: readonly RawIssue[];
  /** Human-readable notes about anything discarded while parsing. */
  readonly problems: readonly string[];
}

/**
 * Extracts a JSON object from model output.
 *
 * With structured output the response is already bare JSON, but a fenced block
 * or surrounding prose is cheap to tolerate and keeps a degraded model from
 * failing the whole review.
 */
export function extractJsonObject(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // Only look for a fence when the payload is not already bare JSON: a review
  // message may legitimately quote backticks, and unwrapping those would
  // shred the very response we are trying to read.
  let candidate = trimmed;
  if (!trimmed.startsWith('{')) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fenced) {
      candidate = fenced[1].trim();
    }
  }

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSeverity(value: unknown): Severity | undefined {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value)
    ? (value as Severity)
    : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  const n = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    return undefined;
  }
  const rounded = Math.trunc(n);
  return rounded >= 1 ? rounded : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Validates a model response. Never throws: a broken response yields zero
 * issues plus an explanation, which the caller surfaces as a review failure
 * rather than as edits, notifications, or an exception.
 */
export function parseReviewResponse(text: string): ParsedReview {
  const problems: string[] = [];
  const json = extractJsonObject(text);
  if (json === undefined) {
    return { issues: [], problems: ['response contained no JSON object'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { issues: [], problems: [`response was not valid JSON (${detail})`] };
  }

  if (!isRecord(parsed)) {
    return { issues: [], problems: ['response JSON was not an object'] };
  }

  const rawIssues = parsed.issues;
  if (rawIssues === undefined || rawIssues === null) {
    return { issues: [], problems: [] };
  }
  if (!Array.isArray(rawIssues)) {
    return { issues: [], problems: ['"issues" was not an array'] };
  }

  const issues: RawIssue[] = [];
  rawIssues.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`issue ${index}: not an object`);
      return;
    }
    const file = asNonEmptyString(entry.file);
    const line = asPositiveInteger(entry.line);
    const severity = asSeverity(entry.severity);
    const message = asNonEmptyString(entry.message);

    if (file === undefined) {
      problems.push(`issue ${index}: missing or empty "file"`);
      return;
    }
    if (line === undefined) {
      problems.push(`issue ${index}: missing or invalid "line"`);
      return;
    }
    if (severity === undefined) {
      problems.push(`issue ${index}: unsupported "severity"`);
      return;
    }
    if (message === undefined) {
      problems.push(`issue ${index}: missing or empty "message"`);
      return;
    }

    const endLine = asPositiveInteger(entry.endLine);
    issues.push({
      file,
      line,
      endLine: endLine !== undefined && endLine >= line ? endLine : line,
      severity,
      category: asNonEmptyString(entry.category) ?? 'observation',
      message,
      symbol: asNonEmptyString(entry.symbol),
    });
  });

  return { issues, problems };
}

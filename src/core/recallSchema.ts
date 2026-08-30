/**
 * The contract with the model for recall (SPEC §9), and its enforcement.
 *
 * The four rungs of §9 are four fields, so the caller can show them one at a
 * time. Each is validated by a different sanitiser, and the choice of
 * sanitiser is where the guarantee lives:
 *
 *   name       label  — no code, no URL
 *   signature  must actually *be* a signature, or it is dropped
 *   concept    the review sanitiser — no code survives it at all
 *   search     label  — no code, no URL
 *
 * "No usage examples" (§9) therefore does not depend on the model obeying the
 * prompt: a usage example is not signature-shaped, and it does not survive the
 * review sanitiser either.
 */

import { isSignature } from './hintSanitize.js';
import { extractJsonObject } from './schema.js';
import { sanitizeLabel, sanitizeMessage } from './sanitize.js';

/** More than a few and this is a search result, not a jog of the memory. */
export const MAX_CANDIDATES = 3;

export const RECALL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      description: 'What the developer may have meant, likeliest first. Empty when it is not clear.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The fully qualified name, as the documentation writes it.',
          },
          signature: {
            type: 'string',
            description:
              'The parameter list alone, e.g. "reduce(callbackFn, initialValue?)". Never a call with real arguments. Empty string when there is none.',
          },
          concept: {
            type: 'string',
            description:
              'One sentence on what it does. Never how to use it, and never containing code. Empty string when the name says it.',
          },
          search: {
            type: 'string',
            description: 'A short query that lands on the official documentation. Never a URL.',
          },
        },
        // Every field required with a documented empty value, so one schema is
        // valid under both Anthropic structured outputs and OpenAI strict mode.
        required: ['name', 'signature', 'concept', 'search'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const;

export interface RecallCandidate {
  readonly name: string;
  /** Undefined when the model gave something that was not a signature. */
  readonly signature?: string;
  readonly concept?: string;
  readonly search?: string;
}

export interface ParsedRecall {
  readonly candidates: readonly RecallCandidate[];
  readonly problems: readonly string[];
}

const MAX_NAME_LENGTH = 80;
const MAX_SIGNATURE_LENGTH = 120;
const MAX_SEARCH_LENGTH = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps a signature only when it is one. A usage example is not. */
function asSignature(value: unknown): string | undefined {
  const label = sanitizeLabel(value, MAX_SIGNATURE_LENGTH);
  return label !== undefined && isSignature(label) ? label : undefined;
}

/**
 * Validates a recall response. Never throws: an unusable answer yields no
 * candidates plus an explanation, which the caller surfaces as silence.
 */
export function parseRecallResponse(text: string): ParsedRecall {
  const problems: string[] = [];
  const json = extractJsonObject(text);
  if (json === undefined) {
    return { candidates: [], problems: ['response contained no JSON object'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { candidates: [], problems: [`response was not valid JSON (${detail})`] };
  }

  if (!isRecord(parsed)) {
    return { candidates: [], problems: ['response JSON was not an object'] };
  }

  const raw = parsed.candidates;
  if (raw === undefined || raw === null) {
    return { candidates: [], problems: [] };
  }
  if (!Array.isArray(raw)) {
    return { candidates: [], problems: ['"candidates" was not an array'] };
  }

  const candidates: RecallCandidate[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    if (!isRecord(entry)) {
      problems.push(`candidate ${index}: not an object`);
      return;
    }
    const name = sanitizeLabel(entry.name, MAX_NAME_LENGTH);
    if (name === undefined) {
      problems.push(`candidate ${index}: nothing usable left in "name"`);
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);

    const signature = asSignature(entry.signature);
    const offeredSignature = typeof entry.signature === 'string' && entry.signature.trim().length > 0;
    if (signature === undefined && offeredSignature) {
      problems.push(`candidate ${index}: dropped a "signature" that was not one`);
    }
    // The review sanitiser, deliberately: a concept explains, it never shows.
    const concept = typeof entry.concept === 'string' ? sanitizeMessage(entry.concept).message : undefined;
    const search = sanitizeLabel(entry.search, MAX_SEARCH_LENGTH);

    candidates.push({
      name,
      ...(signature === undefined ? {} : { signature }),
      ...(concept === undefined ? {} : { concept }),
      ...(search === undefined ? {} : { search }),
    });
  });

  if (candidates.length > MAX_CANDIDATES) {
    problems.push(`kept the first ${MAX_CANDIDATES} of ${candidates.length} candidates`);
    candidates.length = MAX_CANDIDATES;
  }

  return { candidates, problems };
}

/** One rung of SPEC §9, in the order the developer may climb them. */
export interface RecallStage {
  readonly kind: 'signature' | 'concept' | 'search';
  readonly text: string;
}

/**
 * The rungs above the name, in §9 order: Signature, Concept, Documentation.
 *
 * The name itself is not here — it is shown first and on its own, which is the
 * whole point (§9: the name alone is usually enough).
 */
export function recallStages(candidate: RecallCandidate): RecallStage[] {
  const stages: RecallStage[] = [];
  if (candidate.signature !== undefined) {
    stages.push({ kind: 'signature', text: candidate.signature });
  }
  if (candidate.concept !== undefined) {
    stages.push({ kind: 'concept', text: candidate.concept });
  }
  if (candidate.search !== undefined) {
    stages.push({ kind: 'search', text: candidate.search });
  }
  return stages;
}

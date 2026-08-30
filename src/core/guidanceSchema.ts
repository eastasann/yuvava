/**
 * The contract with the model for the guidance path, and its enforcement.
 *
 * Two things this schema deliberately cannot express, both structural rather
 * than prompted:
 *
 *   - **code** — there is no field for it, and every string that comes back is
 *     run through the label sanitiser;
 *   - **a URL** — Navigator does not display links a model invented, because
 *     they are wrong often enough that "it appeared as a link" would stop
 *     meaning "it exists". Links come from an index (see `docsIndex.ts`); a
 *     URL in the model's own output is stripped here.
 */

import { extractJsonObject } from './schema.js';
import { sanitizeLabel } from './sanitize.js';

/** Beyond a handful, a list of things to look at stops being navigable. */
export const MAX_TOPICS = 5;
export const MAX_SEARCHES = 4;

export const GUIDANCE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      description: 'The things the developer will have to decide or find out. Empty when there is nothing specific.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The topic itself — an API, a concept, a decision. A few words, not a sentence.',
          },
          note: {
            type: 'string',
            description:
              'A short phrase naming what the topic governs. Never an explanation or an instruction. Empty string when the name says it.',
          },
        },
        // Every field required, with a documented empty value for the
        // conceptually optional one: OpenAI strict mode demands it, and one
        // schema has to serve both providers (see `schema.ts`).
        required: ['name', 'note'],
        additionalProperties: false,
      },
    },
    searches: {
      type: 'array',
      description: 'Literal search queries, two to five words each. Never URLs.',
      items: { type: 'string' },
    },
  },
  required: ['topics', 'searches'],
  additionalProperties: false,
} as const;

export interface GuidanceTopic {
  readonly name: string;
  /** Undefined when the model gave nothing usable beyond the name. */
  readonly note?: string;
}

export interface ParsedGuidance {
  readonly topics: readonly GuidanceTopic[];
  readonly searches: readonly string[];
  /** Human-readable notes about anything discarded while parsing. */
  readonly problems: readonly string[];
}

const MAX_NAME_LENGTH = 60;
const MAX_NOTE_LENGTH = 120;
const MAX_SEARCH_LENGTH = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a guidance response. Never throws: a broken answer yields an empty
 * guidance plus an explanation, which the caller surfaces as silence.
 */
export function parseGuidanceResponse(text: string): ParsedGuidance {
  const problems: string[] = [];
  const json = extractJsonObject(text);
  if (json === undefined) {
    return { topics: [], searches: [], problems: ['response contained no JSON object'] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { topics: [], searches: [], problems: [`response was not valid JSON (${detail})`] };
  }

  if (!isRecord(parsed)) {
    return { topics: [], searches: [], problems: ['response JSON was not an object'] };
  }

  const topics: GuidanceTopic[] = [];
  const rawTopics = parsed.topics;
  if (rawTopics !== undefined && rawTopics !== null) {
    if (!Array.isArray(rawTopics)) {
      problems.push('"topics" was not an array');
    } else {
      const seen = new Set<string>();
      rawTopics.forEach((entry, index) => {
        if (!isRecord(entry)) {
          problems.push(`topic ${index}: not an object`);
          return;
        }
        const name = sanitizeLabel(entry.name, MAX_NAME_LENGTH);
        if (name === undefined) {
          problems.push(`topic ${index}: nothing usable left in "name"`);
          return;
        }
        const key = name.toLowerCase();
        if (seen.has(key)) {
          problems.push(`topic ${index}: duplicate of an earlier topic`);
          return;
        }
        seen.add(key);
        const note = sanitizeLabel(entry.note, MAX_NOTE_LENGTH);
        topics.push(note === undefined ? { name } : { name, note });
      });
    }
  }

  const searches: string[] = [];
  const rawSearches = parsed.searches;
  if (rawSearches !== undefined && rawSearches !== null) {
    if (!Array.isArray(rawSearches)) {
      problems.push('"searches" was not an array');
    } else {
      const seen = new Set<string>();
      rawSearches.forEach((entry, index) => {
        const term = sanitizeLabel(entry, MAX_SEARCH_LENGTH);
        if (term === undefined) {
          problems.push(`search ${index}: nothing usable left`);
          return;
        }
        const key = term.toLowerCase();
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        searches.push(term);
      });
    }
  }

  if (topics.length > MAX_TOPICS) {
    problems.push(`kept the first ${MAX_TOPICS} of ${topics.length} topics`);
    topics.length = MAX_TOPICS;
  }
  if (searches.length > MAX_SEARCHES) {
    problems.push(`kept the first ${MAX_SEARCHES} of ${searches.length} searches`);
    searches.length = MAX_SEARCHES;
  }

  return { topics, searches, problems };
}

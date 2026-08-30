/**
 * Model answers the eval can be scored against without a network.
 *
 * Two sources, in order:
 *
 *   1. `test/eval/recorded/<case>.<intensity>.json`, written by
 *      `npm run eval -- --record` against a real endpoint;
 *   2. the stand-ins below, used where no recording exists.
 *
 * **The stand-ins are written by hand, and a green run against them says
 * nothing about review quality.** What it does say is that the pipeline —
 * validation, anchoring, sanitising, silence — turns a given answer into the
 * observations it should, and that the scorer counts them the way it claims
 * to. That is a regression test, and it is the part that can be kept honest
 * without an API key.
 *
 * Reviews are ranked by the numbers `scripts/eval.mjs` prints from a real
 * endpoint. Nothing here substitutes for that.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { ReviewIntensity } from '../../src/core/types.js';

export interface RecordedAnswer {
  /** Raw model output, exactly as the provider returned it. */
  readonly text: string;
  /** True when it came from a real endpoint rather than from the table below. */
  readonly real: boolean;
}

function issues(...entries: Array<Record<string, unknown>>): string {
  return JSON.stringify({ issues: entries });
}

const NOTHING = issues();

/**
 * Hand-written stand-ins, chosen to exercise every branch of the scorer:
 * a clean hit, a miss, an extra observation on a case that had a real bug,
 * an observation on a change that was fine, and a response that is rubbish.
 */
const STAND_INS: Readonly<Record<string, string>> = {
  'empty-input-division:silent': issues({
    file: 'src/scores.js',
    line: 4,
    endLine: 4,
    severity: 'error',
    category: 'edge-case',
    message: 'An empty results array makes scores.length zero, so this returns NaN.',
    symbol: 'total',
  }),
  'empty-input-division:normal': issues({
    file: 'src/scores.js',
    line: 4,
    endLine: 4,
    severity: 'error',
    category: 'edge-case',
    message: 'An empty results array makes scores.length zero, so this returns NaN.',
    symbol: 'total',
  }),
  'empty-input-division:strict': issues(
    {
      file: 'src/scores.js',
      line: 4,
      endLine: 4,
      severity: 'error',
      category: 'edge-case',
      message: 'An empty results array makes scores.length zero, so this returns NaN.',
      symbol: 'total',
    },
    {
      // True, and nobody needed to hear it: this is what the noise rate counts.
      file: 'src/scores.js',
      line: 2,
      endLine: 2,
      severity: 'info',
      category: 'complexity',
      message: 'The intermediate array could be avoided by folding in one pass.',
      symbol: 'scores',
    },
  ),
  'retry-returns-nothing:silent': issues({
    file: 'src/profile.js',
    line: 7,
    endLine: 7,
    severity: 'error',
    category: 'correctness',
    message: 'When every attempt fails the loop ends and the function returns undefined.',
    symbol: '',
  }),
  'retry-returns-nothing:normal': issues({
    file: 'src/profile.js',
    line: 7,
    endLine: 7,
    severity: 'error',
    category: 'correctness',
    message: 'When every attempt fails the loop ends and the function returns undefined.',
    symbol: '',
  }),
  'retry-returns-nothing:strict': issues({
    file: 'src/profile.js',
    line: 7,
    endLine: 7,
    severity: 'error',
    category: 'correctness',
    message: 'When every attempt fails the loop ends and the function returns undefined.',
    symbol: '',
  }),
  'optional-field:silent': NOTHING,
  'optional-field:normal': issues({
    file: 'src/tags.js',
    line: 2,
    endLine: 3,
    severity: 'warning',
    category: 'edge-case',
    message: 'tags is optional on the response, so this can be undefined before map runs.',
    symbol: 'tags',
  }),
  'optional-field:strict': issues({
    file: 'src/tags.js',
    line: 2,
    endLine: 3,
    severity: 'warning',
    category: 'edge-case',
    message: 'tags is optional on the response, so this can be undefined before map runs.',
    symbol: 'tags',
  }),
  'cache-races:silent': NOTHING,
  // A miss: the answer lands on the wrong concern, so nothing matches.
  'cache-races:normal': issues({
    file: 'src/loadOnce.js',
    line: 9,
    endLine: 9,
    severity: 'info',
    category: 'complexity',
    message: 'The map is never cleared, so it grows for the lifetime of the process.',
    symbol: 'pending',
  }),
  'cache-races:strict': issues({
    file: 'src/loadOnce.js',
    line: 7,
    endLine: 8,
    severity: 'warning',
    category: 'concurrency',
    message: 'Two concurrent calls for the same key both load, because the promise is not stored in flight.',
    symbol: 'pending',
  }),
  'quadratic-dedupe:silent': NOTHING,
  'quadratic-dedupe:normal': NOTHING,
  'quadratic-dedupe:strict': issues({
    file: 'src/people.js',
    line: 4,
    endLine: 4,
    severity: 'warning',
    category: 'performance',
    message: 'Scanning the array for each person makes this O(n squared) as the list grows.',
    symbol: 'includes',
  }),
  'path-traversal:silent': NOTHING,
  'path-traversal:normal': NOTHING,
  'path-traversal:strict': issues({
    file: 'src/assets.js',
    line: 4,
    endLine: 4,
    severity: 'error',
    category: 'security',
    message: 'A requested path containing .. escapes the root, so this can reach files outside it.',
    symbol: 'join',
  }),
  'silent-rename:silent': NOTHING,
  'silent-rename:normal': NOTHING,
  'silent-rename:strict': NOTHING,
  'silent-test-added:silent': NOTHING,
  'silent-test-added:normal': NOTHING,
  // A false positive: a correct change, spoken about anyway.
  'silent-test-added:strict': issues({
    file: 'test/date.test.js',
    line: 7,
    endLine: 7,
    severity: 'info',
    category: 'complexity',
    message: 'This test asserts one case; a table would cover the boundaries more cheaply.',
    symbol: '',
  }),
  'silent-comment:silent': NOTHING,
  'silent-comment:normal': NOTHING,
  // Rubbish: the pipeline must turn this into silence rather than into an error.
  'silent-comment:strict': 'I was unable to review this change.',
};

const RECORDINGS_DIR = path.resolve(__dirname, '..', '..', '..', 'test', 'eval', 'recorded');

/** Real recordings on disk, keyed `<case>:<intensity>`. Empty is normal. */
export function loadRecordings(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  let names: string[];
  try {
    names = readdirSync(RECORDINGS_DIR);
  } catch {
    return found;
  }

  for (const name of names) {
    const parsed = /^(.+)\.(silent|normal|strict)\.json$/.exec(name);
    if (parsed === null) {
      continue;
    }
    try {
      const body: unknown = JSON.parse(readFileSync(path.join(RECORDINGS_DIR, name), 'utf8'));
      if (typeof body === 'object' && body !== null && typeof (body as { text?: unknown }).text === 'string') {
        found.set(`${parsed[1]}:${parsed[2]}`, (body as { text: string }).text);
      }
    } catch {
      // A corrupt recording is skipped; the stand-in covers for it.
    }
  }
  return found;
}

export function answerFor(
  caseId: string,
  intensity: ReviewIntensity,
  recordings: ReadonlyMap<string, string> = loadRecordings(),
): RecordedAnswer | undefined {
  const key = `${caseId}:${intensity}`;
  const real = recordings.get(key);
  if (real !== undefined) {
    return { text: real, real: true };
  }
  const standIn = STAND_INS[key];
  return standIn === undefined ? undefined : { text: standIn, real: false };
}

export const STAND_IN_KEYS: readonly string[] = Object.keys(STAND_INS);

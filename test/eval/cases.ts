/**
 * The eval set: synthetic diffs with known answers.
 *
 * `SPEC.md` §7 (Silence by Default) is the product's central claim, and until
 * something measures it, "the prompt seems good" is the only evidence there is.
 * These cases exist so a prompt change can be compared against a prompt.
 *
 * **Everything here is written for the purpose.** `LOOP.md` §2.2 forbids code
 * that was actually under review from entering this repository, which is
 * public; the cases are invented, and any that are ever added must be too.
 *
 * Three quarters of the value is in the `silent` cases. Finding a planted bug
 * is the easy half of the job — saying nothing about a rename is the half the
 * product is actually betting on.
 */

import type { ReviewIntensity } from '../../src/core/types.js';

/** One thing a review is expected to notice. */
export interface Expectation {
  readonly file: string;
  /** 1-based line in the changed file. */
  readonly line: number;
  /**
   * At least one of these must appear in the message, case-insensitively.
   * Without it, an observation could be credited for landing on the right
   * line while talking about something else entirely.
   */
  readonly mentions: readonly string[];
  /** The weakest intensity at which this must be reported. */
  readonly from: ReviewIntensity;
}

export interface EvalCase {
  readonly id: string;
  /** What the case is about, for the report. */
  readonly summary: string;
  readonly diff: string;
  readonly expected: readonly Expectation[];
  /** True when the correct review is silence, at every intensity. */
  readonly silent: boolean;
}

/** Weakest to strongest, so an expectation applies from its level upward. */
const ORDER: Record<ReviewIntensity, number> = { silent: 0, normal: 1, strict: 2 };

export function appliesAt(expectation: Expectation, intensity: ReviewIntensity): boolean {
  return ORDER[intensity] >= ORDER[expectation.from];
}

export function expectationsAt(
  testCase: EvalCase,
  intensity: ReviewIntensity,
): readonly Expectation[] {
  return testCase.expected.filter((expectation) => appliesAt(expectation, intensity));
}

/**
 * A whole new file, rendered the way `untracked.ts` renders one.
 *
 * Line N of the content is line N of the file, which makes an expectation's
 * line number something that can be read off the array rather than counted
 * through a hunk header.
 */
export function newFileDiff(path: string, lines: readonly string[]): string {
  const body = lines.map((line) => `+${line}`).join('\n');
  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
    '',
  ].join('\n');
}

/**
 * A whole-file rewrite: every old line removed, every new line added.
 *
 * Crude next to what git emits, and exact about line numbers, which is what
 * matters for an expectation.
 */
export function rewriteDiff(path: string, before: readonly string[], after: readonly string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...before.map((line) => `-${line}`),
    ...after.map((line) => `+${line}`),
    '',
  ].join('\n');
}

const AVERAGE = [
  'export function averageScore(results) {',
  '  const scores = results.map((result) => result.score);',
  '  const total = scores.reduce((sum, score) => sum + score, 0);',
  '  return total / scores.length;',
  '}',
];

const FETCH_RETRY = [
  'export async function loadProfile(id) {',
  '  for (let attempt = 0; attempt <= 3; attempt++) {',
  '    const response = await fetch(`/api/profile/${id}`);',
  '    if (response.ok) {',
  '      return response.json();',
  '    }',
  '  }',
  '}',
];

const TAGS = [
  'export function tagLabels(post) {',
  '  const tags = post.metadata.tags;',
  '  return tags.map((tag) => tag.label).join(", ");',
  '}',
];

const CACHE = [
  'const pending = new Map();',
  '',
  'export async function loadOnce(key, load) {',
  '  if (pending.has(key)) {',
  '    return pending.get(key);',
  '  }',
  '  const value = await load(key);',
  '  pending.set(key, value);',
  '  return value;',
  '}',
];

const DUPLICATES = [
  'export function uniqueNames(people) {',
  '  const seen = [];',
  '  for (const person of people) {',
  '    if (!seen.includes(person.name)) {',
  '      seen.push(person.name);',
  '    }',
  '  }',
  '  return seen;',
  '}',
];

const ASSET_PATH = [
  'import { join } from "node:path";',
  '',
  'export function assetPath(root, requested) {',
  '  return join(root, requested);',
  '}',
];

const RENAMED_BEFORE = [
  'export function fmt(d) {',
  '  return `${d.getFullYear()}-${d.getMonth() + 1}`;',
  '}',
];

const RENAMED_AFTER = [
  'export function formatYearMonth(date) {',
  '  return `${date.getFullYear()}-${date.getMonth() + 1}`;',
  '}',
];

const TEST_ADDITION = [
  'import { describe, it } from "node:test";',
  'import assert from "node:assert/strict";',
  'import { formatYearMonth } from "./date.js";',
  '',
  'describe("formatYearMonth", () => {',
  '  it("uses a one-based month", () => {',
  '    assert.equal(formatYearMonth(new Date(2024, 0, 15)), "2024-1");',
  '  });',
  '});',
];

const COMMENT_BEFORE = [
  'export function slugify(title) {',
  '  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");',
  '}',
];

const COMMENT_AFTER = [
  '// Matches the slug rules the CMS applies on its side.',
  'export function slugify(title) {',
  '  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");',
  '}',
];

export const EVAL_CASES: readonly EvalCase[] = [
  {
    id: 'empty-input-division',
    summary: 'Averaging an empty list divides by zero.',
    diff: newFileDiff('src/scores.js', AVERAGE),
    silent: false,
    expected: [
      { file: 'src/scores.js', line: 4, mentions: ['empty', 'zero', 'length', 'nan'], from: 'silent' },
    ],
  },
  {
    id: 'retry-returns-nothing',
    summary: 'Every attempt failing falls out of the loop and returns undefined.',
    diff: newFileDiff('src/profile.js', FETCH_RETRY),
    silent: false,
    expected: [
      {
        file: 'src/profile.js',
        line: 7,
        mentions: ['undefined', 'exhaust', 'all attempts', 'falls through', 'no value'],
        from: 'silent',
      },
    ],
  },
  {
    id: 'optional-field',
    summary: 'An optional response field is used without a guard.',
    diff: newFileDiff('src/tags.js', TAGS),
    silent: false,
    expected: [
      { file: 'src/tags.js', line: 2, mentions: ['tags', 'undefined', 'optional', 'missing'], from: 'normal' },
    ],
  },
  {
    id: 'cache-races',
    summary: 'The in-flight map stores the value, not the promise, so concurrent calls both load.',
    diff: newFileDiff('src/loadOnce.js', CACHE),
    silent: false,
    expected: [
      {
        file: 'src/loadOnce.js',
        line: 7,
        mentions: ['concurrent', 'race', 'promise', 'twice', 'in flight', 'in-flight'],
        from: 'normal',
      },
    ],
  },
  {
    id: 'quadratic-dedupe',
    summary: 'Deduplicating with an array scan is quadratic.',
    diff: newFileDiff('src/people.js', DUPLICATES),
    silent: false,
    expected: [
      {
        file: 'src/people.js',
        line: 4,
        mentions: ['quadratic', 'o(n', 'set', 'linear scan', 'includes'],
        from: 'strict',
      },
    ],
  },
  {
    id: 'path-traversal',
    summary: 'A request-supplied path is joined onto a root with no containment check.',
    diff: newFileDiff('src/assets.js', ASSET_PATH),
    silent: false,
    expected: [
      {
        file: 'src/assets.js',
        line: 4,
        mentions: ['traversal', 'escape', '..', 'outside', 'contain'],
        from: 'strict',
      },
    ],
  },
  {
    id: 'silent-rename',
    summary: 'A rename to clearer names, behaviour identical.',
    diff: rewriteDiff('src/date.js', RENAMED_BEFORE, RENAMED_AFTER),
    silent: true,
    expected: [],
  },
  {
    id: 'silent-test-added',
    summary: 'A straightforward test for existing behaviour.',
    diff: newFileDiff('test/date.test.js', TEST_ADDITION),
    silent: true,
    expected: [],
  },
  {
    id: 'silent-comment',
    summary: 'A comment explaining why, with no code change.',
    diff: rewriteDiff('src/slug.js', COMMENT_BEFORE, COMMENT_AFTER),
    silent: true,
    expected: [],
  },
];

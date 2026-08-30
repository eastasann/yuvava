/**
 * Scoring an answer against what was expected of it.
 *
 * Four numbers, because `SPEC.md` §7 makes four different claims and three of
 * them are about restraint:
 *
 *   miss rate            planted bugs that went unreported
 *   false-positive rate  observations on a change that had nothing wrong
 *   noise rate           true-or-not, it was not what the case was about
 *   silence correctness  changes that correctly produced no output at all
 *
 * The distinction between a false positive and noise is mechanical, not a
 * judgement: on a `silent` case every answer is a false positive, and on a case
 * that expected something, an answer matching none of it is noise. Noise here
 * means *unasked-for*, not *wrong* — a model can be right about something
 * nobody needed to hear, which is exactly what §7 is trying to suppress.
 *
 * Every path scores into the same four numbers, and the tallying and the
 * formatting live here once. What differs is only how an answer is matched
 * against an expectation, which is each path's own business. Three copies of
 * one decision is how #35 came to exist three times over.
 */

import type { Observation, ReviewIntensity } from '../../src/core/types.js';
import { expectationsAt, type EvalCase, type Expectation } from './cases.js';
import type { GuidanceCase, RecallCase } from './questionCases.js';

/**
 * How far from the cited line an observation may land and still count.
 *
 * A bug and the line that reveals it are often a line or two apart, and
 * insisting on the exact line would measure line-citing rather than reviewing.
 */
export const LINE_TOLERANCE = 2;

export function matches(observation: Observation, expectation: Expectation): boolean {
  if (observation.file !== expectation.file) {
    return false;
  }
  const near =
    observation.line >= expectation.line - LINE_TOLERANCE &&
    observation.line <= expectation.line + LINE_TOLERANCE;
  if (!near) {
    return false;
  }
  const message = observation.message.toLowerCase();
  return expectation.mentions.some((mention) => message.includes(mention.toLowerCase()));
}

/**
 * One case's result, in terms every path shares.
 *
 * `missed` and `unexpected` are rendered descriptions rather than typed
 * findings, because a review's are a file and a line and a question's are a
 * topic name, and the tally does not care which.
 */
export interface CaseResult {
  readonly id: string;
  readonly silent: boolean;
  /** How many things the model said. Observations, topics, candidates. */
  readonly answers: number;
  readonly expected: number;
  readonly matched: number;
  /** Expectations nothing was said about. */
  readonly missed: readonly string[];
  /** Said, and not what was expected. On a silent case, a false positive. */
  readonly unexpected: readonly string[];
  /** Set when the answer could not be produced at all. */
  readonly failure?: string;
}

export interface Scorecard {
  /** What was scored: an intensity for a review, a path for a question. */
  readonly label: string;
  readonly cases: number;
  readonly scored: number;
  readonly failures: number;
  readonly expected: number;
  readonly matched: number;
  readonly missed: number;
  readonly answers: number;
  readonly falsePositives: number;
  readonly noise: number;
  readonly silentCases: number;
  readonly silentCasesCorrect: number;
  /** Missed expectations over expectations. Lower is better. */
  readonly missRate: number;
  /** Answers on silent cases over all answers. Lower is better. */
  readonly falsePositiveRate: number;
  /** Unexpected answers over all answers. Lower is better. */
  readonly noiseRate: number;
  /** Silent cases that produced nothing, over silent cases. Higher is better. */
  readonly silenceCorrectness: number;
  readonly results: readonly CaseResult[];
}

/** What a run of one case produced. A failure is data, not an exception. */
export interface CaseOutcome {
  readonly observations: readonly Observation[];
  readonly failure?: string;
}

function describeObservation(observation: Observation): string {
  return `${observation.file}:${observation.line} ${observation.message}`;
}

function describeExpectation(expectation: Expectation): string {
  return `${expectation.file}:${expectation.line} (${expectation.mentions[0]})`;
}

export function scoreReviewCase(
  testCase: EvalCase,
  intensity: ReviewIntensity,
  outcome: CaseOutcome,
): CaseResult {
  const expectations = expectationsAt(testCase, intensity);
  const missed: Expectation[] = [];
  const claimed = new Set<Observation>();

  for (const expectation of expectations) {
    const hit = outcome.observations.find(
      (observation) => !claimed.has(observation) && matches(observation, expectation),
    );
    if (hit === undefined) {
      missed.push(expectation);
    } else {
      claimed.add(hit);
    }
  }

  return {
    id: testCase.id,
    silent: testCase.silent,
    answers: outcome.observations.length,
    expected: expectations.length,
    matched: expectations.length - missed.length,
    missed: missed.map(describeExpectation),
    unexpected: outcome.observations
      .filter((observation) => !claimed.has(observation))
      .map(describeObservation),
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 1000;
}

export function scoreAll(label: string, results: readonly CaseResult[]): Scorecard {
  const scored = results.filter((result) => result.failure === undefined);
  const silentCases = scored.filter((result) => result.silent);

  const expected = scored.reduce((sum, result) => sum + result.expected, 0);
  const matched = scored.reduce((sum, result) => sum + result.matched, 0);
  const answers = scored.reduce((sum, result) => sum + result.answers, 0);
  const falsePositives = silentCases.reduce((sum, result) => sum + result.answers, 0);
  const noise = scored
    .filter((result) => !result.silent)
    .reduce((sum, result) => sum + result.unexpected.length, 0);
  const silentCasesCorrect = silentCases.filter((result) => result.answers === 0).length;

  return {
    label,
    cases: results.length,
    scored: scored.length,
    failures: results.length - scored.length,
    expected,
    matched,
    missed: expected - matched,
    answers,
    falsePositives,
    noise,
    silentCases: silentCases.length,
    silentCasesCorrect,
    missRate: ratio(expected - matched, expected),
    falsePositiveRate: ratio(falsePositives, answers),
    noiseRate: ratio(noise, answers),
    silenceCorrectness: silentCases.length === 0 ? 1 : ratio(silentCasesCorrect, silentCases.length),
    results,
  };
}

/** A fixed-width line per scorecard, so two runs can be diffed by eye. */
export function formatScorecard(card: Scorecard): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`.padStart(6);
  return (
    `${card.label.padEnd(9)} ` +
    `cases ${String(card.scored).padStart(2)}/${card.cases}  ` +
    `miss ${percent(card.missRate)} (${card.missed}/${card.expected})  ` +
    `false-positive ${percent(card.falsePositiveRate)} (${card.falsePositives}/${card.answers})  ` +
    `noise ${percent(card.noiseRate)} (${card.noise}/${card.answers})  ` +
    `silence ${percent(card.silenceCorrectness)} (${card.silentCasesCorrect}/${card.silentCases})`
  );
}

/**
 * Scoring a guidance answer (SPEC §10).
 *
 * `answers` counts topics and search terms together: both are things put in
 * front of the developer, and §7 is about how much is put there.
 *
 * Noise is not "anything the case did not predict" — a question can surface a
 * topic the fixture never thought of, and punishing that would measure the
 * fixture rather than the answer. It is the presence of filler: words true of
 * almost any task, which is precisely what §7 asks to be left unsaid.
 */
export function scoreGuidanceCase(
  testCase: GuidanceCase,
  outcome: { readonly topics: readonly string[]; readonly searches: readonly string[]; readonly failure?: string },
): CaseResult {
  const said = [...outcome.topics, ...outcome.searches];
  const haystack = said.join(' \n ').toLowerCase();

  const missed = testCase.expected
    .filter((expectation) => !expectation.mentions.some((m) => haystack.includes(m.toLowerCase())))
    .map((expectation) => expectation.mentions[0]);

  const vague = testCase.silent
    ? said
    : said.filter((entry) =>
        testCase.vague.some((filler) => entry.toLowerCase().includes(filler.toLowerCase())),
      );

  return {
    id: testCase.id,
    silent: testCase.silent,
    answers: said.length,
    expected: testCase.expected.length,
    matched: testCase.expected.length - missed.length,
    missed,
    unexpected: vague,
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
  };
}

/**
 * Scoring a recall answer (SPEC §9).
 *
 * Noise here is *extra candidates*. The name is what was forgotten, and once
 * it is on screen the others are a menu to choose from — which is the opposite
 * of remembering. §9's prompt asks for an empty list rather than three guesses
 * for the same reason.
 */
export function scoreRecallCase(
  testCase: RecallCase,
  outcome: { readonly candidates: readonly string[]; readonly failure?: string },
): CaseResult {
  const claimed = new Set<string>();
  const missed = testCase.expected
    .filter((expectation) => {
      const hit = outcome.candidates.find(
        (name) =>
          !claimed.has(name) &&
          expectation.mentions.some((m) => name.toLowerCase().includes(m.toLowerCase())),
      );
      if (hit === undefined) {
        return true;
      }
      claimed.add(hit);
      return false;
    })
    .map((expectation) => expectation.mentions[0]);

  return {
    id: testCase.id,
    silent: testCase.silent,
    answers: outcome.candidates.length,
    expected: testCase.expected.length,
    matched: testCase.expected.length - missed.length,
    missed,
    unexpected: outcome.candidates.filter((name) => !claimed.has(name)),
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
  };
}

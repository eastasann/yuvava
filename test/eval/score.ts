/**
 * Scoring a review against known answers.
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
 * judgement: on a `silent` case every observation is a false positive, and on
 * a case with planted bugs an observation matching none of them is noise. Noise
 * here means *unasked-for*, not *wrong* — a model can be right about something
 * nobody needed to hear, which is exactly what §7 is trying to suppress.
 */

import type { Observation, ReviewIntensity } from '../../src/core/types.js';
import { expectationsAt, type EvalCase, type Expectation } from './cases.js';

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

export interface CaseResult {
  readonly id: string;
  readonly silent: boolean;
  readonly observations: number;
  readonly expected: number;
  readonly matched: number;
  /** Expectations nothing was said about. */
  readonly missed: readonly Expectation[];
  /** Observations matching no expectation: false positives on a silent case. */
  readonly unexpected: readonly Observation[];
  /** Set when the review could not be produced at all. */
  readonly failure?: string;
}

export interface Scorecard {
  readonly intensity: ReviewIntensity;
  readonly cases: number;
  readonly scored: number;
  readonly failures: number;
  readonly expected: number;
  readonly matched: number;
  readonly missed: number;
  readonly observations: number;
  readonly falsePositives: number;
  readonly noise: number;
  readonly silentCases: number;
  readonly silentCasesCorrect: number;
  /** Missed expectations over expectations. Lower is better. */
  readonly missRate: number;
  /** Observations on silent cases over all observations. Lower is better. */
  readonly falsePositiveRate: number;
  /** Unexpected observations over all observations. Lower is better. */
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

export function scoreCase(
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
    observations: outcome.observations.length,
    expected: expectations.length,
    matched: expectations.length - missed.length,
    missed,
    unexpected: outcome.observations.filter((observation) => !claimed.has(observation)),
    ...(outcome.failure === undefined ? {} : { failure: outcome.failure }),
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 1000) / 1000;
}

export function scoreAll(
  intensity: ReviewIntensity,
  results: readonly CaseResult[],
): Scorecard {
  const scored = results.filter((result) => result.failure === undefined);
  const silentCases = scored.filter((result) => result.silent);

  const expected = scored.reduce((sum, result) => sum + result.expected, 0);
  const matched = scored.reduce((sum, result) => sum + result.matched, 0);
  const observations = scored.reduce((sum, result) => sum + result.observations, 0);
  const falsePositives = silentCases.reduce((sum, result) => sum + result.observations, 0);
  const noise = scored
    .filter((result) => !result.silent)
    .reduce((sum, result) => sum + result.unexpected.length, 0);
  const silentCasesCorrect = silentCases.filter((result) => result.observations === 0).length;

  return {
    intensity,
    cases: results.length,
    scored: scored.length,
    failures: results.length - scored.length,
    expected,
    matched,
    missed: expected - matched,
    observations,
    falsePositives,
    noise,
    silentCases: silentCases.length,
    silentCasesCorrect,
    missRate: ratio(expected - matched, expected),
    falsePositiveRate: ratio(falsePositives, observations),
    noiseRate: ratio(noise, observations),
    silenceCorrectness: silentCases.length === 0 ? 1 : ratio(silentCasesCorrect, silentCases.length),
    results,
  };
}

/** A fixed-width line per intensity, so two runs can be diffed by eye. */
export function formatScorecard(card: Scorecard): string {
  const percent = (value: number): string => `${(value * 100).toFixed(1)}%`.padStart(6);
  return (
    `${card.intensity.padEnd(6)} ` +
    `cases ${String(card.scored).padStart(2)}/${card.cases}  ` +
    `miss ${percent(card.missRate)} (${card.missed}/${card.expected})  ` +
    `false-positive ${percent(card.falsePositiveRate)} (${card.falsePositives}/${card.observations})  ` +
    `noise ${percent(card.noiseRate)} (${card.noise}/${card.observations})  ` +
    `silence ${percent(card.silenceCorrectness)} (${card.silentCasesCorrect}/${card.silentCases})`
  );
}

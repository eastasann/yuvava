/**
 * The eval harness (issue #17), run against answers rather than against a
 * model.
 *
 * What this proves: the cases are well formed, the scorer counts what it says
 * it counts, and a given answer produces the observations it should once the
 * pipeline has validated, anchored and sanitised it.
 *
 * What it does not prove: anything about review quality. That number comes
 * from `npm run eval` against a real endpoint, and has never been produced —
 * see `PROGRESS.md`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVAL_CASES, expectationsAt, newFileDiff, rewriteDiff } from './eval/cases.js';
import { LINE_TOLERANCE, formatScorecard, matches, scoreAll, scoreCase } from './eval/score.js';
import { STAND_IN_KEYS, answerFor, loadRecordings } from './eval/recorded.js';
import { isLineInDiff, parseUnifiedDiff, reviewableFiles } from '../src/core/diff.js';
import { runReview } from '../src/core/review.js';
import { REVIEW_INTENSITIES, type Observation, type ReviewIntensity } from '../src/core/types.js';
import type { ReviewProvider } from '../src/core/provider.js';

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    file: 'src/scores.js',
    line: 4,
    endLine: 4,
    severity: 'warning',
    category: 'edge-case',
    message: 'An empty list makes this divide by zero.',
    ...overrides,
  };
}

describe('the eval cases are well formed', () => {
  it('has both planted bugs and changes that should be met with silence', () => {
    assert.ok(EVAL_CASES.some((testCase) => testCase.silent));
    assert.ok(EVAL_CASES.some((testCase) => !testCase.silent));
    assert.ok(EVAL_CASES.length >= 6);
  });

  it('gives every case a unique id', () => {
    const ids = EVAL_CASES.map((testCase) => testCase.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('produces a diff the parser understands, for every case', () => {
    for (const testCase of EVAL_CASES) {
      const files = reviewableFiles(parseUnifiedDiff(testCase.diff));
      assert.ok(files.length > 0, `${testCase.id} produced no reviewable file`);
    }
  });

  it('expects observations only on lines the diff actually contains', () => {
    // Without this the harness would measure anchoring rather than reviewing:
    // an expectation outside a hunk can never be matched, because `anchor.ts`
    // discards it before it becomes an observation.
    for (const testCase of EVAL_CASES) {
      const files = reviewableFiles(parseUnifiedDiff(testCase.diff));
      for (const expectation of testCase.expected) {
        const file = files.find((entry) => entry.path === expectation.file);
        assert.ok(file, `${testCase.id}: ${expectation.file} is not in the diff`);
        assert.ok(
          isLineInDiff(file, expectation.line),
          `${testCase.id}: line ${expectation.line} of ${expectation.file} is outside the diff`,
        );
      }
    }
  });

  it('expects nothing at all from a silent case', () => {
    for (const testCase of EVAL_CASES.filter((entry) => entry.silent)) {
      assert.deepEqual(testCase.expected, [], `${testCase.id} is silent but expects something`);
    }
  });

  it('scopes expectations by intensity, weakest upward', () => {
    const strictOnly = EVAL_CASES.find((testCase) => testCase.id === 'quadratic-dedupe');
    assert.ok(strictOnly);
    assert.equal(expectationsAt(strictOnly, 'silent').length, 0);
    assert.equal(expectationsAt(strictOnly, 'normal').length, 0);
    assert.equal(expectationsAt(strictOnly, 'strict').length, 1);

    const always = EVAL_CASES.find((testCase) => testCase.id === 'empty-input-division');
    assert.ok(always);
    for (const intensity of REVIEW_INTENSITIES) {
      assert.equal(expectationsAt(always, intensity).length, 1);
    }
  });
});

describe('the diff builders', () => {
  it('numbers a new file so line N is line N', () => {
    const diff = newFileDiff('src/a.js', ['one', 'two', 'three']);
    const [file] = reviewableFiles(parseUnifiedDiff(diff));
    assert.equal(file.hunks[0].newStart, 1);
    assert.equal(file.hunks[0].newEnd, 3);
  });

  it('numbers a rewrite from the new side', () => {
    const diff = rewriteDiff('src/a.js', ['old'], ['new one', 'new two']);
    const [file] = reviewableFiles(parseUnifiedDiff(diff));
    assert.equal(file.hunks[0].newStart, 1);
    assert.equal(file.hunks[0].newEnd, 2);
  });
});

describe('matching an observation to an expectation', () => {
  const expectation = {
    file: 'src/scores.js',
    line: 4,
    mentions: ['empty', 'zero'],
    from: 'silent' as const,
  };

  it('accepts the right line, or near it', () => {
    assert.equal(matches(observation(), expectation), true);
    assert.equal(matches(observation({ line: 4 + LINE_TOLERANCE }), expectation), true);
    assert.equal(matches(observation({ line: 4 + LINE_TOLERANCE + 1 }), expectation), false);
  });

  it('refuses the right line in the wrong file', () => {
    assert.equal(matches(observation({ file: 'src/other.js' }), expectation), false);
  });

  it('refuses the right line for the wrong reason', () => {
    // Landing on the line while talking about something else is not a find.
    assert.equal(
      matches(observation({ message: 'This name could be clearer.' }), expectation),
      false,
    );
  });
});

describe('the scorer', () => {
  const buggy = EVAL_CASES.find((testCase) => testCase.id === 'empty-input-division');
  const silent = EVAL_CASES.find((testCase) => testCase.id === 'silent-rename');
  assert.ok(buggy && silent);

  it('counts a hit as matched and nothing else', () => {
    const result = scoreCase(buggy, 'normal', { observations: [observation()] });
    assert.equal(result.matched, 1);
    assert.equal(result.missed.length, 0);
    assert.equal(result.unexpected.length, 0);
  });

  it('counts an extra observation on a real bug as noise, not as a miss', () => {
    const extra = observation({ line: 2, message: 'The intermediate array could be avoided.' });
    const card = scoreAll('normal', [scoreCase(buggy, 'normal', { observations: [observation(), extra] })]);
    assert.equal(card.missed, 0);
    assert.equal(card.noise, 1);
    assert.equal(card.falsePositives, 0);
    assert.equal(card.noiseRate, 0.5);
  });

  it('counts anything at all on a silent case as a false positive', () => {
    const card = scoreAll('normal', [
      scoreCase(silent, 'normal', {
        observations: [observation({ file: 'src/date.js', line: 1, message: 'Consider a different name.' })],
      }),
    ]);
    assert.equal(card.falsePositives, 1);
    assert.equal(card.noise, 0);
    assert.equal(card.silenceCorrectness, 0);
    assert.equal(card.falsePositiveRate, 1);
  });

  it('counts silence on a silent case as the correct answer', () => {
    const card = scoreAll('normal', [scoreCase(silent, 'normal', { observations: [] })]);
    assert.equal(card.silenceCorrectness, 1);
    assert.equal(card.observations, 0);
  });

  it('counts a missed bug', () => {
    const card = scoreAll('normal', [scoreCase(buggy, 'normal', { observations: [] })]);
    assert.equal(card.missed, 1);
    assert.equal(card.missRate, 1);
  });

  it('never lets one observation satisfy two expectations', () => {
    const twoBugs = {
      ...buggy,
      expected: [buggy.expected[0], { ...buggy.expected[0], mentions: ['empty'] }],
    };
    const result = scoreCase(twoBugs, 'normal', { observations: [observation()] });
    assert.equal(result.matched, 1);
    assert.equal(result.missed.length, 1);
  });

  it('sets a failed review aside instead of scoring it as silence', () => {
    const card = scoreAll('normal', [
      scoreCase(silent, 'normal', { observations: [], failure: 'the API key was rejected' }),
    ]);
    assert.equal(card.failures, 1);
    assert.equal(card.scored, 0);
    assert.equal(card.silentCases, 0);
  });

  it('formats one comparable line per intensity', () => {
    const line = formatScorecard(scoreAll('normal', [scoreCase(buggy, 'normal', { observations: [observation()] })]));
    assert.match(line, /^normal /);
    assert.match(line, /miss\s+0\.0%/);
    assert.match(line, /silence/);
  });
});

describe('the eval end to end, against answers rather than a model', () => {
  function providerReplaying(text: string): ReviewProvider {
    return { review: () => Promise.resolve({ text }) };
  }

  /**
   * `recordings` defaults to whatever `npm run eval -- --record` left on disk,
   * so a real answer replaces a stand-in. The pinning test below passes an
   * empty map deliberately: it is asserting what the *pipeline* does with a
   * fixed answer, and a real recording would rightly change the numbers.
   */
  async function runAll(intensity: ReviewIntensity, recordings = loadRecordings()) {
    const results = [];
    for (const testCase of EVAL_CASES) {
      const answer = answerFor(testCase.id, intensity, recordings);
      if (answer === undefined) {
        continue;
      }
      const report = await runReview({
        diff: testCase.diff,
        intensity,
        maxObservations: 20,
        maxDiffBytes: 200000,
        provider: providerReplaying(answer.text),
      });
      results.push(scoreCase(testCase, intensity, { observations: report.observations }));
    }
    return scoreAll(intensity, results);
  }

  it('scores every case at every intensity', async () => {
    for (const intensity of REVIEW_INTENSITIES) {
      const card = await runAll(intensity);
      assert.equal(card.cases, EVAL_CASES.length, `${intensity} did not score every case`);
      assert.equal(card.failures, 0);
    }
  });

  it('has an answer on file for every case and intensity', () => {
    for (const testCase of EVAL_CASES) {
      for (const intensity of REVIEW_INTENSITIES) {
        assert.ok(
          STAND_IN_KEYS.includes(`${testCase.id}:${intensity}`),
          `no stand-in answer for ${testCase.id} at ${intensity}`,
        );
      }
    }
  });

  it('scores real recordings when there are any, without failing on them', async () => {
    const recordings = loadRecordings();
    for (const intensity of REVIEW_INTENSITIES) {
      const card = await runAll(intensity, recordings);
      assert.equal(card.failures, 0);
      assert.ok(card.missRate >= 0 && card.missRate <= 1);
      assert.ok(card.silenceCorrectness >= 0 && card.silenceCorrectness <= 1);
    }
  });

  it('turns the stand-in answers into the numbers they were written to produce', async () => {
    // These pin the *scorer and pipeline*, not the model: the answers are
    // hand-written. A change here means the pipeline changed what it does with
    // a fixed answer, which is exactly what a regression test should catch.
    const none = new Map<string, string>();
    const strict = await runAll('strict', none);
    assert.equal(strict.expected, 6);
    assert.equal(strict.matched, 6, 'every planted bug is found at strict in the stand-ins');
    assert.equal(strict.noise, 1, 'one true-but-unasked-for observation');
    assert.equal(strict.falsePositives, 1, 'one observation on a change that was fine');
    assert.equal(strict.silentCasesCorrect, 2);
    assert.equal(strict.silentCases, 3);

    const normal = await runAll('normal', none);
    assert.equal(normal.expected, 4);
    assert.equal(normal.missed, 1, 'the concurrency case is answered off-target at normal');
    assert.equal(normal.noise, 1);
    assert.equal(normal.falsePositives, 0);
    assert.equal(normal.silenceCorrectness, 1);

    const quiet = await runAll('silent', none);
    assert.equal(quiet.expected, 2);
    assert.equal(quiet.missed, 0);
    assert.equal(quiet.observations, 2, 'at silent, only the two clear bugs are spoken about');
  });

  it('turns an unusable answer into silence rather than a failure', async () => {
    const report = await runReview({
      diff: EVAL_CASES[0].diff,
      intensity: 'normal',
      maxObservations: 20,
      maxDiffBytes: 200000,
      provider: providerReplaying('I was unable to review this change.'),
    });
    assert.equal(report.status, 'reviewed');
    assert.deepEqual(report.observations, []);
  });
});

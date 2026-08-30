#!/usr/bin/env node
/**
 * Review-quality measurement against a real endpoint (issue #17).
 *
 * `npm test` scores the same cases against fixed answers, which pins the
 * pipeline and the scorer but says nothing about whether the prompt produces
 * high-signal, low-noise reviews. This does — and it needs an API key, so it
 * is not part of `npm run verify`.
 *
 *   npm run eval
 *   npm run eval -- --intensity=strict
 *   npm run eval -- --provider=openai --base-url=https://api.groq.com/openai/v1
 *   npm run eval -- --record          # also save the answers for npm test
 *
 * Reads ANTHROPIC_API_KEY or OPENAI_API_KEY, whichever the provider needs.
 *
 * All three paths are scored, into the same four numbers, because §7 is a
 * claim about the whole product's restraint rather than about one command.
 * What "noise" means differs: on a review it is an unasked-for observation, on
 * guidance it is filler true of any task, on recall it is a second and third
 * name offered to someone trying to remember one.
 *
 * Reading the numbers: the miss rate is the least important of the four. A run
 * that finds every planted bug and talks through three clean diffs — or names
 * "error handling" for every question — is a failure of the thing the product
 * is betting on.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORDINGS = path.join(ROOT, 'test', 'eval', 'recorded');

const { EVAL_CASES } = await import(path.join(ROOT, 'out/test/eval/cases.js'));
const { GUIDANCE_CASES, RECALL_CASES } = await import(path.join(ROOT, 'out/test/eval/questionCases.js'));
const { scoreReviewCase, scoreGuidanceCase, scoreRecallCase, scoreAll, formatScorecard } = await import(
  path.join(ROOT, 'out/test/eval/score.js')
);
const { runReview } = await import(path.join(ROOT, 'out/src/core/review.js'));
const { runGuidance } = await import(path.join(ROOT, 'out/src/core/guidance.js'));
const { runRecall } = await import(path.join(ROOT, 'out/src/core/recall.js'));
const { createReviewProvider, providerProfile } = await import(
  path.join(ROOT, 'out/src/core/providerFactory.js')
);

function option(name, fallback) {
  const found = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
}

const provider = option('provider', 'anthropic');
const model = option('model', '');
const baseUrl = option('base-url', '');
const effort = option('effort', '');
const intensities = option('intensity', 'silent,normal,strict').split(',').filter(Boolean);
const paths = option('paths', 'review,guidance,recall').split(',').filter(Boolean);
const record = process.argv.includes('--record');

if (provider !== 'anthropic' && provider !== 'openai') {
  console.error(`Unknown provider "${provider}". Use anthropic or openai.`);
  process.exit(1);
}

const profile = providerProfile(provider);
const apiKey = process.env[profile.apiKeyEnvVar];
if (apiKey === undefined || apiKey.trim().length === 0) {
  console.error(`No ${profile.apiKeyEnvVar} in the environment. This is the one thing the eval cannot fake.`);
  process.exit(1);
}

if (record) {
  mkdirSync(RECORDINGS, { recursive: true });
}

const total =
  (paths.includes('review') ? EVAL_CASES.length * intensities.length : 0) +
  (paths.includes('guidance') ? GUIDANCE_CASES.length : 0) +
  (paths.includes('recall') ? RECALL_CASES.length : 0);

console.log(
  `${profile.displayName} ${model || profile.defaultModel}` +
    `${baseUrl ? ` via ${baseUrl}` : ''}${effort ? ` at effort ${effort}` : ''}, ` +
    `${total} request(s)\n`,
);

const cards = [];
const newProvider = () => createReviewProvider({ kind: provider, apiKey, model, baseUrl, effort });

/** One line per case, plus what it got wrong. Shared by all three paths. */
function report(label, id, started, answers, usage, result) {
  console.log(
    `  ${label.padEnd(9)} ${id.padEnd(24)} ${String(answers).padStart(2)} answer(s)  ` +
      `${String(Date.now() - started).padStart(6)} ms  ${usage}`,
  );
  for (const missed of result.missed) {
    console.log(`      missed  ${missed}`);
  }
  for (const extra of result.unexpected) {
    console.log(`      ${result.silent ? 'false positive' : 'noise'}  ${extra}`);
  }
}

const usageOf = (notes) => notes.find((note) => note.startsWith('tokens:')) ?? 'tokens: unknown';

for (const intensity of paths.includes('review') ? intensities : []) {
  const results = [];

  for (const testCase of EVAL_CASES) {
    const started = Date.now();
    let outcome;
    try {
      const reviewed = await runReview({
        diff: testCase.diff,
        intensity,
        maxObservations: 20,
        maxDiffBytes: 200000,
        provider: newProvider(),
      });
      outcome = { observations: reviewed.observations, usage: usageOf(reviewed.notes) };
      if (record) {
        // Saved so `npm test` can score real answers instead of stand-ins.
        writeFileSync(
          path.join(RECORDINGS, `${testCase.id}.${intensity}.json`),
          `${JSON.stringify({ text: reviewed.rawText ?? '' }, null, 2)}\n`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      outcome = { observations: [], failure: reason, usage: 'tokens: unknown' };
      console.log(`  ${intensity.padEnd(9)} ${testCase.id.padEnd(24)} FAILED: ${reason}`);
    }

    const result = scoreReviewCase(testCase, intensity, outcome);
    if (outcome.failure === undefined) {
      report(intensity, testCase.id, started, outcome.observations.length, outcome.usage, result);
    }
    results.push(result);
  }

  cards.push(scoreAll(intensity, results));
  console.log('');
}

/** Guidance and recall: one request each, no intensity to sweep. */
async function runQuestionPath(label, cases, ask, score) {
  const results = [];
  for (const testCase of cases) {
    const started = Date.now();
    let outcome;
    try {
      outcome = await ask(testCase);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      outcome = { failure: reason, answers: 0, usage: 'tokens: unknown' };
      console.log(`  ${label.padEnd(9)} ${testCase.id.padEnd(24)} FAILED: ${reason}`);
    }
    const result = score(testCase, outcome);
    if (outcome.failure === undefined) {
      report(label, testCase.id, started, outcome.answers, outcome.usage, result);
    }
    results.push(result);
  }
  cards.push(scoreAll(label, results));
  console.log('');
}

if (paths.includes('guidance')) {
  await runQuestionPath(
    'guidance',
    GUIDANCE_CASES,
    async (testCase) => {
      const answered = await runGuidance({ question: testCase.question, provider: newProvider() });
      const topics = answered.topics.map((topic) => topic.name);
      return {
        topics,
        searches: [...answered.searches],
        answers: topics.length + answered.searches.length,
        usage: usageOf(answered.notes),
      };
    },
    scoreGuidanceCase,
  );
}

if (paths.includes('recall')) {
  await runQuestionPath(
    'recall',
    RECALL_CASES,
    async (testCase) => {
      const answered = await runRecall({ description: testCase.description, provider: newProvider() });
      const candidates = answered.candidates.map((entry) => entry.name);
      return { candidates, answers: candidates.length, usage: usageOf(answered.notes) };
    },
    scoreRecallCase,
  );
}

console.log('---');
for (const card of cards) {
  console.log(formatScorecard(card));
}
console.log(
  '\nmiss           = expected and not said.\n' +
    'false-positive = said where the right answer was nothing at all.\n' +
    'noise          = said, and not worth saying: an unasked-for observation, ' +
    'filler true of any\n                 task, or a second name offered to ' +
    'someone trying to remember one.\n' +
    'silence        = cases where nothing was the right answer, and nothing ' +
    'was said.',
);

const failed = cards.reduce((sum, card) => sum + card.failures, 0);
process.exit(failed > 0 ? 1 : 0);

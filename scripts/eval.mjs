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
 * Reading the numbers: the miss rate is the least important of the four.
 * SPEC §7 is a claim about restraint, so the false-positive rate and the
 * silence correctness are what decide whether the prompt is working. A run
 * that finds every planted bug and talks through three clean diffs is a
 * failure of the thing the product is betting on.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECORDINGS = path.join(ROOT, 'test', 'eval', 'recorded');

const { EVAL_CASES } = await import(path.join(ROOT, 'out/test/eval/cases.js'));
const { scoreCase, scoreAll, formatScorecard } = await import(path.join(ROOT, 'out/test/eval/score.js'));
const { runReview } = await import(path.join(ROOT, 'out/src/core/review.js'));
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

console.log(
  `${profile.displayName} ${model || profile.defaultModel}` +
    `${baseUrl ? ` via ${baseUrl}` : ''}${effort ? ` at effort ${effort}` : ''}, ` +
    `${EVAL_CASES.length} cases\n`,
);

const cards = [];

for (const intensity of intensities) {
  const results = [];

  for (const testCase of EVAL_CASES) {
    const started = Date.now();
    let outcome;
    try {
      const report = await runReview({
        diff: testCase.diff,
        intensity,
        maxObservations: 20,
        maxDiffBytes: 200000,
        provider: createReviewProvider({ kind: provider, apiKey, model, baseUrl, effort }),
      });
      outcome = { observations: report.observations };
      const usage = report.notes.find((note) => note.startsWith('tokens:')) ?? 'tokens: unknown';
      console.log(
        `  ${intensity.padEnd(6)} ${testCase.id.padEnd(24)} ` +
          `${String(report.observations.length).padStart(2)} observation(s)  ` +
          `${String(Date.now() - started).padStart(6)} ms  ${usage}`,
      );
      if (record) {
        // Saved so `npm test` can score real answers instead of stand-ins.
        writeFileSync(
          path.join(RECORDINGS, `${testCase.id}.${intensity}.json`),
          `${JSON.stringify({ text: report.rawText ?? '' }, null, 2)}\n`,
        );
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      outcome = { observations: [], failure: reason };
      console.log(`  ${intensity.padEnd(6)} ${testCase.id.padEnd(24)} FAILED: ${reason}`);
    }

    const result = scoreCase(testCase, intensity, outcome);
    for (const missed of result.missed) {
      console.log(`      missed  ${missed.file}:${missed.line} (${missed.mentions[0]})`);
    }
    for (const extra of result.unexpected) {
      const kind = result.silent ? 'false positive' : 'noise';
      console.log(`      ${kind}  ${extra.file}:${extra.line} ${extra.message}`);
    }
    results.push(result);
  }

  cards.push(scoreAll(intensity, results));
  console.log('');
}

console.log('---');
for (const card of cards) {
  console.log(formatScorecard(card));
}
console.log(
  '\nmiss = planted bugs not reported. false-positive = anything said about a ' +
    'change that was fine.\nnoise = said, but not what the case was about. ' +
    'silence = clean changes that produced nothing.',
);

const failed = cards.reduce((sum, card) => sum + card.failures, 0);
process.exit(failed > 0 ? 1 : 0);

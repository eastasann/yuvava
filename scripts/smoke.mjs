#!/usr/bin/env node
/**
 * One real request down every path, against a real endpoint (issue #16).
 *
 * Every provider test in this repository injects the SDK's `fetch`, so the
 * request shape, the headers and every response branch are pinned — and no
 * server has ever accepted one of these requests. A green `npm run verify`
 * does not mean Navigator works; it means Navigator is consistent with what
 * this repository believes about the APIs.
 *
 * This is the script that settles it. It needs an API key, which is the one
 * thing that cannot be faked here, so it is not part of the gate.
 *
 *   ANTHROPIC_API_KEY=... npm run smoke
 *   OPENAI_API_KEY=...    npm run smoke -- --provider=openai
 *   OPENAI_API_KEY=$GROQ_KEY npm run smoke -- \
 *                           --provider=openai \
 *                           --base-url=https://api.groq.com/openai/v1 \
 *                           --model=<one the endpoint actually has>
 *
 * Ask the endpoint for that name rather than copying one from here. A model
 * written into a comment is retired eventually, and the first thing this
 * script ever got back from a real server was a 404 for exactly that reason:
 *
 *   curl -s https://api.groq.com/openai/v1/models \
 *     -H "Authorization: Bearer $KEY" | grep -o '\"id\":\"[^\"]*\"'
 *
 * The compatible path is the least trustworthy of the three, and the two
 * things most likely to be wrong are called out by name in the output when
 * they fail, because a single real error message fixes either of them:
 *
 *   1. `isStructuredOutputRejection` matches the error text of a service that
 *      refuses the JSON schema. Real wording varies; if it does not match, the
 *      fallback never fires and the review fails outright.
 *   2. `max_tokens` may be interpreted differently, or capped.
 *
 * On failure this prints the raw message. Paste it into the issue; that is the
 * information the repository does not have.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { runReview } = await import(path.join(ROOT, 'out/src/core/review.js'));
const { runGuidance } = await import(path.join(ROOT, 'out/src/core/guidance.js'));
const { runRecall } = await import(path.join(ROOT, 'out/src/core/recall.js'));
const { createReviewProvider, providerProfile } = await import(
  path.join(ROOT, 'out/src/core/providerFactory.js')
);
const { MdnDocsIndex } = await import(path.join(ROOT, 'out/src/core/docsIndex.js'));

function option(name, fallback) {
  const found = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  return found === undefined ? fallback : found.slice(name.length + 3);
}

const provider = option('provider', 'anthropic');
const model = option('model', '');
const baseUrl = option('base-url', '');
const effort = option('effort', '');

if (provider !== 'anthropic' && provider !== 'openai') {
  console.error(`Unknown provider "${provider}". Use anthropic or openai.`);
  process.exit(1);
}

const profile = providerProfile(provider);
const apiKey = process.env[profile.apiKeyEnvVar];
if (apiKey === undefined || apiKey.trim().length === 0) {
  console.error(
    `No ${profile.apiKeyEnvVar} in the environment.\n` +
      'That is the whole reason this is a separate script: it is the one thing\n' +
      'the test suite cannot fake, and until it is set, "the review works end to\n' +
      'end" stays unproven.',
  );
  process.exit(1);
}

const DIFF = `diff --git a/src/scores.js b/src/scores.js
new file mode 100644
--- /dev/null
+++ b/src/scores.js
@@ -0,0 +1,4 @@
+export function average(results) {
+  const scores = results.map((result) => result.score);
+  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
+}
`;

const route =
  `${profile.displayName} ${model || profile.defaultModel}` +
  `${baseUrl ? ` via ${baseUrl}` : ''}${effort ? ` at effort ${effort}` : ''}`;

console.log(`Smoke test: ${route}\n`);

const newProvider = () => createReviewProvider({ kind: provider, apiKey, model, baseUrl, effort });
const failures = [];

async function attempt(name, run, describe) {
  const started = Date.now();
  try {
    const value = await run();
    console.log(`  ok    ${name.padEnd(9)} ${String(Date.now() - started).padStart(6)} ms  ${describe(value)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`  FAIL  ${name.padEnd(9)} ${String(Date.now() - started).padStart(6)} ms`);
    console.log(`        ${message}`);
    failures.push({ name, message });
  }
}

await attempt(
  'review',
  () =>
    runReview({
      diff: DIFF,
      intensity: 'normal',
      maxObservations: 20,
      maxDiffBytes: 200000,
      provider: newProvider(),
    }),
  (report) =>
    `${report.observations.length} observation(s); ` +
    `${report.notes.find((note) => note.startsWith('tokens:')) ?? 'tokens: unknown'}`,
);

await attempt(
  'guidance',
  () => runGuidance({ question: 'add a retry to fetch', provider: newProvider() }),
  (report) =>
    `${report.topics.length} topic(s), ${report.searches.length} search(es), ` +
    `${report.hints.length} hint(s), ${report.explore.length} to explore`,
);

await attempt(
  'recall',
  () => runRecall({ description: 'folds an array into a single value', provider: newProvider() }),
  (report) => `${report.candidates.length} candidate(s): ${report.candidates.map((c) => c.name).join(', ')}`,
);

// Not a model call, and just as unproven: the docs index has never resolved a
// term against the real service either.
await attempt(
  'mdn',
  async () => {
    const link = await new MdnDocsIndex({ timeoutMs: 8000 }).resolve('AbortSignal timeout');
    if (link === undefined) {
      throw new Error(
        'MDN returned nothing usable. Either the index is unreachable from here ' +
          '(check egress) or the response shape changed — see src/core/docsIndex.ts.',
      );
    }
    return link;
  },
  (link) => `${link.title} -> ${link.url}`,
);

console.log('');
if (failures.length === 0) {
  console.log('All four paths answered. Note the numbers in PROGRESS.md and close #16.');
  process.exit(0);
}

console.log(`${failures.length} path(s) failed.\n`);
for (const failure of failures) {
  if (failure.name !== 'review' && failure.name !== 'guidance' && failure.name !== 'recall') {
    continue;
  }
  if (baseUrl && /schema|response_format|json/i.test(failure.message)) {
    console.log(
      'The schema fallback may not have fired. `isStructuredOutputRejection` in\n' +
        'src/core/openaiProvider.ts matches on /response_format|json_schema|structured\n' +
        `output|schema/ and this endpoint said:\n  ${failure.message}\n`,
    );
  }
  if (/max_tokens|max_output_tokens|token/i.test(failure.message)) {
    console.log(
      'Token limits may be interpreted differently here. MAX_TOKENS is 4096\n' +
        '(Anthropic) and MAX_OUTPUT_TOKENS 8192 (OpenAI) in src/core/.\n',
    );
  }
}
console.log('Put the exact wording above into issue #16 — that is the part this repository cannot derive.');
process.exit(1);

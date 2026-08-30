/**
 * Token usage (issue #19).
 *
 * Three wire shapes and one reader, plus the case that matters most for the
 * compatible endpoints: an endpoint that reports nothing must be a log line,
 * not a failure.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeUsage, readUsage } from '../src/core/usage.js';
import { runReview } from '../src/core/review.js';
import type { ReviewProvider } from '../src/core/provider.js';

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 const a = 1;
+const b = 2;
 const c = 3;
`;

describe('readUsage', () => {
  it('reads the Anthropic and Responses shape', () => {
    assert.deepEqual(
      readUsage({
        input_tokens: 4210,
        output_tokens: 1830,
        output_tokens_details: { thinking_tokens: 1204 },
      }),
      { input: 4210, output: 1830, thinking: 1204 },
    );
  });

  it('reads the Chat Completions shape', () => {
    assert.deepEqual(
      readUsage({
        prompt_tokens: 900,
        completion_tokens: 210,
        completion_tokens_details: { reasoning_tokens: 64 },
      }),
      { input: 900, output: 210, thinking: 64 },
    );
  });

  it('takes what it can when only part is reported', () => {
    assert.deepEqual(readUsage({ prompt_tokens: 12 }), { input: 12 });
    assert.deepEqual(readUsage({ output_tokens: 7 }), { output: 7 });
  });

  it('reports nothing rather than zero when the endpoint said nothing', () => {
    for (const nothing of [undefined, null, {}, 'usage', 42, { input_tokens: 'lots' }]) {
      assert.equal(readUsage(nothing), undefined, `accepted ${JSON.stringify(nothing)}`);
    }
  });

  it('ignores a nonsensical count', () => {
    assert.equal(readUsage({ input_tokens: -5 }), undefined);
    assert.equal(readUsage({ input_tokens: Number.NaN }), undefined);
  });
});

describe('describeUsage', () => {
  it('reads as one line', () => {
    assert.equal(
      describeUsage({ input: 4210, output: 1830, thinking: 1204 }),
      'tokens: 4210 in, 1830 out, 1204 thinking',
    );
    assert.equal(describeUsage({ input: 900, output: 210 }), 'tokens: 900 in, 210 out');
  });

  it('says so when the endpoint reported nothing', () => {
    assert.equal(describeUsage(undefined), 'tokens: not reported by this endpoint');
  });
});

describe('a review logs what it cost', () => {
  function providerReporting(usage: unknown): ReviewProvider {
    return {
      review: () =>
        Promise.resolve({
          text: '{"issues": []}',
          ...(usage === undefined ? {} : { usage: usage as never }),
        }),
    };
  }

  const options = { diff: DIFF, intensity: 'normal' as const, maxObservations: 10, maxDiffBytes: 100000 };

  it('puts the count in the notes', async () => {
    const report = await runReview({
      ...options,
      provider: providerReporting({ input: 4210, output: 1830 }),
    });
    assert.equal(report.notes.at(-1), 'tokens: 4210 in, 1830 out');
  });

  it('does not fail on an endpoint that reports nothing', async () => {
    const report = await runReview({ ...options, provider: providerReporting(undefined) });
    assert.equal(report.status, 'reviewed');
    assert.equal(report.notes.at(-1), 'tokens: not reported by this endpoint');
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReviewUnavailableError, type ReviewProvider, type ReviewRequest } from '../src/core/provider.js';
import { byteLength, runReview } from '../src/core/review.js';
import type { ReviewIntensity } from '../src/core/types.js';

const DIFF = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -8,2 +8,4 @@
 const items = cart.items;
+const count = items.length;
+const average = total / count;
`;

function providerReturning(text: string, seen: ReviewRequest[] = []): ReviewProvider {
  return {
    async review(request) {
      seen.push(request);
      return { text };
    },
  };
}

function providerThrowing(error: unknown): ReviewProvider {
  return {
    async review() {
      throw error;
    },
  };
}

const BASE = {
  intensity: 'normal' as ReviewIntensity,
  maxObservations: 20,
  maxDiffBytes: 200000,
};

const OK_RESPONSE = JSON.stringify({
  issues: [
    {
      file: 'src/cart.ts',
      line: 10,
      severity: 'warning',
      category: 'edge-case',
      message: 'count is zero for an empty cart, so average becomes NaN.',
      symbol: 'count',
    },
  ],
});

describe('runReview', () => {
  it('produces an anchored observation from a well-formed review', async () => {
    const report = await runReview({ ...BASE, diff: DIFF, provider: providerReturning(OK_RESPONSE) });
    assert.equal(report.status, 'reviewed');
    assert.equal(report.observations.length, 1);
    assert.equal(report.observations[0].file, 'src/cart.ts');
    assert.equal(report.observations[0].line, 10);
    assert.equal(report.observations[0].symbol, 'count');
    assert.deepEqual(report.notes, ['tokens: not reported by this endpoint']);
  });

  it('sends the model a diff annotated with new-file line numbers', async () => {
    const seen: ReviewRequest[] = [];
    await runReview({ ...BASE, diff: DIFF, provider: providerReturning('{"issues":[]}', seen) });
    assert.equal(seen.length, 1);
    assert.match(seen[0].annotatedDiff, /### src\/cart\.ts/);
    assert.match(seen[0].annotatedDiff, /^\s+9 \+const count = items\.length;$/m);
    assert.equal(seen[0].intensity, 'normal');
  });

  it('stays silent, and never calls the model, when there is nothing to review', async () => {
    let called = false;
    const provider: ReviewProvider = {
      async review() {
        called = true;
        return { text: '{"issues":[]}' };
      },
    };
    for (const diff of ['', '\n', 'diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n']) {
      const report = await runReview({ ...BASE, diff, provider });
      assert.equal(report.status, 'no-changes');
      assert.deepEqual(report.observations, []);
    }
    assert.equal(called, false);
  });

  it('reports an empty review as a successful, silent one', async () => {
    const report = await runReview({ ...BASE, diff: DIFF, provider: providerReturning('{"issues":[]}') });
    assert.equal(report.status, 'reviewed');
    assert.deepEqual(report.observations, []);
    assert.deepEqual(report.notes, ['tokens: not reported by this endpoint']);
  });

  it('refuses to send an oversized diff', async () => {
    let called = false;
    const provider: ReviewProvider = {
      async review() {
        called = true;
        return { text: '{"issues":[]}' };
      },
    };
    const report = await runReview({ ...BASE, diff: DIFF, maxDiffBytes: 10, provider });
    assert.equal(report.status, 'diff-too-large');
    assert.equal(called, false);
    assert.match(report.notes[0], /over the 10 byte limit/);
  });

  it('survives a malformed response with zero observations and a note', async () => {
    for (const text of ['', 'not json', '{"issues": [1,2,]}', '{"issues": {}}', 'null']) {
      const report = await runReview({ ...BASE, diff: DIFF, provider: providerReturning(text) });
      assert.equal(report.status, 'reviewed');
      assert.deepEqual(report.observations, []);
      assert.ok(report.notes.length > 0, `expected a note for ${JSON.stringify(text)}`);
    }
  });

  it('records why an issue was discarded', async () => {
    const response = JSON.stringify({
      issues: [
        { file: 'src/nope.ts', line: 3, severity: 'error', category: 'c', message: 'about another file' },
      ],
    });
    const report = await runReview({ ...BASE, diff: DIFF, provider: providerReturning(response) });
    assert.deepEqual(report.observations, []);
    assert.match(report.notes[0], /discarded src\/nope\.ts:3/);
  });

  it('never surfaces replacement code from the model', async () => {
    const response = JSON.stringify({
      issues: [
        {
          file: 'src/cart.ts',
          line: 10,
          severity: 'warning',
          category: 'edge-case',
          message: 'Guard the empty case.\n```ts\nif (count === 0) {\n  return 0;\n}\n```',
        },
      ],
    });
    const report = await runReview({ ...BASE, diff: DIFF, provider: providerReturning(response) });
    assert.equal(report.observations.length, 1);
    const { message } = report.observations[0];
    assert.ok(!message.includes('```'));
    assert.ok(!message.includes('return 0'));
    assert.ok(!message.includes('\n'));
  });

  it('reports provider failure as ReviewUnavailableError', async () => {
    await assert.rejects(
      () => runReview({ ...BASE, diff: DIFF, provider: providerThrowing(new Error('network down')) }),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /network down/);
        return true;
      },
    );
  });

  it('passes a ReviewUnavailableError through unchanged', async () => {
    const original = new ReviewUnavailableError('no API key');
    await assert.rejects(
      () => runReview({ ...BASE, diff: DIFF, provider: providerThrowing(original) }),
      (error: unknown) => {
        assert.equal(error, original);
        return true;
      },
    );
  });

  it('wraps a non-Error rejection', async () => {
    await assert.rejects(
      () => runReview({ ...BASE, diff: DIFF, provider: providerThrowing('boom') }),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /boom/);
        return true;
      },
    );
  });
});

describe('byteLength', () => {
  it('counts UTF-8 bytes, not code units', () => {
    assert.equal(byteLength('abc'), 3);
    assert.equal(byteLength('あ'), 3);
  });
});

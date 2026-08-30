import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { anchorIssues } from '../src/core/anchor.js';
import { parseUnifiedDiff, reviewableFiles } from '../src/core/diff.js';
import type { RawIssue } from '../src/core/schema.js';

const DIFF = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -8,3 +8,5 @@
 const items = cart.items;
+const count = items.length;
+const average = total / count;
 return average;
diff --git a/src/util.ts b/src/util.ts
--- a/src/util.ts
+++ b/src/util.ts
@@ -100,2 +100,3 @@
 export function id(x) {
+  return x;
 }
`;

const FILES = reviewableFiles(parseUnifiedDiff(DIFF));

function issue(overrides: Partial<RawIssue> = {}): RawIssue {
  return {
    file: 'src/cart.ts',
    line: 9,
    endLine: 9,
    severity: 'warning',
    category: 'edge-case',
    message: 'count can be zero, which makes average NaN.',
    ...overrides,
  };
}

describe('anchorIssues', () => {
  it('keeps an issue that lands inside a hunk', () => {
    const { observations, dropped } = anchorIssues([issue()], FILES, { maxObservations: 20 });
    assert.equal(observations.length, 1);
    assert.equal(dropped.length, 0);
    assert.equal(observations[0].file, 'src/cart.ts');
    assert.equal(observations[0].line, 9);
  });

  it('drops an issue about a file that is not in the diff', () => {
    const { observations, dropped } = anchorIssues([issue({ file: 'src/other.ts' })], FILES, {
      maxObservations: 20,
    });
    assert.equal(observations.length, 0);
    assert.match(dropped[0].reason, /not part of the reviewed diff/);
  });

  it('drops an issue about a line outside the reviewed changes', () => {
    const { observations, dropped } = anchorIssues([issue({ line: 400 })], FILES, {
      maxObservations: 20,
    });
    assert.equal(observations.length, 0);
    assert.match(dropped[0].reason, /outside the reviewed changes/);
  });

  it('resolves a partially-qualified path when it is unambiguous', () => {
    const { observations } = anchorIssues([issue({ file: '/home/me/project/src/cart.ts' })], FILES, {
      maxObservations: 20,
    });
    assert.equal(observations.length, 1);
    assert.equal(observations[0].file, 'src/cart.ts');
  });

  it('drops an issue whose message was only code', () => {
    const { observations, dropped } = anchorIssues(
      [issue({ message: '```ts\nconst count = items.length || 1;\n```' })],
      FILES,
      { maxObservations: 20 },
    );
    assert.equal(observations.length, 0);
    assert.match(dropped[0].reason, /no usable prose/);
  });

  it('strips replacement code but keeps the observation around it', () => {
    const { observations } = anchorIssues(
      [issue({ message: 'count can be zero here.\n```ts\nif (count === 0) return 0;\n```' })],
      FILES,
      { maxObservations: 20 },
    );
    assert.equal(observations.length, 1);
    assert.equal(observations[0].message, 'count can be zero here.');
  });

  it('removes duplicates', () => {
    const { observations, dropped } = anchorIssues([issue(), issue()], FILES, { maxObservations: 20 });
    assert.equal(observations.length, 1);
    assert.match(dropped[0].reason, /duplicate/);
  });

  it('clamps endLine to the end of the hunk', () => {
    const { observations } = anchorIssues([issue({ line: 9, endLine: 9999 })], FILES, {
      maxObservations: 20,
    });
    assert.equal(observations[0].endLine, 11);
  });

  it('orders by severity, then file, then line', () => {
    const { observations } = anchorIssues(
      [
        issue({ file: 'src/util.ts', line: 101, severity: 'info', message: 'an informational note here' }),
        issue({ line: 10, severity: 'error', message: 'a clear correctness bug here' }),
        issue({ line: 9, severity: 'warning', message: 'a warning about an edge case' }),
      ],
      FILES,
      { maxObservations: 20 },
    );
    assert.deepEqual(
      observations.map((o) => o.severity),
      ['error', 'warning', 'info'],
    );
  });

  it('caps the number of observations for one review', () => {
    const issues = [1, 2, 3].map((n) =>
      issue({ line: 9, message: `distinct observation number ${n} about this line` }),
    );
    const { observations, dropped } = anchorIssues(issues, FILES, { maxObservations: 2 });
    assert.equal(observations.length, 2);
    assert.equal(dropped.length, 1);
    assert.match(dropped[0].reason, /limit/);
  });

  it('returns nothing for an empty issue list', () => {
    const outcome = anchorIssues([], FILES, { maxObservations: 20 });
    assert.deepEqual(outcome.observations, []);
    assert.deepEqual(outcome.dropped, []);
  });
});

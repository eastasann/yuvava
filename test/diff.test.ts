import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addedLines,
  isLineInDiff,
  normalizeDiffPath,
  parseUnifiedDiff,
  renderAnnotatedDiff,
  reviewableFiles,
} from '../src/core/diff.js';

const SAMPLE = `diff --git a/src/cart.ts b/src/cart.ts
index 1111111..2222222 100644
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -8,7 +8,9 @@ export function total(cart: Cart): number {
   const items = cart.items;
-  return items.reduce((sum, item) => sum + item.price, 0);
+  const count = items.length;
+  return items.reduce((sum, item) => sum + item.price * item.qty, 0) / count;
 }
 
 export function empty(cart: Cart): boolean {
`;

describe('parseUnifiedDiff', () => {
  it('extracts the new-file path and hunk range', () => {
    const files = parseUnifiedDiff(SAMPLE);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'src/cart.ts');
    assert.equal(files[0].hunks.length, 1);
    assert.equal(files[0].hunks[0].newStart, 8);
  });

  it('numbers added and context lines against the new file', () => {
    const [file] = parseUnifiedDiff(SAMPLE);
    assert.deepEqual(addedLines(file), [9, 10]);
    // 8 context, 9-10 added, 11-13 trailing context.
    assert.equal(file.hunks[0].newEnd, 13);
    assert.ok(isLineInDiff(file, 9));
    assert.ok(isLineInDiff(file, 13));
    assert.equal(isLineInDiff(file, 7), false);
    assert.equal(isLineInDiff(file, 14), false);
  });

  it('handles an empty diff', () => {
    assert.deepEqual(parseUnifiedDiff(''), []);
    assert.deepEqual(parseUnifiedDiff('\n\n'), []);
  });

  it('marks deleted and binary files so they are not reviewed', () => {
    const diff = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 3333333..0000000
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const a = 1;
-const b = 2;
diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
`;
    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 2);
    assert.equal(files[0].isDeleted, true);
    assert.equal(files[1].isBinary, true);
    assert.deepEqual(reviewableFiles(files), []);
  });

  it('follows renames to the new path', () => {
    const diff = `diff --git a/old/name.ts b/new/name.ts
similarity index 90%
rename from old/name.ts
rename to new/name.ts
--- a/old/name.ts
+++ b/new/name.ts
@@ -1,2 +1,2 @@
 const a = 1;
-const b = 2;
+const b = 3;
`;
    const [file] = parseUnifiedDiff(diff);
    assert.equal(file.path, 'new/name.ts');
  });

  it('ignores garbage rather than throwing', () => {
    const files = parseUnifiedDiff('not a diff at all\n@@ -1 +1 @@\n+x\n');
    assert.deepEqual(files, []);
  });

  it('parses combined-diff style headers without crashing', () => {
    const diff = `diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@@ -1,2 -1,2 +1,3 @@@
+ added
`;
    const files = parseUnifiedDiff(diff);
    assert.equal(files.length, 1);
  });
});

describe('normalizeDiffPath', () => {
  it('strips git prefixes, quotes and backslashes', () => {
    assert.equal(normalizeDiffPath('b/src/a.ts'), 'src/a.ts');
    assert.equal(normalizeDiffPath('a/src/a.ts'), 'src/a.ts');
    assert.equal(normalizeDiffPath('"b/src/a b.ts"'), 'src/a b.ts');
    assert.equal(normalizeDiffPath('src\\win\\a.ts'), 'src/win/a.ts');
    assert.equal(normalizeDiffPath('./src/a.ts'), 'src/a.ts');
  });
});

describe('renderAnnotatedDiff', () => {
  it('puts the new-file line number in the gutter of every kept line', () => {
    const rendered = renderAnnotatedDiff(parseUnifiedDiff(SAMPLE));
    assert.match(rendered, /^### src\/cart\.ts$/m);
    assert.match(rendered, /^\s+9 \+ {2}const count = items\.length;$/m);
    assert.match(rendered, /^\s+8 {4}const items = cart\.items;$/m);
    // Removed lines carry no new-file line number.
    assert.match(rendered, /^ {7}- {2}return items\.reduce\(\(sum, item\) => sum \+ item\.price, 0\);$/m);
  });

  it('names deleted and binary files without their content', () => {
    const diff = `diff --git a/logo.png b/logo.png
Binary files a/logo.png and b/logo.png differ
`;
    assert.match(renderAnnotatedDiff(parseUnifiedDiff(diff)), /logo\.png \(binary, not reviewable\)/);
  });
});

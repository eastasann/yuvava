import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseUnifiedDiff, reviewableFiles, renderAnnotatedDiff, addedLines } from '../src/core/diff.js';
import { buildUntrackedDiff, renderAddedFileDiff, type FileReader } from '../src/core/untracked.js';

function readerFor(files: Record<string, string | Buffer>): FileReader {
  return (absolutePath: string) => {
    const key = Object.keys(files).find((name) => absolutePath.endsWith(name));
    if (key === undefined) {
      return Promise.reject(new Error('ENOENT'));
    }
    const value = files[key];
    return Promise.resolve(typeof value === 'string' ? Buffer.from(value, 'utf8') : value);
  };
}

const BASE = { root: '/repo', maxFileBytes: 64 * 1024, maxTotalBytes: 100000 };

describe('renderAddedFileDiff', () => {
  it('produces a diff the parser reads back with correct line numbers', () => {
    const rendered = renderAddedFileDiff('src/new.ts', 'const a = 1;\nconst b = 2;\n');
    assert.ok(rendered);
    const [file] = reviewableFiles(parseUnifiedDiff(rendered));
    assert.equal(file.path, 'src/new.ts');
    assert.deepEqual(addedLines(file), [1, 2]);
    assert.match(renderAnnotatedDiff([file]), /^\s+2 \+const b = 2;$/m);
  });

  it('normalises CRLF and a missing trailing newline', () => {
    const crlf = renderAddedFileDiff('a.ts', 'one\r\ntwo\r\n');
    const noTrailer = renderAddedFileDiff('a.ts', 'one\ntwo');
    assert.equal(crlf, noTrailer);
    assert.match(crlf!, /@@ -0,0 \+1,2 @@/);
  });

  it('returns nothing for an empty file', () => {
    assert.equal(renderAddedFileDiff('a.ts', ''), undefined);
    assert.equal(renderAddedFileDiff('a.ts', '\n'), undefined);
  });

  it('cannot be used to forge a second file entry', () => {
    // A file whose own content is diff syntax must stay one file in the diff.
    const hostile = 'diff --git a/etc/passwd b/etc/passwd\n@@ -1 +1 @@\n+root\n';
    const rendered = renderAddedFileDiff('notes.patch', hostile);
    assert.ok(rendered);
    const files = parseUnifiedDiff(rendered);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'notes.patch');
    assert.equal(files[0].hunks.length, 1);
  });
});

describe('buildUntrackedDiff', () => {
  it('includes every readable text file, in a stable order', async () => {
    const result = await buildUntrackedDiff({
      ...BASE,
      paths: ['src/b.ts', 'src/a.ts'],
      readFile: readerFor({ 'src/a.ts': 'const a = 1;\n', 'src/b.ts': 'const b = 2;\n' }),
    });
    const files = parseUnifiedDiff(result.diff);
    assert.deepEqual(files.map((file) => file.path), ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(result.skipped, []);
  });

  it('skips a binary file', async () => {
    const result = await buildUntrackedDiff({
      ...BASE,
      paths: ['logo.png'],
      readFile: readerFor({ 'logo.png': Buffer.from([0x89, 0x50, 0x00, 0x01]) }),
    });
    assert.equal(result.diff, '');
    assert.match(result.skipped[0].reason, /binary/);
  });

  it('skips an oversized file', async () => {
    const result = await buildUntrackedDiff({
      ...BASE,
      maxFileBytes: 10,
      paths: ['big.ts'],
      readFile: readerFor({ 'big.ts': 'x'.repeat(50) }),
    });
    assert.equal(result.diff, '');
    assert.match(result.skipped[0].reason, /larger than 10 bytes/);
  });

  it('skips an empty file', async () => {
    const result = await buildUntrackedDiff({
      ...BASE,
      paths: ['empty.ts'],
      readFile: readerFor({ 'empty.ts': '' }),
    });
    assert.match(result.skipped[0].reason, /empty/);
  });

  it('skips a file it cannot read rather than failing the review', async () => {
    const result = await buildUntrackedDiff({
      ...BASE,
      paths: ['gone.ts', 'here.ts'],
      readFile: readerFor({ 'here.ts': 'const a = 1;\n' }),
    });
    assert.match(result.skipped[0].reason, /could not be read/);
    assert.match(result.diff, /here\.ts/);
  });

  it('stops once the untracked budget is spent', async () => {
    const paths = ['a.ts', 'b.ts', 'c.ts'];
    const contents = Object.fromEntries(paths.map((path) => [path, `${'x'.repeat(200)}\n`]));
    const result = await buildUntrackedDiff({
      ...BASE,
      maxTotalBytes: 250,
      paths,
      readFile: readerFor(contents),
    });
    assert.equal(parseUnifiedDiff(result.diff).length, 1);
    assert.equal(result.skipped.length, 2);
    assert.match(result.skipped[0].reason, /diff budget/);
  });

  it('produces nothing for no untracked files', async () => {
    const result = await buildUntrackedDiff({ ...BASE, paths: [], readFile: readerFor({}) });
    assert.equal(result.diff, '');
    assert.deepEqual(result.skipped, []);
  });
});

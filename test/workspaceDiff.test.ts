import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseUnifiedDiff, reviewableFiles } from '../src/core/diff.js';
import type { CommandResult, GitRunner } from '../src/core/git.js';
import { collectWorkspaceDiff } from '../src/core/workspaceDiff.js';
import type { FileReader } from '../src/core/untracked.js';

const TRACKED = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -1,2 +1,3 @@
 const items = cart.items;
+const count = items.length;
`;

function runnerFor(
  responses: { diff?: string; untracked?: string[] },
  calls: string[][] = [],
): GitRunner {
  return (args): Promise<CommandResult> => {
    calls.push([...args]);
    if (args[0] === 'rev-parse') {
      return Promise.resolve({ code: 0, stdout: 'abc\n', stderr: '' });
    }
    if (args[0] === 'diff') {
      return Promise.resolve({ code: 0, stdout: responses.diff ?? '', stderr: '' });
    }
    if (args[0] === 'ls-files') {
      const paths = responses.untracked ?? [];
      return Promise.resolve({
        code: 0,
        stdout: paths.length === 0 ? '' : `${paths.join('\0')}\0`,
        stderr: '',
      });
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

const readFile: FileReader = (absolutePath) =>
  Promise.resolve(Buffer.from(`// ${absolutePath}\nconst added = true;\n`, 'utf8'));

const BASE = { root: '/repo', base: 'HEAD', maxDiffBytes: 200000, includeUntracked: true };

describe('collectWorkspaceDiff', () => {
  it('reviews tracked changes and untracked files together', async () => {
    const result = await collectWorkspaceDiff({
      ...BASE,
      runner: runnerFor({ diff: TRACKED, untracked: ['src/new.ts'] }),
      readFile,
    });
    const files = reviewableFiles(parseUnifiedDiff(result.diff));
    assert.deepEqual(files.map((file) => file.path), ['src/cart.ts', 'src/new.ts']);
    assert.equal(result.untrackedCount, 1);
  });

  it('asks git for untracked files without touching the index', async () => {
    const calls: string[][] = [];
    await collectWorkspaceDiff({
      ...BASE,
      runner: runnerFor({ diff: TRACKED, untracked: ['src/new.ts'] }, calls),
      readFile,
    });
    const lsFiles = calls.find((call) => call[0] === 'ls-files');
    assert.deepEqual(lsFiles, ['ls-files', '--others', '--exclude-standard', '-z']);
    assert.equal(calls.some((call) => call[0] === 'add'), false);
  });

  it('reviews untracked files even when nothing tracked has changed', async () => {
    const result = await collectWorkspaceDiff({
      ...BASE,
      runner: runnerFor({ diff: '', untracked: ['src/new.ts'] }),
      readFile,
    });
    const files = reviewableFiles(parseUnifiedDiff(result.diff));
    assert.deepEqual(files.map((file) => file.path), ['src/new.ts']);
  });

  it('joins the two diffs so the parser sees both', async () => {
    const result = await collectWorkspaceDiff({
      ...BASE,
      runner: runnerFor({ diff: TRACKED.trimEnd(), untracked: ['src/new.ts'] }),
      readFile,
    });
    assert.equal(reviewableFiles(parseUnifiedDiff(result.diff)).length, 2);
  });

  it('skips untracked files entirely when the setting is off', async () => {
    const calls: string[][] = [];
    const result = await collectWorkspaceDiff({
      ...BASE,
      includeUntracked: false,
      runner: runnerFor({ diff: TRACKED, untracked: ['src/new.ts'] }, calls),
      readFile,
    });
    assert.equal(result.diff, TRACKED);
    assert.equal(result.untrackedCount, 0);
    assert.equal(calls.some((call) => call[0] === 'ls-files'), false);
  });

  it('is an empty diff when there is nothing at all', async () => {
    const result = await collectWorkspaceDiff({
      ...BASE,
      runner: runnerFor({ diff: '', untracked: [] }),
      readFile,
    });
    assert.equal(result.diff, '');
    assert.equal(result.untrackedCount, 0);
  });

  it('reports files it skipped', async () => {
    const result = await collectWorkspaceDiff({
      ...BASE,
      runner: runnerFor({ diff: '', untracked: ['a.bin'] }),
      readFile: () => Promise.resolve(Buffer.from([0x00, 0x01])),
    });
    assert.equal(result.untrackedCount, 0);
    assert.match(result.skipped[0].reason, /binary/);
  });
});

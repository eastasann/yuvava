/**
 * The one test that runs real git.
 *
 * Everything else stubs the runner, which leaves the actual `execFile` path
 * and git's real diff output untested. This builds a throwaway repository,
 * makes a change, and drives the pipeline end to end with a stub model.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findRepositoryRoot, getWorkingTreeDiff } from '../src/core/git.js';
import { parseUnifiedDiff, renderAnnotatedDiff, reviewableFiles } from '../src/core/diff.js';
import { runReview } from '../src/core/review.js';
import type { ReviewProvider } from '../src/core/provider.js';

function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const ORIGINAL = `export function total(cart) {
  const items = cart.items;
  return items.reduce((sum, item) => sum + item.price, 0);
}
`;

const CHANGED = `export function total(cart) {
  const items = cart.items;
  const count = items.length;
  return items.reduce((sum, item) => sum + item.price, 0) / count;
}
`;

let repo: string | undefined;

describe('git integration', { skip: gitAvailable() ? false : 'git is not installed' }, () => {
  before(() => {
    repo = mkdtempSync(path.join(tmpdir(), 'navigator-git-'));
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    };
    git('init', '-q');
    git('config', 'user.email', 'navigator@example.invalid');
    git('config', 'user.name', 'Navigator Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(path.join(repo, 'cart.js'), ORIGINAL);
    git('add', '.');
    git('commit', '-q', '-m', 'initial');
  });

  after(() => {
    if (repo !== undefined) {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('finds the repository root', async () => {
    const root = await findRepositoryRoot({ cwd: repo! });
    assert.equal(path.basename(root), path.basename(repo!));
  });

  it('returns an empty diff for a clean tree', async () => {
    assert.equal(await getWorkingTreeDiff('HEAD', { cwd: repo! }), '');
  });

  it('rejects a base revision that does not exist', async () => {
    await assert.rejects(() => getWorkingTreeDiff('origin/nope', { cwd: repo! }));
  });

  it('parses a real git diff and renders usable line numbers', async () => {
    writeFileSync(path.join(repo!, 'cart.js'), CHANGED);
    const diff = await getWorkingTreeDiff('HEAD', { cwd: repo! });
    assert.match(diff, /^diff --git a\/cart\.js b\/cart\.js$/m);

    const files = reviewableFiles(parseUnifiedDiff(diff));
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'cart.js');

    const rendered = renderAnnotatedDiff(files);
    assert.match(rendered, /^\s+3 \+ {2}const count = items\.length;$/m);
  });

  it('drives the whole pipeline from a real diff to an anchored observation', async () => {
    const diff = await getWorkingTreeDiff('HEAD', { cwd: repo! });
    const provider: ReviewProvider = {
      review: () =>
        Promise.resolve({
          text: JSON.stringify({
            issues: [
              {
                file: 'cart.js',
                line: 4,
                severity: 'warning',
                category: 'edge-case',
                message: 'count is zero for an empty cart, so the result is NaN.',
                symbol: 'count',
              },
              {
                file: 'cart.js',
                line: 900,
                severity: 'error',
                category: 'correctness',
                message: 'this line is not in the diff at all.',
              },
            ],
          }),
        }),
    };

    const report = await runReview({
      diff,
      intensity: 'normal',
      maxObservations: 20,
      maxDiffBytes: 200000,
      provider,
    });

    assert.equal(report.status, 'reviewed');
    assert.equal(report.observations.length, 1);
    assert.equal(report.observations[0].file, 'cart.js');
    assert.equal(report.observations[0].line, 4);
    assert.equal(report.notes.length, 1);
    assert.match(report.notes[0], /discarded cart\.js:900/);
  });

  it('leaves the working tree exactly as it found it', async () => {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo!, encoding: 'utf8' });
    assert.equal(status.trim(), 'M cart.js', 'Navigator must not stage, stash or revert anything');
  });
});

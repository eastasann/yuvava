import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  GitError,
  READ_ONLY_GIT_SUBCOMMANDS,
  assertReadOnlyGitArgs,
  findRepositoryRoot,
  getWorkingTreeDiff,
  revisionExists,
  runGit,
  type CommandResult,
  type GitRunner,
} from '../src/core/git.js';

function fakeRunner(result: Partial<CommandResult>, calls: string[][] = []): GitRunner {
  return async (args) => {
    calls.push([...args]);
    return { code: 0, stdout: '', stderr: '', ...result };
  };
}

const OPTIONS = { cwd: '/repo' };

describe('read-only enforcement', () => {
  it('allows only read-only subcommands', () => {
    assert.deepEqual([...READ_ONLY_GIT_SUBCOMMANDS].sort(), ['diff', 'ls-files', 'rev-parse', 'status']);
  });

  it('rejects every subcommand that can modify a repository', () => {
    for (const subcommand of [
      'add',
      'apply',
      'checkout',
      'clean',
      'commit',
      'merge',
      'mv',
      'push',
      'rebase',
      'reset',
      'restore',
      'rm',
      'stash',
      'switch',
      'update-index',
      'write-tree',
    ]) {
      assert.throws(() => assertReadOnlyGitArgs([subcommand]), GitError, `${subcommand} should be refused`);
    }
  });

  it('rejects global options that could smuggle in a config change', () => {
    assert.throws(() => assertReadOnlyGitArgs(['-c', 'core.editor=x', 'diff']), GitError);
    assert.throws(() => assertReadOnlyGitArgs(['--exec-path=/tmp', 'diff']), GitError);
  });

  it('rejects an empty invocation', () => {
    assert.throws(() => assertReadOnlyGitArgs([]), GitError);
  });

  it('is enforced by runGit itself, not only by callers', async () => {
    const calls: string[][] = [];
    await assert.rejects(
      () => runGit(['commit', '-m', 'x'], OPTIONS, fakeRunner({}, calls)),
      GitError,
    );
    assert.deepEqual(calls, [], 'no process should be spawned for a refused subcommand');
  });
});

describe('runGit', () => {
  it('returns stdout on success', async () => {
    assert.equal(await runGit(['diff'], OPTIONS, fakeRunner({ stdout: 'patch' })), 'patch');
  });

  it('turns a non-zero exit into a GitError carrying stderr', async () => {
    await assert.rejects(
      () => runGit(['diff'], OPTIONS, fakeRunner({ code: 128, stderr: 'not a git repository' })),
      (error: unknown) => {
        assert.ok(error instanceof GitError);
        assert.match(error.message, /not a git repository/);
        return true;
      },
    );
  });
});

describe('findRepositoryRoot', () => {
  it('trims the reported root', async () => {
    assert.equal(await findRepositoryRoot(OPTIONS, fakeRunner({ stdout: '/repo\n' })), '/repo');
  });

  it('fails when git reports nothing', async () => {
    await assert.rejects(() => findRepositoryRoot(OPTIONS, fakeRunner({ stdout: '\n' })), GitError);
  });
});

describe('revisionExists', () => {
  it('is false when git cannot resolve the revision', async () => {
    assert.equal(await revisionExists('nope', OPTIONS, fakeRunner({ code: 1 })), false);
  });

  it('is true when git resolves it', async () => {
    assert.equal(await revisionExists('HEAD', OPTIONS, fakeRunner({ stdout: 'abc\n' })), true);
  });
});

describe('getWorkingTreeDiff', () => {
  it('diffs the working tree against the base without colour or external tools', async () => {
    const calls: string[][] = [];
    await getWorkingTreeDiff('HEAD', OPTIONS, fakeRunner({ stdout: 'patch' }, calls));
    assert.deepEqual(calls[0], ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
    assert.deepEqual(calls[1], ['diff', '--no-color', '--no-ext-diff', '--unified=3', 'HEAD', '--']);
  });

  it('explains an unknown base revision instead of failing obscurely', async () => {
    await assert.rejects(
      () => getWorkingTreeDiff('origin/nope', OPTIONS, fakeRunner({ code: 1 })),
      (error: unknown) => {
        assert.ok(error instanceof GitError);
        assert.match(error.message, /does not exist/);
        return true;
      },
    );
  });

  it('returns an empty diff unchanged', async () => {
    assert.equal(await getWorkingTreeDiff('HEAD', OPTIONS, fakeRunner({ stdout: '' })), '');
  });
});

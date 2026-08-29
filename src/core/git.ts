/**
 * Read-only git access.
 *
 * Navigator reads the working tree and never writes to it. That is enforced
 * structurally rather than by convention: `runGit` is the only way to reach
 * git, it always spawns the literal `git` binary, and it refuses any
 * subcommand that is not on the read-only allowlist.
 */

import { execFile } from 'node:child_process';

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunOptions {
  readonly cwd: string;
  readonly signal?: AbortSignal;
  readonly maxBuffer?: number;
}

/** Runs `git` with the given arguments. Injected in tests. */
export type GitRunner = (args: readonly string[], options: RunOptions) => Promise<CommandResult>;

/**
 * git subcommands Navigator is allowed to run.
 *
 * Adding anything that can write to the index, the object store or the working
 * tree breaks the product invariant in SPEC §16 — and the test that guards it.
 */
export const READ_ONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'diff',
  'ls-files',
  'rev-parse',
  'status',
]);

export class GitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GitError';
  }
}

/** Throws unless `args` is a read-only git invocation. */
export function assertReadOnlyGitArgs(args: readonly string[]): void {
  const subcommand = args[0];
  if (subcommand === undefined) {
    throw new GitError('no git subcommand given');
  }
  if (subcommand.startsWith('-')) {
    throw new GitError(`global git option "${subcommand}" is not allowed`);
  }
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
    throw new GitError(`git ${subcommand} is not a read-only subcommand`);
  }
}

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

const defaultRunner: GitRunner = (args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      {
        cwd: options.cwd,
        signal: options.signal,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === 'number') {
          // git ran and exited non-zero; the caller decides what that means.
          resolve({ code, stdout, stderr });
          return;
        }
        reject(
          new GitError(code === 'ENOENT' ? 'git was not found on PATH' : error.message, {
            cause: error,
          }),
        );
      },
    );
  });

export async function runGit(
  args: readonly string[],
  options: RunOptions,
  runner: GitRunner = defaultRunner,
): Promise<string> {
  assertReadOnlyGitArgs(args);
  const result = await runner(args, options);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`;
    throw new GitError(`git ${args[0]} failed: ${detail}`);
  }
  return result.stdout;
}

/** Absolute path of the repository containing `cwd`. */
export async function findRepositoryRoot(
  options: RunOptions,
  runner: GitRunner = defaultRunner,
): Promise<string> {
  const output = await runGit(['rev-parse', '--show-toplevel'], options, runner);
  const root = output.trim();
  if (root.length === 0) {
    throw new GitError('could not determine the repository root');
  }
  return root;
}

export async function revisionExists(
  revision: string,
  options: RunOptions,
  runner: GitRunner = defaultRunner,
): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--verify', '--quiet', `${revision}^{commit}`], options, runner);
    return true;
  } catch {
    return false;
  }
}

/**
 * Working-tree changes against `base`, staged and unstaged.
 *
 * Untracked files are intentionally excluded: including them would mean
 * running `git add -N`, and Navigator does not write to the repository.
 */
export async function getWorkingTreeDiff(
  base: string,
  options: RunOptions,
  runner: GitRunner = defaultRunner,
): Promise<string> {
  if (!(await revisionExists(base, options, runner))) {
    throw new GitError(`revision "${base}" does not exist in this repository`);
  }
  return runGit(
    ['diff', '--no-color', '--no-ext-diff', '--unified=3', base, '--'],
    options,
    runner,
  );
}

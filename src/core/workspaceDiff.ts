/**
 * What Navigator reviews: tracked changes plus new, untracked files.
 *
 * Both halves are obtained read-only — `git diff` for tracked changes,
 * `git ls-files --others` plus a file read for the rest — and concatenated
 * into one diff so everything downstream stays unaware of the distinction.
 */

import { readFile } from 'node:fs/promises';
import { getWorkingTreeDiff, listUntrackedFiles, type GitRunner, type RunOptions } from './git.js';
import {
  DEFAULT_MAX_UNTRACKED_FILE_BYTES,
  UNTRACKED_BUDGET_RATIO,
  buildUntrackedDiff,
  type FileReader,
  type SkippedFile,
} from './untracked.js';

export interface WorkspaceDiffOptions {
  /** Repository root, and the working directory for git. */
  readonly root: string;
  /** Revision the working tree is compared against. */
  readonly base: string;
  /** Total diff budget; untracked files may use a fraction of it. */
  readonly maxDiffBytes: number;
  readonly includeUntracked: boolean;
  readonly signal?: AbortSignal;
  readonly runner?: GitRunner;
  readonly readFile?: FileReader;
}

export interface WorkspaceDiff {
  readonly diff: string;
  readonly untrackedCount: number;
  readonly skipped: readonly SkippedFile[];
}

const defaultFileReader: FileReader = (absolutePath) => readFile(absolutePath);

export async function collectWorkspaceDiff(options: WorkspaceDiffOptions): Promise<WorkspaceDiff> {
  const runOptions: RunOptions = { cwd: options.root, signal: options.signal };
  const tracked = await getWorkingTreeDiff(options.base, runOptions, options.runner);

  if (!options.includeUntracked) {
    return { diff: tracked, untrackedCount: 0, skipped: [] };
  }

  const paths = await listUntrackedFiles(runOptions, options.runner);
  if (paths.length === 0) {
    return { diff: tracked, untrackedCount: 0, skipped: [] };
  }

  const untracked = await buildUntrackedDiff({
    root: options.root,
    paths,
    maxFileBytes: DEFAULT_MAX_UNTRACKED_FILE_BYTES,
    maxTotalBytes: Math.floor(options.maxDiffBytes * UNTRACKED_BUDGET_RATIO),
    readFile: options.readFile ?? defaultFileReader,
  });

  const separator = tracked.length > 0 && !tracked.endsWith('\n') ? '\n' : '';
  return {
    diff: `${tracked}${separator}${untracked.diff}`,
    untrackedCount: paths.length - untracked.skipped.length,
    skipped: untracked.skipped,
  };
}

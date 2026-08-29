/**
 * Untracked files, rendered as a diff.
 *
 * A file git does not track has no diff of its own, and the usual fix —
 * `git add -N` — writes to the index, which Navigator will not do. Instead the
 * file is read and presented as an all-added hunk, so it flows through exactly
 * the same parsing, prompting and anchoring as everything else.
 */

/** Reads a file's bytes. Injected so the synthesis is testable. */
export type FileReader = (absolutePath: string) => Promise<Buffer>;

export interface SkippedFile {
  readonly path: string;
  readonly reason: string;
}

export interface UntrackedDiffOptions {
  /** Repository root; untracked paths are relative to it. */
  readonly root: string;
  readonly paths: readonly string[];
  /** Files larger than this are not read. */
  readonly maxFileBytes: number;
  /** Once the synthesised diff reaches this size, remaining files are skipped. */
  readonly maxTotalBytes: number;
  readonly readFile: FileReader;
}

export interface UntrackedDiffResult {
  readonly diff: string;
  readonly skipped: readonly SkippedFile[];
}

/** 64 KiB: a new source file is smaller; a data dump is not worth reviewing. */
export const DEFAULT_MAX_UNTRACKED_FILE_BYTES = 64 * 1024;

/** How much of the diff budget untracked files may occupy. */
export const UNTRACKED_BUDGET_RATIO = 0.5;

function isProbablyBinary(content: Buffer): boolean {
  const sample = content.subarray(0, 8000);
  return sample.includes(0);
}

/** Joins a repository-relative path onto the root, POSIX or Windows style. */
function resolveWithin(root: string, relativePath: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  const trimmed = root.endsWith('/') || root.endsWith('\\') ? root.slice(0, -1) : root;
  return `${trimmed}${separator}${relativePath.split('/').join(separator)}`;
}

/**
 * Renders one file as a `new file` diff whose lines are all additions.
 *
 * Every content line is prefixed, so a file that itself contains diff syntax
 * cannot forge a hunk header or a second file entry.
 */
export function renderAddedFileDiff(path: string, content: string): string | undefined {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.every((line) => line.trim().length === 0)) {
    // Nothing but blank lines: there is no code here to review.
    return undefined;
  }

  return [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    '',
  ].join('\n');
}

/**
 * Builds a diff covering the given untracked files.
 *
 * A file that cannot be read, is binary, is empty, or does not fit the budget
 * is skipped with a reason rather than failing the review.
 */
export async function buildUntrackedDiff(options: UntrackedDiffOptions): Promise<UntrackedDiffResult> {
  const parts: string[] = [];
  const skipped: SkippedFile[] = [];
  let total = 0;

  for (const path of [...options.paths].sort()) {
    if (total >= options.maxTotalBytes) {
      skipped.push({ path, reason: 'untracked files exceeded the diff budget' });
      continue;
    }

    let content: Buffer;
    try {
      content = await options.readFile(resolveWithin(options.root, path));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      skipped.push({ path, reason: `could not be read (${detail})` });
      continue;
    }

    if (content.byteLength === 0) {
      skipped.push({ path, reason: 'file is empty' });
      continue;
    }
    if (content.byteLength > options.maxFileBytes) {
      skipped.push({ path, reason: `file is larger than ${options.maxFileBytes} bytes` });
      continue;
    }
    if (isProbablyBinary(content)) {
      skipped.push({ path, reason: 'file looks binary' });
      continue;
    }

    const rendered = renderAddedFileDiff(path, content.toString('utf8'));
    if (rendered === undefined) {
      skipped.push({ path, reason: 'file has no content lines' });
      continue;
    }

    parts.push(rendered);
    total += Buffer.byteLength(rendered, 'utf8');
  }

  return { diff: parts.join(''), skipped };
}

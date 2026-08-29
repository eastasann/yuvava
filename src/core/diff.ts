/**
 * Minimal unified-diff parsing.
 *
 * Navigator only needs two things from a diff:
 *   1. which files changed, and which lines of the *new* file each hunk covers
 *      (so an observation can be anchored to a real line, and so observations
 *      about untouched code can be rejected);
 *   2. a rendering that carries new-file line numbers, so the model can cite
 *      line numbers instead of guessing them.
 */

export interface DiffLine {
  /** ' ' context, '+' added, '-' removed. */
  readonly kind: ' ' | '+' | '-';
  /** 1-based line number in the new file; undefined for removed lines. */
  readonly newLine?: number;
  readonly text: string;
}

export interface DiffHunk {
  readonly header: string;
  /** First new-file line covered by the hunk (1-based). */
  readonly newStart: number;
  /** Last new-file line covered by the hunk (1-based, inclusive). */
  readonly newEnd: number;
  readonly lines: readonly DiffLine[];
}

export interface DiffFile {
  /** Repository-relative path of the file after the change. */
  readonly path: string;
  readonly hunks: readonly DiffHunk[];
  readonly isDeleted: boolean;
  readonly isBinary: boolean;
}

const HUNK_HEADER = /^@@+ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Strips git's `a/` and `b/` prefixes and normalises separators. */
export function normalizeDiffPath(raw: string): string {
  let path = raw.trim();
  if (path.startsWith('"') && path.endsWith('"') && path.length >= 2) {
    path = path.slice(1, -1);
  }
  path = path.replace(/\\/g, '/');
  path = path.replace(/^[ab]\//, '');
  path = path.replace(/^\.\//, '');
  return path;
}

/**
 * Parses `git diff` output. Unknown or malformed sections are skipped rather
 * than thrown on: a diff Navigator cannot fully understand should degrade to a
 * smaller review, never to a crash.
 */
export function parseUnifiedDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diff.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    // Trailing newline, not an empty context line.
    lines.pop();
  }

  let path: string | undefined;
  let isDeleted = false;
  let isBinary = false;
  let hunks: DiffHunk[] = [];
  let hunkHeader: string | undefined;
  let hunkLines: DiffLine[] = [];
  let hunkStart = 0;
  let nextNewLine = 0;

  const flushHunk = (): void => {
    if (hunkHeader === undefined) {
      return;
    }
    hunks.push({
      header: hunkHeader,
      newStart: hunkStart,
      newEnd: Math.max(hunkStart, nextNewLine - 1),
      lines: hunkLines,
    });
    hunkHeader = undefined;
    hunkLines = [];
  };

  const flushFile = (): void => {
    flushHunk();
    if (path !== undefined) {
      files.push({ path, hunks, isDeleted, isBinary });
    }
    path = undefined;
    isDeleted = false;
    isBinary = false;
    hunks = [];
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flushFile();
      const match = /^diff --git (.+?) (.+)$/.exec(line);
      if (match) {
        path = normalizeDiffPath(match[2]);
      }
      continue;
    }

    if (path === undefined) {
      continue;
    }

    if (line.startsWith('deleted file mode')) {
      isDeleted = true;
      continue;
    }
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      isBinary = true;
      continue;
    }
    if (line.startsWith('rename to ')) {
      path = normalizeDiffPath(line.slice('rename to '.length));
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim();
      if (target !== '/dev/null') {
        path = normalizeDiffPath(target);
      }
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('index ') || line.startsWith('old mode') ||
        line.startsWith('new mode') || line.startsWith('new file mode') ||
        line.startsWith('similarity index') || line.startsWith('rename from ')) {
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      flushHunk();
      hunkHeader = line;
      hunkStart = Number.parseInt(hunkMatch[3], 10);
      nextNewLine = hunkStart;
      continue;
    }

    if (hunkHeader === undefined) {
      continue;
    }

    if (line.startsWith('\\')) {
      // "\ No newline at end of file"
      continue;
    }

    const marker = line.charAt(0);
    const text = line.slice(1);
    if (marker === '+') {
      hunkLines.push({ kind: '+', newLine: nextNewLine, text });
      nextNewLine += 1;
    } else if (marker === '-') {
      hunkLines.push({ kind: '-', text });
    } else if (marker === ' ' || line === '') {
      hunkLines.push({ kind: ' ', newLine: nextNewLine, text });
      nextNewLine += 1;
    }
  }

  flushFile();
  return files;
}

/** True when `line` falls inside any hunk of `file`. */
export function isLineInDiff(file: DiffFile, line: number): boolean {
  return file.hunks.some((hunk) => line >= hunk.newStart && line <= hunk.newEnd);
}

/** Every new-file line number the diff actually added for this file. */
export function addedLines(file: DiffFile): number[] {
  const result: number[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === '+' && line.newLine !== undefined) {
        result.push(line.newLine);
      }
    }
  }
  return result;
}

const GUTTER_WIDTH = 6;

/**
 * Renders a diff with explicit new-file line numbers.
 *
 * The model is asked to cite `line` values from this gutter, which removes the
 * most common source of misplaced review comments.
 */
export function renderAnnotatedDiff(files: readonly DiffFile[]): string {
  const out: string[] = [];
  for (const file of files) {
    if (file.isBinary) {
      out.push(`### ${file.path} (binary, not reviewable)`);
      out.push('');
      continue;
    }
    if (file.isDeleted) {
      out.push(`### ${file.path} (deleted)`);
      out.push('');
      continue;
    }
    out.push(`### ${file.path}`);
    for (const hunk of file.hunks) {
      out.push(hunk.header);
      for (const line of hunk.lines) {
        const gutter = line.newLine === undefined ? '' : String(line.newLine);
        out.push(`${gutter.padStart(GUTTER_WIDTH)} ${line.kind}${line.text}`);
      }
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}

/** Files worth sending to review: text files that still exist and have hunks. */
export function reviewableFiles(files: readonly DiffFile[]): DiffFile[] {
  return files.filter((file) => !file.isBinary && !file.isDeleted && file.hunks.length > 0);
}

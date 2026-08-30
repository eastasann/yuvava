/**
 * What the last review found, kept in memory for as long as its diagnostics
 * are on screen.
 *
 * The hover and `Navigator: Go Deeper` need to know which observation the
 * cursor is on, and which change it was found in. Both are in memory only:
 * nothing here is written anywhere, and a reload starts empty. There is no
 * review history (see `DECISIONS.md`), and this is not the beginning of one —
 * each review replaces the last.
 */

import type { DiffFile } from '../core/diff.js';
import type { Observation } from '../core/types.js';

interface RememberedReview {
  readonly repositoryRoot: string;
  readonly observations: readonly Observation[];
  readonly files: readonly DiffFile[];
}

let remembered: RememberedReview | undefined;

export function rememberReview(review: RememberedReview): void {
  remembered = review;
}

export function forgetReview(): void {
  remembered = undefined;
}

export function rememberedReview(): RememberedReview | undefined {
  return remembered;
}

/** The observation covering `line` (zero-based) in `fsPath`, if any. */
export function observationAt(fsPath: string, line: number): Observation | undefined {
  if (remembered === undefined) {
    return undefined;
  }
  const normalized = fsPath.replace(/\\/g, '/');
  return remembered.observations.find((observation) => {
    if (!normalized.endsWith(`/${observation.file}`) && normalized !== observation.file) {
      return false;
    }
    return line >= observation.line - 1 && line <= observation.endLine - 1;
  });
}

export function observationFor(file: string, line: number): Observation | undefined {
  return remembered?.observations.find(
    (observation) => observation.file === file && observation.line === line,
  );
}

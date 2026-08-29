/**
 * Turns validated model issues into observations anchored to the reviewed diff.
 *
 * Two things happen here, both in service of SPEC §7 (Silence by Default):
 * an issue that cannot be placed on a line the developer actually changed is
 * discarded rather than guessed at, and the message is run through the
 * sanitizer so no replacement code reaches the editor.
 */

import { isLineInDiff, normalizeDiffPath, type DiffFile } from './diff.js';
import { sanitizeMessage } from './sanitize.js';
import type { DroppedObservation, Observation, ReviewOutcome, Severity } from './types.js';
import type { RawIssue } from './schema.js';

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export interface AnchorOptions {
  /** Upper bound on observations shown for a single review. */
  readonly maxObservations: number;
}

function findFile(files: readonly DiffFile[], rawPath: string): DiffFile | undefined {
  const path = normalizeDiffPath(rawPath);
  const exact = files.find((file) => file.path === path);
  if (exact) {
    return exact;
  }
  // Models sometimes echo an absolute or partially-qualified path.
  const suffixMatches = files.filter(
    (file) => file.path.endsWith(`/${path}`) || path.endsWith(`/${file.path}`),
  );
  return suffixMatches.length === 1 ? suffixMatches[0] : undefined;
}

function hunkEndFor(file: DiffFile, line: number): number {
  for (const hunk of file.hunks) {
    if (line >= hunk.newStart && line <= hunk.newEnd) {
      return hunk.newEnd;
    }
  }
  return line;
}

export function anchorIssues(
  issues: readonly RawIssue[],
  files: readonly DiffFile[],
  options: AnchorOptions,
): ReviewOutcome {
  const observations: Observation[] = [];
  const dropped: DroppedObservation[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    const file = findFile(files, issue.file);
    if (file === undefined) {
      dropped.push({
        reason: 'file is not part of the reviewed diff',
        detail: `${issue.file}:${issue.line}`,
      });
      continue;
    }

    if (!isLineInDiff(file, issue.line)) {
      dropped.push({
        reason: 'line is outside the reviewed changes',
        detail: `${file.path}:${issue.line}`,
      });
      continue;
    }

    const sanitized = sanitizeMessage(issue.message);
    if (sanitized.message === undefined) {
      dropped.push({
        reason: 'observation contained no usable prose after code was removed',
        detail: `${file.path}:${issue.line}`,
      });
      continue;
    }

    const key = `${file.path}:${issue.line}:${sanitized.message}`;
    if (seen.has(key)) {
      dropped.push({ reason: 'duplicate observation', detail: `${file.path}:${issue.line}` });
      continue;
    }
    seen.add(key);

    const endLine = Math.min(issue.endLine ?? issue.line, hunkEndFor(file, issue.line));
    observations.push({
      file: file.path,
      line: issue.line,
      endLine: Math.max(issue.line, endLine),
      severity: issue.severity,
      category: issue.category,
      message: sanitized.message,
      symbol: issue.symbol,
    });
  }

  observations.sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byFile = a.file.localeCompare(b.file);
    return byFile !== 0 ? byFile : a.line - b.line;
  });

  const limit = Math.max(1, Math.trunc(options.maxObservations));
  if (observations.length > limit) {
    for (const extra of observations.slice(limit)) {
      dropped.push({
        reason: `over the ${limit}-observation limit for one review`,
        detail: `${extra.file}:${extra.line}`,
      });
    }
    observations.length = limit;
  }

  return { observations, dropped };
}

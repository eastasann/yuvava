/**
 * The review pipeline: diff in, observations out.
 *
 * Deliberately free of I/O and of `vscode`, so the whole decision chain —
 * what is reviewable, what the model is told, what survives validation, what
 * the developer ends up seeing — is exercised by unit tests.
 */

import { parseUnifiedDiff, renderAnnotatedDiff, reviewableFiles, type DiffFile } from './diff.js';
import { parseReviewResponse } from './schema.js';
import { anchorIssues } from './anchor.js';
import { ReviewUnavailableError, type ReviewProvider } from './provider.js';
import type { DroppedObservation, Observation, ReviewIntensity } from './types.js';

export interface ReviewOptions {
  readonly diff: string;
  readonly intensity: ReviewIntensity;
  readonly maxObservations: number;
  readonly maxDiffBytes: number;
  readonly provider: ReviewProvider;
  readonly signal?: AbortSignal;
}

export type ReviewStatus =
  /** Nothing to review — an empty diff is a normal, silent outcome. */
  | 'no-changes'
  /** The diff was too large to send. */
  | 'diff-too-large'
  /** A review ran. `observations` may still be empty, and usually is. */
  | 'reviewed';

export interface ReviewReport {
  readonly status: ReviewStatus;
  readonly observations: readonly Observation[];
  readonly dropped: readonly DroppedObservation[];
  /** Notes for the log: parse problems, discarded issues, size warnings. */
  readonly notes: readonly string[];
  readonly files: readonly DiffFile[];
}

const EMPTY_REPORT = (status: ReviewStatus, notes: string[] = [], files: DiffFile[] = []): ReviewReport => ({
  status,
  observations: [],
  dropped: [],
  notes,
  files,
});

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * Runs one review.
 *
 * Throws only `ReviewUnavailableError`, and only when the provider itself
 * failed. Every other degraded case (empty diff, oversized diff, unusable
 * response) is reported as a status the caller can surface quietly.
 */
export async function runReview(options: ReviewOptions): Promise<ReviewReport> {
  const files = reviewableFiles(parseUnifiedDiff(options.diff));
  if (files.length === 0) {
    return EMPTY_REPORT('no-changes');
  }

  const annotatedDiff = renderAnnotatedDiff(files);
  const size = byteLength(annotatedDiff);
  if (size > options.maxDiffBytes) {
    return EMPTY_REPORT(
      'diff-too-large',
      [`diff is ${size} bytes, over the ${options.maxDiffBytes} byte limit`],
      files,
    );
  }

  let response;
  try {
    response = await options.provider.review({
      annotatedDiff,
      intensity: options.intensity,
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof ReviewUnavailableError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReviewUnavailableError(detail, { cause: error });
  }

  const parsed = parseReviewResponse(response.text);
  const outcome = anchorIssues(parsed.issues, files, {
    maxObservations: options.maxObservations,
  });

  const notes = [...(response.warnings ?? []), ...parsed.problems];
  for (const drop of outcome.dropped) {
    notes.push(`discarded ${drop.detail}: ${drop.reason}`);
  }

  return {
    status: 'reviewed',
    observations: outcome.observations,
    dropped: outcome.dropped,
    notes,
    files,
  };
}

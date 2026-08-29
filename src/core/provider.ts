/**
 * The seam between Navigator and whatever produces a review.
 *
 * Keeping this an interface is what makes the review pipeline testable without
 * a network or an API key — and it keeps every model-specific detail out of
 * the code that decides what the developer is shown.
 */

import type { ReviewIntensity } from './types.js';

export interface ReviewRequest {
  /** Diff rendered with new-file line numbers. */
  readonly annotatedDiff: string;
  readonly intensity: ReviewIntensity;
  readonly signal?: AbortSignal;
}

export interface ReviewResponse {
  /** Raw model output. Parsed and validated by the core, never trusted. */
  readonly text: string;
}

export interface ReviewProvider {
  review(request: ReviewRequest): Promise<ReviewResponse>;
}

/** A review that could not be produced. Never a reason to touch user code. */
export class ReviewUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ReviewUnavailableError';
  }
}

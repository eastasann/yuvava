/**
 * The seam between Navigator and whatever produces an answer.
 *
 * Keeping this an interface is what makes the pipelines testable without a
 * network or an API key — and it keeps every model-specific detail out of the
 * code that decides what the developer is shown.
 *
 * There are two request shapes, not one general one. A provider is told which
 * job it is doing, so the prompt and the schema for that job live on
 * Navigator's side of the seam rather than in the caller: nothing outside
 * `src/core` can ask a model an arbitrary question.
 */

import type { ReviewIntensity } from './types.js';

export interface ReviewRequest {
  /** Diff rendered with new-file line numbers. */
  readonly annotatedDiff: string;
  readonly intensity: ReviewIntensity;
  readonly signal?: AbortSignal;
}

/** What the developer said they are trying to do (SPEC §10). */
export interface GuidanceRequest {
  readonly question: string;
  /**
   * Optional code the developer had selected, already rendered and capped by
   * the caller. Read-only context; nothing is ever written back to it.
   */
  readonly context?: string;
  readonly signal?: AbortSignal;
}

export interface ProviderResponse {
  /** Raw model output. Parsed and validated by the core, never trusted. */
  readonly text: string;
  /**
   * Anything the provider had to work around to get an answer — a rejected
   * schema, say. Surfaced in the log so an unfamiliar endpoint can be
   * diagnosed; never shown as an observation.
   */
  readonly warnings?: readonly string[];
}

/** Historic name for {@link ProviderResponse}; the shape is the same. */
export type ReviewResponse = ProviderResponse;

export interface ReviewProvider {
  review(request: ReviewRequest): Promise<ProviderResponse>;
}

export interface GuidanceProvider {
  guide(request: GuidanceRequest): Promise<ProviderResponse>;
}

/** What `providerFactory` builds: one client that can do either job. */
export type NavigatorProvider = ReviewProvider & GuidanceProvider;

/** An answer that could not be produced. Never a reason to touch user code. */
export class ReviewUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ReviewUnavailableError';
  }
}

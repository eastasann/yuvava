/**
 * Core domain types for Navigator.
 *
 * Nothing in `src/core` may import `vscode`: the core is the part that is
 * unit-testable outside the editor, and it is also the part that carries the
 * product invariant — it can describe observations, and nothing else.
 */

export type Severity = 'error' | 'warning' | 'info';

export const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info'];

/** Which service performs the review. Both are held to the same contract. */
export type ProviderKind = 'anthropic' | 'openai';

export const PROVIDER_KINDS: readonly ProviderKind[] = ['anthropic', 'openai'];

/**
 * How hard the model is asked to think before answering.
 *
 * Empty means "whatever the provider does by default", which is the default
 * here: nobody has measured what a lower setting costs in review quality, so
 * changing the default would be a guess. See `DECISIONS.md`.
 */
export type ReviewEffort = '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const REVIEW_EFFORTS: readonly ReviewEffort[] = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Review strength. No intensity ever permits code generation. */
export type ReviewIntensity = 'silent' | 'normal' | 'strict';

export const REVIEW_INTENSITIES: readonly ReviewIntensity[] = ['silent', 'normal', 'strict'];

/**
 * A single thing Navigator noticed.
 *
 * Deliberately minimal: there is no field in which a model could return
 * replacement code, a patch, or a fix. The only prose channel is `message`,
 * and it is length-capped and flattened to a single line by the sanitizer.
 */
export interface Observation {
  /** Repository-relative, forward-slash separated path. */
  readonly file: string;
  /** 1-based line in the post-change file. */
  readonly line: number;
  /** 1-based inclusive end line. Equals `line` for single-line observations. */
  readonly endLine: number;
  readonly severity: Severity;
  /** Short kind label, e.g. `correctness`, `edge-case`. */
  readonly category: string;
  /** One-sentence observation. Never contains code blocks. */
  readonly message: string;
  /**
   * Optional identifier appearing on `line`, used only to narrow the
   * underline. Purely presentational; never used to change the file.
   */
  readonly symbol?: string;
}

/** An issue the model reported that Navigator refused to show, and why. */
export interface DroppedObservation {
  readonly reason: string;
  readonly detail: string;
}

export interface ReviewOutcome {
  readonly observations: readonly Observation[];
  readonly dropped: readonly DroppedObservation[];
}

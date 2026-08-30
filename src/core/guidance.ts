/**
 * The guidance pipeline: a question in, places to look out.
 *
 * Deliberately free of I/O and of `vscode`, for the same reason as
 * `review.ts`: what the developer is told has to be decidable in a unit test.
 *
 * SPEC §10 is the constraint that shapes this. Navigator is not answering the
 * question — it is naming what the question involves, so the developer goes
 * and finds out. Nothing here summarises documentation, and nothing here
 * produces a link (see `guidanceSchema.ts`).
 */

import { parseGuidanceResponse, type GuidanceTopic } from './guidanceSchema.js';
import { ReviewUnavailableError, type GuidanceProvider } from './provider.js';
import { describeUsage } from './usage.js';

/** Longer than this and it is not a question, it is a specification. */
export const MAX_QUESTION_LENGTH = 500;

export interface GuidanceOptions {
  readonly question: string;
  readonly provider: GuidanceProvider;
  /** Read-only code the developer had selected, already rendered and capped. */
  readonly context?: string;
  readonly signal?: AbortSignal;
}

export type GuidanceStatus =
  /** Nothing was asked. A normal, silent outcome. */
  | 'no-question'
  /** An answer came back. `topics` and `searches` may both still be empty. */
  | 'answered';

export interface GuidanceReport {
  readonly status: GuidanceStatus;
  readonly topics: readonly GuidanceTopic[];
  readonly searches: readonly string[];
  /**
   * SPEC §8 Levels 1-3, least specific first.
   *
   * The pipeline hands over all of them; revealing them one at a time is the
   * caller's job, and it never happens without the developer asking (§8: the
   * loop being preserved is Hint -> Human thinks -> Human solves).
   */
  readonly hints: readonly string[];
  /**
   * SPEC §21.6. Things next to the question that the developer did not ask
   * about. The last rung of the same disclosure, so it is reached rather than
   * presented — which is the whole of "keep the frequency low".
   */
  readonly explore: readonly string[];
  /** Notes for the log: parse problems, anything discarded. */
  readonly notes: readonly string[];
}

/**
 * Asks where to look.
 *
 * Throws only `ReviewUnavailableError`, and only when the provider itself
 * failed. An unusable answer is reported as an answer with nothing in it,
 * which the caller surfaces as silence (SPEC §7).
 */
export async function runGuidance(options: GuidanceOptions): Promise<GuidanceReport> {
  const question = options.question.trim().slice(0, MAX_QUESTION_LENGTH);
  if (question.length === 0) {
    return { status: 'no-question', topics: [], searches: [], hints: [], explore: [], notes: [] };
  }

  let response;
  try {
    response = await options.provider.guide({
      question,
      ...(options.context === undefined ? {} : { context: options.context }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof ReviewUnavailableError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReviewUnavailableError(detail, { cause: error });
  }

  const parsed = parseGuidanceResponse(response.text);
  return {
    status: 'answered',
    topics: parsed.topics,
    searches: parsed.searches,
    hints: parsed.hints,
    explore: parsed.explore,
    notes: [...(response.warnings ?? []), ...parsed.problems, describeUsage(response.usage)],
  };
}

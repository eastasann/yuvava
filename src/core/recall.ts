/**
 * The recall pipeline (SPEC §9): a description in, names out.
 *
 * Same shape as `review.ts` and `guidance.ts`, and free of I/O and of `vscode`
 * for the same reason: what the developer is shown has to be decidable in a
 * unit test.
 */

import { parseRecallResponse, type RecallCandidate } from './recallSchema.js';
import { ReviewUnavailableError, type RecallProvider } from './provider.js';

/** A description of a forgotten name is short by nature. */
export const MAX_DESCRIPTION_LENGTH = 300;

export interface RecallOptions {
  readonly description: string;
  readonly provider: RecallProvider;
  readonly signal?: AbortSignal;
}

export type RecallStatus = 'no-question' | 'answered';

export interface RecallReport {
  readonly status: RecallStatus;
  readonly candidates: readonly RecallCandidate[];
  readonly notes: readonly string[];
}

export async function runRecall(options: RecallOptions): Promise<RecallReport> {
  const description = options.description.trim().slice(0, MAX_DESCRIPTION_LENGTH);
  if (description.length === 0) {
    return { status: 'no-question', candidates: [], notes: [] };
  }

  let response;
  try {
    response = await options.provider.recall({ description, signal: options.signal });
  } catch (error) {
    if (error instanceof ReviewUnavailableError) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new ReviewUnavailableError(detail, { cause: error });
  }

  const parsed = parseRecallResponse(response.text);
  return {
    status: 'answered',
    candidates: parsed.candidates,
    notes: [...(response.warnings ?? []), ...parsed.problems],
  };
}

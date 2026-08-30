/**
 * Turning one observation into a question worth asking about it.
 *
 * A review says *what* is wrong (SPEC §6.1). Going deeper is SPEC §8: the
 * developer wants to work it out, and asks for one more step of narrowing.
 * That is the same shape as the guidance path, so it reuses it rather than
 * growing a fourth prompt — the question is built here, from the observation
 * and the hunk it sits in, and the answer comes back through the same schema,
 * the same validation, and the same hint sanitiser.
 */

import { renderAnnotatedDiff, type DiffFile } from './diff.js';
import type { Observation } from './types.js';

/** Enough of the change to reason about, without resending the whole review. */
export const MAX_CONTEXT_BYTES = 8000;

export function buildObservationQuestion(observation: Observation): string {
  return (
    'I am looking at a problem flagged in code I wrote, and I want to work it ' +
    `out myself rather than be told the answer.\n\nThe observation was: "${observation.message}"\n` +
    `It is in ${observation.file} at line ${observation.line} (${observation.category}).`
  );
}

/**
 * The reviewed file the observation sits in, annotated as it was for the
 * review. Undefined when the file is no longer part of the remembered review.
 */
export function buildObservationContext(
  files: readonly DiffFile[],
  observation: Observation,
  maxBytes: number = MAX_CONTEXT_BYTES,
): string | undefined {
  const file = files.find((entry) => entry.path === observation.file);
  if (file === undefined) {
    return undefined;
  }
  const rendered = renderAnnotatedDiff([file]);
  if (rendered.length === 0) {
    return undefined;
  }
  const capped =
    Buffer.byteLength(rendered, 'utf8') > maxBytes
      ? `${rendered.slice(0, maxBytes)}\n(truncated)`
      : rendered;
  return `\n\nThis is the change it was found in:\n\n${capped}`;
}

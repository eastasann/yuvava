/**
 * The sanitiser for the hint path, and only the hint path.
 *
 * `sanitize.ts` removes every trace of code, which is right for a review
 * (SPEC §6.2) and wrong for a hint: SPEC §9 explicitly wants signatures, and a
 * hint that may not show the *shape* of a construct often cannot be given at
 * all. So this module allows a code fragment through — under conditions strict
 * enough that what survives cannot be pasted.
 *
 * Three kinds, from issue #6:
 *
 *   a. a signature — `reduce(callbackFn, initialValue?)` — allowed, SPEC §9
 *   b. a skeleton with the decision left out — allowed
 *   c. code that would run as written — refused
 *
 * The test for c is mechanical: a fragment is kept only if it is a signature,
 * or if it still has a **hole** — an ellipsis, or a comment asking a question.
 * Working code has neither. Everything is then flattened to one line and
 * capped, so even a fragment that slipped through is a fragment, not a file.
 *
 * This module is deliberately not imported by the review path. `anchor.ts`
 * calls `sanitizeMessage`, and `test/sanitize.test.ts` keeps proving that a
 * review message loses all of its code.
 */

import { looksLikeCode } from './sanitize.js';

/** A hint is a sentence and perhaps a fragment, not a document. */
export const MAX_HINT_LENGTH = 400;

/** Shorter than this and there is nothing left worth revealing. */
export const MIN_HINT_LENGTH = 8;

/** Past this, a "fragment" is an implementation. */
export const MAX_HINT_CODE_LINES = 6;
export const MAX_HINT_CODE_CHARS = 200;

export interface HintSanitizeResult {
  /** Sanitized hint, or undefined when nothing usable remained. */
  readonly text?: string;
  /** True when a code fragment was refused. */
  readonly removedCode: boolean;
  readonly truncated: boolean;
}

const FENCED_BLOCK = /```[a-zA-Z0-9_+-]*\n?([\s\S]*?)(?:```|$)/g;

/**
 * A hole the developer still has to fill: an ellipsis, a standalone `...`, or
 * a comment that asks something.
 *
 * `...` only counts when it stands alone — `{ ...rest }` is a spread operator
 * in working code, not a gap.
 */
const PLACEHOLDER: readonly RegExp[] = [
  /…/,
  /(^|[\s({[])\.\.\.($|[\s)}\],;])/,
  /(?:\/\/|\/\*|#)[^\n]*[?？]/,
];

/** A bare call or method signature: no body, no statement. */
const SIGNATURE = /^[A-Za-z_$][\w$.]*(?:<[^<>]*>)?\s*\([^;{}]*\)(?:\s*(?::|->)\s*[\w$<>[\]|,. ]+)?;?$/;

export function isSignature(fragment: string): boolean {
  const trimmed = fragment.trim();
  return !trimmed.includes('\n') && SIGNATURE.test(trimmed);
}

export function hasHole(fragment: string): boolean {
  return PLACEHOLDER.some((pattern) => pattern.test(fragment));
}

/**
 * May this fragment be shown?
 *
 * Exported because it is the whole of the a/b/c rule, and the rule is the part
 * worth testing directly.
 */
export function isPermittedFragment(fragment: string): boolean {
  const lines = fragment.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0 || lines.length > MAX_HINT_CODE_LINES) {
    return false;
  }
  const flattened = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (flattened.length > MAX_HINT_CODE_CHARS) {
    return false;
  }
  return isSignature(flattened) || hasHole(flattened);
}

/**
 * Sanitises one hint.
 *
 * At most one fragment survives, on one line, inside backticks. Prose outside
 * the fences is treated exactly as a review message is: statement-shaped lines
 * are dropped, so code cannot get through by leaving the fence off.
 */
export function sanitizeHint(raw: unknown): HintSanitizeResult {
  if (typeof raw !== 'string') {
    return { removedCode: false, truncated: false };
  }

  let removedCode = false;
  let fragment: string | undefined;

  const withoutFences = raw.replace(FENCED_BLOCK, (_match, body: string) => {
    if (fragment === undefined && isPermittedFragment(body)) {
      fragment = body
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return ' ';
    }
    removedCode = true;
    return ' ';
  });

  const prose = withoutFences
    .split('\n')
    .filter((line) => {
      if (!looksLikeCode(line)) {
        return true;
      }
      removedCode = true;
      return false;
    })
    .join(' ')
    .replace(/`{3,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  let text = fragment === undefined ? prose : `${prose} \`${fragment}\``.trim();
  if (text.length < MIN_HINT_LENGTH) {
    return { removedCode, truncated: false };
  }

  let truncated = false;
  if (text.length > MAX_HINT_LENGTH) {
    text = text.slice(0, MAX_HINT_LENGTH).trimEnd() + '…';
    truncated = true;
  }

  return { text, removedCode, truncated };
}

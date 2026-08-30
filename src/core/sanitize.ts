/**
 * Structural defence for SPEC §16 (Hard Safety Invariant) and §6.2.
 *
 * The prompt asks the model not to write code. This module makes it *hard* for
 * code to survive even when the model ignores that instruction: fenced blocks
 * are removed, statement-shaped lines are dropped, the remaining prose is
 * flattened to a single line and length-capped. A multi-line replacement
 * implementation cannot pass through intact.
 */

/** Observations longer than this are truncated. A review is one sentence. */
export const MAX_MESSAGE_LENGTH = 320;

/** Shorter than this and there is nothing meaningful left to show. */
export const MIN_MESSAGE_LENGTH = 12;

export interface SanitizeResult {
  /** Sanitized text, or undefined when nothing usable remained. */
  readonly message?: string;
  /** True when code-looking content was removed. */
  readonly removedCode: boolean;
  /** True when the message was shortened. */
  readonly truncated: boolean;
}

const FENCED_BLOCK = /```[\s\S]*?(?:```|$)/g;
/**
 * Lines that are syntactically code even without a trailing `;` or brace.
 * Each pattern requires real syntax after the keyword, so prose that merely
 * begins with "if", "for" or "return" is not mistaken for an implementation.
 */
const CODE_SHAPES: readonly RegExp[] = [
  /^(?:if|for|while|switch|catch)\s*\(/,
  /^(?:const|let|var)\s+[\w$]+\s*=/,
  /^(?:function|class|def|fn)\s+[\w$]+\s*[(<]/,
  /^(?:import|export)\s+[\w{*]/,
];

/**
 * Heuristic: does this line read like a statement rather than a sentence?
 *
 * Deliberately conservative about prose — an English sentence that merely
 * starts with "if" or "return" is kept, because dropping real observations
 * costs more than letting one short code-ish line through the flattener.
 */
export function looksLikeCode(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (trimmed.startsWith('diff --git') || /^@@[ -]/.test(trimmed)) {
    return true;
  }
  const body = trimmed.replace(/^[+-]\s*/, '');
  if (body.length === 0) {
    return false;
  }
  if (/[;{}]$/.test(body)) {
    return true;
  }
  if (/[.!?。！？]$/.test(body)) {
    return false;
  }
  return CODE_SHAPES.some((shape) => shape.test(body));
}

/** A topic name or a search term. Short by nature, so no minimum length. */
export const MAX_LABEL_LENGTH = 120;

/**
 * Sanitises a short label — a topic name, a note, a search term.
 *
 * The same code-stripping as `sanitizeMessage`, minus the minimum length: a
 * topic is legitimately two words, and a review message is not. It also
 * removes URLs, because Navigator shows links resolved from an index and never
 * ones a model wrote (see `guidanceSchema.ts`).
 *
 * Returns undefined when nothing usable is left, which the caller treats as
 * "the model had nothing to say here" rather than as an error.
 */
export function sanitizeLabel(raw: unknown, maxLength: number = MAX_LABEL_LENGTH): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const withoutFences = raw.replace(FENCED_BLOCK, ' ');
  const kept = withoutFences.split('\n').filter((line) => !looksLikeCode(line));
  const label = kept
    .join(' ')
    .replace(/`{3,}/g, '')
    .replace(/\bhttps?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (label.length === 0) {
    return undefined;
  }
  if (label.length <= maxLength) {
    return label;
  }
  const slice = label.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxLength * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + '…';
}

export function sanitizeMessage(raw: string): SanitizeResult {
  let removedCode = false;

  const withoutFences = raw.replace(FENCED_BLOCK, () => {
    removedCode = true;
    return ' ';
  });

  const keptLines: string[] = [];
  for (const line of withoutFences.split('\n')) {
    if (looksLikeCode(line)) {
      removedCode = true;
      continue;
    }
    keptLines.push(line);
  }

  // Flatten: an observation is one sentence, not a document.
  let message = keptLines.join(' ').replace(/`{3,}/g, '').replace(/\s+/g, ' ').trim();

  if (message.length < MIN_MESSAGE_LENGTH) {
    return { removedCode, truncated: false };
  }

  let truncated = false;
  if (message.length > MAX_MESSAGE_LENGTH) {
    const slice = message.slice(0, MAX_MESSAGE_LENGTH);
    const lastSpace = slice.lastIndexOf(' ');
    const cut = lastSpace > MAX_MESSAGE_LENGTH * 0.6 ? slice.slice(0, lastSpace) : slice;
    message = cut.trimEnd() + '…';
    truncated = true;
  }

  return { message, removedCode, truncated };
}

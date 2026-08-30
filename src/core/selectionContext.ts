/**
 * Rendering an editor selection as context for a question (issue #24).
 *
 * "I want to add a retry to this" is a much better question when *this* is
 * something the developer pointed at, and typing the situation out instead is
 * work the selection already did.
 *
 * Read-only by construction: this module receives text, it does not know where
 * it came from and has no way back to a document. The caller reads the
 * selection; `test/invariant.test.ts` pins that it does so with `getText` and
 * nothing else.
 */

/** Past this, the developer selected a file, not a passage. */
export const MAX_SELECTION_CHARS = 4000;
export const MAX_SELECTION_LINES = 200;

export interface Selection {
  /** Workspace-relative path, for the model and for telling the developer. */
  readonly path: string;
  readonly languageId: string;
  /** 1-based, inclusive. */
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
}

export interface RenderedSelection {
  /** Appended to the question. Empty is impossible: undefined is used instead. */
  readonly context: string;
  /** What the developer is told is being sent. */
  readonly summary: string;
  readonly truncated: boolean;
}

function summarize(selection: Selection, lines: number, truncated: boolean): string {
  const range =
    selection.startLine === selection.endLine
      ? `${selection.startLine}`
      : `${selection.startLine}-${selection.endLine}`;
  const count = `${lines} line${lines === 1 ? '' : 's'}`;
  return `${selection.path}:${range} (${truncated ? `first ${count}` : count})`;
}

/**
 * Renders a selection, or nothing when there is nothing worth sending.
 *
 * Returns undefined for an empty or whitespace-only selection: an accidental
 * click should not silently attach a stray character to the question.
 */
export function renderSelection(
  selection: Selection,
  limits: { maxChars?: number; maxLines?: number } = {},
): RenderedSelection | undefined {
  if (selection.text.trim().length === 0) {
    return undefined;
  }

  const maxChars = limits.maxChars ?? MAX_SELECTION_CHARS;
  const maxLines = limits.maxLines ?? MAX_SELECTION_LINES;

  const allLines = selection.text.split('\n');
  let kept = allLines.slice(0, Math.max(1, maxLines));
  let truncated = kept.length < allLines.length;

  let body = kept.join('\n');
  if (body.length > maxChars) {
    body = body.slice(0, maxChars);
    kept = body.split('\n');
    truncated = true;
  }

  const summary = summarize(selection, kept.length, truncated);
  const context =
    `\n\nThey have this selected in ${selection.path} ` +
    `(${selection.languageId}), lines ${selection.startLine} to ${selection.endLine}` +
    `${truncated ? ', truncated' : ''}:\n\n${body}`;

  return { context, summary, truncated };
}

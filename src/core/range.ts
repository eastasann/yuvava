/**
 * Where an observation is underlined.
 *
 * Kept out of the editor layer so the placement rules — including "drop the
 * observation when the file no longer has that line" — are unit-testable.
 */

import type { Observation } from './types.js';

/** Zero-based, end-exclusive on the column. */
export interface Anchor {
  readonly startLine: number;
  readonly startColumn: number;
  readonly endLine: number;
  readonly endColumn: number;
}

/** The little bit of a text document that anchoring needs. */
export interface DocumentLines {
  readonly lineCount: number;
  lineText(index: number): string;
}

/**
 * Resolves an observation to a range in the current document.
 *
 * Returns undefined when the document has moved on and the line no longer
 * exists: a misplaced warning is worse than a missing one (SPEC §7).
 */
export function computeAnchor(observation: Observation, document: DocumentLines): Anchor | undefined {
  const startLine = observation.line - 1;
  if (startLine < 0 || startLine >= document.lineCount) {
    return undefined;
  }
  const endLine = Math.min(Math.max(observation.endLine, observation.line) - 1, document.lineCount - 1);
  const startText = document.lineText(startLine);

  if (observation.symbol !== undefined && startLine === endLine) {
    const index = startText.indexOf(observation.symbol);
    if (index >= 0 && observation.symbol.length > 0) {
      return {
        startLine,
        startColumn: index,
        endLine,
        endColumn: index + observation.symbol.length,
      };
    }
  }

  const indent = startText.search(/\S/);
  const endText = document.lineText(endLine);
  return {
    startLine,
    startColumn: indent < 0 ? 0 : indent,
    endLine,
    endColumn: endText.length,
  };
}

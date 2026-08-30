/**
 * Reading the editor's current selection.
 *
 * The whole module: ask the active editor what is selected and hand the text
 * over. `TextEditor` also offers `edit`, and this file never touches it —
 * `test/invariant.test.ts` asserts that `getText` is the only editor member
 * called here, so a future edit path cannot appear quietly.
 *
 * No selection means no context. Guessing at the lines around the cursor was
 * the alternative, and a guess attached to every question is noise the
 * developer cannot see the shape of.
 */

import * as vscode from 'vscode';
import { renderSelection, type RenderedSelection } from '../core/selectionContext.js';

export function readSelection(): RenderedSelection | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined || editor.selection.isEmpty) {
    return undefined;
  }

  const range = editor.selection;
  return renderSelection({
    path: vscode.workspace.asRelativePath(editor.document.uri, false),
    languageId: editor.document.languageId,
    startLine: range.start.line + 1,
    endLine: range.end.line + 1,
    text: editor.document.getText(range),
  });
}

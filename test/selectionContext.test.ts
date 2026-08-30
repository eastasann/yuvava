/**
 * The editor selection as context for a question (issue #24).
 *
 * Two things matter here: that a large selection is cut down rather than sent
 * whole, and that whatever is sent is described back to the developer in the
 * same breath. Nothing should leave the editor that they were not told about.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_SELECTION_LINES,
  renderSelection,
  type Selection,
} from '../src/core/selectionContext.js';

const SELECTION: Selection = {
  path: 'src/net/client.ts',
  languageId: 'typescript',
  startLine: 12,
  endLine: 14,
  text: 'async function load(url) {\n  return await fetch(url);\n}',
};

describe('renderSelection', () => {
  it('names the file, the language and the lines', () => {
    const rendered = renderSelection(SELECTION);
    assert.ok(rendered);
    assert.match(rendered.context, /src\/net\/client\.ts/);
    assert.match(rendered.context, /typescript/);
    assert.match(rendered.context, /lines 12 to 14/);
    assert.match(rendered.context, /async function load/);
  });

  it('summarises what is being sent, for the developer to read', () => {
    const rendered = renderSelection(SELECTION);
    assert.equal(rendered?.summary, 'src/net/client.ts:12-14 (3 lines)');
    assert.equal(rendered?.truncated, false);
  });

  it('says "first N lines" when it had to cut', () => {
    const rendered = renderSelection(
      { ...SELECTION, endLine: 500, text: Array.from({ length: 400 }, () => 'line').join('\n') },
      { maxLines: 10 },
    );
    assert.ok(rendered);
    assert.equal(rendered.truncated, true);
    assert.equal(rendered.summary, 'src/net/client.ts:12-500 (first 10 lines)');
    assert.match(rendered.context, /truncated/);
  });

  it('cuts on characters too, so one enormous line cannot get through', () => {
    const rendered = renderSelection({ ...SELECTION, text: 'x'.repeat(50000) }, { maxChars: 100 });
    assert.ok(rendered);
    assert.equal(rendered.truncated, true);
    assert.ok(rendered.context.length < 500);
  });

  it('sends nothing for an accidental selection', () => {
    assert.equal(renderSelection({ ...SELECTION, text: '' }), undefined);
    assert.equal(renderSelection({ ...SELECTION, text: '   \n\t' }), undefined);
  });

  it('reads naturally for a one-line selection', () => {
    const rendered = renderSelection({ ...SELECTION, startLine: 7, endLine: 7, text: 'const a = 1;' });
    assert.equal(rendered?.summary, 'src/net/client.ts:7 (1 line)');
  });

  it('has a default cap, so a caller cannot forget to pass one', () => {
    const rendered = renderSelection({
      ...SELECTION,
      text: Array.from({ length: MAX_SELECTION_LINES + 50 }, () => 'x').join('\n'),
    });
    assert.equal(rendered?.truncated, true);
  });
});

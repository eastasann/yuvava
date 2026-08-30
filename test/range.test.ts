import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeAnchor, type DocumentLines } from '../src/core/range.js';
import type { Observation } from '../src/core/types.js';

function documentOf(...lines: string[]): DocumentLines {
  return { lineCount: lines.length, lineText: (index) => lines[index] };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    file: 'src/a.ts',
    line: 2,
    endLine: 2,
    severity: 'warning',
    category: 'edge-case',
    message: 'items may be undefined here.',
    ...overrides,
  };
}

const DOC = documentOf('function total(cart) {', '  const count = items.length;', '}');

describe('computeAnchor', () => {
  it('underlines the named symbol when it is on the line', () => {
    const anchor = computeAnchor(observation({ symbol: 'items' }), DOC);
    assert.deepEqual(anchor, { startLine: 1, startColumn: 16, endLine: 1, endColumn: 21 });
  });

  it('underlines the code on the line, skipping indentation, without a symbol', () => {
    const anchor = computeAnchor(observation(), DOC);
    assert.deepEqual(anchor, { startLine: 1, startColumn: 2, endLine: 1, endColumn: 29 });
  });

  it('falls back to the whole line when the symbol is not there', () => {
    const anchor = computeAnchor(observation({ symbol: 'missing' }), DOC);
    assert.equal(anchor?.startColumn, 2);
  });

  it('spans a multi-line range', () => {
    const anchor = computeAnchor(observation({ line: 1, endLine: 3 }), DOC);
    assert.deepEqual(anchor, { startLine: 0, startColumn: 0, endLine: 2, endColumn: 1 });
  });

  it('drops an observation whose line no longer exists', () => {
    assert.equal(computeAnchor(observation({ line: 99, endLine: 99 }), DOC), undefined);
    assert.equal(computeAnchor(observation({ line: 0, endLine: 0 }), DOC), undefined);
  });

  it('clamps an end line past the end of the file', () => {
    const anchor = computeAnchor(observation({ line: 2, endLine: 99 }), DOC);
    assert.equal(anchor?.endLine, 2);
  });

  it('handles a blank line', () => {
    const anchor = computeAnchor(observation({ line: 1, endLine: 1 }), documentOf('   '));
    assert.deepEqual(anchor, { startLine: 0, startColumn: 0, endLine: 0, endColumn: 3 });
  });
});

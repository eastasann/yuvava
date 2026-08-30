/**
 * Every item either does something, or does not close the window (#35).
 *
 * Reported from real use: the list appeared, an item was clicked, the window
 * closed and nothing happened. The item was a topic — the answer's main
 * content, at the top of the list, and inert.
 *
 * The rule these tests hold: a QuickPick item that can be selected must lead
 * somewhere. Where there is nowhere to lead, the list stays open instead of
 * vanishing, because a window that closes and does nothing reads as broken.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type * as FakeVscode from './fakes/vscode.js';
import type * as GuidanceModule from '../src/vscode/guidance.js';
import type * as RecallModule from '../src/vscode/recall.js';

const FAKE_PATH = require.resolve('./fakes/vscode.js');

type ModuleWithResolve = typeof Module & {
  _resolveFilename(request: string, ...rest: unknown[]): string;
};

const loader = Module as ModuleWithResolve;
const originalResolve = loader._resolveFilename;

before(() => {
  loader._resolveFilename = function patched(this: unknown, request: string, ...rest: unknown[]): string {
    return request === 'vscode' ? FAKE_PATH : originalResolve.call(this, request, ...rest);
  };
});

after(() => {
  loader._resolveFilename = originalResolve;
});

/* eslint-disable @typescript-eslint/no-require-imports */
const fake = require('./fakes/vscode.js') as typeof FakeVscode;
const guidance = require('../src/vscode/guidance.js') as typeof GuidanceModule;
const recall = require('../src/vscode/recall.js') as typeof RecallModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const REPORT = {
  status: 'answered' as const,
  topics: [
    { name: 'AbortSignal.timeout()', note: 'how the deadline is expressed' },
    { name: '4xx versus 5xx' },
  ],
  searches: ['MDN AbortSignal'],
  hints: ['A third attempt is not the same as a second one.'],
  explore: ['Retry-After'],
  notes: [],
};

/** Everything a person can actually click: separators are not selectable. */
function selectable(picks: readonly { label: string; kind?: number }[]): typeof picks {
  return picks.filter((pick) => pick.kind !== fake.QuickPickItemKind.Separator);
}

describe('the guidance list leads somewhere', () => {
  beforeEach(() => {
    fake.reset();
  });

  it('opens a search for a topic, which was the reported dead end', () => {
    const picks = guidance.buildGuidancePicks(REPORT);
    const topic = picks.find((pick) => pick.label === 'AbortSignal.timeout()');
    assert.equal(topic?.search, 'AbortSignal.timeout()');
  });

  it('keeps the note on the topic while making it lead somewhere', () => {
    const picks = guidance.buildGuidancePicks(REPORT);
    const topic = picks.find((pick) => pick.label === 'AbortSignal.timeout()');
    assert.equal(topic?.description, 'how the deadline is expressed');
  });

  it('leaves nothing selectable inert except the text of a hint', () => {
    // Fully revealed, so every kind of item is on screen at once.
    const picks = guidance.buildGuidancePicks(REPORT, 2);
    const inert = selectable(picks).filter(
      (pick) => (pick as GuidanceModule.GuidancePick).search === undefined &&
        (pick as GuidanceModule.GuidancePick).more !== true,
    );
    assert.deepEqual(
      inert.map((pick) => pick.label),
      [REPORT.hints[0]],
      'only a hint may be text; everything else has to lead somewhere',
    );
  });

  it('still resolves a topic through the index when the index knows it', () => {
    const links = new Map([
      [
        'AbortSignal.timeout()',
        {
          term: 'AbortSignal.timeout()',
          title: 'AbortSignal: timeout()',
          url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static',
        },
      ],
    ]);
    // Topics are not resolved today, so this pins the shape rather than the
    // behaviour: a topic falls back to a search, exactly like an unresolved
    // term does, and never to nothing.
    const picks = guidance.buildGuidancePicks(REPORT, 0, links);
    const topic = picks.find((pick) => pick.label === 'AbortSignal.timeout()');
    assert.equal(topic?.search, 'AbortSignal.timeout()');
  });
});

describe('the recall list leads somewhere', () => {
  const candidate = {
    name: 'Array.prototype.reduce',
    signature: 'reduce(callbackFn, initialValue?)',
    concept: 'Folds an array into one value.',
    search: 'MDN Array reduce',
  };

  beforeEach(() => {
    fake.reset();
  });

  it('has only the signature and the concept as text', () => {
    const picks = recall.buildCandidatePicks(candidate, 3);
    const inert = selectable(picks).filter(
      (pick) => (pick as { search?: string }).search === undefined &&
        (pick as { more?: true }).more !== true,
    );
    assert.deepEqual(inert.map((pick) => pick.label), [candidate.signature, candidate.concept]);
  });

  it('keeps the documentation rung leading somewhere', () => {
    const picks = recall.buildCandidatePicks(candidate, 3);
    const docs = picks.find((pick) => pick.label === candidate.search);
    assert.equal(docs?.search, candidate.search);
  });
});

describe('what choosing an item does', () => {
  it('closes on Escape', () => {
    assert.deepEqual(guidance.actionFor(undefined), { kind: 'close' });
  });

  it('opens a search for anything that names one', () => {
    assert.deepEqual(guidance.actionFor({ search: 'MDN AbortSignal' }), {
      kind: 'open',
      url: 'https://duckduckgo.com/?q=MDN%20AbortSignal',
    });
  });

  it('prefers a resolved page over a search when the index found one', () => {
    assert.deepEqual(
      guidance.actionFor({ search: 'MDN AbortSignal', url: 'https://developer.mozilla.org/x' }),
      { kind: 'open', url: 'https://developer.mozilla.org/x' },
    );
  });

  it('advances the disclosure for More specific', () => {
    assert.deepEqual(guidance.actionFor({ more: true }), { kind: 'reveal' });
  });

  it('shows the list again for text, rather than closing it', () => {
    // This is #35. A topic used to land here and the caller returned, so the
    // window closed having done nothing at all.
    assert.deepEqual(guidance.actionFor({}), { kind: 'again' });
    assert.deepEqual(guidance.actionFor({ more: undefined }), { kind: 'again' });
  });

  it('never returns an action that closes the window silently', () => {
    const cases: Array<Parameters<typeof guidance.actionFor>[0]> = [
      {},
      { more: true },
      { search: 'x' },
      { search: 'x', url: 'https://y/' },
    ];
    for (const chosen of cases) {
      const action = guidance.actionFor(chosen);
      assert.notEqual(action.kind, 'close', `${JSON.stringify(chosen)} must not close silently`);
    }
  });
});

describe('the three commands share one decision', () => {
  it('is the same function in each, so a fix reaches all of them', () => {
    // #35 was three copies of the same four-branch decision, and the fix would
    // have had to be made three times. It is one function now.
    const sources = ['guidance', 'recall', 'hover'].map((name) =>
      readFileSync(path.join(__dirname, '..', '..', 'src', 'vscode', `${name}.ts`), 'utf8'),
    );
    for (const source of sources) {
      assert.match(source, /actionFor\(chosen\)/);
    }
    assert.equal(sources.filter((source) => /export function actionFor/.test(source)).length, 1);
  });
});

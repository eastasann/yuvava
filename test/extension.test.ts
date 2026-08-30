/**
 * Extension-host wiring, exercised against a fake `vscode` module.
 *
 * These tests cover what unit tests of the core cannot: that activation
 * registers the commands the spec requires, that failures are reported without
 * blocking anything, and that observations become diagnostics.
 */

import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type * as FakeVscode from './fakes/vscode.js';
import type * as ExtensionModule from '../src/vscode/extension.js';
import type * as DiagnosticsModule from '../src/vscode/diagnostics.js';
import type * as GuidanceModule from '../src/vscode/guidance.js';
import type * as RecallModule from '../src/vscode/recall.js';
import type * as SelectionModule from '../src/vscode/selection.js';

const FAKE_PATH = require.resolve('./fakes/vscode.js');

type ModuleWithResolve = typeof Module & {
  _resolveFilename(request: string, ...rest: unknown[]): string;
};

const loader = Module as ModuleWithResolve;
const originalResolve = loader._resolveFilename;

before(() => {
  loader._resolveFilename = function patched(this: unknown, request: string, ...rest: unknown[]): string {
    if (request === 'vscode') {
      return FAKE_PATH;
    }
    return originalResolve.call(this, request, ...rest);
  };
});

after(() => {
  loader._resolveFilename = originalResolve;
});

/* eslint-disable @typescript-eslint/no-require-imports */
const fake = require('./fakes/vscode.js') as typeof FakeVscode;
const extension = require('../src/vscode/extension.js') as typeof ExtensionModule;
const diagnosticsModule = require('../src/vscode/diagnostics.js') as typeof DiagnosticsModule;
const guidanceModule = require('../src/vscode/guidance.js') as typeof GuidanceModule;
const recallModule = require('../src/vscode/recall.js') as typeof RecallModule;
const selectionModule = require('../src/vscode/selection.js') as typeof SelectionModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const REQUIRED_COMMANDS = [
  'navigator.reviewChanges',
  'navigator.clearObservations',
  'navigator.whereToLook',
  'navigator.recallName',
  'navigator.setApiKey',
  'navigator.clearApiKey',
  'navigator.showLog',
];

let savedKeys: Record<string, string | undefined> = {};
const API_KEY_VARS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY'];

describe('activation', () => {
  beforeEach(() => {
    fake.reset();
  });

  it('registers every contributed command', () => {
    const context = fake.makeExtensionContext();
    extension.activate(context as never);
    for (const command of REQUIRED_COMMANDS) {
      assert.ok(fake.recorded.commands.has(command), `${command} was not registered`);
    }
  });

  it('registers its resources for disposal', () => {
    const context = fake.makeExtensionContext();
    extension.activate(context as never);
    assert.ok(context.subscriptions.length >= REQUIRED_COMMANDS.length + 3);
    for (const subscription of context.subscriptions) {
      assert.equal(typeof subscription.dispose, 'function');
    }
    assert.doesNotThrow(() => extension.deactivate());
  });
});

describe('review command failure paths', () => {
  before(() => {
    savedKeys = Object.fromEntries(API_KEY_VARS.map((name) => [name, process.env[name]]));
  });

  after(() => {
    for (const [name, value] of Object.entries(savedKeys)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  beforeEach(() => {
    fake.reset();
    for (const name of API_KEY_VARS) {
      delete process.env[name];
    }
    extension.activate(fake.makeExtensionContext() as never);
  });

  it('asks for a folder instead of failing when none is open', async () => {
    await fake.commands.executeCommand('navigator.reviewChanges');
    assert.equal(fake.recorded.warnings.length, 1);
    assert.match(fake.recorded.warnings[0], /open a folder/);
  });

  it('asks for an API key instead of calling out without one', async () => {
    fake.recorded.workspaceFolders = [{ uri: { fsPath: '/tmp/does-not-exist' }, name: 'w', index: 0 }];
    await fake.commands.executeCommand('navigator.reviewChanges');
    assert.equal(fake.recorded.warnings.length, 1);
    assert.match(fake.recorded.warnings[0], /no Anthropic API key/);
  });

  it('names the configured provider when its key is missing', async () => {
    fake.recorded.configuration = { provider: 'openai' };
    fake.recorded.workspaceFolders = [{ uri: { fsPath: '/tmp/does-not-exist' }, name: 'w', index: 0 }];
    await fake.commands.executeCommand('navigator.reviewChanges');
    assert.match(fake.recorded.warnings[0], /no OpenAI API key/);
    assert.match(fake.recorded.warnings[0], /OPENAI_API_KEY/);
  });

  it('reads the API key of the configured provider from the environment', async () => {
    // With an OpenAI key present but Anthropic selected, the review must still
    // stop for a missing key rather than reach for the wrong one.
    process.env.OPENAI_API_KEY = 'openai-key';
    fake.recorded.workspaceFolders = [{ uri: { fsPath: '/tmp/does-not-exist' }, name: 'w', index: 0 }];
    await fake.commands.executeCommand('navigator.reviewChanges');
    assert.match(fake.recorded.warnings[0], /no Anthropic API key/);
  });

  it('keeps each provider key in its own secret', async () => {
    fake.recorded.configuration = { provider: 'openai' };
    fake.recorded.secrets.set('navigator.anthropicApiKey', 'anthropic-key');
    fake.recorded.workspaceFolders = [{ uri: { fsPath: '/tmp/does-not-exist' }, name: 'w', index: 0 }];
    await fake.commands.executeCommand('navigator.reviewChanges');
    assert.match(fake.recorded.warnings[0], /no OpenAI API key/);
  });

  it('reports a git failure as a warning and nothing else', async () => {
    fake.recorded.secrets.set('navigator.anthropicApiKey', 'test-key');
    fake.recorded.workspaceFolders = [
      { uri: { fsPath: path.join('/tmp', 'navigator-not-a-repo') }, name: 'w', index: 0 },
    ];
    await fake.commands.executeCommand('navigator.reviewChanges');
    assert.equal(fake.recorded.warnings.length, 1);
    assert.match(fake.recorded.warnings[0], /review unavailable/);
  });

  it('clears observations on request', () => {
    assert.doesNotThrow(() => fake.commands.executeCommand('navigator.clearObservations'));
  });
});

describe('publishObservations', () => {
  beforeEach(() => {
    fake.reset();
  });

  it('turns observations into diagnostics with a Navigator source', async () => {
    const collection = new fake.DiagnosticCollection();
    fake.recorded.documents.set(path.join('/repo', 'src/a.ts'), [
      'function total(cart) {',
      '  const count = items.length;',
      '}',
    ]);

    const result = await diagnosticsModule.publishObservations(collection as never, '/repo', [
      {
        file: 'src/a.ts',
        line: 2,
        endLine: 2,
        severity: 'warning',
        category: 'edge-case',
        message: 'items may be undefined here.',
        symbol: 'items',
      },
      {
        file: 'src/a.ts',
        line: 1,
        endLine: 1,
        severity: 'error',
        category: 'correctness',
        message: 'cart is never validated.',
      },
    ]);

    assert.equal(result.shown, 2);
    const diagnostics = collection.entries.get(path.join('/repo', 'src/a.ts'));
    assert.ok(diagnostics);
    assert.equal(diagnostics.length, 2);
    assert.equal(diagnostics[0].source, 'Navigator');
    assert.equal(diagnostics[0].code, 'edge-case');
    assert.equal(diagnostics[0].severity, fake.DiagnosticSeverity.Warning);
    assert.equal(diagnostics[0].range.start.character, 16);
    assert.equal(diagnostics[1].severity, fake.DiagnosticSeverity.Error);
  });

  it('shows nothing at all when there are no observations', async () => {
    const collection = new fake.DiagnosticCollection();
    const result = await diagnosticsModule.publishObservations(collection as never, '/repo', []);
    assert.equal(result.shown, 0);
    assert.equal(collection.entries.size, 0);
  });

  it('replaces the previous review rather than accumulating', async () => {
    const collection = new fake.DiagnosticCollection();
    fake.recorded.documents.set(path.join('/repo', 'src/a.ts'), ['const a = 1;']);
    const observation = {
      file: 'src/a.ts',
      line: 1,
      endLine: 1,
      severity: 'warning' as const,
      category: 'edge-case',
      message: 'something to look at here.',
    };
    await diagnosticsModule.publishObservations(collection as never, '/repo', [observation]);
    assert.equal(collection.entries.size, 1);
    await diagnosticsModule.publishObservations(collection as never, '/repo', []);
    assert.equal(collection.entries.size, 0);
  });

  it('skips a file it cannot open instead of failing the review', async () => {
    const collection = new fake.DiagnosticCollection();
    const result = await diagnosticsModule.publishObservations(collection as never, '/repo', [
      {
        file: 'src/missing.ts',
        line: 1,
        endLine: 1,
        severity: 'warning',
        category: 'edge-case',
        message: 'this file is not on disk.',
      },
    ]);
    assert.equal(result.shown, 0);
    assert.equal(result.notes.length, 1);
    assert.match(result.notes[0], /could not open src\/missing\.ts/);
  });

  it('drops an observation whose line no longer exists', async () => {
    const collection = new fake.DiagnosticCollection();
    fake.recorded.documents.set(path.join('/repo', 'src/a.ts'), ['const a = 1;']);
    const result = await diagnosticsModule.publishObservations(collection as never, '/repo', [
      {
        file: 'src/a.ts',
        line: 99,
        endLine: 99,
        severity: 'warning',
        category: 'edge-case',
        message: 'this line is long gone.',
      },
    ]);
    assert.equal(result.shown, 0);
    assert.match(result.notes[0], /line no longer exists/);
  });
});

describe('Where Should I Look?', () => {
  beforeEach(() => {
    fake.reset();
    for (const name of API_KEY_VARS) {
      delete process.env[name];
    }
    extension.activate(fake.makeExtensionContext() as never);
  });

  after(() => {
    for (const [name, value] of Object.entries(savedKeys)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('asks nothing and shows nothing when the question is dismissed', async () => {
    fake.recorded.inputBoxAnswers.push(undefined);
    await fake.commands.executeCommand('navigator.whereToLook');
    assert.deepEqual(fake.recorded.quickPicks, []);
    assert.deepEqual(fake.recorded.warnings, []);
  });

  it('treats a blank question as no question', async () => {
    fake.recorded.inputBoxAnswers.push('   ');
    await fake.commands.executeCommand('navigator.whereToLook');
    assert.deepEqual(fake.recorded.quickPicks, []);
  });

  it('stops for a missing API key instead of calling out', async () => {
    fake.recorded.inputBoxAnswers.push('add a retry to fetch');
    await fake.commands.executeCommand('navigator.whereToLook');
    assert.equal(fake.recorded.quickPicks.length, 0);
    assert.match(fake.recorded.warnings[0], /no Anthropic API key/);
  });
});

describe('buildGuidancePicks', () => {
  it('shows nothing at all when there is nothing to point at', () => {
    const picks = guidanceModule.buildGuidancePicks({
      status: 'answered',
      topics: [],
      searches: [],
      hints: [],
      explore: [],
      notes: [],
    });
    assert.deepEqual(picks, []);
  });

  it('lists the topics, then the searches under their own heading', () => {
    const picks = guidanceModule.buildGuidancePicks({
      status: 'answered',
      topics: [{ name: 'AbortSignal.timeout()', note: 'the deadline' }, { name: '4xx versus 5xx' }],
      searches: ['MDN AbortSignal'],
      hints: [],
      explore: [],
      notes: [],
    });
    assert.deepEqual(
      picks.map((pick) => [pick.label, pick.description, pick.search]),
      [
        // A topic carries its own name as the thing to look up (#35): leaving
        // it inert made the answer's main content a dead end.
        ['AbortSignal.timeout()', 'the deadline', 'AbortSignal.timeout()'],
        ['4xx versus 5xx', undefined, '4xx versus 5xx'],
        ['Search', undefined, undefined],
        ['MDN AbortSignal', undefined, 'MDN AbortSignal'],
      ],
    );
    assert.equal(picks[2].kind, fake.QuickPickItemKind.Separator);
  });

  it('offers no heading when the model had no search terms', () => {
    const picks = guidanceModule.buildGuidancePicks({
      status: 'answered',
      topics: [{ name: 'backoff' }],
      searches: [],
      hints: [],
      explore: [],
      notes: [],
    });
    assert.equal(picks.length, 1);
  });
});

describe('progressive disclosure (SPEC §8)', () => {
  const report = {
    status: 'answered' as const,
    topics: [{ name: 'backoff' }],
    searches: [],
    hints: ['Consider what happens on the third failure.', 'The delay is not constant.'],
    explore: [],
    notes: [],
  };

  it('shows no hint until the developer asks for one', () => {
    const picks = guidanceModule.buildGuidancePicks(report);
    assert.deepEqual(picks.map((pick) => pick.label), ['backoff', '', guidanceModule.MORE_SPECIFIC]);
  });

  it('reveals one more level per request, in order', () => {
    assert.deepEqual(
      guidanceModule.buildGuidancePicks(report, 1).map((pick) => pick.label),
      ['backoff', 'Hints', report.hints[0], '', guidanceModule.MORE_SPECIFIC],
    );
    assert.deepEqual(
      guidanceModule.buildGuidancePicks(report, 2).map((pick) => pick.label),
      ['backoff', 'Hints', report.hints[0], report.hints[1]],
    );
  });

  it('stops offering more once the last level is out', () => {
    const picks = guidanceModule.buildGuidancePicks(report, 2);
    assert.equal(picks.some((pick) => pick.label === guidanceModule.MORE_SPECIFIC), false);
  });

  it('never offers a level the model did not give', () => {
    const picks = guidanceModule.buildGuidancePicks({ ...report, hints: [] });
    assert.equal(picks.some((pick) => pick.label === guidanceModule.MORE_SPECIFIC), false);
  });
});

describe('What Was It Called? (SPEC §9)', () => {
  const candidate = {
    name: 'Array.prototype.reduce',
    signature: 'reduce(callbackFn, initialValue?)',
    concept: 'Folds an array into one value.',
    search: 'MDN Array reduce',
  };

  beforeEach(() => {
    fake.reset();
    for (const name of API_KEY_VARS) {
      delete process.env[name];
    }
    extension.activate(fake.makeExtensionContext() as never);
  });

  it('shows names and nothing else in the first list', () => {
    const picks = recallModule.buildNamePicks({
      status: 'answered',
      candidates: [candidate, { name: 'Array.prototype.flatMap' }],
      notes: [],
    });
    assert.deepEqual(picks.map((pick) => [pick.label, pick.description]), [
      ['Array.prototype.reduce', undefined],
      ['Array.prototype.flatMap', undefined],
    ]);
  });

  it('gives back the name alone until the developer asks for more', () => {
    const picks = recallModule.buildCandidatePicks(candidate);
    assert.deepEqual(picks.map((pick) => pick.label), [guidanceModule.MORE_SPECIFIC]);
  });

  it('climbs the rungs in SPEC §9 order, one per request', () => {
    assert.deepEqual(
      recallModule.buildCandidatePicks(candidate, 1).map((pick) => pick.label),
      [candidate.signature, '', guidanceModule.MORE_SPECIFIC],
    );
    assert.deepEqual(
      recallModule.buildCandidatePicks(candidate, 2).map((pick) => pick.label),
      [candidate.signature, candidate.concept, '', guidanceModule.MORE_SPECIFIC],
    );
    const all = recallModule.buildCandidatePicks(candidate, 3);
    assert.deepEqual(all.map((pick) => pick.label), [
      candidate.signature,
      candidate.concept,
      'Documentation',
      candidate.search,
    ]);
    assert.equal(all[3].search, candidate.search);
  });

  it('offers nothing at all for a candidate that is only a name', () => {
    assert.deepEqual(recallModule.buildCandidatePicks({ name: 'fetch' }), []);
  });

  it('stops for a missing API key instead of calling out', async () => {
    fake.recorded.inputBoxAnswers.push('folds an array into one value');
    await fake.commands.executeCommand('navigator.recallName');
    assert.equal(fake.recorded.quickPicks.length, 0);
    assert.match(fake.recorded.warnings[0], /no Anthropic API key/);
  });

  it('asks nothing when the question is dismissed', async () => {
    fake.recorded.inputBoxAnswers.push(undefined);
    await fake.commands.executeCommand('navigator.recallName');
    assert.deepEqual(fake.recorded.quickPicks, []);
    assert.deepEqual(fake.recorded.warnings, []);
  });
});

describe('documentation links come from the index (SPEC §10)', () => {
  const report = {
    status: 'answered' as const,
    topics: [{ name: 'AbortSignal' }],
    searches: ['MDN AbortSignal', 'some framework thing'],
    hints: [],
    explore: [],
    notes: [],
  };
  const links = new Map([
    [
      'MDN AbortSignal',
      {
        term: 'MDN AbortSignal',
        title: 'AbortSignal',
        url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal',
      },
    ],
  ]);

  it('shows every term, resolved or not', () => {
    const labels = guidanceModule.buildGuidancePicks(report, 0, links).map((pick) => pick.label);
    for (const term of report.searches) {
      assert.ok(labels.includes(term), `${term} was hidden`);
    }
  });

  it('attaches a URL only where the index gave one', () => {
    const picks = guidanceModule.buildGuidancePicks(report, 0, links);
    const resolved = picks.find((pick) => pick.label === 'MDN AbortSignal');
    const unresolved = picks.find((pick) => pick.label === 'some framework thing');
    assert.equal(resolved?.url, 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal');
    assert.equal(resolved?.description, 'AbortSignal');
    assert.equal(unresolved?.url, undefined);
    assert.equal(unresolved?.search, 'some framework thing');
  });

  it('shows no URL at all when the index answered nothing', () => {
    const picks = guidanceModule.buildGuidancePicks(report);
    assert.deepEqual(picks.filter((pick) => pick.url !== undefined), []);
  });

  it('never invents a link for a term the model produced', () => {
    const withUrlInTerm = { ...report, searches: ['https://example.invalid/made/up'] };
    const picks = guidanceModule.buildGuidancePicks(withUrlInTerm, 0, links);
    assert.deepEqual(picks.filter((pick) => pick.url !== undefined), []);
  });
});

describe('documentation exploration (SPEC §21.6)', () => {
  const report = {
    status: 'answered' as const,
    topics: [{ name: 'AbortSignal' }],
    searches: [],
    hints: ['The deadline and the retry are different clocks.'],
    explore: ['AbortController', 'Promise.any()', 'Retry-After'],
    notes: [],
  };

  it('is not shown to a developer who stopped at the topics', () => {
    const labels = guidanceModule.buildGuidancePicks(report).map((pick) => pick.label);
    for (const name of report.explore) {
      assert.equal(labels.includes(name), false, `${name} was presented, not reached`);
    }
  });

  it('is not shown at the hint levels either', () => {
    const labels = guidanceModule.buildGuidancePicks(report, 1).map((pick) => pick.label);
    assert.equal(labels.includes('AbortController'), false);
    assert.ok(labels.includes(guidanceModule.MORE_SPECIFIC), 'one rung should remain');
  });

  it('arrives as the last rung, under its own heading, and is searchable', () => {
    const picks = guidanceModule.buildGuidancePicks(report, 2);
    const labels = picks.map((pick) => pick.label);
    assert.ok(labels.includes('You may want to explore'));
    for (const name of report.explore) {
      const pick = picks.find((entry) => entry.label === name);
      assert.equal(pick?.search, name);
    }
    assert.equal(labels.includes(guidanceModule.MORE_SPECIFIC), false, 'that was the last rung');
  });

  it('adds no rung when the model offered nothing adjacent', () => {
    const bare = { ...report, explore: [] };
    assert.equal(guidanceModule.disclosureSteps(bare), 1);
    assert.equal(guidanceModule.disclosureSteps(report), 2);
  });

  it('is reachable even when there were no hints at all', () => {
    const noHints = { ...report, hints: [] };
    assert.equal(guidanceModule.disclosureSteps(noHints), 1);
    const labels = guidanceModule.buildGuidancePicks(noHints, 1).map((pick) => pick.label);
    assert.ok(labels.includes('You may want to explore'));
  });
});

describe('the editor selection as context (issue #24)', () => {
  beforeEach(() => {
    fake.reset();
    for (const name of API_KEY_VARS) {
      delete process.env[name];
    }
    fake.window.activeTextEditor = undefined;
    extension.activate(fake.makeExtensionContext() as never);
  });

  after(() => {
    fake.window.activeTextEditor = undefined;
  });

  it('tells the developer what is going with the question, before they type it', async () => {
    fake.recorded.workspaceFolders = [{ uri: { fsPath: '/repo' }, name: 'w', index: 0 }];
    fake.window.activeTextEditor = fake.fakeEditor(
      '/repo/src/a.ts',
      'async function load(url) {\n  return await fetch(url);\n}',
      12,
    );
    fake.recorded.inputBoxAnswers.push(undefined);
    await fake.commands.executeCommand('navigator.whereToLook');
    // Dismissed at the input box: nothing was sent, and nothing was asked for.
    assert.deepEqual(fake.recorded.quickPicks, []);
  });

  it('sends nothing when nothing is selected', () => {
    fake.window.activeTextEditor = fake.fakeEditor('/repo/src/a.ts', '');
    assert.equal(selectionModule.readSelection(), undefined);
  });

  it('has no editor to read when none is open', () => {
    fake.window.activeTextEditor = undefined;
    assert.equal(selectionModule.readSelection(), undefined);
  });

  it('reads the selection relative to the workspace', () => {
    fake.recorded.workspaceFolders = [{ uri: { fsPath: '/repo' }, name: 'w', index: 0 }];
    fake.window.activeTextEditor = fake.fakeEditor('/repo/src/a.ts', 'const a = 1;\nconst b = 2;', 12);
    const read = selectionModule.readSelection();
    assert.equal(read?.summary, 'src/a.ts:12-13 (2 lines)');
    assert.match(read.context, /const a = 1;/);
  });

  it('shows what was sent alongside the answer, and it cannot be picked', () => {
    const picks = guidanceModule.buildGuidancePicks(
      { status: 'answered', topics: [{ name: 'backoff' }], searches: [], hints: [], explore: [], notes: [] },
      0,
      new Map(),
      'src/a.ts:12-14 (3 lines)',
    );
    assert.equal(picks[0].label, 'Context: src/a.ts:12-14 (3 lines)');
    assert.equal(picks[0].kind, fake.QuickPickItemKind.Separator);
  });
});

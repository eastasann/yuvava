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
/* eslint-enable @typescript-eslint/no-require-imports */

const REQUIRED_COMMANDS = [
  'navigator.reviewChanges',
  'navigator.clearObservations',
  'navigator.setApiKey',
  'navigator.clearApiKey',
  'navigator.showLog',
];

let savedApiKey: string | undefined;

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
    savedApiKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  after(() => {
    if (savedApiKey !== undefined) {
      process.env.ANTHROPIC_API_KEY = savedApiKey;
    }
  });

  beforeEach(() => {
    fake.reset();
    delete process.env.ANTHROPIC_API_KEY;
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

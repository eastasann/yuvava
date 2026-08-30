/**
 * Hover over an observation (issue #13), and what it is allowed to offer.
 *
 * The hover has to earn its place: VS Code already shows a diagnostic's
 * message, so restating it would be worth nothing. What it adds is one link
 * into SPEC §8 — and that link is the only thing it can do.
 */

import assert from 'node:assert/strict';
import Module from 'node:module';
import { after, before, beforeEach, describe, it } from 'node:test';
import type * as FakeVscode from './fakes/vscode.js';
import type * as ExtensionModule from '../src/vscode/extension.js';
import type * as HoverModule from '../src/vscode/hover.js';
import type * as StoreModule from '../src/vscode/observationStore.js';
import type { Observation } from '../src/core/types.js';

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
const extension = require('../src/vscode/extension.js') as typeof ExtensionModule;
const hover = require('../src/vscode/hover.js') as typeof HoverModule;
const store = require('../src/vscode/observationStore.js') as typeof StoreModule;
/* eslint-enable @typescript-eslint/no-require-imports */

const OBSERVATION: Observation = {
  file: 'src/a.ts',
  line: 12,
  endLine: 14,
  severity: 'warning',
  category: 'edge-case',
  message: 'items may be undefined when the response omits it.',
};

describe('the observation hover', () => {
  beforeEach(() => {
    fake.reset();
    store.forgetReview();
  });

  it('says more than the diagnostic already says', () => {
    const markdown = hover.buildObservationHover(OBSERVATION);
    assert.match(markdown.value, /items may be undefined/);
    assert.match(markdown.value, /edge-case/);
    assert.match(markdown.value, /Go deeper/);
    assert.match(markdown.value, /one hint at a time/);
  });

  it('can invoke exactly one command, and names it', () => {
    const markdown = hover.buildObservationHover(OBSERVATION);
    assert.deepEqual(markdown.isTrusted, { enabledCommands: [hover.GO_DEEPER_COMMAND] });
    const links = [...markdown.value.matchAll(/command:([\w.]+)/g)].map((match) => match[1]);
    assert.deepEqual(links, [hover.GO_DEEPER_COMMAND]);
  });

  it('carries the identity of the observation in the link, not the code', () => {
    const markdown = hover.buildObservationHover(OBSERVATION);
    const encoded = markdown.value.slice(markdown.value.indexOf('?') + 1).split(')')[0];
    assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), ['src/a.ts', 12]);
  });

  it('appears only where the review actually found something', () => {
    extension.activate(fake.makeExtensionContext() as never);
    const provider = fake.recorded.hoverProviders[0];
    assert.ok(provider, 'no hover provider was registered');

    const uri = fake.Uri.file('/repo/src/a.ts');
    assert.equal(provider.provideHover({ uri }, { line: 11 }), undefined);

    store.rememberReview({ repositoryRoot: '/repo', observations: [OBSERVATION], files: [] });
    assert.ok(provider.provideHover({ uri }, { line: 11 }));
    assert.ok(provider.provideHover({ uri }, { line: 13 }), 'the whole range should hover');
    assert.equal(provider.provideHover({ uri }, { line: 20 }), undefined);
    assert.equal(provider.provideHover({ uri: fake.Uri.file('/repo/src/b.ts') }, { line: 11 }), undefined);
  });

  it('forgets the review when the observations are cleared', () => {
    extension.activate(fake.makeExtensionContext() as never);
    store.rememberReview({ repositoryRoot: '/repo', observations: [OBSERVATION], files: [] });
    fake.commands.executeCommand('navigator.clearObservations');
    assert.equal(store.rememberedReview(), undefined);
  });
});

describe('Go Deeper', () => {
  beforeEach(() => {
    fake.reset();
    store.forgetReview();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    extension.activate(fake.makeExtensionContext() as never);
  });

  it('says so quietly when the observation is gone, rather than failing', async () => {
    await fake.commands.executeCommand('navigator.goDeeper', 'src/a.ts', 12);
    assert.deepEqual(fake.recorded.warnings, []);
    assert.match(fake.recorded.statusMessages[0], /that observation is gone/);
  });

  it('stops for a missing API key instead of calling out', async () => {
    store.rememberReview({ repositoryRoot: '/repo', observations: [OBSERVATION], files: [] });
    await fake.commands.executeCommand('navigator.goDeeper', 'src/a.ts', 12);
    assert.match(fake.recorded.warnings[0], /no Anthropic API key/);
    assert.equal(fake.recorded.quickPicks.length, 0);
  });
});

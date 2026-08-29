/**
 * SPEC §16 / LOOP.md §13: Navigator must never modify user implementation code.
 *
 * The prompt asks the model not to write code; these tests check the thing the
 * prompt cannot: that the extension has no *capability* to change a file. They
 * read Navigator's own source, so a future change that adds an edit path fails
 * here rather than in a user's workspace.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...sourceFiles(full));
    } else if (entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found.sort();
}

const SOURCES = sourceFiles(SRC_ROOT).map((file) => ({
  path: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

/**
 * Editor and filesystem APIs that can change a file on disk or in a buffer.
 * Each pattern is assembled at runtime so this test file does not match itself
 * if it is ever moved under `src/`.
 */
const FORBIDDEN_WRITE_APIS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: 'WorkspaceEdit', pattern: new RegExp(['Workspace', 'Edit'].join('')) },
  { label: 'workspace.applyEdit', pattern: new RegExp(['apply', 'Edit'].join('')) },
  { label: 'TextEdit', pattern: new RegExp(['\\bText', 'Edit\\b'].join('')) },
  { label: 'TextEditor.edit', pattern: /\.edit\s*\(/ },
  { label: 'insertSnippet', pattern: new RegExp(['insert', 'Snippet'].join('')) },
  { label: 'SnippetString', pattern: new RegExp(['Snippet', 'String'].join('')) },
  { label: 'workspace.fs', pattern: /workspace\.fs\b/ },
  { label: 'fs.writeFile', pattern: /\bwriteFile(?:Sync)?\s*\(/ },
  { label: 'fs.appendFile', pattern: /\bappendFile(?:Sync)?\s*\(/ },
  { label: 'fs.rename', pattern: /\brename(?:Sync)?\s*\(/ },
  { label: 'fs.rm / unlink', pattern: /\b(?:rmSync|unlinkSync|rm|unlink)\s*\(/ },
  { label: 'createWriteStream', pattern: new RegExp(['create', 'WriteStream'].join('')) },
  { label: 'document.save', pattern: /\.save\s*\(/ },
];

/** Contribution points through which VS Code would offer to change code. */
const FORBIDDEN_PROVIDERS: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: 'code action provider', pattern: new RegExp(['registerCode', 'ActionsProvider'].join('')) },
  { label: 'code action kind', pattern: new RegExp(['CodeAction', 'Kind'].join('')) },
  { label: 'completion provider', pattern: new RegExp(['registerCompletion', 'ItemProvider'].join('')) },
  { label: 'inline completion provider', pattern: new RegExp(['registerInlineCompletion', 'ItemProvider'].join('')) },
  { label: 'formatting provider', pattern: /registerDocument\w*FormattingEditProvider/ },
  { label: 'rename provider', pattern: new RegExp(['registerRename', 'Provider'].join('')) },
  { label: 'on-will-save handler', pattern: new RegExp(['onWillSave', 'TextDocument'].join('')) },
];

describe('Navigator cannot modify user source code', () => {
  it('has source files to check', () => {
    assert.ok(SOURCES.length >= 8, `expected Navigator sources, found ${SOURCES.length}`);
  });

  for (const { label, pattern } of FORBIDDEN_WRITE_APIS) {
    it(`never calls ${label}`, () => {
      const offenders = SOURCES.filter((file) => pattern.test(file.text)).map((file) => file.path);
      assert.deepEqual(offenders, [], `${label} would give Navigator the ability to change a file`);
    });
  }

  for (const { label, pattern } of FORBIDDEN_PROVIDERS) {
    it(`registers no ${label}`, () => {
      const offenders = SOURCES.filter((file) => pattern.test(file.text)).map((file) => file.path);
      assert.deepEqual(offenders, [], `a ${label} is a route to changing user code`);
    });
  }

  it('spawns no process other than git', () => {
    // `foo.exec(regex)` is a regular expression, not a subprocess.
    const spawnCall = /(?<![.\w])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/;
    const offenders = SOURCES.filter(
      (file) => file.path !== 'src/core/git.ts' &&
        (spawnCall.test(file.text) || /child_process/.test(file.text)),
    ).map((file) => file.path);
    assert.deepEqual(offenders, [], 'process execution belongs in the read-only git module only');
  });

  it('keeps editor APIs out of the core, so the core cannot reach a buffer', () => {
    const offenders = SOURCES.filter(
      (file) => file.path.startsWith('src/core/') && /from '(?:node:)?vscode'|require\('vscode'\)/.test(file.text),
    ).map((file) => file.path);
    assert.deepEqual(offenders, []);
  });

  it('publishes findings only as diagnostics', () => {
    const extension = SOURCES.find((file) => file.path === 'src/vscode/extension.ts');
    assert.ok(extension, 'extension entry point is missing');
    assert.match(extension.text, /createDiagnosticCollection/);
  });
});

describe('the extension manifest offers no way to change code', () => {
  const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    contributes: Record<string, unknown> & {
      commands: Array<{ command: string; title: string; category?: string }>;
    };
    activationEvents: string[];
  };

  it('contributes no command that applies, fixes, generates or refactors', () => {
    const forbidden = /\b(apply|fix|generate|complete|refactor|rewrite|accept|patch|implement)\b/i;
    const offenders = manifest.contributes.commands.filter(
      (command) => forbidden.test(command.command) || forbidden.test(command.title),
    );
    assert.deepEqual(offenders, []);
  });

  it('offers the review command required by the spec', () => {
    const review = manifest.contributes.commands.find((c) => c.command === 'navigator.reviewChanges');
    assert.ok(review, 'navigator.reviewChanges is missing');
    assert.equal(`${review.category}: ${review.title}`, 'Navigator: Review Current Changes');
  });

  it('declares no editor-integration contribution points', () => {
    assert.deepEqual(Object.keys(manifest.contributes).sort(), ['commands', 'configuration']);
  });
});

/**
 * The tests that only a real VS Code can run (issue #18).
 *
 * `test/extension.test.ts` activates Navigator against a fake `vscode` module,
 * which covers command registration, failure paths and diagnostic conversion —
 * and cannot cover the things that are only true inside an extension host:
 *
 *   - `main` in package.json resolving to a file that exists *after packaging*
 *   - activation actually firing from the contributed commands
 *   - the commands appearing in the palette
 *   - VS Code accepting the diagnostics and the hover provider
 *   - SecretStorage behaving like storage
 *
 * Nothing here needs an API key or a network: every command is driven only as
 * far as the point where it would call out.
 *
 * Loaded by VS Code as `extensionTestsPath`. It exports `run()` and throws on
 * failure, which is the whole contract — no test framework is added for it.
 *
 * CommonJS on purpose: VS Code `require`s this file, and the Node inside a VS
 * Code release is not always new enough to `require` an ES module.
 */

const assert = require('node:assert/strict');

const EXTENSION_ID = 'navigator.yuvava';

const EXPECTED_COMMANDS = [
  'navigator.reviewChanges',
  'navigator.clearObservations',
  'navigator.whereToLook',
  'navigator.recallName',
  'navigator.goDeeper',
  'navigator.setApiKey',
  'navigator.clearApiKey',
  'navigator.showLog',
];

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check('the extension is installed under the id its secrets are keyed by', (vscode) => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(
    extension,
    `${EXTENSION_ID} was not found. The id is publisher.name from package.json, ` +
      'and changing either orphans the stored API key.',
  );
  return extension;
});

check('it activates, which means `main` resolved', async (vscode) => {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  await extension.activate();
  assert.equal(extension.isActive, true);
});

check('every contributed command is registered in the palette', async (vscode) => {
  const registered = new Set(await vscode.commands.getCommands(true));
  for (const command of EXPECTED_COMMANDS) {
    assert.ok(registered.has(command), `${command} is contributed but not registered`);
  }
});

check('clearing observations is safe with nothing to clear', async (vscode) => {
  await vscode.commands.executeCommand('navigator.clearObservations');
});

check('going deeper with no review says so instead of failing', async (vscode) => {
  // No review has run, so there is no observation to deepen. This must be a
  // quiet no-op rather than an unhandled rejection in the host.
  await vscode.commands.executeCommand('navigator.goDeeper', 'src/nothing.ts', 1);
});

check('VS Code accepts the diagnostics Navigator produces', async (vscode) => {
  const collection = vscode.languages.createDiagnosticCollection('navigator-host-check');
  try {
    const document = await vscode.workspace.openTextDocument({
      language: 'javascript',
      content: 'const a = 1;\nconst b = 2;\n',
    });
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 5),
      'A host-side check, not a real observation.',
      vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'Navigator';
    collection.set(document.uri, [diagnostic]);
    assert.equal(vscode.languages.getDiagnostics(document.uri).length, 1);
  } finally {
    collection.dispose();
  }
});

check('the hover provider is live and silent where there is no observation', async (vscode) => {
  const document = await vscode.workspace.openTextDocument({
    language: 'javascript',
    content: 'const a = 1;\n',
  });
  const hovers = await vscode.commands.executeCommand(
    'vscode.executeHoverProvider',
    document.uri,
    new vscode.Position(0, 6),
  );
  // Other providers may answer; Navigator's must not, with nothing reviewed.
  const ours = (hovers ?? []).filter((hover) =>
    (hover.contents ?? []).some((part) => String(part.value ?? part).includes('Navigator')),
  );
  assert.deepEqual(ours, [], 'Navigator hovered a line it never reviewed');
});

async function run() {
  const vscode = require('vscode');
  const failures = [];

  for (const { name, fn } of checks) {
    try {
      await fn(vscode);
      console.log(`  ok    ${name}`);
    } catch (error) {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.log(`  FAIL  ${name}\n        ${message}`);
      failures.push(name);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${failures.length} host check(s) failed: ${failures.join(', ')}`);
  }
  console.log(`\n${checks.length} host checks passed.`);
}

module.exports = { run };

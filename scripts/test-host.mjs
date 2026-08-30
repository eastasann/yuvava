#!/usr/bin/env node
/**
 * Launches a real VS Code and runs the host checks inside it (issue #18).
 *
 *   npm run test:host
 *
 * **This does not run in a cloud container**, and it is deliberately not part
 * of `npm run verify`. `@vscode/test-electron` downloads and starts an Electron
 * build of VS Code, which needs a display; the same is true of
 * `npm run install:local`. Both are the human operating path.
 *
 * On Linux with no display, `xvfb-run npm run test:host` works and is the only
 * supported way to run this headless. That dependency is why it is not the
 * gate: the gate has to be runnable by an agent in a container, and a green
 * gate that skipped its own extension-host coverage would be a lie by omission
 * (see `test/gitIntegration.test.ts` for the same argument, decided the same
 * way).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  const exitCode = await runTests({
    extensionDevelopmentPath: ROOT,
    extensionTestsPath: path.join(ROOT, 'scripts', 'host', 'index.cjs'),
    // No folder, no settings, no other extensions: the checks are about
    // Navigator's own wiring, and a user's environment would only add noise.
    launchArgs: ['--disable-extensions', '--disable-gpu'],
  });
  process.exit(exitCode);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nThe extension host did not run: ${message}`);
  console.error(
    '\nIf this is a headless Linux machine, try `xvfb-run npm run test:host`.\n' +
      'If it is a container with no display and no xvfb, this check cannot run\n' +
      'here — that is issue #18, and PROGRESS.md records it as such.',
  );
  process.exit(1);
}

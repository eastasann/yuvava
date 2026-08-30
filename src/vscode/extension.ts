/**
 * Navigator's editor layer.
 *
 * Everything the extension can do to a workspace happens in this file, and it
 * is deliberately short: read configuration, read a git diff, ask for a review,
 * publish diagnostics. There is no code path here — or anywhere else in the
 * extension — that writes to a user file (SPEC §16).
 */

import * as vscode from 'vscode';
import { createReviewProvider, providerProfile } from '../core/providerFactory.js';
import { GitError, findRepositoryRoot } from '../core/git.js';
import { collectWorkspaceDiff } from '../core/workspaceDiff.js';
import { ReviewUnavailableError } from '../core/provider.js';
import { runReview } from '../core/review.js';
import type { ProviderKind } from '../core/types.js';
import { readConfig } from './config.js';
import { publishObservations } from './diagnostics.js';
import { NavigatorStatusBar } from './statusBar.js';

const TRANSIENT_MESSAGE_MS = 4000;

let reviewInFlight = false;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('navigator');
  const log = vscode.window.createOutputChannel('Navigator', { log: true });
  const statusBar = new NavigatorStatusBar();

  context.subscriptions.push(diagnostics, log, statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand('navigator.reviewChanges', () =>
      reviewCurrentChanges(context, diagnostics, log, statusBar),
    ),
    vscode.commands.registerCommand('navigator.clearObservations', () => {
      diagnostics.clear();
      statusBar.setIdle();
    }),
    vscode.commands.registerCommand('navigator.setApiKey', () =>
      setApiKey(context, activeProvider(), log),
    ),
    vscode.commands.registerCommand('navigator.clearApiKey', async () => {
      const profile = providerProfile(activeProvider());
      await context.secrets.delete(profile.secretKey);
      void vscode.window.showInformationMessage(
        `Navigator: stored ${profile.displayName} API key removed.`,
      );
    }),
    vscode.commands.registerCommand('navigator.showLog', () => log.show(true)),
  );
}

export function deactivate(): void {
  // Diagnostics, the log channel and the status bar are disposed via subscriptions.
}

function currentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri !== undefined) {
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder !== undefined) {
      return folder;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

/** The configured provider, for commands that run outside a review. */
function activeProvider(): ProviderKind {
  const folder = currentWorkspaceFolder();
  return readConfig(folder?.uri).provider;
}

async function resolveApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
): Promise<string | undefined> {
  const profile = providerProfile(kind);
  const stored = await context.secrets.get(profile.secretKey);
  if (stored !== undefined && stored.trim().length > 0) {
    return stored.trim();
  }
  const fromEnv = process.env[profile.apiKeyEnvVar];
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : undefined;
}

async function setApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const profile = providerProfile(kind);
  const key = await vscode.window.showInputBox({
    title: `Navigator: ${profile.displayName} API key`,
    prompt: 'Stored in VS Code secret storage. Leave empty to cancel.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined || key.trim().length === 0) {
    return;
  }
  await context.secrets.store(profile.secretKey, key.trim());
  log.info(`${profile.displayName} API key stored in secret storage`);
  void vscode.window.showInformationMessage(`Navigator: ${profile.displayName} API key saved.`);
}

async function promptForMissingApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const profile = providerProfile(kind);
  const choice = await vscode.window.showWarningMessage(
    `Navigator: no ${profile.displayName} API key configured (or ${profile.apiKeyEnvVar} in the environment).`,
    'Set API Key',
  );
  if (choice === 'Set API Key') {
    await setApiKey(context, kind, log);
  }
}

function reportUnavailable(reason: string, log: vscode.LogOutputChannel): void {
  log.warn(`review unavailable: ${reason}`);
  void vscode.window
    .showWarningMessage(`Navigator: review unavailable — ${reason}`, 'Show Log')
    .then((choice) => {
      if (choice === 'Show Log') {
        log.show(true);
      }
    });
}

async function reviewCurrentChanges(
  context: vscode.ExtensionContext,
  diagnostics: vscode.DiagnosticCollection,
  log: vscode.LogOutputChannel,
  statusBar: NavigatorStatusBar,
): Promise<void> {
  if (reviewInFlight) {
    vscode.window.setStatusBarMessage('Navigator: already reviewing', TRANSIENT_MESSAGE_MS);
    return;
  }

  const folder = currentWorkspaceFolder();
  if (folder === undefined) {
    void vscode.window.showWarningMessage('Navigator: open a folder to review its changes.');
    return;
  }

  const config = readConfig(folder.uri);
  const apiKey = await resolveApiKey(context, config.provider);
  if (apiKey === undefined) {
    await promptForMissingApiKey(context, config.provider, log);
    return;
  }

  reviewInFlight = true;
  statusBar.setReviewing();
  const abort = new AbortController();

  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Navigator: reviewing changes', cancellable: true },
      async (_progress, token) => {
        token.onCancellationRequested(() => abort.abort());

        const runOptions = { cwd: folder.uri.fsPath, signal: abort.signal };

        let repositoryRoot: string;
        let diff: string;
        try {
          repositoryRoot = await findRepositoryRoot(runOptions);
          const workspaceDiff = await collectWorkspaceDiff({
            root: repositoryRoot,
            base: config.diffBase,
            maxDiffBytes: config.maxDiffBytes,
            includeUntracked: config.includeUntracked,
            signal: abort.signal,
          });
          diff = workspaceDiff.diff;
          if (workspaceDiff.untrackedCount > 0) {
            log.info(`including ${workspaceDiff.untrackedCount} untracked file(s)`);
          }
          for (const skipped of workspaceDiff.skipped) {
            log.info(`skipped untracked ${skipped.path}: ${skipped.reason}`);
          }
        } catch (error) {
          if (error instanceof GitError) {
            statusBar.setIdle();
            reportUnavailable(error.message, log);
            return;
          }
          throw error;
        }

        const report = await runReview({
          diff,
          intensity: config.intensity,
          maxObservations: config.maxObservations,
          maxDiffBytes: config.maxDiffBytes,
          provider: createReviewProvider({
            kind: config.provider,
            apiKey,
            model: config.model,
            baseUrl: config.openaiBaseUrl,
          }),
          signal: abort.signal,
        });

        for (const note of report.notes) {
          log.info(note);
        }

        if (report.status === 'no-changes') {
          diagnostics.clear();
          statusBar.setIdle();
          vscode.window.setStatusBarMessage(
            `Navigator: no changes against ${config.diffBase}`,
            TRANSIENT_MESSAGE_MS,
          );
          return;
        }

        if (report.status === 'diff-too-large') {
          statusBar.setIdle();
          reportUnavailable(
            `the diff is larger than navigator.maxDiffBytes (${config.maxDiffBytes} bytes)`,
            log,
          );
          return;
        }

        const published = await publishObservations(diagnostics, repositoryRoot, report.observations);
        for (const note of published.notes) {
          log.info(note);
        }

        const profile = providerProfile(config.provider);
        const endpoint =
          config.provider === 'openai' && config.openaiBaseUrl.length > 0
            ? ` via ${config.openaiBaseUrl}`
            : '';
        log.info(
          `reviewed ${report.files.length} file(s) with ${profile.displayName} ` +
            `${config.model || profile.defaultModel}${endpoint} at intensity ` +
            `"${config.intensity}": ${published.shown} observation(s)`,
        );
        statusBar.setObservations(published.shown);

        // SPEC §7: no issues means no output at all, beyond a transient note
        // that the review actually ran.
        if (published.shown === 0) {
          vscode.window.setStatusBarMessage('Navigator: nothing to flag', TRANSIENT_MESSAGE_MS);
        }
      },
    );
  } catch (error) {
    statusBar.setIdle();
    if (abort.signal.aborted) {
      // The developer cancelled. That is not a failure worth a notification.
      log.info('review cancelled');
      return;
    }
    if (error instanceof ReviewUnavailableError || error instanceof GitError) {
      reportUnavailable(error.message, log);
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      log.error(`unexpected failure: ${detail}`);
      reportUnavailable(detail, log);
    }
  } finally {
    reviewInFlight = false;
  }
}

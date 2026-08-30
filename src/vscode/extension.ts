/**
 * Navigator's editor layer.
 *
 * Activation and the review command. The other commands are a file each, and
 * all of them are deliberately short: read configuration, read a git diff, ask
 * a question, publish diagnostics. There is no code path here — or anywhere
 * else in the extension — that writes to a user file (SPEC §16).
 */

import * as vscode from 'vscode';
import { createReviewProvider, providerProfile } from '../core/providerFactory.js';
import { GitError, findRepositoryRoot } from '../core/git.js';
import { collectWorkspaceDiff } from '../core/workspaceDiff.js';
import { ReviewUnavailableError } from '../core/provider.js';
import { runReview } from '../core/review.js';
import type { ProviderKind } from '../core/types.js';
import { promptForMissingApiKey, resolveApiKey, setApiKey } from './apiKey.js';
import { currentWorkspaceFolder, describeRoute, providerOptions, readConfig } from './config.js';
import { publishObservations } from './diagnostics.js';
import { whereShouldILook } from './guidance.js';
import { GO_DEEPER_COMMAND, goDeeper, registerObservationHover } from './hover.js';
import { forgetReview, rememberReview } from './observationStore.js';
import { whatWasItCalled } from './recall.js';
import { NavigatorStatusBar } from './statusBar.js';

const TRANSIENT_MESSAGE_MS = 4000;

let reviewInFlight = false;

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = vscode.languages.createDiagnosticCollection('navigator');
  const log = vscode.window.createOutputChannel('Navigator', { log: true });
  const statusBar = new NavigatorStatusBar();

  context.subscriptions.push(diagnostics, log, statusBar, registerObservationHover());

  context.subscriptions.push(
    vscode.commands.registerCommand('navigator.reviewChanges', () =>
      reviewCurrentChanges(context, diagnostics, log, statusBar),
    ),
    vscode.commands.registerCommand('navigator.clearObservations', () => {
      diagnostics.clear();
      forgetReview();
      statusBar.setIdle();
    }),
    vscode.commands.registerCommand(GO_DEEPER_COMMAND, (file?: unknown, line?: unknown) =>
      goDeeper(context, log, statusBar, file, line),
    ),
    vscode.commands.registerCommand('navigator.whereToLook', () =>
      whereShouldILook(context, log, statusBar),
    ),
    vscode.commands.registerCommand('navigator.recallName', () =>
      whatWasItCalled(context, log, statusBar),
    ),
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

/** The configured provider, for commands that run outside a review. */
function activeProvider(): ProviderKind {
  const folder = currentWorkspaceFolder();
  return readConfig(folder?.uri).provider;
}

/** `route` is omitted where nothing was sent — a git failure names no endpoint. */
function reportUnavailable(reason: string, log: vscode.LogOutputChannel, route?: string): void {
  log.warn(`review unavailable${route === undefined ? '' : ` via ${route}`}: ${reason}`);
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
          provider: createReviewProvider(providerOptions(config, apiKey)),
          signal: abort.signal,
        });

        for (const note of report.notes) {
          log.info(note);
        }

        if (report.status === 'no-changes') {
          diagnostics.clear();
          forgetReview();
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

        rememberReview({ repositoryRoot, observations: report.observations, files: report.files });
        const published = await publishObservations(diagnostics, repositoryRoot, report.observations);
        for (const note of published.notes) {
          log.info(note);
        }

        log.info(
          `reviewed ${report.files.length} file(s) with ${describeRoute(config)} ` +
            `at intensity "${config.intensity}": ${published.shown} observation(s)`,
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
    // A git failure never reached an endpoint, so naming one would mislead.
    const route = error instanceof GitError ? undefined : describeRoute(config);
    if (error instanceof ReviewUnavailableError || error instanceof GitError) {
      reportUnavailable(error.message, log, route);
    } else {
      const detail = error instanceof Error ? error.message : String(error);
      log.error(`unexpected failure: ${detail}`);
      reportUnavailable(detail, log, route);
    }
  } finally {
    reviewInFlight = false;
  }
}

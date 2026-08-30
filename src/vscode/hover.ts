/**
 * Hover, and the one action it offers (SPEC §12, issue #13).
 *
 * VS Code already shows a diagnostic's message on hover, so a hover that
 * repeated it would be worth nothing. What this adds is the way *in* to SPEC
 * §8: one link, which asks for the first level of hint about this observation
 * and opens the same progressive disclosure the guidance command uses.
 *
 * Why a hover provider is allowed here when code action, completion,
 * formatting and rename providers are banned: those four exist to change the
 * document, and `vscode.Hover` cannot. It carries a `MarkdownString` and a
 * range, and nothing else. `test/invariant.test.ts` says the same thing, and
 * pins that hover is the only provider Navigator registers.
 */

import * as vscode from 'vscode';
import { runGuidance, type GuidanceReport } from '../core/guidance.js';
import { buildObservationContext, buildObservationQuestion } from '../core/observationHints.js';
import { createReviewProvider } from '../core/providerFactory.js';
import { ReviewUnavailableError } from '../core/provider.js';
import { searchUrl } from '../core/search.js';
import type { Observation } from '../core/types.js';
import { promptForMissingApiKey, resolveApiKey } from './apiKey.js';
import { currentWorkspaceFolder, describeRoute, providerOptions, readConfig } from './config.js';
import { buildGuidancePicks } from './guidance.js';
import { observationAt, observationFor, rememberedReview } from './observationStore.js';
import type { NavigatorStatusBar } from './statusBar.js';

const TRANSIENT_MESSAGE_MS = 4000;

export const GO_DEEPER_COMMAND = 'navigator.goDeeper';

let deeperInFlight = false;

/**
 * The hover shown over one of Navigator's own observations.
 *
 * Exported so its contents can be asserted without an extension host — in
 * particular that the only command it can invoke is the one named here.
 */
export function buildObservationHover(observation: Observation): vscode.MarkdownString {
  const markdown = new vscode.MarkdownString();
  // Command links need trust. Naming the one command means a future edit that
  // adds a second link has to come back here and say so.
  markdown.isTrusted = { enabledCommands: [GO_DEEPER_COMMAND] };
  const args = encodeURIComponent(JSON.stringify([observation.file, observation.line]));
  markdown.appendMarkdown(`**Navigator** — ${observation.category}\n\n`);
  markdown.appendMarkdown(`${observation.message}\n\n`);
  markdown.appendMarkdown(`[Go deeper](command:${GO_DEEPER_COMMAND}?${args}) — one hint at a time.`);
  return markdown;
}

export function registerObservationHover(): vscode.Disposable {
  return vscode.languages.registerHoverProvider(
    { scheme: 'file' },
    {
      provideHover(document, position) {
        const observation = observationAt(document.uri.fsPath, position.line);
        if (observation === undefined) {
          return undefined;
        }
        return new vscode.Hover(buildObservationHover(observation));
      },
    },
  );
}

/**
 * `Navigator: Go Deeper` — SPEC §8, applied to one observation.
 *
 * Reuses the guidance pipeline: the observation and the hunk it was found in
 * become the question, and the answer comes back through the same schema, the
 * same validation and the same hint sanitiser. Levels open one at a time, and
 * never on their own.
 */
export async function goDeeper(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  statusBar: NavigatorStatusBar,
  file?: unknown,
  line?: unknown,
): Promise<void> {
  if (deeperInFlight) {
    vscode.window.setStatusBarMessage('Navigator: already looking', TRANSIENT_MESSAGE_MS);
    return;
  }

  const observation = resolveObservation(file, line);
  if (observation === undefined) {
    vscode.window.setStatusBarMessage('Navigator: that observation is gone', TRANSIENT_MESSAGE_MS);
    return;
  }

  const folder = currentWorkspaceFolder();
  const config = readConfig(folder?.uri);
  const apiKey = await resolveApiKey(context, config.provider);
  if (apiKey === undefined) {
    await promptForMissingApiKey(context, config.provider, log);
    return;
  }

  const review = rememberedReview();
  const observationContext =
    review === undefined ? undefined : buildObservationContext(review.files, observation);

  deeperInFlight = true;
  statusBar.setLooking();

  let report: GuidanceReport;
  try {
    report = await runGuidance({
      question: buildObservationQuestion(observation),
      ...(observationContext === undefined ? {} : { context: observationContext }),
      provider: createReviewProvider(providerOptions(config, apiKey)),
    });
  } catch (error) {
    const reason = error instanceof ReviewUnavailableError ? error.message : String(error);
    log.warn(`going deeper failed via ${describeRoute(config)}: ${reason}`);
    void vscode.window.showWarningMessage(`Navigator: ${reason}`);
    return;
  } finally {
    deeperInFlight = false;
    statusBar.setIdle();
  }

  for (const note of report.notes) {
    log.info(note);
  }

  if (buildGuidancePicks(report).length === 0) {
    vscode.window.setStatusBarMessage('Navigator: nothing more to add', TRANSIENT_MESSAGE_MS);
    return;
  }

  // The observation itself is Level 0 and the developer has already read it,
  // so the first hint is open from the start here.
  let revealed = 1;
  for (;;) {
    const chosen = await vscode.window.showQuickPick(buildGuidancePicks(report, revealed), {
      title: observation.message,
      placeHolder: 'Escape closes this and leaves nothing behind.',
    });

    if (chosen === undefined) {
      return;
    }
    if (chosen.search !== undefined) {
      await vscode.env.openExternal(vscode.Uri.parse(searchUrl(chosen.search)));
      return;
    }
    if (chosen.more !== true) {
      return;
    }
    revealed += 1;
  }
}

function resolveObservation(file: unknown, line: unknown): Observation | undefined {
  if (typeof file === 'string' && typeof line === 'number') {
    return observationFor(file, line);
  }
  const editor = vscode.window.activeTextEditor;
  return editor === undefined
    ? undefined
    : observationAt(editor.document.uri.fsPath, editor.selection.active.line);
}

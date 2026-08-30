/**
 * `Navigator: Where Should I Look?` — the way in for SPEC §10.
 *
 * The developer says what they are trying to do; Navigator names what that
 * involves and offers the words to search for. It does not answer the
 * question, and there is no path from here to code appearing in a file.
 *
 * Deliberately transient: a QuickPick, dismissed with Escape, leaving nothing
 * behind. That is the difference between this and a chat panel, which SPEC
 * §12.3 rejects.
 */

import * as vscode from 'vscode';
import { runGuidance } from '../core/guidance.js';
import { createReviewProvider } from '../core/providerFactory.js';
import { ReviewUnavailableError } from '../core/provider.js';
import { searchUrl } from '../core/search.js';
import type { GuidanceReport } from '../core/guidance.js';
import { currentWorkspaceFolder, readConfig } from './config.js';
import { promptForMissingApiKey, resolveApiKey } from './apiKey.js';
import type { NavigatorStatusBar } from './statusBar.js';

const TRANSIENT_MESSAGE_MS = 4000;

let guidanceInFlight = false;

/** SPEC §8: the label on the only thing that advances the disclosure. */
export const MORE_SPECIFIC = 'More specific';

/**
 * A pick that opens a web search, one that reveals the next hint, or — most
 * of them — one that is simply there to be read.
 */
export interface GuidancePick extends vscode.QuickPickItem {
  readonly search?: string;
  readonly more?: true;
}

/**
 * Renders the guidance at the current level of disclosure.
 *
 * `revealed` is how many hints the developer has asked for; it starts at zero
 * and only ever grows by their choosing `More specific`. SPEC §8 is about
 * keeping `Hint -> Human thinks -> Human solves` intact, so nothing here
 * advances on its own.
 */
export function buildGuidancePicks(report: GuidanceReport, revealed = 0): GuidancePick[] {
  const picks: GuidancePick[] = report.topics.map((topic) => ({
    label: topic.name,
    ...(topic.note === undefined ? {} : { description: topic.note }),
  }));

  const shown = report.hints.slice(0, Math.max(0, revealed));
  if (shown.length > 0) {
    picks.push({ label: 'Hints', kind: vscode.QuickPickItemKind.Separator });
    for (const hint of shown) {
      picks.push({ label: hint });
    }
  }

  if (report.searches.length > 0) {
    picks.push({ label: 'Search', kind: vscode.QuickPickItemKind.Separator });
    for (const term of report.searches) {
      picks.push({ label: term, search: term });
    }
  }

  if (revealed < report.hints.length) {
    if (picks.length > 0) {
      picks.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
    picks.push({ label: MORE_SPECIFIC, more: true });
  }

  return picks;
}

export async function whereShouldILook(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  statusBar: NavigatorStatusBar,
): Promise<void> {
  if (guidanceInFlight) {
    vscode.window.setStatusBarMessage('Navigator: already looking', TRANSIENT_MESSAGE_MS);
    return;
  }

  const question = await vscode.window.showInputBox({
    title: 'Navigator: Where Should I Look?',
    prompt: 'What are you trying to do?',
    placeHolder: 'add a retry to fetch',
  });
  if (question === undefined || question.trim().length === 0) {
    return;
  }

  const folder = currentWorkspaceFolder();
  const config = readConfig(folder?.uri);
  const apiKey = await resolveApiKey(context, config.provider);
  if (apiKey === undefined) {
    await promptForMissingApiKey(context, config.provider, log);
    return;
  }

  guidanceInFlight = true;
  statusBar.setLooking();
  const abort = new AbortController();

  let report: GuidanceReport;
  try {
    report = await runGuidance({
      question,
      provider: createReviewProvider({
        kind: config.provider,
        apiKey,
        model: config.model,
        baseUrl: config.openaiBaseUrl,
      }),
      signal: abort.signal,
    });
  } catch (error) {
    const reason = error instanceof ReviewUnavailableError ? error.message : String(error);
    log.warn(`guidance unavailable: ${reason}`);
    void vscode.window.showWarningMessage(`Navigator: ${reason}`);
    return;
  } finally {
    guidanceInFlight = false;
    statusBar.setIdle();
  }

  for (const note of report.notes) {
    log.info(note);
  }

  // SPEC §7: nothing specific to point at means no window at all.
  if (buildGuidancePicks(report).length === 0) {
    log.info(`no guidance for: ${question.trim()}`);
    vscode.window.setStatusBarMessage('Navigator: nothing to point at', TRANSIENT_MESSAGE_MS);
    return;
  }

  let revealed = 0;
  for (;;) {
    const chosen = await vscode.window.showQuickPick(buildGuidancePicks(report, revealed), {
      title: question.trim(),
      placeHolder: 'Where to look. Escape closes this and leaves nothing behind.',
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

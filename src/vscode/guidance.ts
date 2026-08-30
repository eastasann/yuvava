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

/** A pick that opens a web search. Anything else is there to be read. */
interface GuidancePick extends vscode.QuickPickItem {
  readonly search?: string;
}

export function buildGuidancePicks(report: GuidanceReport): GuidancePick[] {
  const picks: GuidancePick[] = report.topics.map((topic) => ({
    label: topic.name,
    ...(topic.note === undefined ? {} : { description: topic.note }),
  }));

  if (report.searches.length > 0) {
    picks.push({ label: 'Search', kind: vscode.QuickPickItemKind.Separator });
    for (const term of report.searches) {
      picks.push({ label: term, search: term });
    }
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

  const picks = buildGuidancePicks(report);
  // SPEC §7: nothing specific to point at means no window at all.
  if (picks.length === 0) {
    log.info(`no guidance for: ${question.trim()}`);
    vscode.window.setStatusBarMessage('Navigator: nothing to point at', TRANSIENT_MESSAGE_MS);
    return;
  }

  const chosen = await vscode.window.showQuickPick(picks, {
    title: question.trim(),
    placeHolder: 'Where to look. Escape closes this and leaves nothing behind.',
  });

  if (chosen?.search !== undefined) {
    await vscode.env.openExternal(vscode.Uri.parse(searchUrl(chosen.search)));
  }
}

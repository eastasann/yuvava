/**
 * `Navigator: What Was It Called?` — SPEC §9 Recall Assistance.
 *
 * Two QuickPicks. The first lists names and nothing else, because the name is
 * usually the whole of what was forgotten. Choosing one opens the rungs above
 * it — signature, then concept, then the documentation — one at a time, and
 * only when asked for.
 *
 * The staging is the feature. Handing over the name, the signature and an
 * explanation together is how one stops remembering things.
 */

import * as vscode from 'vscode';
import { runRecall, type RecallReport } from '../core/recall.js';
import { recallStages, type RecallCandidate } from '../core/recallSchema.js';
import { MdnDocsIndex, resolveDocsLinks, type DocsLink } from '../core/docsIndex.js';
import { createReviewProvider } from '../core/providerFactory.js';
import { ReviewUnavailableError } from '../core/provider.js';
import { searchUrl } from '../core/search.js';
import { currentWorkspaceFolder, providerOptions, readConfig } from './config.js';
import { promptForMissingApiKey, resolveApiKey } from './apiKey.js';
import { MORE_SPECIFIC } from './guidance.js';
import type { NavigatorStatusBar } from './statusBar.js';

const TRANSIENT_MESSAGE_MS = 4000;

let recallInFlight = false;

interface RecallPick extends vscode.QuickPickItem {
  readonly search?: string;
  /** Set when the term resolved to a real page in the index (SPEC §10.1). */
  readonly url?: string;
  readonly more?: true;
}

/** The first list: names only (SPEC §9 — Name is the first and often last rung). */
export function buildNamePicks(report: RecallReport): RecallPick[] {
  return report.candidates.map((candidate) => ({ label: candidate.name }));
}

/**
 * One candidate, disclosed as far as the developer has asked.
 *
 * `revealed` counts rungs climbed above the name; it starts at zero, so the
 * first thing shown is the name alone.
 */
export function buildCandidatePicks(
  candidate: RecallCandidate,
  revealed = 0,
  links: ReadonlyMap<string, DocsLink> = new Map(),
): RecallPick[] {
  const stages = recallStages(candidate);
  const picks: RecallPick[] = [];

  for (const stage of stages.slice(0, Math.max(0, revealed))) {
    if (stage.kind === 'search') {
      picks.push({ label: 'Documentation', kind: vscode.QuickPickItemKind.Separator });
      const link = links.get(stage.text);
      picks.push(
        link === undefined
          ? { label: stage.text, search: stage.text }
          : { label: stage.text, description: link.title, search: stage.text, url: link.url },
      );
    } else {
      picks.push({ label: stage.text, description: stage.kind });
    }
  }

  if (revealed < stages.length) {
    if (picks.length > 0) {
      picks.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
    picks.push({ label: MORE_SPECIFIC, more: true });
  }

  return picks;
}

export async function whatWasItCalled(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
  statusBar: NavigatorStatusBar,
): Promise<void> {
  if (recallInFlight) {
    vscode.window.setStatusBarMessage('Navigator: already looking', TRANSIENT_MESSAGE_MS);
    return;
  }

  const description = await vscode.window.showInputBox({
    title: 'Navigator: What Was It Called?',
    prompt: 'Describe what it does. Navigator gives back the name, not the code.',
    placeHolder: 'folds an array into a single value',
  });
  if (description === undefined || description.trim().length === 0) {
    return;
  }

  const folder = currentWorkspaceFolder();
  const config = readConfig(folder?.uri);
  const apiKey = await resolveApiKey(context, config.provider);
  if (apiKey === undefined) {
    await promptForMissingApiKey(context, config.provider, log);
    return;
  }

  recallInFlight = true;
  statusBar.setLooking();

  let report: RecallReport;
  try {
    report = await runRecall({
      description,
      provider: createReviewProvider(providerOptions(config, apiKey)),
    });
  } catch (error) {
    const reason = error instanceof ReviewUnavailableError ? error.message : String(error);
    log.warn(`recall unavailable: ${reason}`);
    void vscode.window.showWarningMessage(`Navigator: ${reason}`);
    return;
  } finally {
    recallInFlight = false;
    statusBar.setIdle();
  }

  for (const note of report.notes) {
    log.info(note);
  }

  // SPEC §7: guessing at three things it might have been is worse than silence.
  if (report.candidates.length === 0) {
    log.info(`nothing came to mind for: ${description.trim()}`);
    vscode.window.setStatusBarMessage('Navigator: no name for that', TRANSIENT_MESSAGE_MS);
    return;
  }

  const chosenName = await vscode.window.showQuickPick(buildNamePicks(report), {
    title: description.trim(),
    placeHolder: 'If the name is enough, close this.',
  });
  if (chosenName === undefined) {
    return;
  }
  const candidate = report.candidates.find((entry) => entry.name === chosenName.label);
  if (candidate === undefined) {
    return;
  }

  const links = await resolveDocsLinks(
    new MdnDocsIndex(),
    candidate.search === undefined ? [] : [candidate.search],
  );

  let revealed = 0;
  for (;;) {
    const picks = buildCandidatePicks(candidate, revealed, links);
    if (picks.length === 0) {
      return;
    }
    const chosen = await vscode.window.showQuickPick(picks, {
      title: candidate.name,
      placeHolder: 'Escape closes this and leaves nothing behind.',
    });

    if (chosen === undefined) {
      return;
    }
    if (chosen.search !== undefined) {
      await vscode.env.openExternal(vscode.Uri.parse(chosen.url ?? searchUrl(chosen.search)));
      return;
    }
    if (chosen.more !== true) {
      return;
    }
    revealed += 1;
  }
}

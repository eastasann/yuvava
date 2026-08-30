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
import { MdnDocsIndex, resolveDocsLinks, type DocsLink } from '../core/docsIndex.js';
import { createReviewProvider } from '../core/providerFactory.js';
import { ReviewUnavailableError } from '../core/provider.js';
import { searchUrl } from '../core/search.js';
import type { GuidanceReport } from '../core/guidance.js';
import { currentWorkspaceFolder, describeRoute, providerOptions, readConfig } from './config.js';
import { promptForMissingApiKey, resolveApiKey } from './apiKey.js';
import { readSelection } from './selection.js';
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
  /** Set when the term resolved to a real page in the index (SPEC §10.1). */
  readonly url?: string;
  readonly more?: true;
}

/**
 * How many times `More specific` can be chosen: one per hint, plus one for the
 * adjacent things (SPEC §21.6) if the model offered any.
 */
export function disclosureSteps(report: GuidanceReport): number {
  return report.hints.length + (report.explore.length > 0 ? 1 : 0);
}

/**
 * Renders the guidance at the current level of disclosure.
 *
 * `revealed` is how many hints the developer has asked for; it starts at zero
 * and only ever grows by their choosing `More specific`. SPEC §8 is about
 * keeping `Hint -> Human thinks -> Human solves` intact, so nothing here
 * advances on its own.
 */
export function buildGuidancePicks(
  report: GuidanceReport,
  revealed = 0,
  links: ReadonlyMap<string, DocsLink> = new Map(),
  contextSummary?: string,
): GuidancePick[] {
  const picks: GuidancePick[] = [];

  // What was sent, said again where the answer is read. A separator cannot be
  // selected, so it reads as a note rather than as an option.
  if (contextSummary !== undefined) {
    picks.push({ label: `Context: ${contextSummary}`, kind: vscode.QuickPickItemKind.Separator });
  }

  // A topic is an API, a concept, a decision — exactly the thing the developer
  // would go and look up, which is the whole of SPEC §10. Leaving it inert made
  // the answer's main content a dead end.
  picks.push(
    ...report.topics.map((topic) => ({
      label: topic.name,
      search: topic.name,
      ...(topic.note === undefined ? {} : { description: topic.note }),
    })),
  );

  const shown = report.hints.slice(0, Math.max(0, revealed));
  if (shown.length > 0) {
    picks.push({ label: 'Hints', kind: vscode.QuickPickItemKind.Separator });
    for (const hint of shown) {
      picks.push({ label: hint });
    }
  }

  // SPEC §21.6, and the last rung: adjacent things are reached, never
  // presented. A developer who stopped at the topics never sees them.
  if (report.explore.length > 0 && revealed > report.hints.length) {
    picks.push({ label: 'You may want to explore', kind: vscode.QuickPickItemKind.Separator });
    for (const name of report.explore) {
      picks.push({ label: name, search: name });
    }
  }

  if (report.searches.length > 0) {
    picks.push({ label: 'Search', kind: vscode.QuickPickItemKind.Separator });
    for (const term of report.searches) {
      // The term is shown either way (SPEC §10.3): if it resolved, choosing it
      // opens the page; if not, it opens a web search. Nothing is hidden
      // because Navigator could not find a link for it.
      const link = links.get(term);
      picks.push(
        link === undefined
          ? { label: term, search: term }
          : { label: term, description: link.title, search: term, url: link.url },
      );
    }
  }

  if (revealed < disclosureSteps(report)) {
    if (picks.length > 0) {
      picks.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    }
    picks.push({ label: MORE_SPECIFIC, more: true });
  }

  return picks;
}

/**
 * What choosing an item means.
 *
 * Extracted because this is precisely where #35 was: a topic fell through
 * every branch and the caller returned, closing the window having done
 * nothing. `again` is that case named — there is nowhere to go, so the list
 * comes back rather than disappearing.
 */
export type PickAction =
  | { readonly kind: 'close' }
  | { readonly kind: 'open'; readonly url: string }
  | { readonly kind: 'reveal' }
  | { readonly kind: 'again' };

export function actionFor(
  chosen: { readonly search?: string; readonly url?: string; readonly more?: true } | undefined,
): PickAction {
  if (chosen === undefined) {
    return { kind: 'close' };
  }
  if (chosen.search !== undefined) {
    return { kind: 'open', url: chosen.url ?? searchUrl(chosen.search) };
  }
  if (chosen.more === true) {
    return { kind: 'reveal' };
  }
  return { kind: 'again' };
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

  // Read before asking, so the prompt can say what is going with the question.
  // Nothing is sent that the developer was not told about first.
  const selection = readSelection();

  const question = await vscode.window.showInputBox({
    title: 'Navigator: Where Should I Look?',
    prompt:
      selection === undefined
        ? 'What are you trying to do?'
        : `What are you trying to do? Sending ${selection.summary} with it.`,
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
    if (selection !== undefined) {
      log.info(`sending selection as context: ${selection.summary}`);
    }
    report = await runGuidance({
      question,
      ...(selection === undefined ? {} : { context: selection.context }),
      provider: createReviewProvider(providerOptions(config, apiKey)),
      signal: abort.signal,
    });
  } catch (error) {
    const reason = error instanceof ReviewUnavailableError ? error.message : String(error);
    log.warn(`guidance unavailable via ${describeRoute(config)}: ${reason}`);
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

  const links = await resolveDocsLinks(new MdnDocsIndex(), report.searches, { signal: abort.signal });

  let revealed = 0;
  for (;;) {
    const picks = buildGuidancePicks(report, revealed, links, selection?.summary);
    const chosen = await vscode.window.showQuickPick(picks, {
      title: question.trim(),
      placeHolder: 'Choose one to look it up. Escape closes this and leaves nothing behind.',
    });

    const action = actionFor(chosen);
    if (action.kind === 'close') {
      return;
    }
    if (action.kind === 'open') {
      await vscode.env.openExternal(vscode.Uri.parse(action.url));
      return;
    }
    if (action.kind === 'reveal') {
      revealed += 1;
    }
    // 'again': it was text. The list comes back rather than vanishing.
  }
}

import * as path from 'node:path';
import * as vscode from 'vscode';
import { computeAnchor } from '../core/range.js';
import type { Observation, Severity } from '../core/types.js';

const SEVERITY_MAP: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

export interface PublishResult {
  readonly shown: number;
  readonly notes: readonly string[];
}

/**
 * Publishes observations as diagnostics — the whole of Navigator's output.
 *
 * Diagnostics are the only channel by design (SPEC §12.1, §16): a diagnostic
 * describes a location, it cannot change one.
 */
export async function publishObservations(
  collection: vscode.DiagnosticCollection,
  repositoryRoot: string,
  observations: readonly Observation[],
): Promise<PublishResult> {
  collection.clear();

  const byFile = new Map<string, Observation[]>();
  for (const observation of observations) {
    const existing = byFile.get(observation.file);
    if (existing) {
      existing.push(observation);
    } else {
      byFile.set(observation.file, [observation]);
    }
  }

  const notes: string[] = [];
  let shown = 0;

  for (const [file, fileObservations] of byFile) {
    const uri = vscode.Uri.file(path.join(repositoryRoot, file));
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      notes.push(`could not open ${file}: ${detail}`);
      continue;
    }

    const diagnostics: vscode.Diagnostic[] = [];
    for (const observation of fileObservations) {
      const anchor = computeAnchor(observation, {
        lineCount: document.lineCount,
        lineText: (index) => document.lineAt(index).text,
      });
      if (anchor === undefined) {
        notes.push(`discarded ${file}:${observation.line}: line no longer exists`);
        continue;
      }
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(anchor.startLine, anchor.startColumn, anchor.endLine, anchor.endColumn),
        observation.message,
        SEVERITY_MAP[observation.severity],
      );
      diagnostic.source = 'Navigator';
      diagnostic.code = observation.category;
      diagnostics.push(diagnostic);
    }

    if (diagnostics.length > 0) {
      collection.set(uri, diagnostics);
      shown += diagnostics.length;
    }
  }

  return { shown, notes };
}

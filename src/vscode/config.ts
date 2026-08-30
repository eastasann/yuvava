import * as vscode from 'vscode';
import { providerProfile, type CreateProviderOptions } from '../core/providerFactory.js';
import {
  PROVIDER_KINDS,
  REVIEW_EFFORTS,
  REVIEW_INTENSITIES,
  type ProviderKind,
  type ReviewEffort,
  type ReviewIntensity,
} from '../core/types.js';

export interface NavigatorConfig {
  readonly provider: ProviderKind;
  /** Blank means "this provider's default model". */
  readonly model: string;
  /** Blank means OpenAI itself; set for an OpenAI-compatible endpoint. */
  readonly openaiBaseUrl: string;
  readonly intensity: ReviewIntensity;
  /** Blank means the provider's own default. */
  readonly effort: ReviewEffort;
  readonly diffBase: string;
  readonly includeUntracked: boolean;
  readonly maxDiffBytes: number;
  readonly maxObservations: number;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * The folder a command applies to: the one holding the active editor, else the
 * first in the workspace. Undefined when no folder is open at all.
 */
export function currentWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri !== undefined) {
    const folder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (folder !== undefined) {
      return folder;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Where a request is about to go, for the log.
 *
 * Written for the failure case. A successful review says which model answered;
 * a failed one used to say only what went wrong, which is the moment the route
 * matters most — a 404 about a model, or a rate limit, means nothing until you
 * know which endpoint said it.
 */
export function describeRoute(config: NavigatorConfig): string {
  const profile = providerProfile(config.provider);
  const endpoint =
    config.provider === 'openai' && config.openaiBaseUrl.length > 0
      ? ` via ${config.openaiBaseUrl}`
      : '';
  const effort = config.effort === '' ? '' : ` at effort ${config.effort}`;
  return `${profile.displayName} ${config.model || profile.defaultModel}${endpoint}${effort}`;
}

/**
 * The settings that describe *which* model answers, in the shape the factory
 * wants. One place, so a new setting reaches every command at once.
 */
export function providerOptions(
  config: NavigatorConfig,
  apiKey: string,
): CreateProviderOptions {
  return {
    kind: config.provider,
    apiKey,
    model: config.model,
    baseUrl: config.openaiBaseUrl,
    effort: config.effort,
  };
}

export function readConfig(scope?: vscode.Uri): NavigatorConfig {
  const section = vscode.workspace.getConfiguration('navigator', scope);

  return {
    provider: oneOf(section.get('provider'), PROVIDER_KINDS, 'anthropic'),
    model: section.get<string>('model', '').trim(),
    openaiBaseUrl: section.get<string>('openaiBaseUrl', '').trim(),
    intensity: oneOf(section.get('reviewIntensity'), REVIEW_INTENSITIES, 'normal'),
    effort: oneOf(section.get('effort'), REVIEW_EFFORTS, ''),
    diffBase: section.get<string>('diffBase', 'HEAD').trim() || 'HEAD',
    includeUntracked: section.get<boolean>('includeUntracked', true) !== false,
    maxDiffBytes: positiveNumber(section.get('maxDiffBytes'), 200000),
    maxObservations: positiveNumber(section.get('maxObservations'), 20),
  };
}

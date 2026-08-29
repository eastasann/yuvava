import * as vscode from 'vscode';
import { PROVIDER_KINDS, REVIEW_INTENSITIES, type ProviderKind, type ReviewIntensity } from '../core/types.js';

export interface NavigatorConfig {
  readonly provider: ProviderKind;
  /** Blank means "this provider's default model". */
  readonly model: string;
  readonly intensity: ReviewIntensity;
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

export function readConfig(scope?: vscode.Uri): NavigatorConfig {
  const section = vscode.workspace.getConfiguration('navigator', scope);

  return {
    provider: oneOf(section.get('provider'), PROVIDER_KINDS, 'anthropic'),
    model: section.get<string>('model', '').trim(),
    intensity: oneOf(section.get('reviewIntensity'), REVIEW_INTENSITIES, 'normal'),
    diffBase: section.get<string>('diffBase', 'HEAD').trim() || 'HEAD',
    includeUntracked: section.get<boolean>('includeUntracked', true) !== false,
    maxDiffBytes: positiveNumber(section.get('maxDiffBytes'), 200000),
    maxObservations: positiveNumber(section.get('maxObservations'), 20),
  };
}

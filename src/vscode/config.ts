import * as vscode from 'vscode';
import { DEFAULT_MODEL } from '../core/anthropicProvider.js';
import { REVIEW_INTENSITIES, type ReviewIntensity } from '../core/types.js';

export interface NavigatorConfig {
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

export function readConfig(scope?: vscode.Uri): NavigatorConfig {
  const section = vscode.workspace.getConfiguration('navigator', scope);
  const rawIntensity = section.get<string>('reviewIntensity', 'normal');
  const intensity = (REVIEW_INTENSITIES as readonly string[]).includes(rawIntensity)
    ? (rawIntensity as ReviewIntensity)
    : 'normal';

  return {
    model: section.get<string>('model', DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    intensity,
    diffBase: section.get<string>('diffBase', 'HEAD').trim() || 'HEAD',
    includeUntracked: section.get<boolean>('includeUntracked', true) !== false,
    maxDiffBytes: positiveNumber(section.get('maxDiffBytes'), 200000),
    maxObservations: positiveNumber(section.get('maxObservations'), 20),
  };
}

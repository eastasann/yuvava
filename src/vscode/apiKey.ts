/**
 * Where the API key comes from, for every command that needs one.
 *
 * Secret storage first, then the provider's environment variable. Never
 * settings: a settings-backed key ends up in synced or committed JSON.
 */

import * as vscode from 'vscode';
import { providerProfile } from '../core/providerFactory.js';
import type { ProviderKind } from '../core/types.js';

export async function resolveApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
): Promise<string | undefined> {
  const profile = providerProfile(kind);
  const stored = await context.secrets.get(profile.secretKey);
  if (stored !== undefined && stored.trim().length > 0) {
    return stored.trim();
  }
  const fromEnv = process.env[profile.apiKeyEnvVar];
  return fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : undefined;
}

export async function setApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const profile = providerProfile(kind);
  const key = await vscode.window.showInputBox({
    title: `Navigator: ${profile.displayName} API key`,
    prompt: 'Stored in VS Code secret storage. Leave empty to cancel.',
    password: true,
    ignoreFocusOut: true,
  });
  if (key === undefined || key.trim().length === 0) {
    return;
  }
  await context.secrets.store(profile.secretKey, key.trim());
  log.info(`${profile.displayName} API key stored in secret storage`);
  void vscode.window.showInformationMessage(`Navigator: ${profile.displayName} API key saved.`);
}

export async function promptForMissingApiKey(
  context: vscode.ExtensionContext,
  kind: ProviderKind,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const profile = providerProfile(kind);
  const choice = await vscode.window.showWarningMessage(
    `Navigator: no ${profile.displayName} API key configured (or ${profile.apiKeyEnvVar} in the environment).`,
    'Set API Key',
  );
  if (choice === 'Set API Key') {
    await setApiKey(context, kind, log);
  }
}

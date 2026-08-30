/**
 * Choosing a reviewer.
 *
 * Navigator's guarantees do not come from which model answers — they come from
 * the schema it must answer in, the validation on the way back, and the
 * sanitiser. So a provider is a swappable detail, and this is the one place
 * that knows the set of them.
 */

import { AnthropicReviewProvider, DEFAULT_ANTHROPIC_MODEL } from './anthropicProvider.js';
import { OpenAIReviewProvider, DEFAULT_OPENAI_MODEL } from './openaiProvider.js';
import type { NavigatorProvider } from './provider.js';
import type { ProviderKind } from './types.js';

export interface ProviderProfile {
  readonly kind: ProviderKind;
  /** Shown in messages and prompts. */
  readonly displayName: string;
  readonly defaultModel: string;
  /** Environment variable consulted when no key is in secret storage. */
  readonly apiKeyEnvVar: string;
  /** Key under which the API key is stored in VS Code secret storage. */
  readonly secretKey: string;
}

const PROFILES: Readonly<Record<ProviderKind, ProviderProfile>> = {
  anthropic: {
    kind: 'anthropic',
    displayName: 'Anthropic',
    defaultModel: DEFAULT_ANTHROPIC_MODEL,
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    secretKey: 'navigator.anthropicApiKey',
  },
  openai: {
    kind: 'openai',
    displayName: 'OpenAI',
    defaultModel: DEFAULT_OPENAI_MODEL,
    apiKeyEnvVar: 'OPENAI_API_KEY',
    secretKey: 'navigator.openaiApiKey',
  },
};

export function providerProfile(kind: ProviderKind): ProviderProfile {
  return PROFILES[kind];
}

export interface CreateProviderOptions {
  readonly kind: ProviderKind;
  readonly apiKey: string;
  /** Empty or blank means "use this provider's default model". */
  readonly model?: string;
  /** OpenAI-compatible endpoint. Ignored by providers that have no such notion. */
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
}

export function createReviewProvider(options: CreateProviderOptions): NavigatorProvider {
  const model = options.model?.trim() || providerProfile(options.kind).defaultModel;
  const shared = {
    apiKey: options.apiKey,
    model,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  return options.kind === 'openai'
    ? new OpenAIReviewProvider({ ...shared, baseUrl: options.baseUrl })
    : new AnthropicReviewProvider(shared);
}

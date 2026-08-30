/**
 * Provider selection, and the promise that selecting one changes nothing about
 * what Navigator is allowed to do with the answer.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnthropicReviewProvider, DEFAULT_ANTHROPIC_MODEL } from '../src/core/anthropicProvider.js';
import { OpenAIReviewProvider, DEFAULT_OPENAI_MODEL } from '../src/core/openaiProvider.js';
import { createReviewProvider, providerProfile } from '../src/core/providerFactory.js';
import { runReview } from '../src/core/review.js';
import { PROVIDER_KINDS } from '../src/core/types.js';

const DIFF = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -8,2 +8,3 @@
 const items = cart.items;
+const average = total / items.length;
`;

function capturingFetch(captured: Record<string, unknown>[], body: unknown): typeof globalThis.fetch {
  return (_input, init) => {
    captured.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>);
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };
}

const ANTHROPIC_BODY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: DEFAULT_ANTHROPIC_MODEL,
  content: [{ type: 'text', text: '' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
};

function openaiBodyWith(text: string): unknown {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    model: DEFAULT_OPENAI_MODEL,
    status: 'completed',
    output: [
      {
        type: 'message',
        id: 'm',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    output_text: text,
    parallel_tool_calls: false,
    tool_choice: 'auto',
    tools: [],
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
  };
}

function anthropicBodyWith(text: string): unknown {
  return { ...ANTHROPIC_BODY, content: [{ type: 'text', text }] };
}

/** A response body carrying `text`, in whichever shape the provider expects. */
function bodyFor(kind: 'anthropic' | 'openai', text: string): unknown {
  return kind === 'openai' ? openaiBodyWith(text) : anthropicBodyWith(text);
}

/** A review that tries to smuggle replacement code past Navigator. */
const HOSTILE_REVIEW = JSON.stringify({
  issues: [
    {
      file: 'src/cart.ts',
      line: 9,
      endLine: 9,
      severity: 'warning',
      category: 'edge-case',
      message: 'Empty carts divide by zero. Fix it like this:\n```ts\nif (!items.length) {\n  return 0;\n}\n```',
      symbol: 'average',
    },
  ],
});

describe('createReviewProvider', () => {
  it('builds the provider named by the configuration', () => {
    assert.ok(createReviewProvider({ kind: 'anthropic', apiKey: 'k' }) instanceof AnthropicReviewProvider);
    assert.ok(createReviewProvider({ kind: 'openai', apiKey: 'k' }) instanceof OpenAIReviewProvider);
  });

  it('uses each provider default model when none is configured', async () => {
    for (const [kind, expected] of [
      ['anthropic', DEFAULT_ANTHROPIC_MODEL],
      ['openai', DEFAULT_OPENAI_MODEL],
    ] as const) {
      const captured: Record<string, unknown>[] = [];
      const provider = createReviewProvider({
        kind,
        apiKey: 'k',
        model: '   ',
        fetch: capturingFetch(captured, bodyFor(kind, '{"issues":[]}')),
      });
      await provider.review({ annotatedDiff: 'x', intensity: 'normal' });
      assert.equal(captured[0].model, expected, `${kind} default model`);
    }
  });

  it('passes a configured model through to either provider', async () => {
    const captured: Record<string, unknown>[] = [];
    await createReviewProvider({
      kind: 'openai',
      apiKey: 'k',
      model: 'gpt-5.1-codex',
      fetch: capturingFetch(captured, openaiBodyWith('{"issues":[]}')),
    }).review({ annotatedDiff: 'x', intensity: 'normal' });
    assert.equal(captured[0].model, 'gpt-5.1-codex');
  });
});

describe('providerProfile', () => {
  it('describes every provider kind', () => {
    for (const kind of PROVIDER_KINDS) {
      const profile = providerProfile(kind);
      assert.equal(profile.kind, kind);
      assert.ok(profile.displayName.length > 0);
      assert.ok(profile.defaultModel.length > 0);
      assert.match(profile.apiKeyEnvVar, /^[A-Z_]+$/);
      assert.match(profile.secretKey, /^navigator\./);
    }
  });

  it('keeps the API keys of the two providers apart', () => {
    assert.notEqual(providerProfile('anthropic').secretKey, providerProfile('openai').secretKey);
    assert.notEqual(providerProfile('anthropic').apiKeyEnvVar, providerProfile('openai').apiKeyEnvVar);
  });
});

describe('the guarantees do not depend on the provider', () => {
  for (const kind of PROVIDER_KINDS) {
    it(`strips replacement code returned by ${kind}`, async () => {
      const payload = bodyFor(kind, HOSTILE_REVIEW);

      const report = await runReview({
        diff: DIFF,
        intensity: 'normal',
        maxObservations: 20,
        maxDiffBytes: 200000,
        provider: createReviewProvider({ kind, apiKey: 'k', fetch: capturingFetch([], payload) }),
      });

      assert.equal(report.observations.length, 1);
      const { message } = report.observations[0];
      assert.ok(!message.includes('```'), `${kind}: fence survived`);
      assert.ok(!message.includes('return 0'), `${kind}: replacement code survived`);
      assert.ok(!message.includes('\n'), `${kind}: message was not flattened`);
      assert.match(message, /Empty carts divide by zero/);
    });
  }
});

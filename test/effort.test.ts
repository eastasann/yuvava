/**
 * The effort dial (issue #20).
 *
 * The behaviour that matters most is the one when it is *not* set: the request
 * must go out exactly as it did before, so the model's own default applies and
 * Navigator has not quietly picked one on the developer's behalf.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnthropicReviewProvider } from '../src/core/anthropicProvider.js';
import { OpenAIReviewProvider } from '../src/core/openaiProvider.js';
import { REVIEW_EFFORTS, type ReviewEffort } from '../src/core/types.js';

const REQUEST = { annotatedDiff: '### a.ts\n     1 +const a = 1;', intensity: 'normal' as const };

function capturing(bodies: Array<Record<string, unknown>>, payload: unknown): typeof globalThis.fetch {
  return (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    void input;
    bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>);
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
  };
}

const ANTHROPIC_REPLY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5',
  content: [{ type: 'text', text: '{"issues":[]}' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

const CHAT_REPLY = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'llama-3.3-70b-versatile',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '{"issues":[]}', refusal: null },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
};

describe('the effort setting', () => {
  it('offers empty first, so the default is the model\'s own', () => {
    assert.equal(REVIEW_EFFORTS[0], '');
  });

  it('sends nothing at all when it is unset', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await new AnthropicReviewProvider({ apiKey: 'k', fetch: capturing(bodies, ANTHROPIC_REPLY) }).review(REQUEST);
    const outputConfig = bodies[0].output_config as Record<string, unknown>;
    assert.deepEqual(Object.keys(outputConfig), ['format']);
  });

  it('reaches the Anthropic request when it is set', async () => {
    for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const bodies: Array<Record<string, unknown>> = [];
      await new AnthropicReviewProvider({
        apiKey: 'k',
        effort,
        fetch: capturing(bodies, ANTHROPIC_REPLY),
      }).review(REQUEST);
      assert.equal((bodies[0].output_config as Record<string, unknown>).effort, effort);
    }
  });

  it('folds the two levels OpenAI does not have onto its highest', async () => {
    for (const [asked, sent] of [
      ['low', 'low'],
      ['medium', 'medium'],
      ['high', 'high'],
      ['xhigh', 'high'],
      ['max', 'high'],
    ] as const) {
      const bodies: Array<Record<string, unknown>> = [];
      await new OpenAIReviewProvider({
        apiKey: 'k',
        baseUrl: 'https://api.groq.com/openai/v1',
        effort: asked,
        fetch: capturing(bodies, CHAT_REPLY),
      }).review(REQUEST);
      assert.equal(bodies[0].reasoning_effort, sent, `${asked} should be sent as ${sent}`);
    }
  });

  it('sends no reasoning field to a compatible endpoint when it is unset', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    await new OpenAIReviewProvider({
      apiKey: 'k',
      baseUrl: 'https://api.groq.com/openai/v1',
      fetch: capturing(bodies, CHAT_REPLY),
    }).review(REQUEST);
    assert.equal('reasoning_effort' in bodies[0], false);
  });

  it('treats an empty setting as unset, not as a level', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const effort: ReviewEffort = '';
    await new AnthropicReviewProvider({
      apiKey: 'k',
      effort,
      fetch: capturing(bodies, ANTHROPIC_REPLY),
    }).review(REQUEST);
    assert.deepEqual(Object.keys(bodies[0].output_config as Record<string, unknown>), ['format']);
  });
});

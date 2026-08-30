/**
 * How much room each job reserves for its answer.
 *
 * From real use, and the first thing real use found. Groq's free tier bills the
 * *reservation* against its tokens-per-minute limit, not the tokens actually
 * produced, so a guidance request carrying 1,194 tokens of input was refused at
 * 9,386: 8,192 had been set aside for an answer that is a handful of short
 * strings. Nothing was wrong with the request except its ambition.
 *
 * The rule these tests hold: a job asks for what it could plausibly need. Only
 * a review needs room.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnthropicReviewProvider } from '../src/core/anthropicProvider.js';
import { OpenAIReviewProvider } from '../src/core/openaiProvider.js';

type Body = Record<string, unknown>;

function capturing(bodies: Body[], payload: unknown): typeof globalThis.fetch {
  return (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Body);
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
  content: [{ type: 'text', text: '{}' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
};

const CHAT_REPLY = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'openai/gpt-oss-120b',
  choices: [
    { index: 0, message: { role: 'assistant', content: '{}', refusal: null }, finish_reason: 'stop', logprobs: null },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1 },
};

const REVIEW = { annotatedDiff: '### a.ts\n     1 +const a = 1;', intensity: 'normal' as const };
const GUIDANCE = { question: 'add a retry to fetch' };
const RECALL = { description: 'folds an array into one value' };

describe('an OpenAI-compatible endpoint is asked for what the job needs', () => {
  async function budgets(): Promise<{ review: number; guidance: number; recall: number }> {
    const bodies: Body[] = [];
    const provider = () =>
      new OpenAIReviewProvider({
        apiKey: 'k',
        baseUrl: 'https://api.groq.com/openai/v1',
        model: 'openai/gpt-oss-120b',
        fetch: capturing(bodies, CHAT_REPLY),
      });
    await provider().review(REVIEW);
    await provider().guide(GUIDANCE);
    await provider().recall(RECALL);
    return {
      review: bodies[0].max_tokens as number,
      guidance: bodies[1].max_tokens as number,
      recall: bodies[2].max_tokens as number,
    };
  }

  it('reserves less for a question than for a review', async () => {
    const { review, guidance, recall } = await budgets();
    assert.ok(guidance < review, `guidance ${guidance} should be under review ${review}`);
    assert.ok(recall <= guidance, `recall ${recall} should not exceed guidance ${guidance}`);
  });

  it('keeps a question inside a modest per-minute budget', async () => {
    // The reported failure: 1,194 in + 8,192 reserved = 9,386, over a limit of
    // 8,000. A question's whole request has to fit in that with room to spare.
    const { guidance, recall } = await budgets();
    const INPUT_ALLOWANCE = 2000;
    const FREE_TIER_TPM = 8000;
    assert.ok(guidance + INPUT_ALLOWANCE < FREE_TIER_TPM, `guidance reserves ${guidance}`);
    assert.ok(recall + INPUT_ALLOWANCE < FREE_TIER_TPM, `recall reserves ${recall}`);
  });

  it('still leaves a review room to think and to report', async () => {
    const { review } = await budgets();
    assert.ok(review >= 4096, `a review needs room for reasoning and findings, got ${review}`);
  });
});

describe('Anthropic is asked for what the job needs too', () => {
  it('reserves less for a question than for a review', async () => {
    const bodies: Body[] = [];
    const provider = () =>
      new AnthropicReviewProvider({ apiKey: 'k', fetch: capturing(bodies, ANTHROPIC_REPLY) });
    await provider().review(REVIEW);
    await provider().guide(GUIDANCE);
    await provider().recall(RECALL);

    const [review, guidance, recall] = bodies.map((body) => body.max_tokens as number);
    assert.ok(guidance < review, `guidance ${guidance} should be under review ${review}`);
    assert.ok(recall <= guidance, `recall ${recall} should not exceed guidance ${guidance}`);
  });
});

describe('the Responses API path carries the same budgets', () => {
  it('sends max_output_tokens per job', async () => {
    const bodies: Body[] = [];
    const reply = {
      id: 'resp_1',
      object: 'response',
      created_at: 1,
      status: 'completed',
      model: 'gpt-5.1-codex-max',
      output: [
        { type: 'message', id: 'm1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: '{}', annotations: [] }] },
      ],
      output_text: '{}',
      usage: { input_tokens: 1, output_tokens: 1 },
    };
    const provider = () => new OpenAIReviewProvider({ apiKey: 'k', fetch: capturing(bodies, reply) });
    await provider().review(REVIEW);
    await provider().guide(GUIDANCE);

    assert.ok(
      (bodies[1].max_output_tokens as number) < (bodies[0].max_output_tokens as number),
      'guidance should reserve less than a review',
    );
  });
});

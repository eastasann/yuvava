/**
 * Degrading instead of giving up, when an endpoint refuses the size (#32).
 *
 * The observed failure, reproduced as a fixture: Groq's free tier counts the
 * `max_tokens` reservation against a per-minute limit, so a request is refused
 * for room it was never going to use. Halving and asking again is better than
 * not answering.
 *
 * What these tests hold: it fires for that, it does not fire for anything else,
 * and it never fires twice.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import OpenAI from 'openai';
import { OpenAIReviewProvider, isTokenBudgetRejection } from '../src/core/openaiProvider.js';
import { ReviewUnavailableError } from '../src/core/provider.js';

const BASE_URL = 'https://api.groq.com/openai/v1';
const REVIEW = { annotatedDiff: '### a.ts\n     1 +const a = 1;', intensity: 'normal' as const };

/** The exact wording that was observed, minus the organisation id. */
const TPM_MESSAGE =
  'Request too large for model `openai/gpt-oss-120b` in organization `org_x` service tier ' +
  '`on_demand` on tokens per minute (TPM): Limit 8000, Requested 9386, please reduce your ' +
  'message size and try again.';

function apiError(status: number, message: string): unknown {
  return new OpenAI.APIError(status, { error: { message } }, message, undefined);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const ANSWER = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'openai/gpt-oss-120b',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '{"issues":[]}', refusal: null },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: { prompt_tokens: 1194, completion_tokens: 30 },
};

function truncated(): unknown {
  return { ...ANSWER, choices: [{ ...ANSWER.choices[0], finish_reason: 'length' }] };
}

/** Replies in sequence; records the max_tokens of every attempt. */
function provider(replies: Array<() => Response>, budgets: number[] = []): OpenAIReviewProvider {
  let call = 0;
  return new OpenAIReviewProvider({
    apiKey: 'k',
    baseUrl: BASE_URL,
    model: 'openai/gpt-oss-120b',
    fetch: (_input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
      budgets.push(body.max_tokens as number);
      const reply = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return Promise.resolve(reply());
    },
  });
}

describe('isTokenBudgetRejection', () => {
  it('recognises the refusal that was actually observed', () => {
    assert.equal(isTokenBudgetRejection(apiError(413, TPM_MESSAGE)), true);
  });

  it('recognises the same complaint at the other statuses it arrives with', () => {
    assert.equal(isTokenBudgetRejection(apiError(400, 'max_tokens is too large for this model')), true);
    assert.equal(isTokenBudgetRejection(apiError(429, 'rate limit reached on tokens per minute (TPM)')), true);
  });

  it('does not treat a plain rate limit as something a smaller answer would fix', () => {
    // Retrying into "too many requests" with a shorter answer only adds load.
    assert.equal(isTokenBudgetRejection(apiError(429, 'Rate limit reached: too many requests')), false);
  });

  it('ignores everything else', () => {
    assert.equal(isTokenBudgetRejection(apiError(404, 'The model `x` does not exist')), false);
    assert.equal(isTokenBudgetRejection(apiError(401, 'Invalid API key')), false);
    assert.equal(isTokenBudgetRejection(apiError(500, 'internal error')), false);
    assert.equal(isTokenBudgetRejection(new Error('too large')), false);
  });
});

describe('an endpoint that refuses the size', () => {
  it('is asked again with half the room, and answers', async () => {
    const budgets: number[] = [];
    const response = await provider(
      [() => json({ error: { message: TPM_MESSAGE } }, 413), () => json(ANSWER)],
      budgets,
    ).review(REVIEW);

    assert.deepEqual(budgets, [8192, 4096]);
    assert.equal(response.text, '{"issues":[]}');
    assert.ok(response.warnings?.some((warning) => /refused the request size/.test(warning)));
    assert.ok(response.warnings?.some((warning) => /4096 tokens set aside/.test(warning)));
  });

  it('gives up after one reduction rather than halving its way to nothing', async () => {
    const budgets: number[] = [];
    await assert.rejects(
      provider([() => json({ error: { message: TPM_MESSAGE } }, 413)], budgets).review(REVIEW),
      (error: unknown) => error instanceof ReviewUnavailableError,
    );
    assert.equal(budgets.length, 2, `expected one retry, got ${budgets.length} attempts`);
  });

  it('reduces the smaller reservation of a question too, down to a usable floor', async () => {
    const budgets: number[] = [];
    await provider(
      [() => json({ error: { message: TPM_MESSAGE } }, 413), () => json(ANSWER)],
      budgets,
    ).recall({ description: 'folds an array into one value' });
    assert.deepEqual(budgets, [1024, 512]);
  });

  it('says the answer was cut short *because* it was made smaller', async () => {
    await assert.rejects(
      provider([() => json({ error: { message: TPM_MESSAGE } }, 413), () => json(truncated())]).review(REVIEW),
      (error: unknown) =>
        error instanceof ReviewUnavailableError && /refused the original size/.test(error.message),
    );
  });

  it('still reports a plain truncation as a plain truncation', async () => {
    await assert.rejects(
      provider([() => json(truncated())]).review(REVIEW),
      (error: unknown) => error instanceof ReviewUnavailableError && /cut short \(max_tokens\)/.test(error.message),
    );
  });
});

describe('the two retries are independent', () => {
  it('can fall back on the schema and then on the size, once each', async () => {
    const budgets: number[] = [];
    const response = await provider(
      [
        () => json({ error: { message: 'response_format json_schema is not supported' } }, 400),
        () => json({ error: { message: TPM_MESSAGE } }, 413),
        () => json(ANSWER),
      ],
      budgets,
    ).review(REVIEW);

    assert.deepEqual(budgets, [8192, 8192, 4096]);
    assert.equal(response.warnings?.length, 2);
  });

  it('does not retry the size twice, however often the endpoint refuses', async () => {
    const budgets: number[] = [];
    await assert.rejects(
      provider(
        [
          () => json({ error: { message: TPM_MESSAGE } }, 413),
          () => json({ error: { message: TPM_MESSAGE } }, 413),
          () => json(ANSWER),
        ],
        budgets,
      ).review(REVIEW),
      (error: unknown) => error instanceof ReviewUnavailableError,
    );
    assert.equal(budgets.length, 2);
  });

  it('leaves an unrelated failure alone', async () => {
    const budgets: number[] = [];
    await assert.rejects(
      provider(
        [() => json({ error: { message: 'The model `x` does not exist' } }, 404)],
        budgets,
      ).review(REVIEW),
      (error: unknown) => error instanceof ReviewUnavailableError && /does not exist/.test(error.message),
    );
    assert.equal(budgets.length, 1, 'a 404 is not something a retry fixes');
  });
});

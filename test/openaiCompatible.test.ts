/**
 * Pointing the OpenAI provider at an OpenAI-compatible endpoint.
 *
 * The important behaviours: the request goes to /chat/completions rather than
 * /responses (which is what Groq, Cerebras, Ollama and LM Studio actually
 * implement), and an endpoint that rejects the JSON schema still produces a
 * review rather than a failure.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OpenAIReviewProvider, isStructuredOutputRejection } from '../src/core/openaiProvider.js';
import { ReviewUnavailableError } from '../src/core/provider.js';
import { runReview } from '../src/core/review.js';

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

const BASE_URL = 'https://api.groq.com/openai/v1';
const REVIEW_JSON = '{"issues":[]}';

function chatResponse(content: string, finishReason = 'stop', refusal: string | null = null): unknown {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'llama-3.3-70b-versatile',
    choices: [
      { index: 0, message: { role: 'assistant', content, refusal }, finish_reason: finishReason, logprobs: null },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

/** Replies in sequence, so a fallback retry can be observed. */
function providerWith(
  replies: Array<() => Response>,
  captured: Captured[] = [],
  options: { model?: string; baseUrl?: string } = {},
): OpenAIReviewProvider {
  let call = 0;
  return new OpenAIReviewProvider({
    apiKey: 'test-key',
    model: options.model ?? 'llama-3.3-70b-versatile',
    baseUrl: options.baseUrl ?? BASE_URL,
    fetch: (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      captured.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
      });
      const reply = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return Promise.resolve(reply());
    },
  });
}

const REQUEST = { annotatedDiff: '### a.ts\n     1 +const a = 1;', intensity: 'normal' as const };

describe('an OpenAI-compatible endpoint', () => {
  it('goes to /chat/completions, not /responses', async () => {
    const captured: Captured[] = [];
    await providerWith([() => json(chatResponse(REVIEW_JSON))], captured).review(REQUEST);
    assert.equal(captured.length, 1);
    assert.match(captured[0].url, /^https:\/\/api\.groq\.com\/openai\/v1\/chat\/completions$/);
  });

  it('sends the same prompt and schema as everywhere else', async () => {
    const captured: Captured[] = [];
    await providerWith([() => json(chatResponse(REVIEW_JSON))], captured).review(REQUEST);
    const body = captured[0].body;
    const messages = body.messages as Array<{ role: string; content: string }>;
    assert.deepEqual(messages.map((m) => m.role), ['system', 'user']);
    assert.match(messages[0].content, /You are the navigator/);
    assert.match(messages[0].content, /Do not write implementation code/);
    assert.ok(messages[1].content.includes(REQUEST.annotatedDiff));
    assert.equal(body.model, 'llama-3.3-70b-versatile');
    assert.equal(body.tools, undefined);

    const format = body.response_format as { type: string; json_schema: { name: string; strict: boolean } };
    assert.equal(format.type, 'json_schema');
    assert.equal(format.json_schema.strict, true);
  });

  it('still uses /responses when no base URL is configured', async () => {
    const captured: Captured[] = [];
    const provider = new OpenAIReviewProvider({
      apiKey: 'k',
      fetch: (input, init) => {
        captured.push({
          url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
          body: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>,
        });
        return Promise.resolve(
          json({
            id: 'resp_1', object: 'response', created_at: 1, model: 'm', status: 'completed',
            output: [{ type: 'message', id: 'm', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: REVIEW_JSON, annotations: [] }] }],
            output_text: REVIEW_JSON, parallel_tool_calls: false, tool_choice: 'auto', tools: [],
            error: null, incomplete_details: null, instructions: null, metadata: {},
          }),
        );
      },
    });
    await provider.review(REQUEST);
    assert.match(captured[0].url, /\/responses$/);
  });

  it('retries without the schema when the endpoint rejects it', async () => {
    const captured: Captured[] = [];
    const provider = providerWith(
      [
        () => json({ error: { message: "'response_format.json_schema' is not supported", type: 'invalid_request_error' } }, 400),
        () => json(chatResponse(REVIEW_JSON)),
      ],
      captured,
    );

    const result = await provider.review(REQUEST);
    assert.equal(result.text, REVIEW_JSON);
    assert.equal(captured.length, 2, 'should have retried exactly once');
    assert.ok(captured[0].body.response_format, 'first attempt carries the schema');
    assert.equal(captured[1].body.response_format, undefined, 'retry drops the schema');
    assert.match(result.warnings?.[0] ?? '', /rejected the JSON schema/);
  });

  it('surfaces the fallback in the review notes, not as an observation', async () => {
    const provider = providerWith([
      () => json({ error: { message: 'json_schema unsupported' } }, 400),
      () => json(chatResponse(REVIEW_JSON)),
    ]);
    const report = await runReview({
      diff: 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1,2 @@\n const a = 1;\n+const b = 2;\n',
      intensity: 'normal',
      maxObservations: 20,
      maxDiffBytes: 200000,
      provider,
    });
    assert.deepEqual(report.observations, []);
    assert.match(report.notes[0], /rejected the JSON schema/);
  });

  it('does not retry an error that is not about the schema', async () => {
    const captured: Captured[] = [];
    const provider = providerWith(
      [() => json({ error: { message: 'model not found', type: 'invalid_request_error' } }, 404)],
      captured,
    );
    await assert.rejects(() => provider.review(REQUEST), ReviewUnavailableError);
    assert.equal(captured.length, 1, 'an unrelated failure must not be retried');
  });

  it('reports a truncated answer rather than parsing half a review', async () => {
    const provider = providerWith([() => json(chatResponse('{"issues": [', 'length'))]);
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /cut short \(max_tokens\)/);
        return true;
      },
    );
  });

  it('reports a refusal and an empty answer distinctly', async () => {
    await assert.rejects(
      () => providerWith([() => json(chatResponse('', 'stop', 'I cannot help'))]).review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /declined to review/);
        return true;
      },
    );
    await assert.rejects(
      () => providerWith([() => json(chatResponse('   '))]).review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /empty response/);
        return true;
      },
    );
  });

  it('explains a rejected key without naming OpenAI, since it may not be OpenAI', async () => {
    await assert.rejects(
      () => providerWith([() => json({ error: { message: 'bad key' } }, 401)]).review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /API key was rejected/);
        return true;
      },
    );
  });

  it('handles an endpoint that returns no choices', async () => {
    const provider = providerWith([
      () => json({ id: 'c', object: 'chat.completion', created: 1, model: 'm', choices: [] }),
    ]);
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /no choices/);
        return true;
      },
    );
  });
});

describe('isStructuredOutputRejection', () => {
  it('ignores anything that is not an API error', () => {
    assert.equal(isStructuredOutputRejection(new Error('response_format')), false);
    assert.equal(isStructuredOutputRejection(undefined), false);
  });
});

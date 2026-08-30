/**
 * The wire request Navigator actually sends.
 *
 * No network: the SDK's `fetch` is replaced, so the request body and the
 * handling of every response shape can be pinned without an API key.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnthropicReviewProvider, DEFAULT_ANTHROPIC_MODEL } from '../src/core/anthropicProvider.js';
import { ReviewUnavailableError } from '../src/core/provider.js';

interface CapturedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function messageWith(text: string, stopReason = 'end_turn'): unknown {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: DEFAULT_ANTHROPIC_MODEL,
    content: [{ type: 'text', text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function messageWithUsage(usage: unknown): unknown {
  return { ...(messageWith('{"issues":[]}') as Record<string, unknown>), usage };
}

function providerReturning(
  response: Response | (() => Promise<Response>),
  captured: CapturedRequest[] = [],
  model?: string,
): AnthropicReviewProvider {
  return new AnthropicReviewProvider({
    apiKey: 'test-key',
    model,
    fetch: async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      const headers: Record<string, string> = {};
      new Headers(init?.headers).forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const body = typeof init?.body === 'string' ? init.body : '{}';
      captured.push({
        url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
        method: init?.method ?? 'GET',
        headers,
        body: JSON.parse(body) as Record<string, unknown>,
      });
      return typeof response === 'function' ? response() : response.clone();
    },
  });
}

const REQUEST = { annotatedDiff: '### src/a.ts\n@@ -1 +1 @@\n     1 +const a = 1;', intensity: 'normal' as const };

describe('AnthropicReviewProvider request', () => {
  it('asks for a structured review of the annotated diff', async () => {
    const captured: CapturedRequest[] = [];
    const provider = providerReturning(jsonResponse(messageWith('{"issues":[]}')), captured);
    await provider.review(REQUEST);

    assert.equal(captured.length, 1);
    const request = captured[0];
    assert.equal(request.method, 'POST');
    assert.match(request.url, /\/v1\/messages/);
    assert.equal(request.headers['x-api-key'], 'test-key');

    assert.equal(request.body.model, DEFAULT_ANTHROPIC_MODEL);
    assert.equal(typeof request.body.max_tokens, 'number');

    const system = String(request.body.system);
    assert.match(system, /You are the navigator/);
    assert.match(system, /Do not write implementation code/);

    const messages = request.body.messages as Array<{ role: string; content: string }>;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.ok(messages[0].content.includes(REQUEST.annotatedDiff));
  });

  it('pins the response to the review JSON schema', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(messageWith('{"issues":[]}')), captured).review(REQUEST);
    const outputConfig = captured[0].body.output_config as { format: { type: string; schema: unknown } };
    assert.equal(outputConfig.format.type, 'json_schema');
    assert.ok(outputConfig.format.schema);
  });

  it('enables server-side fallback so a classifier refusal is not a dead end', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(messageWith('{"issues":[]}')), captured).review(REQUEST);
    assert.equal(captured[0].headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
    assert.equal(captured[0].body.fallbacks, 'default');
  });

  it('sends no tools, so the model has nothing it could act with', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(messageWith('{"issues":[]}')), captured).review(REQUEST);
    assert.equal(captured[0].body.tools, undefined);
  });

  it('varies only the scope section with intensity', async () => {
    const captured: CapturedRequest[] = [];
    const provider = providerReturning(jsonResponse(messageWith('{"issues":[]}')), captured);
    await provider.review({ ...REQUEST, intensity: 'silent' });
    await provider.review({ ...REQUEST, intensity: 'strict' });
    assert.match(String(captured[0].body.system), /only clear correctness bugs/);
    assert.match(String(captured[1].body.system), /security risks/);
    for (const request of captured) {
      assert.match(String(request.body.system), /Do not write implementation code/);
    }
  });

  it('honours a configured model', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(messageWith('{"issues":[]}')), captured, 'claude-sonnet-5').review(REQUEST);
    assert.equal(captured[0].body.model, 'claude-sonnet-5');
  });

  it('falls back to the default model for a blank setting', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(messageWith('{"issues":[]}')), captured, '   ').review(REQUEST);
    assert.equal(captured[0].body.model, DEFAULT_ANTHROPIC_MODEL);
  });
});

describe('AnthropicReviewProvider responses', () => {
  it('returns the text of a successful review', async () => {
    const provider = providerReturning(jsonResponse(messageWith('{"issues":[]}')));
    assert.equal((await provider.review(REQUEST)).text, '{"issues":[]}');
  });

  it('reports a refusal as an unavailable review, not a crash', async () => {
    const provider = providerReturning(jsonResponse(messageWith('', 'refusal')));
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /declined to review/);
        return true;
      },
    );
  });

  it('reports an empty response', async () => {
    const provider = providerReturning(jsonResponse({ ...(messageWith('') as object), content: [] }));
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /empty response/);
        return true;
      },
    );
  });

  it('explains a rejected API key', async () => {
    const provider = providerReturning(
      jsonResponse({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401),
    );
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /API key was rejected/);
        return true;
      },
    );
  });

  it('explains a rate limit', async () => {
    const provider = providerReturning(
      jsonResponse({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 429),
    );
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /rate limited/);
        return true;
      },
    );
  });

  it('explains an unreachable API', async () => {
    const provider = providerReturning(() => Promise.reject(new Error('ECONNREFUSED')));
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /could not reach the Anthropic API/);
        return true;
      },
    );
  });

  it('surfaces an unexpected server error without leaking an exception type', async () => {
    const provider = providerReturning(
      jsonResponse({ type: 'error', error: { type: 'api_error', message: 'boom' } }, 500),
    );
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /Anthropic API error 500/);
        return true;
      },
    );
  });

  it('survives a non-JSON response body', async () => {
    const provider = providerReturning(new Response('<html>gateway</html>', { status: 502 }));
    await assert.rejects(() => provider.review(REQUEST), ReviewUnavailableError);
  });
});

describe('AnthropicReviewProvider usage', () => {
  it('reports what the request cost, thinking tokens included', async () => {
    const provider = providerReturning(
      jsonResponse(
        messageWithUsage({
          input_tokens: 4210,
          output_tokens: 1830,
          output_tokens_details: { thinking_tokens: 1204 },
        }),
      ),
    );
    const response = await provider.review(REQUEST);
    assert.deepEqual(response.usage, { input: 4210, output: 1830, thinking: 1204 });
  });

  it('reports nothing rather than zero when the field is missing', async () => {
    const provider = providerReturning(jsonResponse(messageWithUsage(undefined)));
    const response = await provider.review(REQUEST);
    assert.equal(response.usage, undefined);
  });
});

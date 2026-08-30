/**
 * The wire request the OpenAI provider sends, and how it reads every response
 * shape back. No network: the SDK's `fetch` is replaced.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_OPENAI_MODEL, OpenAIReviewProvider } from '../src/core/openaiProvider.js';
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

function responseWith(overrides: Record<string, unknown>): unknown {
  return {
    id: 'resp_1',
    object: 'response',
    created_at: 1,
    model: DEFAULT_OPENAI_MODEL,
    status: 'completed',
    output: [],
    output_text: '',
    parallel_tool_calls: false,
    tool_choice: 'auto',
    tools: [],
    error: null,
    incomplete_details: null,
    instructions: null,
    metadata: {},
    ...overrides,
  };
}

function textResponse(text: string): unknown {
  return responseWith({
    output: [
      { type: 'message', id: 'msg_1', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] },
    ],
    output_text: text,
  });
}

function providerReturning(
  response: Response | (() => Promise<Response>),
  captured: CapturedRequest[] = [],
  model?: string,
): OpenAIReviewProvider {
  return new OpenAIReviewProvider({
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

describe('OpenAIReviewProvider request', () => {
  it('asks for a structured review of the annotated diff', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(textResponse('{"issues":[]}')), captured).review(REQUEST);

    assert.equal(captured.length, 1);
    const request = captured[0];
    assert.equal(request.method, 'POST');
    assert.match(request.url, /\/responses/);
    assert.equal(request.headers.authorization, 'Bearer test-key');

    assert.equal(request.body.model, DEFAULT_OPENAI_MODEL);
    assert.match(String(request.body.instructions), /You are the navigator/);
    assert.match(String(request.body.instructions), /Do not write implementation code/);
    assert.ok(String(request.body.input).includes(REQUEST.annotatedDiff));
  });

  it('pins the response to the review JSON schema, in strict mode', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(textResponse('{"issues":[]}')), captured).review(REQUEST);
    const text = captured[0].body.text as {
      format: { type: string; name: string; strict: boolean; schema: Record<string, unknown> };
    };
    assert.equal(text.format.type, 'json_schema');
    assert.equal(text.format.strict, true);
    assert.equal(text.format.name, 'navigator_review');
    assert.ok(text.format.schema);
  });

  it('sends the same system prompt as the Anthropic provider does', async () => {
    const captured: CapturedRequest[] = [];
    const provider = providerReturning(jsonResponse(textResponse('{"issues":[]}')), captured);
    await provider.review({ ...REQUEST, intensity: 'silent' });
    await provider.review({ ...REQUEST, intensity: 'strict' });
    assert.match(String(captured[0].body.instructions), /only clear correctness bugs/);
    assert.match(String(captured[1].body.instructions), /security risks/);
  });

  it('sends no tools, so the model has nothing it could act with', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(textResponse('{"issues":[]}')), captured).review(REQUEST);
    assert.equal(captured[0].body.tools, undefined);
  });

  it('honours a configured model and falls back for a blank one', async () => {
    const captured: CapturedRequest[] = [];
    await providerReturning(jsonResponse(textResponse('{"issues":[]}')), captured, 'gpt-5.1-codex').review(REQUEST);
    await providerReturning(jsonResponse(textResponse('{"issues":[]}')), captured, '  ').review(REQUEST);
    assert.equal(captured[0].body.model, 'gpt-5.1-codex');
    assert.equal(captured[1].body.model, DEFAULT_OPENAI_MODEL);
  });
});

describe('OpenAIReviewProvider responses', () => {
  it('returns the text of a successful review', async () => {
    const provider = providerReturning(jsonResponse(textResponse('{"issues":[]}')));
    assert.equal((await provider.review(REQUEST)).text, '{"issues":[]}');
  });

  it('reports a truncated response instead of parsing half a review', async () => {
    const provider = providerReturning(
      jsonResponse(
        responseWith({
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output_text: '{"issues": [',
        }),
      ),
    );
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /cut short \(max_output_tokens\)/);
        return true;
      },
    );
  });

  it('reports a refusal with its reason', async () => {
    const provider = providerReturning(
      jsonResponse(
        responseWith({
          output: [
            {
              type: 'message',
              id: 'msg_1',
              status: 'completed',
              role: 'assistant',
              content: [{ type: 'refusal', refusal: 'not able to help with that' }],
            },
          ],
          output_text: '',
        }),
      ),
    );
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /declined to review this change/);
        return true;
      },
    );
  });

  it('reports an empty response', async () => {
    const provider = providerReturning(jsonResponse(textResponse('')));
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /empty response/);
        return true;
      },
    );
  });

  it('explains a rejected API key', async () => {
    const provider = providerReturning(
      jsonResponse({ error: { message: 'invalid key', type: 'invalid_request_error' } }, 401),
    );
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /OpenAI API key was rejected/);
        return true;
      },
    );
  });

  it('explains a rate limit', async () => {
    const provider = providerReturning(
      jsonResponse({ error: { message: 'slow down', type: 'rate_limit_error' } }, 429),
    );
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /rate limited by the OpenAI API/);
        return true;
      },
    );
  });

  it('explains an unreachable API', async () => {
    const provider = providerReturning(() => Promise.reject(new Error('ECONNREFUSED')));
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.match((error as Error).message, /could not reach the OpenAI API/);
        return true;
      },
    );
  });

  it('surfaces an unexpected server error', async () => {
    const provider = providerReturning(jsonResponse({ error: { message: 'boom' } }, 500));
    await assert.rejects(
      () => provider.review(REQUEST),
      (error: unknown) => {
        assert.ok(error instanceof ReviewUnavailableError);
        assert.match(error.message, /OpenAI API error 500/);
        return true;
      },
    );
  });

  it('survives a non-JSON response body', async () => {
    const provider = providerReturning(new Response('<html>gateway</html>', { status: 502 }));
    await assert.rejects(() => provider.review(REQUEST), ReviewUnavailableError);
  });
});

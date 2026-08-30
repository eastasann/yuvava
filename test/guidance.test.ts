/**
 * The guidance path (SPEC §10): a question in, places to look out.
 *
 * The interesting assertions are the negative ones. Navigator must not answer
 * the question, must not emit code, and must not emit a link the model made
 * up — none of which the model can be trusted to respect, so all three are
 * checked on the way back.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_QUESTION_LENGTH, runGuidance } from '../src/core/guidance.js';
import {
  GUIDANCE_OUTPUT_SCHEMA,
  MAX_SEARCHES,
  MAX_TOPICS,
  parseGuidanceResponse,
} from '../src/core/guidanceSchema.js';
import { buildGuidanceSystemPrompt, buildGuidanceUserPrompt } from '../src/core/guidancePrompt.js';
import { searchUrl } from '../src/core/search.js';
import { ReviewUnavailableError, type GuidanceProvider, type GuidanceRequest } from '../src/core/provider.js';

function providerReturning(text: string, seen: GuidanceRequest[] = []): GuidanceProvider {
  return {
    guide(request) {
      seen.push(request);
      return Promise.resolve({ text });
    },
  };
}

const ANSWER = JSON.stringify({
  topics: [
    { name: 'AbortSignal.timeout()', note: 'how the deadline is expressed' },
    { name: '4xx versus 5xx', note: '' },
  ],
  searches: ['MDN AbortSignal', 'fetch retry backoff'],
});

describe('parseGuidanceResponse', () => {
  it('keeps topics and searches, and drops an empty note', () => {
    const parsed = parseGuidanceResponse(ANSWER);
    assert.deepEqual(parsed.topics, [
      { name: 'AbortSignal.timeout()', note: 'how the deadline is expressed' },
      { name: '4xx versus 5xx' },
    ]);
    assert.deepEqual(parsed.searches, ['MDN AbortSignal', 'fetch retry backoff']);
    assert.deepEqual(parsed.problems, []);
  });

  it('strips a URL the model produced rather than showing it', () => {
    const parsed = parseGuidanceResponse(
      JSON.stringify({
        topics: [{ name: 'URLSearchParams', note: 'see https://example.invalid/made/up' }],
        searches: ['https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams'],
      }),
    );
    assert.equal(parsed.topics[0].note, 'see');
    assert.deepEqual(parsed.searches, []);
    for (const search of parsed.searches) {
      assert.doesNotMatch(search, /https?:\/\//);
    }
  });

  it('removes code the model put in a topic', () => {
    const parsed = parseGuidanceResponse(
      JSON.stringify({
        topics: [
          {
            name: 'retry loop',
            note: 'like this:\n```js\nfor (let i = 0; i < 3; i++) { await go(); }\n```',
          },
        ],
        searches: [],
      }),
    );
    assert.equal(parsed.topics.length, 1);
    assert.equal(parsed.topics[0].note, 'like this:');
  });

  it('drops a topic whose name was nothing but code', () => {
    const parsed = parseGuidanceResponse(
      JSON.stringify({ topics: [{ name: 'const retries = 3;', note: '' }], searches: [] }),
    );
    assert.deepEqual(parsed.topics, []);
    assert.match(parsed.problems[0], /nothing usable/);
  });

  it('caps how much it will put in front of the developer', () => {
    const parsed = parseGuidanceResponse(
      JSON.stringify({
        topics: Array.from({ length: 9 }, (_, i) => ({ name: `topic ${i}`, note: '' })),
        searches: Array.from({ length: 9 }, (_, i) => `search ${i}`),
      }),
    );
    assert.equal(parsed.topics.length, MAX_TOPICS);
    assert.equal(parsed.searches.length, MAX_SEARCHES);
  });

  it('drops duplicates rather than repeating itself', () => {
    const parsed = parseGuidanceResponse(
      JSON.stringify({
        topics: [{ name: 'backoff', note: '' }, { name: 'Backoff', note: '' }],
        searches: ['mdn fetch', 'mdn fetch'],
      }),
    );
    assert.equal(parsed.topics.length, 1);
    assert.equal(parsed.searches.length, 1);
  });

  it('yields nothing at all for a broken response', () => {
    for (const broken of ['', 'sorry, I cannot help', '{"topics": ', '{"topics": "nope"}']) {
      const parsed = parseGuidanceResponse(broken);
      assert.deepEqual(parsed.topics, []);
      assert.deepEqual(parsed.searches, []);
      assert.ok(parsed.problems.length > 0, `expected a problem note for ${JSON.stringify(broken)}`);
    }
  });
});

describe('the guidance schema cannot carry an answer', () => {
  it('has exactly two fields, neither of which is a link or a body of text', () => {
    assert.deepEqual(Object.keys(GUIDANCE_OUTPUT_SCHEMA.properties).sort(), ['searches', 'topics']);
    assert.deepEqual(
      Object.keys(GUIDANCE_OUTPUT_SCHEMA.properties.topics.items.properties).sort(),
      ['name', 'note'],
    );
  });

  it('requires every field, so one schema serves both providers', () => {
    assert.deepEqual([...GUIDANCE_OUTPUT_SCHEMA.required].sort(), ['searches', 'topics']);
    assert.deepEqual(
      [...GUIDANCE_OUTPUT_SCHEMA.properties.topics.items.required].sort(),
      ['name', 'note'],
    );
    assert.equal(GUIDANCE_OUTPUT_SCHEMA.additionalProperties, false);
  });
});

describe('the guidance prompt', () => {
  const system = buildGuidanceSystemPrompt();

  it('forbids the answer, the code and the link', () => {
    assert.match(system, /Do not write implementation code/);
    assert.match(system, /Do not give steps, instructions, or advice/);
    assert.match(system, /Do not produce URLs/);
  });

  it('makes an empty answer a correct one', () => {
    assert.match(system, /empty lists/);
  });

  it('passes the question through without dressing it up', () => {
    assert.match(buildGuidanceUserPrompt('add a retry to fetch'), /add a retry to fetch/);
  });
});

describe('runGuidance', () => {
  it('asks nothing when nothing was asked', async () => {
    const seen: GuidanceRequest[] = [];
    const report = await runGuidance({ question: '   ', provider: providerReturning(ANSWER, seen) });
    assert.equal(report.status, 'no-question');
    assert.equal(seen.length, 0);
  });

  it('returns what the model pointed at', async () => {
    const report = await runGuidance({ question: 'add a retry to fetch', provider: providerReturning(ANSWER) });
    assert.equal(report.status, 'answered');
    assert.equal(report.topics.length, 2);
    assert.equal(report.searches.length, 2);
  });

  it('is silent rather than wrong when the answer is unusable', async () => {
    const report = await runGuidance({ question: 'anything', provider: providerReturning('I am afraid not.') });
    assert.equal(report.status, 'answered');
    assert.deepEqual(report.topics, []);
    assert.deepEqual(report.searches, []);
    assert.ok(report.notes.length > 0);
  });

  it('caps the question rather than sending an essay', async () => {
    const seen: GuidanceRequest[] = [];
    await runGuidance({ question: 'x'.repeat(5000), provider: providerReturning(ANSWER, seen) });
    assert.equal(seen[0].question.length, MAX_QUESTION_LENGTH);
  });

  it('reports a provider failure as unavailable, not as a crash', async () => {
    const provider: GuidanceProvider = {
      guide: () => Promise.reject(new Error('network down')),
    };
    await assert.rejects(
      runGuidance({ question: 'anything', provider }),
      (error: unknown) => error instanceof ReviewUnavailableError && /network down/.test(error.message),
    );
  });
});

describe('searchUrl', () => {
  it('encodes the term into a plain web search', () => {
    assert.equal(searchUrl('fetch retry backoff'), 'https://duckduckgo.com/?q=fetch%20retry%20backoff');
  });

  it('escapes anything that could change the query', () => {
    assert.match(searchUrl('a&b=c'), /\?q=a%26b%3Dc$/);
  });
});

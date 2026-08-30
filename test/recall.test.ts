/**
 * Recall assistance (SPEC §9).
 *
 * The load-bearing assertion is that a usage example cannot reach the
 * developer through any field. It is not enforced by asking the model nicely:
 * `signature` only accepts something that is actually a signature, and
 * `concept` goes through the review sanitiser, which destroys all code.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_DESCRIPTION_LENGTH, runRecall } from '../src/core/recall.js';
import {
  MAX_CANDIDATES,
  RECALL_OUTPUT_SCHEMA,
  parseRecallResponse,
  recallStages,
} from '../src/core/recallSchema.js';
import { buildRecallSystemPrompt } from '../src/core/recallPrompt.js';
import { ReviewUnavailableError, type RecallProvider, type RecallRequest } from '../src/core/provider.js';

function providerReturning(text: string, seen: RecallRequest[] = []): RecallProvider {
  return {
    recall(request) {
      seen.push(request);
      return Promise.resolve({ text });
    },
  };
}

const ANSWER = JSON.stringify({
  candidates: [
    {
      name: 'Array.prototype.reduce',
      signature: 'reduce(callbackFn, initialValue?)',
      concept: 'Walks the array in order, folding it into a single value.',
      search: 'MDN Array reduce',
    },
  ],
});

describe('parseRecallResponse', () => {
  it('keeps the four rungs separate', () => {
    const parsed = parseRecallResponse(ANSWER);
    assert.deepEqual(parsed.candidates, [
      {
        name: 'Array.prototype.reduce',
        signature: 'reduce(callbackFn, initialValue?)',
        concept: 'Walks the array in order, folding it into a single value.',
        search: 'MDN Array reduce',
      },
    ]);
  });

  it('drops a "signature" that is really a usage example', () => {
    const parsed = parseRecallResponse(
      JSON.stringify({
        candidates: [
          {
            name: 'Array.prototype.reduce',
            signature: 'const total = items.reduce((sum, x) => sum + x, 0);',
            concept: '',
            search: '',
          },
        ],
      }),
    );
    assert.equal(parsed.candidates[0].signature, undefined);
    assert.ok(parsed.problems.some((problem) => /not one/.test(problem)));
  });

  it('strips code out of a concept, because a concept explains and never shows', () => {
    const parsed = parseRecallResponse(
      JSON.stringify({
        candidates: [
          {
            name: 'Array.prototype.reduce',
            signature: '',
            concept: 'Folds the array into one value. For example:\n```js\nitems.reduce(add, 0);\n```',
            search: '',
          },
        ],
      }),
    );
    const concept = parsed.candidates[0].concept;
    assert.ok(concept);
    assert.doesNotMatch(concept, /items\.reduce/);
    assert.doesNotMatch(concept, /```/);
  });

  it('leaves nothing usable when every field was code', () => {
    const parsed = parseRecallResponse(
      JSON.stringify({
        candidates: [
          { name: 'const total = 0;', signature: 'x = f();', concept: 'const y = 2;', search: '' },
        ],
      }),
    );
    assert.deepEqual(parsed.candidates, []);
  });

  it('strips a URL out of the search term', () => {
    const parsed = parseRecallResponse(
      JSON.stringify({
        candidates: [
          {
            name: 'URLSearchParams',
            signature: '',
            concept: '',
            search: 'https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams',
          },
        ],
      }),
    );
    assert.equal(parsed.candidates[0].search, undefined);
  });

  it('keeps at most a few candidates, and no duplicates', () => {
    const parsed = parseRecallResponse(
      JSON.stringify({
        candidates: [
          ...Array.from({ length: 6 }, (_, i) => ({
            name: `Thing${i}`,
            signature: '',
            concept: '',
            search: '',
          })),
          { name: 'Thing0', signature: '', concept: '', search: '' },
        ],
      }),
    );
    assert.equal(parsed.candidates.length, MAX_CANDIDATES);
  });

  it('yields nothing at all for a broken response', () => {
    for (const broken of ['', 'no idea', '{"candidates": ', '{"candidates": "nope"}']) {
      const parsed = parseRecallResponse(broken);
      assert.deepEqual(parsed.candidates, []);
    }
  });
});

describe('recallStages', () => {
  it('orders them as SPEC §9 does, with the name excluded', () => {
    const stages = recallStages({
      name: 'Array.prototype.reduce',
      signature: 'reduce(callbackFn, initialValue?)',
      concept: 'Folds an array into one value.',
      search: 'MDN Array reduce',
    });
    assert.deepEqual(stages.map((stage) => stage.kind), ['signature', 'concept', 'search']);
  });

  it('skips the rungs the model had nothing for', () => {
    assert.deepEqual(recallStages({ name: 'fetch' }), []);
    assert.deepEqual(
      recallStages({ name: 'fetch', search: 'MDN fetch' }).map((stage) => stage.kind),
      ['search'],
    );
  });
});

describe('the recall schema and prompt', () => {
  it('has one field per rung of SPEC §9, and no field for an example', () => {
    assert.deepEqual(
      Object.keys(RECALL_OUTPUT_SCHEMA.properties.candidates.items.properties).sort(),
      ['concept', 'name', 'search', 'signature'],
    );
  });

  it('forbids usage examples outright', () => {
    const system = buildRecallSystemPrompt();
    assert.match(system, /Do not write a usage example/);
    assert.match(system, /Do not produce URLs/);
    assert.match(system, /empty list rather than guessing/);
  });
});

describe('runRecall', () => {
  it('asks nothing when nothing was asked', async () => {
    const seen: RecallRequest[] = [];
    await runRecall({ description: '  ', provider: providerReturning(ANSWER, seen) });
    assert.equal(seen.length, 0);
  });

  it('caps the description', async () => {
    const seen: RecallRequest[] = [];
    await runRecall({ description: 'x'.repeat(2000), provider: providerReturning(ANSWER, seen) });
    assert.equal(seen[0].description.length, MAX_DESCRIPTION_LENGTH);
  });

  it('reports a provider failure as unavailable, not as a crash', async () => {
    const provider: RecallProvider = { recall: () => Promise.reject(new Error('offline')) };
    await assert.rejects(
      runRecall({ description: 'folds an array', provider }),
      (error: unknown) => error instanceof ReviewUnavailableError,
    );
  });
});

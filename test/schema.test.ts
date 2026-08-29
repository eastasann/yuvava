import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { REVIEW_OUTPUT_SCHEMA, extractJsonObject, parseReviewResponse } from '../src/core/schema.js';

describe('parseReviewResponse', () => {
  it('accepts a well-formed review', () => {
    const result = parseReviewResponse(
      JSON.stringify({
        issues: [
          {
            file: 'src/a.ts',
            line: 12,
            endLine: 14,
            severity: 'warning',
            category: 'edge-case',
            message: 'items may be undefined here.',
            symbol: 'items',
          },
        ],
      }),
    );
    assert.deepEqual(result.problems, []);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].endLine, 14);
    assert.equal(result.issues[0].symbol, 'items');
  });

  it('treats an empty issue list as a valid, silent review', () => {
    const result = parseReviewResponse('{"issues": []}');
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.problems, []);
  });

  it('treats a missing issue list as a silent review', () => {
    const result = parseReviewResponse('{}');
    assert.deepEqual(result.issues, []);
    assert.deepEqual(result.problems, []);
  });

  it('recovers JSON wrapped in prose or a fence', () => {
    const fenced = parseReviewResponse('Here you go:\n```json\n{"issues": []}\n```\nHope that helps.');
    assert.deepEqual(fenced.issues, []);
    assert.deepEqual(fenced.problems, []);
  });

  it('does not mistake backticks inside a message for a code fence', () => {
    const payload = JSON.stringify({
      issues: [
        {
          file: 'a.ts',
          line: 1,
          severity: 'warning',
          category: 'edge-case',
          message: 'Guard the empty case.\n```ts\nreturn 0;\n```',
        },
      ],
    });
    const result = parseReviewResponse(payload);
    assert.deepEqual(result.problems, []);
    assert.equal(result.issues.length, 1);
  });

  it('reports malformed JSON instead of throwing', () => {
    const result = parseReviewResponse('{"issues": [1, 2,]}');
    assert.deepEqual(result.issues, []);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /not valid JSON/);
  });

  it('reports a truncated response instead of throwing', () => {
    const result = parseReviewResponse('{"issues": [');
    assert.deepEqual(result.issues, []);
    assert.match(result.problems[0], /no JSON object/);
  });

  it('reports a response with no JSON at all', () => {
    const result = parseReviewResponse('I could not review this.');
    assert.deepEqual(result.issues, []);
    assert.match(result.problems[0], /no JSON object/);
  });

  it('rejects an empty response', () => {
    assert.equal(parseReviewResponse('').issues.length, 0);
    assert.equal(parseReviewResponse('   ').problems.length, 1);
  });

  it('rejects a non-object payload', () => {
    assert.match(parseReviewResponse('[1,2,3]').problems[0], /no JSON object/);
    assert.match(parseReviewResponse('{"issues": "nope"}').problems[0], /not an array/);
  });

  it('drops individual malformed issues and keeps the rest', () => {
    const result = parseReviewResponse(
      JSON.stringify({
        issues: [
          { file: 'a.ts', line: 1, severity: 'warning', category: 'c', message: 'ok message here' },
          null,
          { line: 2, severity: 'warning', category: 'c', message: 'no file' },
          { file: 'a.ts', severity: 'warning', category: 'c', message: 'no line' },
          { file: 'a.ts', line: 0, severity: 'warning', category: 'c', message: 'zero line' },
          { file: 'a.ts', line: 3, severity: 'fatal', category: 'c', message: 'bad severity' },
          { file: 'a.ts', line: 4, severity: 'info', category: 'c', message: '   ' },
        ],
      }),
    );
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].message, 'ok message here');
    assert.equal(result.problems.length, 6);
  });

  it('coerces a numeric string line and defaults endLine and category', () => {
    const result = parseReviewResponse(
      JSON.stringify({
        issues: [{ file: 'a.ts', line: '7', severity: 'error', message: 'something is wrong here' }],
      }),
    );
    assert.equal(result.issues[0].line, 7);
    assert.equal(result.issues[0].endLine, 7);
    assert.equal(result.issues[0].category, 'observation');
  });

  it('never lets endLine precede line', () => {
    const result = parseReviewResponse(
      JSON.stringify({
        issues: [{ file: 'a.ts', line: 10, endLine: 2, severity: 'info', category: 'c', message: 'backwards range' }],
      }),
    );
    assert.equal(result.issues[0].endLine, 10);
  });
});

describe('extractJsonObject', () => {
  it('returns undefined for empty input', () => {
    assert.equal(extractJsonObject(''), undefined);
    assert.equal(extractJsonObject('   \n '), undefined);
  });

  it('finds an object embedded in prose', () => {
    assert.equal(extractJsonObject('blah {"a":1} blah'), '{"a":1}');
  });
});

describe('REVIEW_OUTPUT_SCHEMA', () => {
  it('offers no field in which code could be returned', () => {
    const properties = REVIEW_OUTPUT_SCHEMA.properties.issues.items.properties;
    assert.deepEqual(Object.keys(properties).sort(), [
      'category',
      'endLine',
      'file',
      'line',
      'message',
      'severity',
      'symbol',
    ]);
    assert.equal(REVIEW_OUTPUT_SCHEMA.properties.issues.items.additionalProperties, false);
  });
});

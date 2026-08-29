import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_MESSAGE_LENGTH, looksLikeCode, sanitizeMessage } from '../src/core/sanitize.js';

describe('sanitizeMessage', () => {
  it('keeps an ordinary observation untouched', () => {
    const result = sanitizeMessage('items may be undefined when the response has no body.');
    assert.equal(result.message, 'items may be undefined when the response has no body.');
    assert.equal(result.removedCode, false);
    assert.equal(result.truncated, false);
  });

  it('keeps Japanese observations untouched', () => {
    const result = sanitizeMessage('items が undefined のケースを考慮していません。');
    assert.equal(result.message, 'items が undefined のケースを考慮していません。');
    assert.equal(result.removedCode, false);
  });

  it('strips a fenced replacement implementation', () => {
    const result = sanitizeMessage(
      'items may be undefined.\n```ts\nif (!items) {\n  return 0;\n}\n```\nConsider that case.',
    );
    assert.equal(result.removedCode, true);
    assert.ok(result.message !== undefined);
    assert.ok(!result.message.includes('return 0'));
    assert.ok(!result.message.includes('```'));
    assert.match(result.message, /items may be undefined/);
  });

  it('strips an unterminated fence', () => {
    const result = sanitizeMessage('This branch is unhandled.\n```\nconst x = compute(items)');
    assert.equal(result.removedCode, true);
    assert.equal(result.message, 'This branch is unhandled.');
  });

  it('strips bare statement lines', () => {
    const result = sanitizeMessage('The null case is unhandled.\nconst total = items.length;\nPlease check it.');
    assert.equal(result.removedCode, true);
    assert.equal(result.message, 'The null case is unhandled. Please check it.');
  });

  it('drops a message that was nothing but code', () => {
    const result = sanitizeMessage('```ts\nfunction total(items) { return items.length; }\n```');
    assert.equal(result.message, undefined);
    assert.equal(result.removedCode, true);
  });

  it('flattens multi-line output to a single line', () => {
    const result = sanitizeMessage('First point about the bug\nsecond point about the bug');
    assert.equal(result.message, 'First point about the bug second point about the bug');
  });

  it('truncates an essay', () => {
    const long = 'This is a long observation about a real problem. '.repeat(30);
    const result = sanitizeMessage(long);
    assert.equal(result.truncated, true);
    assert.ok(result.message !== undefined);
    assert.ok(result.message.length <= MAX_MESSAGE_LENGTH + 1);
    assert.ok(result.message.endsWith('…'));
  });

  it('drops content that is too short to mean anything', () => {
    assert.equal(sanitizeMessage('bug').message, undefined);
    assert.equal(sanitizeMessage('').message, undefined);
  });
});

describe('looksLikeCode', () => {
  it('recognises statements and diff fragments', () => {
    assert.ok(looksLikeCode('const x = 1;'));
    assert.ok(looksLikeCode('  if (!items) {'));
    assert.ok(looksLikeCode('}'));
    assert.ok(looksLikeCode('+  return null;'));
    assert.ok(looksLikeCode('diff --git a/x b/x'));
    assert.ok(looksLikeCode('@@ -1,2 +1,3 @@'));
  });

  it('does not mistake prose for code', () => {
    assert.equal(looksLikeCode('if the response has no body, items is undefined.'), false);
    assert.equal(looksLikeCode('return values are not checked here.'), false);
    assert.equal(looksLikeCode('The reduce() call assumes a non-empty array.'), false);
    assert.equal(looksLikeCode('items が undefined の可能性があります。'), false);
    assert.equal(looksLikeCode('- items may be undefined'), false);
    assert.equal(looksLikeCode(''), false);
  });
});

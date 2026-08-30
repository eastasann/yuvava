/**
 * The a/b/c rule for hints (issue #6, SPEC §8).
 *
 *   a. a signature — allowed, SPEC §9 asks for it by name
 *   b. a skeleton with the decision left out — allowed
 *   c. code that would run as written — refused
 *
 * And the thing these tests exist to protect: relaxing the hint path must not
 * relax the review path. The last suite here is the tripwire for that;
 * `test/sanitize.test.ts` is the rest of it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_HINT_CODE_LINES,
  MAX_HINT_LENGTH,
  hasHole,
  isPermittedFragment,
  isSignature,
  sanitizeHint,
} from '../src/core/hintSanitize.js';
import { sanitizeMessage } from '../src/core/sanitize.js';

const SIGNATURE_HINT = 'You have used this before:\n```\nreduce(callbackFn, initialValue?)\n```';
const SKELETON_HINT =
  'The shape is the easy part:\n```js\ntry { … } catch (e) { /* which failures are worth retrying? */ }\n```';
const WORKING_CODE_HINT =
  'Here is the fix:\n```js\nconst total = items.reduce((sum, item) => sum + item.price, 0);\n```';

describe('isSignature', () => {
  it('recognises a bare signature', () => {
    assert.equal(isSignature('reduce(callbackFn, initialValue?)'), true);
    assert.equal(isSignature('URLSearchParams.set(name, value)'), true);
    assert.equal(isSignature('fetch(input, init?): Promise<Response>'), true);
  });

  it('refuses anything with a body', () => {
    assert.equal(isSignature('function total(items) { return 1; }'), false);
    assert.equal(isSignature('const x = f(1)'), false);
    assert.equal(isSignature('f(1)\ng(2)'), false);
  });
});

describe('hasHole', () => {
  it('counts an ellipsis and a question in a comment', () => {
    assert.equal(hasHole('try { … } catch (e) {}'), true);
    assert.equal(hasHole('if (...) { }'), true);
    assert.equal(hasHole('// what is the base case here?'), true);
    assert.equal(hasHole('# 何を判定する？'), true);
  });

  it('does not mistake a spread operator for a gap', () => {
    assert.equal(hasHole('const merged = { ...defaults, ...options };'), false);
  });

  it('does not count a statement of fact as a hole', () => {
    assert.equal(hasHole('const total = a + b; // adds them'), false);
  });
});

describe('isPermittedFragment', () => {
  it('allows a signature (a)', () => {
    assert.equal(isPermittedFragment('reduce(callbackFn, initialValue?)'), true);
  });

  it('allows a skeleton with the decision left out (b)', () => {
    assert.equal(
      isPermittedFragment('try { … } catch (e) { /* which failures are worth retrying? */ }'),
      true,
    );
  });

  it('refuses code that would run as written (c)', () => {
    assert.equal(
      isPermittedFragment('const total = items.reduce((sum, item) => sum + item.price, 0);'),
      false,
    );
  });

  it('refuses a fragment long enough to be an implementation', () => {
    const tooMany = Array.from({ length: MAX_HINT_CODE_LINES + 1 }, () => 'doSomething(); // …').join('\n');
    assert.equal(isPermittedFragment(tooMany), false);
  });

  it('refuses a fragment past the character cap even with a hole in it', () => {
    assert.equal(isPermittedFragment(`// …\n${'a'.repeat(400)}`), false);
  });
});

describe('sanitizeHint', () => {
  it('keeps a signature, on one line, in backticks', () => {
    const result = sanitizeHint(SIGNATURE_HINT);
    assert.ok(result.text);
    assert.match(result.text, /`reduce\(callbackFn, initialValue\?\)`/);
    assert.equal(result.removedCode, false);
    assert.doesNotMatch(result.text, /\n/);
  });

  it('keeps a skeleton with its hole intact', () => {
    const result = sanitizeHint(SKELETON_HINT);
    assert.ok(result.text);
    assert.match(result.text, /…/);
    assert.match(result.text, /which failures are worth retrying\?/);
    assert.equal(result.removedCode, false);
  });

  it('throws away working code and says so', () => {
    const result = sanitizeHint(WORKING_CODE_HINT);
    assert.equal(result.removedCode, true);
    assert.ok(result.text);
    assert.doesNotMatch(result.text, /reduce\(/);
    assert.match(result.text, /Here is the fix/);
  });

  it('keeps at most one fragment, however many the model sent', () => {
    const two = `${SIGNATURE_HINT}\nand also:\n\`\`\`\nmap(callbackFn)\n\`\`\``;
    const result = sanitizeHint(two);
    assert.ok(result.text);
    assert.equal((result.text.match(/`/g) ?? []).length, 2);
    assert.equal(result.removedCode, true);
  });

  it('drops statement-shaped lines that were never fenced', () => {
    const result = sanitizeHint('Think about the empty case.\nconst first = items[0];');
    assert.ok(result.text);
    assert.doesNotMatch(result.text, /items\[0\]/);
    assert.equal(result.removedCode, true);
  });

  it('yields nothing when nothing survives', () => {
    assert.equal(sanitizeHint(WORKING_CODE_HINT.split('\n').slice(1).join('\n')).text, undefined);
    assert.equal(sanitizeHint('').text, undefined);
    assert.equal(sanitizeHint(undefined).text, undefined);
    assert.equal(sanitizeHint(42).text, undefined);
  });

  it('caps a hint that turned into an essay', () => {
    const result = sanitizeHint('word '.repeat(400));
    assert.ok(result.text);
    assert.equal(result.truncated, true);
    assert.ok(result.text.length <= MAX_HINT_LENGTH + 1);
  });
});

describe('relaxing the hint path did not relax the review path', () => {
  it('still strips from a review message everything a hint may keep', () => {
    for (const hint of [SIGNATURE_HINT, SKELETON_HINT, WORKING_CODE_HINT]) {
      const review = sanitizeMessage(hint);
      assert.equal(review.removedCode, true, 'a review message must lose its code');
      if (review.message !== undefined) {
        assert.doesNotMatch(review.message, /```/);
        assert.doesNotMatch(review.message, /reduce\(callbackFn/);
        assert.doesNotMatch(review.message, /catch \(e\)/);
      }
    }
  });

  it('leaves the review sanitiser with no way to reach the hint rules', () => {
    // A skeleton is exactly what a review must never carry: it is the shape of
    // a fix. `sanitizeMessage` has no parameter that could turn this on.
    assert.equal(sanitizeMessage.length, 1);
  });
});

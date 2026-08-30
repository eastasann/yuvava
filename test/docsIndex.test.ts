/**
 * Documentation navigation (SPEC §10, issue #8).
 *
 * The guarantee being defended: if Navigator shows a link, it exists — because
 * every link comes from the index, never from the model. These tests pin that,
 * that an unresolved term falls back to being a term, that a network failure
 * costs nothing, and that Navigator does not read the page for the developer.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DOCS_TIMEOUT_MS,
  MAX_DOCS_LINKS,
  MdnDocsIndex,
  mdnDocumentUrl,
  resolveDocsLinks,
  type DocsIndex,
} from '../src/core/docsIndex.js';

const MDN_SUMMARY = 'The timeout() static method returns an AbortSignal that will automatically abort.';

function jsonFetch(body: unknown, status = 200): typeof globalThis.fetch {
  return (() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })) as unknown as typeof globalThis.fetch;
}

const ONE_HIT = {
  documents: [
    {
      mdn_url: '/en-US/docs/Web/API/AbortSignal/timeout_static',
      title: 'AbortSignal: timeout() static method',
      summary: MDN_SUMMARY,
    },
  ],
};

describe('mdnDocumentUrl', () => {
  it('builds an absolute MDN URL from a document path', () => {
    assert.equal(
      mdnDocumentUrl('/en-US/docs/Web/API/AbortSignal'),
      'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal',
    );
  });

  it('refuses anything that is not an MDN document path', () => {
    for (const hostile of [
      'https://example.invalid/phish',
      '//example.invalid/phish',
      'en-US/docs/Web',
      '',
      42,
      undefined,
    ]) {
      assert.equal(mdnDocumentUrl(hostile), undefined, `accepted ${String(hostile)}`);
    }
  });
});

describe('MdnDocsIndex', () => {
  it('resolves a term to the first document, by title and URL', async () => {
    const index = new MdnDocsIndex({ fetch: jsonFetch(ONE_HIT) });
    const link = await index.resolve('AbortSignal timeout');
    assert.deepEqual(link, {
      term: 'AbortSignal timeout',
      title: 'AbortSignal: timeout() static method',
      url: 'https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static',
    });
  });

  it('does not carry the page summary, so the reading is left to the developer', async () => {
    const index = new MdnDocsIndex({ fetch: jsonFetch(ONE_HIT) });
    const link = await index.resolve('AbortSignal timeout');
    assert.ok(link);
    assert.equal(JSON.stringify(link).includes(MDN_SUMMARY), false);
    assert.deepEqual(Object.keys(link).sort(), ['term', 'title', 'url']);
  });

  it('queries the index rather than guessing a URL', async () => {
    const seen: string[] = [];
    const index = new MdnDocsIndex({
      fetch: ((url: string) => {
        seen.push(url);
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(ONE_HIT) });
      }) as unknown as typeof globalThis.fetch,
    });
    await index.resolve('URLSearchParams set');
    assert.match(seen[0], /^https:\/\/developer\.mozilla\.org\/api\/v1\/search\?q=URLSearchParams%20set/);
  });

  it('gives up quietly on every kind of bad answer', async () => {
    const bad: unknown[] = [
      {},
      { documents: [] },
      { documents: 'nope' },
      { documents: [{ mdn_url: 'https://example.invalid/x', title: 'Elsewhere' }] },
      { documents: [{ mdn_url: '/en-US/docs/Web', title: '' }] },
    ];
    for (const body of bad) {
      const index = new MdnDocsIndex({ fetch: jsonFetch(body) });
      assert.equal(await index.resolve('anything'), undefined, `accepted ${JSON.stringify(body)}`);
    }
  });

  it('gives up quietly on an HTTP error and on a thrown request', async () => {
    assert.equal(await new MdnDocsIndex({ fetch: jsonFetch({}, 503) }).resolve('x'), undefined);
    const throwing = (() => Promise.reject(new Error('offline'))) as unknown as typeof globalThis.fetch;
    assert.equal(await new MdnDocsIndex({ fetch: throwing }).resolve('x'), undefined);
  });

  it('does not call out for an empty term', async () => {
    let called = false;
    const index = new MdnDocsIndex({
      fetch: (() => {
        called = true;
        return Promise.reject(new Error('should not happen'));
      }) as unknown as typeof globalThis.fetch,
    });
    assert.equal(await index.resolve('   '), undefined);
    assert.equal(called, false);
  });

  it('abandons a lookup that hangs, rather than holding up the answer', async () => {
    const hanging = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof globalThis.fetch;
    const index = new MdnDocsIndex({ fetch: hanging, timeoutMs: 5 });
    assert.equal(await index.resolve('anything'), undefined);
    assert.ok(DOCS_TIMEOUT_MS > 0);
  });
});

describe('resolveDocsLinks', () => {
  const index: DocsIndex = {
    resolve: (term) =>
      Promise.resolve(
        term.startsWith('mdn')
          ? { term, title: `Page for ${term}`, url: `https://developer.mozilla.org/en-US/docs/${term}` }
          : undefined,
      ),
  };

  it('resolves what it can and leaves the rest as terms', async () => {
    const links = await resolveDocsLinks(index, ['mdn fetch', 'some framework thing']);
    assert.equal(links.size, 1);
    assert.ok(links.get('mdn fetch'));
    assert.equal(links.get('some framework thing'), undefined);
  });

  it('never presents a wall of links', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `mdn thing ${i}`);
    const links = await resolveDocsLinks(index, many);
    assert.equal(links.size, MAX_DOCS_LINKS);
  });

  it('survives an index that throws', async () => {
    const broken: DocsIndex = { resolve: () => Promise.reject(new Error('boom')) };
    assert.equal((await resolveDocsLinks(broken, ['mdn fetch'])).size, 0);
  });

  it('does nothing at all when there is nothing to resolve', async () => {
    assert.equal((await resolveDocsLinks(index, [])).size, 0);
    assert.equal((await resolveDocsLinks(index, ['mdn fetch'], { max: 0 })).size, 0);
  });
});

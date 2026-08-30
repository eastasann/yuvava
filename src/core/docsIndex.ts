/**
 * Turning a search term into a documentation link — from an index, never from
 * the model (SPEC §10, issue #8).
 *
 * The rule this module exists to keep: **if Navigator shows something as a
 * link, it exists.** Models emit plausible URLs that 404, and section anchors
 * are worse, because documentation is reorganised after a training cut-off.
 * One invented link destroys the guarantee for every real one, so the model is
 * never asked for a URL and its output is stripped of them
 * (`guidanceSchema.ts`); links come from here.
 *
 * The index is MDN's own search API, and only that. It is free, needs no key,
 * and is authoritative for what it covers. It covers the web platform and
 * JavaScript, which is most of what "what is this API called" is about; for
 * everything else a term stays a term, which is still useful. The alternative
 * — a general search API — means a key, a setting, and a quota, for a tool
 * with one user.
 *
 * Nothing here reads a page. The title and the URL are taken; MDN's `summary`
 * field is deliberately ignored, because summarising the documentation is what
 * SPEC §10.3 asks Navigator not to do.
 */

/** SPEC §10.2: do not present a wall of links. */
export const MAX_DOCS_LINKS = 3;

/** A slow lookup is worse than no lookup; the term alone still works. */
export const DOCS_TIMEOUT_MS = 2000;

const MDN_ORIGIN = 'https://developer.mozilla.org';
const MDN_SEARCH = `${MDN_ORIGIN}/api/v1/search`;

export interface DocsLink {
  /** The search term this was resolved from. Always shown. */
  readonly term: string;
  /** The page title as the index gives it. Never a summary of the page. */
  readonly title: string;
  readonly url: string;
}

export interface DocsIndex {
  resolve(term: string, signal?: AbortSignal): Promise<DocsLink | undefined>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds the absolute URL for an index result.
 *
 * Exported because it is the whole of "the URL came from the index": anything
 * that is not an MDN document path is refused, so a compromised or changed
 * response cannot become a link to somewhere else.
 */
export function mdnDocumentUrl(mdnPath: unknown): string | undefined {
  if (typeof mdnPath !== 'string' || !mdnPath.startsWith('/') || mdnPath.startsWith('//')) {
    return undefined;
  }
  const url = `${MDN_ORIGIN}${mdnPath}`;
  return url.startsWith(`${MDN_ORIGIN}/`) ? url : undefined;
}

export class MdnDocsIndex implements DocsIndex {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DOCS_TIMEOUT_MS;
  }

  async resolve(term: string, signal?: AbortSignal): Promise<DocsLink | undefined> {
    const query = term.trim();
    if (query.length === 0) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const relay = (): void => controller.abort();
    signal?.addEventListener('abort', relay);

    try {
      const response = await this.fetchImpl(
        `${MDN_SEARCH}?q=${encodeURIComponent(query)}&locale=en-US`,
        { signal: controller.signal, headers: { accept: 'application/json' } },
      );
      if (!response.ok) {
        return undefined;
      }
      const body: unknown = await response.json();
      if (!isRecord(body) || !Array.isArray(body.documents)) {
        return undefined;
      }
      const first: unknown = body.documents[0];
      if (!isRecord(first)) {
        return undefined;
      }
      const url = mdnDocumentUrl(first.mdn_url);
      const title = typeof first.title === 'string' ? first.title.trim() : '';
      // `first.summary` is available here and is deliberately not used: SPEC
      // §10.3 leaves the reading to the developer.
      return url === undefined || title.length === 0 ? undefined : { term: query, title, url };
    } catch {
      // Offline, proxied, rate limited, or malformed. The term still works.
      return undefined;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', relay);
    }
  }
}

/**
 * Resolves what it can, in parallel, and gives up quietly on the rest.
 *
 * Terms that did not resolve are simply absent from the map — the caller shows
 * them as search terms, which is what SPEC §10.3 wants anyway: the developer
 * can always run the search themselves.
 */
export async function resolveDocsLinks(
  index: DocsIndex,
  terms: readonly string[],
  options: { max?: number; signal?: AbortSignal } = {},
): Promise<ReadonlyMap<string, DocsLink>> {
  const limit = Math.max(0, options.max ?? MAX_DOCS_LINKS);
  const resolved = new Map<string, DocsLink>();
  if (limit === 0 || terms.length === 0) {
    return resolved;
  }

  const settled = await Promise.all(
    terms.slice(0, limit).map(async (term) => {
      try {
        return await index.resolve(term, options.signal);
      } catch {
        return undefined;
      }
    }),
  );

  for (const link of settled) {
    if (link !== undefined) {
      resolved.set(link.term, link);
    }
  }
  return resolved;
}

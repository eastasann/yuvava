/**
 * Turning a search term into something a browser can open.
 *
 * SPEC §10 asks Navigator to lead the developer to the documentation rather
 * than to recite it, and §10.3 asks it not to foreclose what they find on the
 * way. A plain web search does both: the developer sees the whole result page,
 * not the one link Navigator would have picked.
 */

/** Chosen because it needs no account and no key, and does not personalise. */
const SEARCH_ENDPOINT = 'https://duckduckgo.com/?q=';

export function searchUrl(term: string): string {
  return SEARCH_ENDPOINT + encodeURIComponent(term.trim());
}

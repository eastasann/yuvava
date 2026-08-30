/**
 * The eval set for the question paths (SPEC §9, §10).
 *
 * `cases.ts` covers review. This covers the other two, because §7 is a claim
 * about the whole product's restraint and not about one command — see the
 * "what is at the centre" entry in `DECISIONS.md`.
 *
 * **Everything here is invented**, for the same reason the review cases are
 * (`LOOP.md` §2.2): this repository is public.
 *
 * What failure looks like differs by path, and that is the interesting part:
 *
 *   guidance  fails by being *vague*. "Your task involves error handling,
 *             state management and testing" is true and worthless, and §7
 *             names exactly that as the thing to suppress.
 *   recall    fails by *guessing*. §9's prompt says to return nothing rather
 *             than offer three things it might have been, because handing
 *             three names to someone trying to remember one takes the
 *             remembering away.
 */

/** One thing an answer is expected to name. Any of `mentions` will do. */
export interface QuestionExpectation {
  readonly mentions: readonly string[];
}

export interface GuidanceCase {
  readonly id: string;
  readonly question: string;
  readonly expected: readonly QuestionExpectation[];
  /**
   * Words that are true of almost any task, and so tell the developer nothing.
   * Their presence is what "noise" means on this path.
   *
   * Not "anything I did not predict": a question can legitimately surface a
   * topic the case did not list, and counting that as noise would punish the
   * model for being more useful than the fixture.
   */
  readonly vague: readonly string[];
  /** True when the correct answer is empty (SPEC §7, and the prompt says so). */
  readonly silent: boolean;
}

export interface RecallCase {
  readonly id: string;
  readonly description: string;
  readonly expected: readonly QuestionExpectation[];
  readonly silent: boolean;
}

/** Generic enough to be true of anything, which is why they are worthless. */
const FILLER = [
  'error handling',
  'state management',
  'testing',
  'best practice',
  'performance',
  'maintainability',
  'documentation',
];

export const GUIDANCE_CASES: readonly GuidanceCase[] = [
  {
    id: 'fetch-retry',
    question: 'add a retry to fetch',
    expected: [
      { mentions: ['backoff', 'exponential'] },
      { mentions: ['idempoten', '4xx', '5xx', 'which failures', 'retryable'] },
    ],
    vague: FILLER,
    silent: false,
  },
  {
    id: 'cancel-in-flight',
    question: 'cancel a request when the user types again',
    expected: [
      { mentions: ['abort', 'AbortController', 'AbortSignal'] },
      { mentions: ['debounce', 'race', 'stale', 'out of order', 'last one'] },
    ],
    vague: FILLER,
    silent: false,
  },
  {
    id: 'parse-api-date',
    question: 'parse a date string coming back from an API',
    expected: [
      { mentions: ['ISO 8601', 'ISO-8601', 'ISO'] },
      { mentions: ['time zone', 'timezone', 'UTC', 'offset'] },
    ],
    vague: FILLER,
    silent: false,
  },
  {
    id: 'silent-no-referent',
    question: 'make this better',
    expected: [],
    vague: FILLER,
    // Nothing has been pointed at, so there is nothing specific to name. The
    // prompt says to return empty lists rather than guess.
    silent: true,
  },
  {
    id: 'silent-not-a-question',
    question: 'thanks, that helped',
    expected: [],
    vague: FILLER,
    silent: true,
  },
];

export const RECALL_CASES: readonly RecallCase[] = [
  {
    id: 'fold-an-array',
    description: 'walks an array in order and folds it into a single value',
    expected: [{ mentions: ['reduce'] }],
    silent: false,
  },
  {
    id: 'query-string',
    description: 'builds and reads the query string part of a URL',
    expected: [{ mentions: ['URLSearchParams'] }],
    silent: false,
  },
  {
    id: 'wait-for-all',
    description: 'waits for several promises and gives every outcome, failures included',
    expected: [{ mentions: ['allSettled'] }],
    silent: false,
  },
  {
    id: 'silent-unidentifiable',
    description: 'the thing that does the stuff with the data',
    expected: [],
    // §9: return an empty list rather than guessing at three things it might
    // have been. Offering three names to someone trying to remember one is the
    // failure this path has.
    silent: true,
  },
];

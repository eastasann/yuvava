# Decisions

Why the current durable design choices were made — the `why` half of the
repository's memory (`LOOP.md` §2.1). Decisions a future agent would otherwise
re-litigate. Small choices are not recorded here; the code is.

Read this before proposing an architecture change: the answer to "why not X?"
is often already below. If a decision here is overturned, rewrite the entry and
say what changed — do not delete it silently.

## Decision: The core is a `vscode`-free module, and that boundary is tested

Everything that decides *what the developer sees* — diff parsing, the prompt,
response validation, sanitising, anchoring, range placement — lives in
`src/core/` and imports no editor API. `src/vscode/` is a thin adapter.

Reason:
The interesting behaviour is testable without an extension host (none is
available in CI here, and `@vscode/test-electron` needs a display). It also
makes SPEC §16 structurally checkable: code that cannot reach a `TextDocument`
cannot edit one.

Alternatives considered:
- One `extension.ts` with everything in it, tested via `@vscode/test-electron`.

Why this choice:
Faster verification, and the invariant becomes a property of the architecture
rather than a promise. `test/invariant.test.ts` fails if `src/core/` ever
imports `vscode`.

## Decision: Review output is VS Code Diagnostics, and nothing else

Reason:
SPEC §12 wants Navigator to disappear into the editor and behave like a
slightly smarter linter. A diagnostic describes a location; it cannot change
one, so the output channel is also the safety boundary.

Alternatives considered:
- Webview panel, chat participant, output-channel report.

Why this choice:
Diagnostics land in the Problems panel and inline, cost no new UI, and are
inherently read-only. A chat UI would also have pulled the product toward
"ask the AI", which SPEC §12.3 explicitly rejects.

## Decision: No Quick Fix, no code action, ever

Reason:
SPEC §16. A code action is the natural next step for a diagnostic, which is
exactly why its absence has to be deliberate and enforced.

Why this choice:
`test/invariant.test.ts` fails the build if the source ever mentions a code
action, completion, formatting or rename provider, `WorkspaceEdit`,
`applyEdit`, `TextEdit`, `workspace.fs`, a filesystem write, or a command whose
name contains "apply", "fix", "generate", "refactor" or "implement".

## Decision: Defence against code generation is structural, not just prompted

The response schema has no field that could hold code (`message` is the only
prose channel), and every message is run through `src/core/sanitize.ts`, which
strips fenced blocks and statement-shaped lines, flattens the result to one
line, and caps it at 320 characters.

Reason:
SPEC §16 asks for the constraint not to depend on prompt text alone. A model
that ignores "do not write code" still cannot deliver a usable patch through a
single flattened 320-character sentence.

## Decision: Structured output via `output_config.format`, validated again locally

The Anthropic request pins a JSON schema; the response is still parsed and
validated field by field in `src/core/schema.ts`.

Reason:
LOOP.md §14. Schema enforcement is a server-side promise, not a local
guarantee, and the extension must survive a truncated, fenced, or nonsense
response. Every malformed shape yields zero observations plus a log note.

## Decision: Observations must land inside the reviewed hunks

An issue whose file is not in the diff, or whose line falls outside a hunk, is
discarded rather than relocated.

Reason:
SPEC §7 — a misplaced warning is worse than a missing one. The model is given
a diff annotated with new-file line numbers in the gutter precisely so it can
cite real lines; if it does not, the issue was probably not grounded either.

## Decision: Git access is read-only by construction

`src/core/git.ts` is the only module that spawns a process, it always spawns
the literal `git`, and it refuses any subcommand outside
`{diff, ls-files, rev-parse, status}`.

Reason:
An allowlist is checkable; "we only run safe commands" is not.

Consequence:
`git add -N` — the usual way to make untracked files appear in `git diff` — is
a write, so it is not available. See the next decision for how new files are
reviewed instead.

## Decision: Untracked files are reviewed via a synthesised diff, not `git add -N`

`git ls-files --others --exclude-standard -z` lists them, each file is read,
and `src/core/untracked.ts` renders it as a `new file` hunk in which every line
is an addition. The result is concatenated with the tracked diff, so parsing,
prompting and anchoring stay unaware that two sources exist.

Reason:
A newly written file is exactly the code most worth a second pair of eyes, and
excluding it made the review blind to the common case of "I just wrote this".
The obvious implementation, `git add -N`, writes to the index — refused by the
allowlist in `src/core/git.ts` and by the invariant test.

Guards:
`--exclude-standard` means `.gitignore` is honoured, so ignored build output
never reaches the model. Individual files are skipped when they are empty,
binary (a NUL byte in the first 8 KB), or over 64 KiB, and the set as a whole
is capped at half the diff budget — a stray untracked data dump degrades the
review to a skip note rather than failing it. Content lines are `+`-prefixed,
so a file that itself contains diff syntax cannot forge a hunk header.

Escape hatch:
`navigator.includeUntracked`, default true.

## Decision: Distribution is a locally built `.vsix`, not the Marketplace

`npm run install:local` verifies, packages, and installs with
`code --install-extension yuvava.vsix --force`.

Reason:
Navigator is being operated by the person who develops it. A Marketplace
listing would add a publisher account, a release process and a review cycle to
a tool with one user, and none of that makes the reviews better.

Consequences:
- `publisher` in `package.json` stays the placeholder `navigator`, so the
  extension id is `navigator.yuvava`. Do not invent a real-looking publisher
  id; it has to be one actually registered on the Marketplace, and only the
  owner can create it.
- Updates are manual by nature — VS Code auto-updates Marketplace extensions
  only. `--force` is required so a rebuild can replace an identical version
  number, and the new build is inert until the window is reloaded.
- The API key lives in secret storage keyed by the extension id, so changing
  `publisher` or `name` orphans it. That is the migration cost of ever
  publishing, and it is small: re-run `Navigator: Set API Key`.

## Decision: The API key lives in VS Code secret storage, not settings

`navigator.setApiKey` stores it via `context.secrets`; `ANTHROPIC_API_KEY` from
the environment is the fallback.

Reason:
A settings-backed key ends up in synced or committed JSON.

## Decision: The provider is swappable; the guarantees are not

`navigator.provider` selects Anthropic (default) or OpenAI, built by
`src/core/providerFactory.ts` behind the existing `ReviewProvider` interface.
Both send the same system prompt and the same JSON schema, and both responses
go through the same validation, anchoring and sanitising.

Reason:
Which model reads the diff is a preference, and people have accounts with one
or the other. What Navigator is allowed to do with the answer is not a
preference, so it lives entirely on Navigator's side of the seam rather than in
either provider.

Consequences:
- The response schema now marks every field `required`, with `endLine`
  repeating `line` and `symbol` allowed to be empty, because OpenAI strict mode
  requires `required` to list every property. One schema serves both; the
  validator already treats those empty values as absent.
- API keys are stored per provider (`navigator.anthropicApiKey` /
  `navigator.openaiApiKey`), with `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` as
  environment fallbacks. Selecting a provider never reaches for the other's key.
- `test/providerFactory.test.ts` runs the same hostile review — an observation
  with a fenced replacement implementation — through both providers and asserts
  the code is stripped either way.

## Decision: A configured base URL switches to Chat Completions

`navigator.openaiBaseUrl` points the OpenAI provider at any OpenAI-compatible
service. Setting it does not merely change the host — it changes the request to
`/chat/completions`.

Reason:
The Responses API is OpenAI-only. Groq, Cerebras, Ollama, LM Studio and
OpenRouter implement Chat Completions, so a base URL alone would have produced
a 404 against every one of them. Two paths in one provider is the cost of the
feature actually working.

Structured-output support varies across these services, so a rejected schema
falls back once to a plain request. `parseReviewResponse` already tolerates
JSON wrapped in prose or a fence, so the answer is still validated the same
way; the fallback surfaces as a note in the log rather than silently.

Consequence:
Error messages in this provider name no vendor — "the API key was rejected",
not "the OpenAI API key was rejected" — because the endpoint may be Groq or a
process on localhost. The log line above names the provider and base URL.

## Decision: Where the diff goes is the user's decision

Navigator sends the diff to whatever endpoint is configured, and does not
police that choice beyond saying so in the setting description and the README.

Reason:
Navigator is a personal learning tool (`SPEC.md` §3). Free tiers commonly train
on what they receive, which matters, but the person choosing the endpoint is
the person whose code it is. Building data-governance controls into a tool with
one user would be a configuration system for a decision the user already makes
by typing a URL.

Consequence:
The warning belongs where the choice is made — the `navigator.openaiBaseUrl`
description and the README — not in a policy the extension enforces. A local
endpoint is the answer for anyone who needs the guarantee.

## Decision: OpenAI reviews go through the Responses API

`client.responses.create` with `text.format` as a strict `json_schema`, and
`gpt-5.1-codex-max` as the default model.

Reason:
The Responses API is the current surface and the only one that serves the
Codex-family models; a Codex model is the right default for a job that is
entirely diff reading. `status === 'incomplete'` is treated as a failed review
rather than parsed, so a truncated response never becomes half a review.

## Decision: Feedback arrives as GitHub Issues, not as files in the repository

Real-world observations are filed as issues with the `feedback` label
(`.github/ISSUE_TEMPLATE/feedback.md`). Issues are the inbox; the repository
stays the memory. Acting on one means putting the durable part in
`DECISIONS.md`, the unresolved part in `PROGRESS.md`, and closing the issue.

Reason:
Two things a `feedback/` directory got wrong. Filing feedback would have
required a clone, a commit and a push — and feedback that is expensive to file
does not get filed. More seriously, **this repository is public**, and useful
feedback quotes the code that was under review: real work code, published
permanently, with no clean way to remove it from git history. An issue can be
edited or deleted.

This is not an exception to "the repository is the memory" (`LOOP.md` §2.1).
What the next agent needs is the conclusion, not the individual report, and
conclusions still land in the repository. A closed issue can be lost without
losing anything that mattered.

Consequence:
`LOOP.md` §2.2 forbids pasting user code under review into an issue, a
document, or a comment — the pattern is recorded, never the code. The issue
template repeats the rule at the moment of writing, which is when it matters;
a policy file nobody opens would not have.

## Decision: The repository is the persistent memory, not the conversation

`SPEC.md` (what), `LOOP.md` (how), `DECISIONS.md` (why), `PROGRESS.md` (where),
git (history), and GitHub Issues as the feedback inbox. `LOOP.md` §24 makes context
recovery from those files mandatory at the start of every session, and §25
makes a handoff into them mandatory before any loop stops.

Reason:
`LOOP.md` §1 assumes a human is not supervising each iteration, and sessions do
not share context. The first loop produced facts that existed only in
conversation — why the diff heuristic was loosened, which failure paths were
deliberately left untested, that no live API call has ever been made. Anything
in that category is lost at the session boundary, and the next agent pays for it
by re-deriving it, or worse, by not knowing to.

Consequence:
Finishing a loop with green tests is not finishing. `LOOP.md` §27 puts "Loop
Handoff complete" alongside "tests pass" in the Definition of Done, and §29
requires the handoff even when stopping for an escalation or a blocker.

## Decision: Agent instructions live in AGENTS.md, with CLAUDE.md importing it

Reason:
Codex reads `AGENTS.md`, Claude Code reads `CLAUDE.md`. Two files with the same
content drift apart, and the file that drifts is the one that tells an agent
not to break the product invariant. `CLAUDE.md` is three lines and an
`@AGENTS.md` import.

## Decision: `claude-opus-5`, on the beta messages endpoint

`src/core/anthropicProvider.ts` calls `client.beta.messages.create` with
`betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`.

Reason:
Review quality is the whole product, so the strongest model is the right
default (overridable via `navigator.model`). Server-side fallback keeps a
safety-classifier refusal on some unusual diff from turning into a dead
command; a refusal that still arrives is reported as "review unavailable" and
changes nothing in the workspace.

## Decision: No bundler

`vsce package` ships the compiled `out/` plus production dependencies — ~6.9 MB
now that both provider SDKs are included.

Reason:
LOOP.md §6.6. A bundler is a build-time abstraction the MVP does not need, and
the packaged size is unremarkable for an extension.

When to revisit:
Carrying two SDKs so one can be used is the obvious waste. Bundling with
esbuild, or `await import()`ing only the selected provider, are both easy
levers — worth pulling if download size or activation time ever matters, and
not before.

Asked again and answered the same way (issue #21, closed not planned). The
package is 6.94 MB across 5,527 files, of which Navigator's own compiled
output is 152 KB. That ratio is embarrassing and costs nothing: the extension
is installed from a local file, so there is no download, and the SDKs load
when a command runs rather than at activation, so there is no startup cost
either. Bundling would add a build step and a class of failure — SDKs that
require lazily do not always survive tree-shaking — to fix a number nobody is
paying. The trigger stands: a measured cost in download time or activation
time. Not the number itself.

## Decision: The way in is a question box and a QuickPick, not a panel

`Navigator: Where Should I Look?` asks one question in an input box, and shows
the answer in a QuickPick that Escape closes. Nothing is persisted, and there
is no thread to continue.

Reason:
SPEC §8, §9 and §10 all need somewhere for the developer to say what they are
trying to do, and every obvious surface for that is a chat panel — which SPEC
§12.3 rejects outright, because "ask the AI" is the relationship the product
exists to avoid. A QuickPick is the same VS Code primitive as Go to Symbol: it
appears, it is read, it is gone. The absence of history is the feature.

Consequences:
- The command is `navigator.whereToLook`. Command ids and titles are checked by
  `test/invariant.test.ts` against apply/fix/generate/complete/refactor/rewrite/
  accept/patch/implement, and a new command has to stay clear of all of them.
- The answer is topics plus search terms, and nothing else. The schema
  (`src/core/guidanceSchema.ts`) has two fields, neither of which can hold code
  or a link, and both go through the label sanitiser on the way back.
- Guidance needs no git and no workspace folder, so unlike the review command it
  runs with a folder-less window.

## Decision: Navigator never displays a URL a model produced

Model output is stripped of URLs in `sanitizeLabel`, and the guidance schema has
no link field. Links, when they exist at all, come from an index.

Reason:
Models emit plausible URLs that 404 at a meaningful rate, and section anchors
are worse — documentation gets reorganised after the training cut-off. The
guarantee worth having is "it appeared as a link, so it exists". One invented
link destroys that for every real one.

Consequence:
Search *terms* are always shown, resolved or not, so the developer can always
run the search themselves (SPEC §10.3). A term that could not be turned into a
link is still useful; a link that does not resolve is worse than nothing.

## Decision: A search term opens a plain web search, on DuckDuckGo

`src/core/search.ts`, one function.

Reason:
SPEC §10 wants the developer taken to the documentation rather than read it
aloud to, and §10.3 wants what they find on the way left intact. A results page
does both: they see the whole page, not the one link Navigator would have
picked. DuckDuckGo needs no account and no key, which keeps this from becoming
another thing to configure.

When to revisit:
If it ever needs to be configurable, it is one setting and one constant. It is
not one today because nobody has asked.

## Decision: Navigator's own UI strings stay in English

`SPEC.md`, `LOOP.md` and the issues are written in Japanese; every string the
extension shows a user is English, including the ones specified in Japanese in
issue #5 (`Navigator: 調べています` became `Navigator: looking`).

Reason:
The extension already had a dozen user-facing strings, all English, and the
owner shipped them. One Japanese string among them is not localisation, it is
an inconsistency. Doing it properly means `l10n` bundles for every string at
once, which is a real feature nobody has asked for.

What was actually specified in issue #5 was the *wording discipline* — no
emoji, no lecturing, name the topic and let the description be short — and that
is what the QuickPick does.

## Decision: A hint may show a hole, never a fix — and that is a mechanical test

`src/core/hintSanitize.ts` allows a code fragment through the hint path. Three
kinds, from SPEC §8 and §9:

| | Example | Allowed |
| --- | --- | --- |
| a. a signature | `reduce(callbackFn, initialValue?)` | yes — SPEC §9 asks for it |
| b. a skeleton with the decision left out | `try { … } catch (e) { /* which failures are worth retrying? */ }` | yes |
| c. code that would run as written | an implementation | no |

The test for c is not a judgement about intent, it is structural: a fragment is
kept only if it is a bare signature, **or if it still has a hole** — an
ellipsis, a standalone `...`, or a comment containing a question mark. Working
code has none of those. What survives is then flattened to one line, capped at
6 lines and 200 characters before flattening, and only the first fragment in a
hint is considered.

Reason:
SPEC §8 says even Level 3 does not present finished code, and its own examples
are prose. But a hint that may not show the *shape* of a construct often cannot
be given at all, and §9 names a signature as the second rung of recall. The
question was where the line falls, and "does the developer still have something
to work out?" is the only version of it that can be checked by a program.

Why not a stricter rule:
Refusing every fragment is what the review path does, and it makes §9 Level 1
impossible to express. Why not a looser one: anything without a hole is a fix,
and handing over a fix is the one thing this product exists not to do.

Consequences:
- **The review path is untouched.** `anchor.ts` still calls `sanitizeMessage`,
  which still strips every fence and every statement-shaped line.
  `test/hintSanitize.test.ts` runs each of a, b and c through *both* sanitisers
  and asserts the review one destroys all three. Do not merge the two.
- A spread operator (`{ ...rest }`) does not count as a hole, or every object
  literal would qualify. `...` only counts standing alone.
- The prompt tells the model that a runnable fragment is thrown away, so the
  cost of writing one is the whole hint. That is prompt-level encouragement of
  a rule the code enforces regardless.

## Decision: Hints are revealed one at a time, and only by asking

The guidance QuickPick shows topics (SPEC §8 Level 0). `More specific` appends
the next hint and reopens the list. Nothing advances on its own, and closing
the QuickPick discards the position.

Reason:
SPEC §8's purpose is the loop `Hint -> Human thinks -> Human solves`. A
disclosure that advances on a timer, on hover, or all at once is just an answer
delivered in instalments. The developer choosing to go deeper is the part that
matters, so it is the only thing that moves the level.

Consequence:
All the levels arrive in one response, so revealing them costs no extra API
call — the gate is entirely in the UI. That is deliberate: a per-level request
would make hesitation expensive, and hesitation is the behaviour being
protected.

## Decision: Recall enforces "no usage examples" by field, not by prompt

`src/core/recallSchema.ts` validates each of SPEC §9's rungs with a different
sanitiser, chosen for what that rung is allowed to be:

| Field | Sanitiser | Effect |
| --- | --- | --- |
| `name` | `sanitizeLabel` | no code, no URL |
| `signature` | `sanitizeLabel`, then `isSignature` | anything that is not a signature is dropped |
| `concept` | `sanitizeMessage` (the review one) | no code survives at all |
| `search` | `sanitizeLabel` | no code, no URL |

Reason:
SPEC §9's whole point is that the developer retrieves the knowledge from their
own memory, and a usage example is what stops that from happening — it is
copyable, so there is nothing left to remember. Asking the model not to write
one is not a guarantee. A usage example is not signature-shaped, and it does
not survive the review sanitiser, so there is no field it can arrive in.

Consequence:
A model that answers `signature` with `const total = items.reduce(...)` loses
that rung entirely rather than having it shown: the developer sees the name and
the concept, and the log says a signature was dropped. That is the right
failure — a missing rung costs one step, a usage example costs the exercise.

## Decision: One provider object, one method per job

`ReviewProvider.review`, `GuidanceProvider.guide`, `RecallProvider.recall`, all
implemented by the same two classes and composed as `NavigatorProvider`. There
is no general "ask the model anything" method.

Reason:
Every prompt and every schema stays on Navigator's side of the seam. A generic
`complete(system, user, schema)` would be less code and would put the ability to
ask a model an arbitrary question into `src/vscode/`, one call site away from
"and now paste the answer into the editor". The seam is a constraint, not just
an abstraction, so it is shaped by what Navigator is allowed to do rather than
by what an HTTP client naturally offers.

Consequence:
A new job is a new method on both providers plus a prompt and a schema — about
thirty lines. That is the intended cost. Each provider keeps one private
request path (`ask` / `run`), so the wire format is written once.

## Decision: A hover provider is allowed, and it is the only provider there will be

`src/vscode/hover.ts` registers a hover provider over Navigator's own
observations. Code action, completion, inline completion, formatting, rename
and on-will-save providers stay banned, and `test/invariant.test.ts` now pins
that hover is the *only* provider of any kind that Navigator registers.

Reason:
The banned six all exist to produce an edit. `vscode.Hover` cannot: it is a
`MarkdownString` and a range, with no member that reaches a document. The
distinction the invariant is drawing is "can this change a file", not "is this
a provider", and stating it that way is more honest than a list that happens
not to contain hover yet.

Why it earns its place:
VS Code already renders a diagnostic's message on hover, so a hover that
repeated it would be pure noise. What this one adds is the entry to SPEC §8 —
one link, `Go deeper`, which asks for a hint about that observation and opens
the same one-at-a-time disclosure the guidance command uses.

Guards:
- The `MarkdownString` is trusted, which is what lets a command link work at
  all, but it names the single command it may invoke
  (`isTrusted: { enabledCommands: [GO_DEEPER_COMMAND] }`). The invariant test
  asserts both that line and that the file contains exactly one command link.
- The link carries the observation's file and line, never its content.

## Decision: Going deeper reuses the guidance path rather than growing a fourth

`Navigator: Go Deeper` builds a question out of the observation plus the hunk
it was found in (`src/core/observationHints.ts`) and sends it through
`runGuidance`.

Reason:
"I have been told what is wrong and I want to work it out myself" is the same
request as "where should I look", and it wants the same answer shape: things
involved, hints that narrow one step at a time, terms to search. A fourth
prompt and schema would have had to say all the same things, and would have
been a second place for the hint rules to drift.

Consequence:
The observation the developer has already read is Level 0, so this path opens
with the first hint already revealed, where the guidance command starts at zero.

## Decision: The last review is remembered in memory, and that is not history

`src/vscode/observationStore.ts` holds the last review's observations and diff
files so the hover knows what is under the cursor. Each review replaces the
last, `Clear Observations` empties it, and a window reload starts blank.

Reason:
The hover needs to answer "which observation is this line" without re-running
anything. Nothing is written to disk, and nothing accumulates — this is not
review history (which stays unbuilt; see its own entry), and it should not
become the place someone adds it.

## Decision: The documentation index is MDN's search API, and only that

`src/core/docsIndex.ts` resolves a search term through
`https://developer.mozilla.org/api/v1/search`, takes the first result's title
and `mdn_url`, and shows nothing when there is no match. This is the decision
issue #8 left open.

Alternatives considered:
- **A general search API** (Brave, Google CSE): covers everything, and costs an
  API key, a setting, a quota and a second failure mode — for a tool with one
  user, whose questions are mostly about the web platform anyway.
- **Scraping**: breaks, silently, at someone else's convenience.
- **A bundled table of links**: goes stale in the repository, which is worse
  than going stale on a server.

Why MDN:
Free, no key, authoritative for what it covers, and its coverage — the web
platform and JavaScript — is most of what "what is this called" is about. What
it does not cover degrades to a search term, which is what SPEC §10.3 wanted
shown regardless.

Guards:
- `mdnDocumentUrl` refuses anything that is not an MDN document path, so a
  changed or hostile response cannot become a link somewhere else.
- 2-second timeout, resolved in parallel, at most three links (SPEC §10.2).
  Every failure — offline, proxied, rate-limited, malformed — is silent and
  costs nothing: the term is still there.
- MDN's `summary` field is available and deliberately unused. Summarising the
  page is what SPEC §10.3 asks Navigator not to do, and the test says so.

When to revisit:
When a real session produces a run of terms MDN cannot resolve, and the pattern
in them says which index would have. Not before — that is the measurement, and
guessing at it is how the setting gets added for nothing.

## Decision: Adjacent things are the last rung of the disclosure, not a section

SPEC §21.6's "You may want to explore" list appears only in the guidance
QuickPick, only after the developer has exhausted the hints, and never on its
own. It is `More specific` one more time.

Reason:
§21.6 asks for two things that pull against each other: the discovery should be
*serendipitous*, and the frequency should be *low* so it does not break
concentration. A dedicated command would be neither — nothing is accidental
about running it. A section shown by default would be the wrong half: seen
every time, and read as part of the answer.

The last rung gets both. The developer asked for "more", not for "adjacent
things", so what arrives is unasked-for in the way that matters; and they only
get there by having already read everything else, which is exactly the moment
when a glance sideways costs nothing.

Consequences:
- A developer who stopped at the topics never sees it. That is correct: it is
  the least important thing Navigator has to say.
- It is names only, each one searchable. No explanations — explaining an
  adjacent API is how a discovery becomes a lecture (SPEC §18.5).
- Something already named as a topic is dropped from it; repeating the answer
  back is not a discovery.
- It never appears in the review path, where an interruption costs most.

## Decision: A selection is sent as context; no selection sends nothing

`Navigator: Where Should I Look?` includes the editor selection when there is
one. When there is not, it sends the question alone — it does not fall back to
the lines around the cursor.

Reason:
"Add a retry to this" is a far better question when *this* was pointed at, and
selecting is work the developer has usually already done. But a cursor-line
guess would attach context to *every* question, silently and with no shape the
developer can see. A selection is a deliberate act; a cursor position is where
they happened to stop typing.

What is told, and when:
- The input box says what is going with the question **before** it is typed:
  "Sending src/a.ts:12-40 (29 lines) with it." Nothing leaves the editor that
  the developer was not shown first.
- The QuickPick repeats it as a non-selectable separator, where the answer is
  read.
- The log records it.

Caps:
200 lines or 4000 characters, whichever comes first, and the summary says
"first N lines" when it cut. A whitespace-only selection sends nothing, so a
stray click cannot attach a character to the question.

Invariant:
`src/vscode/selection.ts` is the only file that touches a `TextEditor`, and
`TextEditor` offers `edit` right next to `selection`. `test/invariant.test.ts`
pins the exact set of members that file calls — `getText` and
`asRelativePath` — so an edit path there cannot appear quietly.

## Decision: Every request logs what it cost, and "unknown" is a valid answer

`src/core/usage.ts` reads whatever the endpoint reported and each pipeline
appends one line to its notes, which the extension writes to the log.

Reason:
For this job — small input, thinking before answering — reasoning tokens are
billed at the output rate and dominate the total, so the cost of one review
could only be stated as a range three times as wide as its own midpoint. That
range is the reason both "should the default effort change" (#20) and "is the
review any good per unit cost" (#17) were unanswerable. One real number ends
it, and it costs one line per request.

Three wire shapes, one reader: Anthropic and the OpenAI Responses API report
`input_tokens` / `output_tokens`; Chat Completions reports `prompt_tokens` /
`completion_tokens`; thinking tokens hide in a details object under either
`thinking_tokens` or `reasoning_tokens`.

Consequence:
An OpenAI-compatible endpoint that reports nothing logs
"tokens: not reported by this endpoint" and carries on. Half the point of the
compatible path is endpoints that implement only part of the API, so a missing
`usage` must never be an error. The note goes last in the list so it can never
displace a warning.

## Decision: Effort is a setting, and its default stays "whatever the model does"

`navigator.effort` reaches `output_config.effort` on Anthropic and
`reasoning_effort` / `reasoning.effort` on OpenAI. Unset — the default — sends
nothing at all, so the request is byte-for-byte what it was before the setting
existed.

Reason for adding it at all:
`LOOP.md` §6.6 says not to grow a configuration system, and this is the
exception that earns itself: for this job the input is small and the thinking
dominates the bill, so effort is the one setting that changes what a review
costs. That is not a preference, it is a budget.

Reason the default does not move:
Lowering it would be cheaper and might be worse, and nobody has measured which.
#19 made the cost visible and #17 makes the quality measurable; changing the
default before both have been run against a real endpoint would be swapping a
known default for a guess. When it does move, the measurement goes here.

Consequences:
- `xhigh` and `max` have no OpenAI counterpart and are sent as `high` rather
  than dropped: the developer asked for as much thinking as possible, and that
  is as much as that provider has.
- Nothing is sent to an OpenAI-compatible endpoint unless the setting is
  explicitly set, so an endpoint that rejects `reasoning_effort` is only
  reachable by someone who asked for it.

## Decision: `npm run verify` requires git, and the git suite fails without it

`test/gitIntegration.test.ts` used to skip itself when `git --version` failed.
It now asserts git is present and fails when it is not.

Reason:
It is the only coverage of the real `execFile` path and of git's actual diff
output. Skipping made a green run ambiguous: the same "all tests pass" line
appeared whether the product's one real integration ran or not, and telling the
difference meant noticing a skip count in a summary nobody reads. A test that
can silently not run is worse than one that is missing, because it is counted.

Why requiring git is not a burden:
Navigator does nothing at all without git. Requiring it to *develop* Navigator
is not a new dependency, it is the same one, stated. `AGENTS.md` says so under
Commands.

Verified: with `PATH` emptied, the suite fails with a named assertion rather
than reporting zero failures.

## Decision: No review history — not planned

`SPEC.md` §19 lists "Review history" among the Optional items and never defines
it. Issue #12 found three readings, and it is closed not planned rather than
left open, because the missing thing is not a decision — it is a demand.

The three readings, and why none is built:

1. **Look back at past reviews.** Nothing in the loop this product describes —
   write, review, fix, continue — involves re-reading an old review. The
   diagnostics are on screen while they matter and gone when they do not, and
   that transience is the same property that keeps Navigator from becoming a
   thing one converses with.
2. **Never show a dismissed observation twice.** This one has real value and is
   the only one worth reopening for: it serves SPEC §7 directly. It needs
   persistent per-observation state, which is the same storage question as
   §21.4 (see its entry), and it needs to know that the same false positive
   *actually* recurs. Nobody has seen a review yet, so that is a guess.
3. **Aggregate what gets flagged.** That is review-quality measurement, which
   is `test/eval/`, not a feature of the extension.

When to revisit:
Reading 2, when `feedback` issues show the same observation being ignored
across several reviews. That report is the demand; until it exists, this would
be a store, a lifecycle and a settings entry built on a hunch.

## Decision: Review quality is measured by an eval set of invented diffs

`test/eval/cases.ts` holds nine synthetic changes with known answers, scored on
four numbers per intensity (`test/eval/score.ts`). `npm test` scores them
against fixed answers; `npm run eval` scores them against a real endpoint.

Why four numbers rather than one:
`SPEC.md` §7 makes several claims and three of them are about restraint. A
single "accuracy" figure would let a prompt that finds every planted bug *and*
comments on every clean diff look good, which is the exact failure mode the
product exists to avoid. So: miss rate, false-positive rate, noise rate, and
silence correctness — and the last two are the ones to read first.

Where the line between them falls:
Mechanically, not by judgement. On a case whose correct review is silence,
every observation is a **false positive**. On a case with a planted bug, an
observation matching none of the expectations is **noise** — meaning
*unasked-for*, not *wrong*. A model can be right about something nobody needed
to hear, and §7 is precisely about suppressing that.

Matching:
An observation counts for an expectation when it is in the right file, within
two lines, and mentions at least one of the expectation's words. The tolerance
stops the eval from measuring line-citing instead of reviewing; the word list
stops an observation being credited for landing on the right line while talking
about something else.

Two rules that keep the set honest:
- **Every case is invented.** `LOOP.md` §2.2 forbids code that was under review
  from entering this public repository, and an eval set is the likeliest place
  for it to leak in. Any case added later must be written for the purpose.
- **A test asserts every expectation lies inside its own diff.** Otherwise
  `anchor.ts` would discard it before it became an observation, and the eval
  would be measuring anchoring while appearing to measure review quality.

What the offline run is worth:
It pins the pipeline and the scorer against hand-written answers, which is a
real regression test and is *not* a quality measurement. The numbers that mean
something come from `npm run eval`, which needs a key.

## Decision: `npm run smoke` is the one command for whoever holds a key

`scripts/smoke.mjs` makes one real request down each of the four network paths
— review, guidance, recall, and the MDN index — prints what came back, and on
failure prints the raw error plus a note about the two things most likely to be
wrong on a compatible endpoint.

Reason:
Issue #16 is an environment blocker, not a design question: no key exists here
and no server has ever accepted one of these requests. The useful thing an
agent without a key can do is make the check take one command instead of an
afternoon, so the person who has one is not also asked to work out what to run.

Why it names the two suspects in its output:
`isStructuredOutputRejection` matches on error *wording*, which varies between
services, and token limits may be capped or interpreted differently. Either is
fixed instantly by one real error message and not at all by reasoning. The
script asks for that message by name.

Verified as far as it can be: run against a local OpenAI-compatible stub
server, review, guidance and recall all completed and the MDN check failed with
its intended message.

## Decision: The extension-host checks exist, and are not part of the gate

`npm run test:host` starts a real VS Code through `@vscode/test-electron` and
runs `scripts/host/index.cjs` inside it: the extension is installed under the
id its secrets are keyed by, it activates (so `main` resolved), every
contributed command is in the palette, VS Code accepts the diagnostics, and
the hover provider is live and silent where nothing has been reviewed.

Why it is not in `npm run verify`:
It needs a display, or `xvfb-run`. The gate has to be runnable by an agent in
a container, and a gate that quietly skipped part of itself would be exactly
the problem decided against in `test/gitIntegration.test.ts` — so rather than a
skipping test in the gate, this is a separate command that either runs properly
or is not claimed to have run.

Why CommonJS:
VS Code `require`s `extensionTestsPath`, and the Node inside a VS Code release
is not always new enough to `require` an ES module. `.cjs` removes a failure
mode from the one command that cannot be tried here.

What is still not covered, even by this:
`SecretStorage` behaviour, because the checks run outside the extension's own
`ExtensionContext` and cannot reach it. And nothing in the host checks calls
out to a model — `npm run smoke` is that.

Status: written, loadable, and never run. This environment cannot even
download VS Code (`update.code.visualstudio.com` is outside its egress
allowlist), which is issue #18 and is recorded in `PROGRESS.md`.

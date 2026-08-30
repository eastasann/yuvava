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

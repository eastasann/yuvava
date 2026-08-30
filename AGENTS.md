# AGENTS.md

Instructions for any coding agent working in this repository — Codex, Claude
Code, or otherwise. Read this first, then `SPEC.md`.

## What this is

Navigator is a VS Code extension for developers who still want to write their
own code. It is not an AI coding assistant. It does not write code, and it must
never be able to.

Three things it does, and they are peers (`SPEC.md` §4.1):

| | |
| --- | --- |
| review | reads the current diff and points at problems (§6) |
| guidance | names what a task involves, so the developer goes and finds out (§10) |
| recall | gives back a forgotten name, and stops (§9) |

**What is at the centre is not any of the three.** It is the constraint: §16
(Navigator cannot write code) and §7 (silence is the default and usually the
correct answer). Those are what make it a navigator rather than an assistant,
and the three commands are three deliveries of the same discipline. Weigh a
change against §22 and §23, not against how much it improves review.

## Source of truth, in order

1. `SPEC.md` — the product definition. It wins over everything below.
2. `LOOP.md` — how to work here autonomously: decide, implement, verify,
   iterate; do not stop to ask about reversible technical choices.
3. `DECISIONS.md` — why the code is shaped as it is. Read before proposing an
   architecture change; the answer to "why not X?" is often already here.
4. `PROGRESS.md` — what is done, what is deliberately not, and known problems.
5. The existing code and tests.

## The repository is the memory

There is no conversation history. Every session starts blank, and the only
things that carry across are files:

| Where | What it holds |
| --- | --- |
| `SPEC.md` | what the product should be |
| `LOOP.md` | how autonomous development should operate |
| `DECISIONS.md` | why the current durable design choices were made |
| `PROGRESS.md` | where development currently stands |
| `git` | implementation history |
| GitHub Issues | the inbox: real-world observations, and the work backlog |

Two procedures in `LOOP.md` are mandatory, not advisory:

- **`LOOP.md` §24 Context Recovery** — at the start of every session, before
  the first decision. Read the files above, check `git status` / `git diff`,
  and confirm `PROGRESS.md` still matches reality.
- **`LOOP.md` §25 Loop Handoff** — before you stop, whatever the reason.
  Update `PROGRESS.md`, record durable decisions in `DECISIONS.md`, note
  unresolved work, and put the *actual* results of the verification commands in
  `PROGRESS.md`. Green tests are not a finished loop; a repository a fresh
  session can continue from is.

Anything known only to you at the end of a session is lost. If the next agent
needs it, write it down.

Feedback from real use arrives as GitHub Issues, not as files: they are cheap
to file, and editable and deletable, which files in git history are not. Issues
are also where the work backlog lives — **the list of unstarted work is
authoritative there, not in `PROGRESS.md`**, which summarises and points at it.
Issues are the inbox; the repository is the memory. When you act on one, put the
durable part in `DECISIONS.md`, the unresolved part in `PROGRESS.md`, and close
the issue.

Labels, and what each means:

| Label | What it marks |
| --- | --- |
| `feedback` | an observation from real use (`.github/ISSUE_TEMPLATE/feedback.md`) |
| `enhancement` | a capability `SPEC.md` asks for that does not exist yet |
| `verification` | something believed to work that has never been observed working |
| `quality` | a known defect or waste in what already exists |
| `blocked-on-design` | a decision has to be made before code can be written |

One issue, one commit. Close an issue only when it has reached one of three
states — implemented (verified, committed), not planned (reason in
`DECISIONS.md`), or blocked (left open, with the missing resource named in
`PROGRESS.md`). "Nobody has decided yet" is not one of them; `LOOP.md` §30
applies.

**This repository is public.** Never paste user code under review into an
issue, a document, or a comment — record the *pattern*, never the code. See
`LOOP.md` §2.2.

## The one rule you may not break

> **Navigator must never modify user implementation code.**

This is `SPEC.md` §16, and it is the product, not a preference. Concretely, the
extension must not gain:

- a `WorkspaceEdit`, `applyEdit`, `TextEdit`, or `TextEditor.edit` call
- a code action / quick fix, completion, inline completion, formatting or
  rename provider
- any filesystem write, or `workspace.fs`
- any subprocess other than a read-only `git` subcommand
- any command whose name or title contains apply, fix, generate, complete,
  refactor, rewrite, accept, patch, or implement

`test/invariant.test.ts` reads this repository's own source and fails if any of
those appear. **Do not weaken that test to make a feature fit.** If a task
seems to require breaking the invariant, the task is wrong — say so instead.

The model is also not trusted to obey the prompt: `src/core/schema.ts` gives it
no field that could hold code, and `src/core/sanitize.ts` strips fences and
statement-shaped lines, flattens to one line, and caps the length. Keep those.

## Commands

```bash
npm install
npm run verify    # lint + compile + tests — must be green before you commit
npm run compile   # tsc
npm run lint      # eslint, zero warnings allowed
npm test          # node:test
npm run package   # builds yuvava.vsix
```

Three more exist, and **none of them runs in a cloud container**. They are the
human operating path, and none is part of the gate:

| Command | Needs | What it settles |
| --- | --- | --- |
| `npm run install:local` | a real VS Code and the `code` CLI | verifies, builds and installs the `.vsix` |
| `npm run smoke` | an API key | one real request down each of review, guidance, recall and the MDN index |
| `npm run eval` | an API key | answer quality on the synthetic set — four numbers for review at each intensity, and for guidance and recall |
| `npm run test:host` | a real VS Code (a display, or `xvfb-run`) | activation, `main` resolution, the palette, diagnostics, the hover provider |

`npm run smoke` and `npm run test:host` exist because a green gate here does
not mean Navigator works: every provider test injects the SDK's `fetch`, and
the extension tests activate against a fake `vscode` module. If you have a key
or a display, run them — that is the part this environment cannot do, and the
part the repository most needs.

**`git` must be on `PATH` to verify.** `test/gitIntegration.test.ts` is the only
coverage of the real `execFile` path and of git's actual diff output, and it
*fails* rather than skips when git is missing — a green run has to mean the
whole product was exercised, and a skipped suite in a summary line nobody reads
does not achieve that. Git is not an optional dependency of a tool that reviews
git diffs.

`npm run verify` is the gate. Do not report work as done without it passing,
and put the results you actually observed into `PROGRESS.md` before you stop
(`LOOP.md` §25.2) — never copy the previous run's numbers.

## Layout

```
src/core/     no `vscode` import, ever — this boundary is enforced by a test
  git.ts               read-only git; allowlisted subcommands only
  untracked.ts         new files rendered as an all-added diff (no `git add -N`)
  workspaceDiff.ts     tracked + untracked, composed
  diff.ts              unified-diff parsing and line-numbered rendering
  prompt.ts            the Navigator persona for review (SPEC §17)
  schema.ts            review schema + validation of whatever comes back
  sanitize.ts          the structural no-code-generation guard (review path)
  hintSanitize.ts      the hint path's looser rule — a hole, never a fix (§8)
  anchor.ts            issues -> observations, anchored to reviewed lines
  range.ts             where the underline goes
  provider.ts          the seam: one method per job, no generic "ask anything"
  anthropicProvider.ts / openaiProvider.ts / providerFactory.ts
  usage.ts             what a request cost, across three wire shapes
  review.ts            the review pipeline
  guidancePrompt/Schema.ts, guidance.ts    "where should I look" (§10, §8, §21.6)
  recallPrompt/Schema.ts, recall.ts        "what was it called" (§9)
  observationHints.ts  one observation -> a question for the guidance path
  docsIndex.ts         MDN search; the only source of a displayed URL
  search.ts            a term -> a plain web search
  selectionContext.ts  an editor selection, capped and described
src/vscode/   thin adapter, one file per command
  extension.ts         activation and the review command
  guidance.ts / recall.ts / hover.ts       the three question commands
  selection.ts         the only file that touches a TextEditor
  observationStore.ts  the last review, in memory, for the hover
  diagnostics.ts / statusBar.ts / config.ts / apiKey.ts
test/         unit tests; `invariant.test.ts` guards the rule above
  eval/                the quality sets and one scorer for all three paths (§7)
scripts/      not part of the gate; each needs something a container lacks
  smoke.mjs            one real request down every network path (needs a key)
  eval.mjs             review quality against a real endpoint (needs a key)
  test-host.mjs + host/index.cjs   checks inside a real VS Code (needs a display)
```

New logic goes in `src/core/` with a test. `src/vscode/` should stay thin
enough that its correctness is obvious by reading it.

A new job for the model is a method on both providers plus a prompt and a
schema — about thirty lines. That cost is deliberate: there is no generic
"ask the model anything" call, so every prompt stays on Navigator's side of
the seam. See `DECISIONS.md`.

## Conventions

- TypeScript, strict. Relative imports carry the `.js` extension (Node16
  module resolution).
- Tests are `node:test` + `node:assert/strict`, named `*.test.ts` under
  `test/`. They must not need a network, an API key, or a display.
- Model calls go through `ReviewProvider`. Tests pin the wire request by
  injecting the SDK's `fetch` — see `test/anthropicProvider.test.ts`.
- Comments explain why, not what. Do not narrate the code.
- Add a dependency only when the platform and the existing ones cannot do the
  job (`LOOP.md` §18).

## Providers

Anthropic (default, `claude-opus-5`) and OpenAI (`gpt-5.1-codex-max`), selected
by `navigator.provider`. Both implement `review`, `guide` and `recall`, all
using the prompts and schemas in `src/core/`, and every answer goes through the
same validation. If you add a third, it goes behind those interfaces and
`providerFactory.ts`, and it changes nothing about what Navigator does with the
answer.

## What not to build

`SPEC.md` §18 and `LOOP.md` §19 list the non-goals. In short: no autonomous
coding, no code generation, no auto-fix, no chat-centric UI, no telemetry, no
large configuration system. When weighing a feature, use `SPEC.md` §22:

> Does this increase the developer's opportunity to think, or remove it?

If it removes it, do not build it.

# AGENTS.md

Instructions for any coding agent working in this repository — Codex, Claude
Code, or otherwise. Read this first, then `SPEC.md`.

## What this is

Navigator is a VS Code extension that reviews the developer's current changes
and points out problems. It is not an AI coding assistant. It does not write
code, and it must never be able to.

## Source of truth, in order

1. `SPEC.md` — the product definition. It wins over everything below.
2. `LOOP.md` — how to work here autonomously: decide, implement, verify,
   iterate; do not stop to ask about reversible technical choices.
3. `PROGRESS.md` — what is done, what is deliberately not, and known gaps.
4. `DECISIONS.md` — why the code is shaped as it is. Read before proposing an
   architecture change; the answer to "why not X?" is often already here.
5. The existing code and tests.

Restore your bearings from those files plus `git status` and `git diff`. Do not
assume any earlier conversation exists.

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
npm run package   # builds navigator.vsix
```

`npm run verify` is the gate. Do not report work as done without it passing.

## Layout

```
src/core/     no `vscode` import, ever — this boundary is enforced by a test
  git.ts               read-only git; allowlisted subcommands only
  untracked.ts         new files rendered as an all-added diff (no `git add -N`)
  workspaceDiff.ts     tracked + untracked, composed
  diff.ts              unified-diff parsing and line-numbered rendering
  prompt.ts            the Navigator persona (SPEC §17)
  schema.ts            response schema + validation of whatever comes back
  sanitize.ts          the structural no-code-generation guard
  anchor.ts            issues -> observations, anchored to reviewed lines
  range.ts             where the underline goes
  provider.ts          the ReviewProvider seam
  anthropicProvider.ts / openaiProvider.ts / providerFactory.ts
  review.ts            the pipeline
src/vscode/   thin adapter: commands, diagnostics, status bar, config
test/         unit tests; `invariant.test.ts` guards the rule above
```

New logic goes in `src/core/` with a test. `src/vscode/` should stay thin
enough that its correctness is obvious by reading it.

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
by `navigator.provider`. Both use the same prompt, the same JSON schema, and
the same validation. If you add a third, it goes behind `ReviewProvider` and
`providerFactory.ts`, and it changes nothing about what Navigator does with the
answer.

## What not to build

`SPEC.md` §18 and `LOOP.md` §19 list the non-goals. In short: no autonomous
coding, no code generation, no auto-fix, no chat-centric UI, no telemetry, no
large configuration system. When weighing a feature, use `SPEC.md` §22:

> Does this increase the developer's opportunity to think, or remove it?

If it removes it, do not build it.

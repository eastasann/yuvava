# Progress

Where development currently stands. Current working state, not a diary — the
history is in `git log`. Read this after `SPEC.md`, `LOOP.md` and
`DECISIONS.md`, as §24 Context Recovery describes.

## Status

The MVP is complete and verified. `SPEC.md` §19 Required is fully implemented,
plus two Optional items (status bar, review intensity). Untracked files are
reviewed, and both Anthropic and OpenAI can act as the reviewer.

No feature work is in progress and the working tree is clean.

**Navigator has not been used against real code yet.** It is distributed by
local install (`npm run install:local`, or a `.vsix` handed over directly) and
the owner is about to try it for the first time. Until that happens, the three
entries under **Known problems** are all still unproven in the same way: no
request has ever reached a provider, and no review has ever been read by a
human.

The next loop is expected to be driven by that first real use, arriving as
`feedback`-labelled issues. Per `LOOP.md` §2.2 those are **batched**: wait for
several before starting a loop, and work the pattern across them rather than
the individual reports.

## Verification

Run from the repository root. `npm run verify` is the gate — do not report work
as done without it passing.

```bash
npm install
npm run lint      # eslint, zero warnings allowed
npm run compile   # tsc
npm test          # node:test
npm run verify    # lint + compile + tests
npm run package   # produces yuvava.vsix
npm run install:local  # verify + build + install into VS Code (human path)
```

Last executed on this tree, Node v22.22.2 / npm 10.9.7:

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0, no warnings |
| `npm run compile` | exit 0 |
| `node --test "out/test/**/*.test.js"` | exit 0 — **187 pass, 0 fail**, 33 suites, ~0.8 s |
| `npm run package` | exit 0 — `yuvava.vsix`, 5509 files, 6.9 MB |

`npm run verify` runs lint + compile + tests together and exits 0.
Re-run these before trusting the table if any source file has changed since.

## Done

### MVP (`SPEC.md` §19 Required)

- Extension activates, contributes five commands and seven settings.
- `Navigator: Review Current Changes`.
- Read-only git access — `src/core/git.ts`, allowlisted subcommands only.
- Untracked files reviewed as a synthesised all-added diff —
  `src/core/untracked.ts`, `src/core/workspaceDiff.ts`. No `git add -N`.
- Unified-diff parsing and line-numbered rendering — `src/core/diff.ts`.
- Review via Anthropic (`claude-opus-5`) or OpenAI (`gpt-5.1-codex-max`),
  selected by `navigator.provider` — `src/core/providerFactory.ts`.
- Any OpenAI-compatible endpoint via `navigator.openaiBaseUrl` (Groq, Cerebras,
  Ollama, LM Studio, OpenRouter). Setting it switches the request to
  `/chat/completions`; a rejected JSON schema falls back once to a plain
  request, noted in the log.
- Structured output schema plus local validation — `src/core/schema.ts`.
- Code-generation sanitiser — `src/core/sanitize.ts`.
- Observations anchored to reviewed hunks — `src/core/anchor.ts`.
- Diagnostics publishing — `src/vscode/diagnostics.ts`, `src/core/range.ts`.
- Silence when there is nothing worth reporting.
- Failure paths: no workspace, no git, unknown base revision, missing API key,
  oversized diff, malformed/truncated response, model refusal, empty response,
  cancellation.
- 187 tests, including `test/invariant.test.ts` (the `SPEC.md` §16 guard) and
  `test/gitIntegration.test.ts` (real git, asserts the working tree is
  untouched afterwards).

### Optional (`SPEC.md` §19)

- Status bar (§12.2) — hidden while idle; reviewing / N observations otherwise.
- Review intensity (§15) — `silent` / `normal` / `strict`, prompt-level only.

## Remaining

**The authoritative list of unstarted work is the open GitHub Issues**
(`LOOP.md` §2.2). This section summarises where things stand; it does not
duplicate the list, and it goes stale the moment an issue is filed or closed.

Where the remaining work sits, by the shape of what is blocking it:

- **Waiting on one real API call** — everything about whether Navigator is
  actually *useful* rather than merely correct. Live endpoint confirmation
  (#16), review-quality measurement (#17), and anything whose design needs
  observed usage: automatic review (#10, held by `SPEC.md` §13), passive
  behaviour (#11), context-aware review (#14), learning-aware hint decay (#15).
  See Known problems for exactly what is missing.
- **Waiting on a real VS Code** — extension-host testing (#18).
- **Open backlog with no external blocker** — read the issue list.

Start a session by listing open issues, not by reading this section.

## Known problems

- **No live API call has ever been made, against any endpoint.** No keys exist
  in the development environment. The provider tests pin the exact wire request
  by injecting each SDK's `fetch`, so request shape, headers and every response
  branch are verified — but no server has ever accepted these requests. Treat
  "the review works end to end" as unproven until it is run once for real.
  The compatible-endpoint path (`test/openaiCompatible.test.ts`) is the least
  proven of all: real services vary in how much of the OpenAI API they
  implement, and the schema fallback is written against that expectation
  rather than against an observed failure.
- **No test inside a real extension host.** `test/extension.test.ts` activates
  the extension against a fake `vscode` module (`test/fakes/vscode.ts`). That
  covers command registration, failure paths and diagnostic conversion, but not
  VS Code's own rendering, activation events, or packaging-time resolution of
  `main`.
- **Review quality is unmeasured.** Whether the prompt actually produces
  high-signal, low-noise observations — the entire point of `SPEC.md` §7 — has
  never been observed on real diffs. There is no eval.
- **The `.vsix` carries both provider SDKs (6.9 MB)** so that one can be used.
  Harmless but wasteful; `DECISIONS.md` records the levers (esbuild, or a
  dynamic import of the selected provider) and why neither was pulled yet.
- **`test/gitIntegration.test.ts` requires `git` on PATH.** It skips cleanly
  when git is absent, which means a green run does not by itself prove the real
  git path was exercised. Check for the skip message if it matters.

## Notes for the next loop

- `test/invariant.test.ts` is the guard for `SPEC.md` §16. It reads Navigator's
  own source and fails if an edit path, code-action/completion/formatting
  provider, filesystem write, non-git subprocess, or an
  "apply/fix/generate/refactor" command appears. **Do not weaken it to make a
  feature fit.** If a task seems to require breaking it, the task is wrong.
- `AGENTS.md` is the entry point for any coding agent; `CLAUDE.md` imports it.
  If the invariant list changes, change it in `AGENTS.md` and the test together.
- The response schema in `src/core/schema.ts` marks every field `required`
  because OpenAI strict mode demands it. `endLine` repeats `line` and `symbol`
  may be `""`; the validator treats both as absent. Adding an optional field
  means adding it to `required` with a documented empty value.
- `src/core/` must never import `vscode`; `test/invariant.test.ts` enforces it.
- Distribution is a locally built `.vsix` (`npm run install:local`), not the
  Marketplace — see `DECISIONS.md`. `publisher` is therefore a deliberate
  placeholder and the extension id is `navigator.yuvava`. Do not "fix" it.
- Feedback from real use arrives as GitHub Issues labelled `feedback`, not as
  files (`LOOP.md` §2.2, and the reasoning in `DECISIONS.md`). Check open
  issues during context recovery. Now that the extension is installed and in
  use, this is the likeliest source of the next loop's work — particularly for
  "review quality is unmeasured" above.
- **This repository is public.** Never put user code that was under review into
  an issue, a document or a comment. Record the pattern, not the code.

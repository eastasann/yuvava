# Progress

Where development currently stands. Current working state, not a diary — the
history is in `git log`. Read this after `SPEC.md`, `LOOP.md` and
`DECISIONS.md`, as §24 Context Recovery describes.

## Status

The MVP is complete and verified. `SPEC.md` §19 Required is fully implemented,
plus two Optional items (status bar, review intensity). Untracked files are
reviewed, and both Anthropic and OpenAI can act as the reviewer.

The first development loop has ended. No feature work is in progress and the
working tree is clean. A fresh session can pick the next item from
**Remaining** below.

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

Last executed on this tree (the handoff commit, Markdown-only on top of
`516eeb6`), Node v22.22.2 / npm 10.9.7:

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

Not started, and each is a deliberate hold rather than an oversight.

- **Progressive hints (`SPEC.md` §8).** The obvious designs all drift toward a
  chat UI, which §12.3 rejects. Settle the interaction surface before writing
  code; this is a product decision, not an implementation one.
- **Documentation navigation (§10).** Would need a source of documentation
  links. Deciding where those come from is the hard part, not rendering them.
- **Recall assistance (§9).** Same interaction-surface problem as §8.
- **Automatic review (§14).** `SPEC.md` §13 says only after the manual flow has
  proven useful — and it has not been used against a live API yet (see Known
  problems). Needs debounce/cooldown when it happens.
- **Review history.** No demand established.
- **Live confirmation of both providers.** See Known problems; this is the
  highest-value next step and needs only an API key.

## Known problems

- **No live API call has ever been made, for either provider.** No keys exist
  in the development environment. `test/anthropicProvider.test.ts` and
  `test/openaiProvider.test.ts` pin the exact wire request by injecting each
  SDK's `fetch`, so request shape, headers and every response branch are
  verified — but no server has ever accepted these requests. Treat "the review
  works end to end" as unproven until each provider is run once with a real key.
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

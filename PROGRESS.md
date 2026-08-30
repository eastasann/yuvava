# Progress

Where development currently stands. Current working state, not a diary — the
history is in `git log`. Read this after `SPEC.md`, `LOOP.md` and
`DECISIONS.md`, as §24 Context Recovery describes.

## Status

`SPEC.md` §19 Required is complete, and so is every Optional item on that list.
The four surfaces §12 asks for — Diagnostics, Problems panel, Hover, Status Bar
— all exist, along with the three question paths §8, §9 and §10 describe.

The working tree is clean and `npm run verify` is green.

**Nothing here has ever been used against a real endpoint, or inside a real
VS Code.** That single fact is the whole of what is left, and it is why the two
open issues are open. Everything below that sounds like a capability is a
capability whose *tests* pass; treat "it works" as unproven until `npm run
smoke` has been run once by someone with an API key.

Read the open issues before this file (`LOOP.md` §2.2): they are the backlog of
record. Six are open — two blocked on this environment, four waiting on
something the first two produce. Each carries a comment saying which.

## Verification

Run from the repository root. `npm run verify` is the gate — do not report work
as done without it passing. **`git` must be on `PATH`**; the git suite fails
rather than skips without it.

```bash
npm install
npm run lint      # eslint, zero warnings allowed
npm run compile   # tsc
npm test          # node:test
npm run verify    # lint + compile + tests
npm run package   # produces yuvava.vsix
```

Last executed on this tree, Node v22.22.2 / npm 10.9.7, git 2.43.0:

| Command | Result |
| --- | --- |
| `npm run lint` | exit 0, no warnings |
| `npm run compile` | exit 0 |
| `node --test "out/test/**/*.test.js"` | exit 0 — **360 pass, 0 fail, 0 skipped**, 75 suites, ~1.1 s |
| `npm run package` | exit 0 — `yuvava.vsix`, 5,527 files, 6.94 MB |

Not runnable in a cloud container, and not part of the gate:

| Command | Needs | Last run |
| --- | --- | --- |
| `npm run smoke` | an API key | **never** — see Known problems |
| `npm run eval` | an API key | **never** — see Known problems |
| `npm run test:host` | a real VS Code (display or `xvfb-run`) | **never** — VS Code cannot even be downloaded here |
| `npm run install:local` | a real VS Code and the `code` CLI | the owner's machine |

Re-run the gate before trusting the table above if any source file has changed.

## Done

### MVP (`SPEC.md` §19 Required)

- Extension activates and contributes eight commands and nine settings.
- `Navigator: Review Current Changes`.
- Read-only git access — `src/core/git.ts`, allowlisted subcommands only.
- Untracked files reviewed as a synthesised all-added diff. No `git add -N`.
- Unified-diff parsing and line-numbered rendering — `src/core/diff.ts`.
- Review via Anthropic (`claude-opus-5`) or OpenAI (`gpt-5.1-codex-max`), or
  any OpenAI-compatible endpoint via `navigator.openaiBaseUrl`.
- Structured output plus local validation, and the code-generation sanitiser.
- Observations anchored to reviewed hunks, published as diagnostics.
- Silence when there is nothing worth reporting.
- Failure paths: no workspace, no git, unknown base revision, missing API key,
  oversized diff, malformed/truncated response, model refusal, empty response,
  cancellation.

### The question paths (`SPEC.md` §8, §9, §10, §21.6)

- `Navigator: Where Should I Look?` — names what a task involves, plus search
  terms. Takes the editor selection as context when there is one, and says so
  before sending it.
- Progressive hints — `More specific` opens one level at a time, never on its
  own. A hint may carry a signature or a skeleton with a hole; working code is
  refused (`src/core/hintSanitize.ts`).
- `Navigator: What Was It Called?` — the name alone first, then signature,
  meaning, documentation, each on request.
- `Navigator: Go Deeper` from a hover over an observation.
- Search terms resolve to real MDN pages where MDN knows them; a link Navigator
  shows always came from the index, never from a model.
- "You may want to explore" as the last rung of the disclosure (§21.6).

### Optional (`SPEC.md` §19) and quality

- Status bar (§12.2), review intensity (§15), hover (§12).
- `navigator.effort` — the cost dial. Default unset.
- Token usage logged for every request.
- 360 tests, including `test/invariant.test.ts` (the §16 guard),
  `test/gitIntegration.test.ts` (real git, and it fails without it), and
  `test/eval.test.ts` (the eval set and scorer).

## Remaining

**The list of unstarted work is the open GitHub Issues** (`LOOP.md` §2.2). Six
are open. Two are blocked on this environment rather than on a decision, and
they are the ones to act on:

- **#16 — no real API call has ever succeeded.** Missing: an API key
  (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`; a free Groq or Cerebras key, or a
  local Ollama, is enough for the compatible path). Everything else is done:
  `npm run smoke` sends one real request down each of review, guidance, recall
  and the MDN index, and on failure prints the raw error plus the two things
  most likely to be wrong. **This is the single highest-value action available
  to anyone reading this.**
- **#18 — no test inside a real extension host.** Missing: a real VS Code, i.e.
  a display or `xvfb-run`. `npm run test:host` is written and loads; this
  container cannot download VS Code at all.

The other four are open but not waiting on a decision. Each one's design
question has been answered in `DECISIONS.md`; what they are waiting for is what
the two above would produce:

- **Automatic review (#10) and passive behaviour (#11)** are held by `SPEC.md`
  §13, which permits automatic review only once the manual flow has proven
  useful in real use. It has not been used at all. This is a SPEC constraint,
  not a preference and not an oversight: implementing them now would violate
  the spec, whatever their merits. They unblock when #16 and real use say the
  manual flow earns its keep.
- **Context-aware review (#14)** waits on `npm run eval` producing a
  false-positive rate to improve against — which waits on a key. The approach
  and its sequencing are settled in `DECISIONS.md`.
- **Learning-aware hint decay (#15)** waits on observed usage: the threshold
  and decay curve have to be fitted to how someone actually uses this. Where
  the state would live, and why it does not touch the invariant, is settled in
  `DECISIONS.md`.

## Known problems

- **No live API call has ever been made, against any endpoint.** No keys exist
  in this environment. The provider tests pin the exact wire request by
  injecting each SDK's `fetch`, so request shape, headers and every response
  branch are verified — but no server has ever accepted these requests. The
  compatible-endpoint path is the least proven: `isStructuredOutputRejection`
  matches on error *wording*, which was written against an expectation rather
  than an observed failure. One real error message fixes it. Run
  `npm run smoke`.
- **Review quality is unmeasured.** `test/eval/` now makes it measurable —
  nine invented diffs, four numbers per intensity — but `npm run eval` has
  never been run against a model. The offline eval scores hand-written answers
  and proves the pipeline and the scorer, *not* the prompt. Do not read a green
  `npm test` as evidence about `SPEC.md` §7.
- **The MDN documentation index has never resolved a term.** This container's
  egress allowlist blocks `developer.mozilla.org`, so `MdnDocsIndex` returns
  undefined here. Its failure path is genuinely confirmed — a real HTTP 403
  produced silence and no error, as designed — and its success path is not.
- **No test inside a real extension host.** `test/extension.test.ts` activates
  against a fake `vscode` module (`test/fakes/vscode.ts`). That covers command
  registration, failure paths, hover contents and diagnostic conversion, but
  not VS Code's own rendering, activation events, or packaging-time resolution
  of `main`. `scripts/host/index.cjs` covers those and has never run.
  `SecretStorage` behaviour is not covered even there — the host checks run
  outside the extension's own `ExtensionContext`.
- **`navigator.effort` has never been sent to a real endpoint.** The values are
  taken from the providers' documented ladders; that they are accepted is
  unverified, and `xhigh`/`max` are folded to `high` for OpenAI on the same
  basis.
- **The `.vsix` carries both provider SDKs** (6.94 MB, 5,527 files, of which
  Navigator's own output is 152 KB). Deliberate — see `DECISIONS.md` twice over.

## Notes for the next loop

- **Start by listing open issues.** They are the backlog of record; this file
  summarises them and goes stale.
- `test/invariant.test.ts` is the guard for `SPEC.md` §16. It reads Navigator's
  own source and fails if an edit path, a filesystem write, a non-git
  subprocess, or an "apply/fix/generate/refactor" command appears. It also now
  pins that **hover is the only provider** registered, that the hover's trusted
  markdown names the single command it may invoke, and that
  `src/vscode/selection.ts` calls only `getText` and `asRelativePath`.
  **Do not weaken it to make a feature fit.** If a task seems to require
  breaking it, the task is wrong.
- **The review path's sanitiser has not moved and must not.** `anchor.ts` calls
  `sanitizeMessage`, which still destroys all code. The hint path uses a
  separate `sanitizeHint`, and `test/hintSanitize.test.ts` runs the same three
  fragments through both and asserts the review one strips all three. Do not
  merge them.
- Adding a job for the model means a method on both providers plus a prompt and
  a schema. That cost is intended — see "One provider object, one method per
  job" in `DECISIONS.md`. There is deliberately no generic "ask anything" call.
- `src/core/` must never import `vscode`; the invariant test enforces it.
- Distribution is a locally built `.vsix`, not the Marketplace. `publisher` is a
  deliberate placeholder and the extension id is `navigator.yuvava`. Do not
  "fix" it — the stored API key is keyed by it.
- **This repository is public.** Never put user code that was under review into
  an issue, a document, a comment, or the eval set. Record the pattern, not the
  code.

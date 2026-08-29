# Progress

Working memory for the next iteration. See DECISIONS.md for the reasoning
behind the shape of the code.

## Verification

```bash
npm install
npm run verify   # lint + compile + tests  (must be green before committing)
npm run package  # produces navigator.vsix
```

## Done — MVP (SPEC §19 Required)

- [x] Extension scaffold, activation, five commands, configuration.
- [x] `Navigator: Review Current Changes`.
- [x] Read-only git diff retrieval (`src/core/git.ts`, allowlisted subcommands).
- [x] Unified-diff parsing and line-numbered rendering (`src/core/diff.ts`).
- [x] AI review via the Anthropic Messages API with a JSON output schema
      (`src/core/anthropicProvider.ts`).
- [x] Structured result parsing and validation (`src/core/schema.ts`).
- [x] Code-generation sanitiser (`src/core/sanitize.ts`).
- [x] Anchoring to reviewed hunks (`src/core/anchor.ts`).
- [x] Diagnostics publishing (`src/vscode/diagnostics.ts`, `src/core/range.ts`).
- [x] Silence when there is nothing to report.
- [x] Failure paths: no git, bad base revision, no API key, no workspace,
      oversized diff, malformed response, model refusal, empty response.
- [x] Tests: 119 across diff, schema, sanitize, anchor, range, git, review
      pipeline, extension wiring, and the product invariant.
- [x] `npm run package` produces a working `.vsix`.

## Done — Optional (SPEC §19)

- [x] Status bar (§12.2) — hidden while idle, shows reviewing / N observations.
- [x] Review intensity (§15) — `silent` / `normal` / `strict`, prompt-level only.

## Not started — Optional, deliberately

- [ ] Progressive hints (§8). Needs an interaction surface that does not become
      a chat UI; the obvious designs all pull toward one. Think before building.
- [ ] Documentation navigation (§10).
- [ ] Recall assistance (§9).
- [ ] Automatic review (§14). Requires debounce/cooldown; SPEC §13 says only
      after the manual flow has proven useful.
- [ ] Review history.

## Invariant

`test/invariant.test.ts` is the guard for SPEC §16. It reads Navigator's own
source and fails if an edit path, code-action/completion/formatting provider,
filesystem write, non-git subprocess, or an "apply/fix/generate/refactor"
command is ever introduced. Do not weaken it to make a feature fit — the
invariant is the product.

## Known gaps

- The Anthropic provider itself is not covered by an automated test; doing so
  would mean either a network call or mocking the SDK's HTTP layer. Everything
  downstream of it is tested through the `ReviewProvider` interface, and the
  provider is deliberately thin (build request, check `stop_reason`, join text).
- No end-to-end test inside a real extension host. `test/extension.test.ts`
  activates the extension against a fake `vscode` module instead.

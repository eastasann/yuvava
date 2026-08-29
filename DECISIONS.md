# Decisions

Decisions a future agent would otherwise re-litigate. Small choices are not
recorded here; the code is.

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

## Decision: The API key lives in VS Code secret storage, not settings

`navigator.setApiKey` stores it via `context.secrets`; `ANTHROPIC_API_KEY` from
the environment is the fallback.

Reason:
A settings-backed key ends up in synced or committed JSON.

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

`vsce package` ships the compiled `out/` plus production dependencies (~2.7 MB).

Reason:
LOOP.md §6.6. A bundler is a build-time abstraction the MVP does not need, and
the packaged size is unremarkable for an extension. Revisit if startup cost
ever shows up.

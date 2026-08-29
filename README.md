# Navigator

> AIに依存しないために、AIを使う。

Navigator is a VS Code extension for developers who still want to write their
own code. It reviews the changes you have made and points at the problems it
finds — and then it stops. It does not write code, complete functions, offer
quick fixes, or modify a single byte of your workspace.

    Human = Driver
    AI    = Navigator

See [SPEC.md](SPEC.md) for the product definition and [DECISIONS.md](DECISIONS.md)
for why it is built the way it is.

## What it does

- `Navigator: Review Current Changes` reviews your working-tree diff, including
  new files git is not tracking yet (`.gitignore` is honoured, and nothing is
  ever staged to make them visible).
- Real problems show up as **diagnostics** in the editor and the Problems panel:
  correctness bugs, missed edge cases, unhandled null/undefined, error handling
  gaps, and — at higher intensity — concurrency, security and performance risks.
- When there is nothing worth saying, it says nothing.

## What it deliberately does not do

- It does not generate implementation code, patches or replacement snippets.
- It does not offer Quick Fixes, autocomplete, or "apply this change".
- It does not write to your files. The extension has no code path that can:
  `test/invariant.test.ts` fails the build if one is ever introduced.
- It does not summarise away the documentation you should be reading.

## Setup

1. Install the extension (`npm run package` produces `navigator.vsix`;
   install it with `code --install-extension navigator.vsix`).
2. Pick a provider with `navigator.provider` (`anthropic`, the default, or
   `openai`), then run `Navigator: Set API Key` — the key is kept in VS Code
   secret storage, one per provider. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
   from the environment are used as fallbacks.
3. Make some changes, then run `Navigator: Review Current Changes`.

## Commands

| Command | What it does |
| --- | --- |
| `Navigator: Review Current Changes` | Reviews the working tree against `navigator.diffBase`. |
| `Navigator: Clear Observations` | Removes Navigator's diagnostics. |
| `Navigator: Set API Key` | Stores the active provider's API key in secret storage. |
| `Navigator: Clear API Key` | Removes the active provider's stored key. |
| `Navigator: Show Log` | Opens the Navigator output channel. |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `navigator.provider` | `anthropic` | `anthropic` (Claude) or `openai` (GPT / Codex). |
| `navigator.model` | *(provider default)* | `claude-opus-5` or `gpt-5.1-codex-max` unless set. |
| `navigator.reviewIntensity` | `normal` | `silent`, `normal` or `strict` (SPEC §15). |
| `navigator.diffBase` | `HEAD` | Revision the working tree is compared against. |
| `navigator.includeUntracked` | `true` | Also review new, untracked files. |
| `navigator.maxDiffBytes` | `200000` | Diffs above this size are not sent. |
| `navigator.maxObservations` | `20` | Cap on observations per review. |

## Providers

Anthropic and OpenAI are held to the same contract: the same system prompt, the
same JSON response schema, the same validation, and the same sanitiser. Which
one reviews changes who is looking over your shoulder — it changes nothing
about what Navigator is allowed to do with the answer, and
`test/providerFactory.test.ts` checks that a replacement implementation is
stripped whichever provider returns it.

## Development

```bash
npm install
npm run verify   # lint + typecheck/compile + tests
npm run package  # build navigator.vsix
```

Agents working on this repository should read [AGENTS.md](AGENTS.md) first.

The code is split so the interesting parts are testable outside the editor:

- `src/core/` — git, diff parsing, prompt, providers, response validation,
  sanitising, anchoring. No `vscode` import; a test-enforced boundary.
- `src/vscode/` — commands, diagnostics, status bar. Thin by design.
- `test/` — unit tests, including `invariant.test.ts`, which reads Navigator's
  own source to prove it cannot edit yours.

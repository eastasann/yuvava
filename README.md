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
- `Navigator: Where Should I Look?` takes what you are trying to do and names
  what it involves — the APIs, the concepts, the decisions — plus the words to
  search for. It does not answer the question.
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

Navigator is installed from a locally built `.vsix`; it is not on the
Marketplace.

```bash
npm install
npm run install:local
```

That runs `npm run verify`, builds `yuvava.vsix`, and installs it with
`code --install-extension yuvava.vsix --force`. Then, in VS Code, run
**Developer: Reload Window** — the new build does not take effect until you do.

Next:

1. Pick a provider with `navigator.provider` (`anthropic`, the default, or
   `openai`), then run `Navigator: Set API Key` — the key is kept in VS Code
   secret storage, one per provider. `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
   from the environment are used as fallbacks.
2. Make some changes, then run `Navigator: Review Current Changes`.

## Updating

A sideloaded extension never updates itself — VS Code only auto-updates
Marketplace extensions. Every update is the same three steps:

```bash
git pull
npm ci                 # only when dependencies changed
npm run install:local
```

then **Developer: Reload Window**. `--force` is what lets a rebuild replace an
identical version number; without it VS Code sees the extension is already
installed and does nothing.

Bumping the version (`npm version patch`) before rebuilding is worth the extra
second: otherwise the Extensions view always reads `0.1.0`, and you cannot tell
this morning's build from last week's.

Useful while operating it:

```bash
code --list-extensions --show-versions | grep yuvava
code --uninstall-extension navigator.yuvava
```

The extension id is `navigator.yuvava` — `publisher` is still a placeholder,
since publishing is not the plan. Settings live in `settings.json` and survive
updates; the API key lives in secret storage keyed by that id, so it survives
updates too, but changing `publisher` or `name` would orphan it and you would
run `Navigator: Set API Key` once more.

If `code` is not found, run **Shell Command: Install 'code' command in PATH**
from the VS Code command palette.

## Commands

| Command | What it does |
| --- | --- |
| `Navigator: Review Current Changes` | Reviews the working tree against `navigator.diffBase`. |
| `Navigator: Where Should I Look?` | Names what a task involves, and what to search for. Answers nothing. |
| `Navigator: Clear Observations` | Removes Navigator's diagnostics. |
| `Navigator: Set API Key` | Stores the active provider's API key in secret storage. |
| `Navigator: Clear API Key` | Removes the active provider's stored key. |
| `Navigator: Show Log` | Opens the Navigator output channel. |

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `navigator.provider` | `anthropic` | `anthropic` (Claude) or `openai` (GPT / Codex). |
| `navigator.model` | *(provider default)* | `claude-opus-5` or `gpt-5.1-codex-max` unless set. |
| `navigator.openaiBaseUrl` | *(empty)* | An OpenAI-compatible endpoint to use instead of OpenAI. |
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

## Using another endpoint

`navigator.openaiBaseUrl` points the OpenAI provider at anything that speaks
the OpenAI API — a free tier, or a model on your own machine:

```jsonc
// Groq
"navigator.provider": "openai",
"navigator.openaiBaseUrl": "https://api.groq.com/openai/v1",
"navigator.model": "llama-3.3-70b-versatile",

// Ollama, locally — nothing leaves the machine
"navigator.openaiBaseUrl": "http://localhost:11434/v1",
"navigator.model": "qwen2.5-coder:14b",
```

Setting it switches the request to `/chat/completions`, which is what those
services implement; OpenAI itself keeps using the Responses API. If the
endpoint rejects the JSON schema, Navigator retries once without it and
validates the answer locally — the fallback is noted in the log.

> **Your diff is sent to whatever you point this at.** Free tiers commonly
> train on the data they receive; check the provider's terms. Navigator is a
> personal learning tool and does not manage this for you — where your code
> goes is your decision. Point it at a local model if that matters.

## Development

```bash
npm install
npm run verify         # lint + typecheck/compile + tests — the gate
npm run package        # build yuvava.vsix
npm run install:local  # verify, build, and install into VS Code
```

Agents working on this repository should read [AGENTS.md](AGENTS.md) first.

The code is split so the interesting parts are testable outside the editor:

- `src/core/` — git, diff parsing, prompt, providers, response validation,
  sanitising, anchoring. No `vscode` import; a test-enforced boundary.
- `src/vscode/` — commands, diagnostics, status bar. Thin by design.
- `test/` — unit tests, including `invariant.test.ts`, which reads Navigator's
  own source to prove it cannot edit yours.

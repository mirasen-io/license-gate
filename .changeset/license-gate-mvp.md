---
'@mirasen/license-gate': major
---

Initial implementation of `@mirasen/license-gate` — a strict, local, default-deny license
policy gate for npm projects (single-package, workspaces, monorepos).

- Two CLI commands: `license-gate check` (gate the installed graph against
  `licenses/allowed-hard.txt` and `licenses/allowed-packages.txt`) and `license-gate
collect` (enumerate installed package/license metadata, no policy I/O).
- Project root is always `process.cwd()` — no walk-up rescue, no `--cwd`.
- Graph discovery via `@npmcli/arborist.loadActual()` + `tree.inventory`. Captures
  non-hoisted workspace installs and transitive duplicates.
- `--workspace <name|path>` narrows the evaluation set via reachability over
  `node.edgesOut` (never by realpath prefix, never by re-pointing Arborist).
- License detection is non-inferential: only a non-empty string `package.json#license`
  is read. Object/array shapes and missing fields map to `could not determine`.
- Literal-first matching: the full license string is searched in `allowed-hard.txt`
  before any SPDX parsing.
- SPDX boolean shape (OR/AND/parens) is supported via `spdx-expression-parse`. Each
  leaf — including WITH-exception leaves rendered as `"<license-id> WITH <exception-id>"`
  composites — is a literal allowlist lookup. No normalisation, no `spdx-correct`, no
  `spdx-satisfies`.
- Two top-level violation reasons (`license-not-in-allowlist`,
  `package-not-in-allowlist`) with two diagnostic detail codes
  (`literal-not-allowed-and-spdx-unparseable`, `spdx-expression-not-satisfied`).
- `check --out` is rejected with exit 2; output flags are `check --json <path>` and
  `collect --out <path>` / `collect --json <path>`.
- Programmatic API exported from `@mirasen/license-gate` (`runCheck`, `runCollect`).
- Engines tightened to Node ≥22.9.0.

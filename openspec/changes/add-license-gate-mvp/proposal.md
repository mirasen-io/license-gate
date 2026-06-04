## Why

`@mirasen/license-gate` exists to enforce a strict, local, default-deny license policy on the
installed npm dependency graph of commercial projects. The repository is a fresh bootstrap
with no runtime behaviour yet: `src/index.ts` is empty, there is no `bin`, and no policy.

Existing tools in this space (e.g. `license-checker-rseidelsohn`) rely on license-text
guessing, SPDX correction, semantic SPDX-satisfies matching, and clarification systems —
each is an implicit trust hole. We want the opposite: literal allowlists, no inference, no
normalisation, no silent excludes, visible package overrides, and a small CLI surface that
cannot be relaxed by command-line tricks. Modern npm `package.json` represents multiple
licenses with a single SPDX expression string (`(MIT OR Apache-2.0)`,
`(MIT AND BSD-3-Clause)`); v1 must therefore evaluate SPDX boolean expressions while still
treating each leaf as a literal allowlist lookup.

## What Changes

- Add a new capability `license-gate` defining the gate's behaviour.
- Add a CLI binary `license-gate` with two subcommands:
  - `license-gate check` — evaluate the installed graph against policy and exit 0/1/2.
  - `license-gate collect` — enumerate installed package/license metadata as a flat report
    (no policy I/O).
- **Project root rule:** the project root is `--cwd <path>` if supplied, otherwise
  `process.cwd()`. The CLI requires `package.json` to exist directly at the selected
  project root and never walks upward. There is no `--root` or `--project` alias and
  no walk-up rescue. All project-relative paths (`licenses/allowed-hard.txt`,
  `licenses/allowed-packages.txt`, `--workspace` relative paths, `--out`, `--json`)
  resolve against the selected project root.
- Adopt `@npmcli/arborist` (`loadActual()` + `tree.inventory`) as the sole graph-discovery
  primitive. No hand-rolled `node_modules` walker in v1.
- Adopt `spdx-expression-parse` strictly for SPDX boolean expression shape (OR / AND /
  parentheses) — never for normalisation or semantic compatibility. No `spdx-correct`, no
  `spdx-satisfies`.
- Define fixed allowlist files at the project root: `licenses/allowed-hard.txt` (required
  for `check`, not read by `collect`) and `licenses/allowed-packages.txt` (optional, read
  only for `check`). Paths are not configurable.
- Define `--workspace <name|path>` narrowing that always loads Arborist from the
  selected project root and filters by reachability from the workspace node via
  `node.edgesOut → edge.to` (never by realpath prefix, never by re-pointing Arborist at
  the workspace path).
- Define `--cwd <path>` (both commands) as explicit project-root selection — not a
  search starting point. When omitted, the project root defaults to `process.cwd()`.
- Define `--json <path>` (both commands) and `--out <path>` (`collect` only) as explicit
  path outputs. `--json` is never a stdout-format toggle. `check --out <path>` is rejected
  as invalid usage with exit 2.
- Define exit codes: `0` clean, `1` policy violations, `2` config / usage / runtime errors.
- Define violation model with two top-level policy reasons —
  `license-not-in-allowlist` and `package-not-in-allowlist` — and two diagnostic detail
  codes under `license-not-in-allowlist`:
  `literal-not-allowed-and-spdx-unparseable` and `spdx-expression-not-satisfied`. Config
  errors are a separate type and never appear as violation reasons.
- Tighten `engines.node` to `>=22.9.0` (forced by `@npmcli/arborist@9` and a stable
  `node:util.parseArgs`).
- Add `bin: { "license-gate": "./dist/cli.js" }` and runtime `dependencies`
  `@npmcli/arborist`, `spdx-expression-parse` to `package.json`.
- Define explicit non-goals locking out walk-up autodiscovery, `--root`/`--project`
  aliases, clarifications, license-text reading, normalisation, semantic SPDX matching,
  denylists, configurable allowlist paths, deprecated `license`/`licenses[]` shape
  unwrapping, pnpm/yarn, Gradle/Maven, bundle analysers, markdown/tree visualisers,
  SaaS/enterprise modes.

## Capabilities

### New Capabilities

- `license-gate`: a strict local license policy gate over the installed npm dependency
  graph. Discovers all installed packages (including non-hoisted workspace installs and
  transitive duplicates) via `@npmcli/arborist`, evaluates each against literal allowlists
  with literal-first matching plus SPDX boolean shape (OR / AND / parens) where each leaf
  is still a literal allowlist lookup, collects all violations before exiting, and emits
  human-readable reports by default with optional JSON file output. Provides a flat
  enumeration command (`collect`) that performs no policy I/O.

### Modified Capabilities

(none — `openspec/specs/` is empty; this is the first capability.)

## Impact

- **New code**: `src/cli.ts` (bin entry), `src/index.ts` (programmatic `check`/`collect`
  API), `src/graph/`, `src/policy/`, `src/report/`, `src/commands/`. Implementation only;
  no policy thresholds embedded in code.
- **`package.json`**:
  - add `bin: { "license-gate": "./dist/cli.js" }`
  - add runtime `dependencies`: `@npmcli/arborist`, `spdx-expression-parse`
  - tighten `engines.node` to `>=22.9.0`
- **No new dev tooling** beyond the bootstrap (vitest, eslint, tsc, changesets, publint).
- **Tests**: fixture-driven vitest suite under `tests/` exercising real `npm install`
  layouts (single-package, hoisted workspaces, non-hoisted conflict, nested duplicates,
  workspace-on-workspace, license-shape variants, override grammar, SPDX expressions),
  plus a packaging smoke test that the built `license-gate` binary actually runs.
- **Docs**: README gains usage, philosophy, "strict by design" non-goals enumeration,
  allowlist file format, override grammar, exit codes, FAQ on `Apache 2.0` vs `Apache-2.0`,
  `UNLICENSED`, internal scopes, and the `process.cwd()` / no-walk-up rule.
- **Out of scope for this change**: pnpm/yarn graph discovery, license file reading,
  configurable allowlist paths, deprecated license-shape unwrapping, denylists, project
  root walk-up.

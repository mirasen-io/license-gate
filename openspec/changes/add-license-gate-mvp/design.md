## Context

`@mirasen/license-gate` is a fresh package: `src/index.ts` is `export {};`, no `bin`, no
runtime deps, ESM (`type: module`, NodeNext). The MVP must turn it into a small hard-mode
CLI that gates installed npm dependency graphs against a literal license allowlist.

The exploration phase produced an empirical artefact at `EXPLORE.md` that includes live
probes of `@npmcli/arborist@9` and `spdx-expression-parse@4`. Key empirical findings used
as inputs here:

- `Arborist.loadActual()` from the project root produces `tree.inventory` (a `Map`) with
  every unique installed copy by realpath — including non-hoisted `lodash@3.10.1` inside
  `apps/web/node_modules/`, transitive duplicates at distinct physical paths, and
  workspace nodes (`isWorkspace: true, isLink: true`).
- Running Arborist with `path = apps/web` does **not** see hoisted dependencies of the
  parent root. So `--workspace` filtering must be done **after** loading from the project
  root, not by re-pointing Arborist at a subdirectory.
- `spdx-expression-parse` fails on `"Apache 2.0"` (space), `"UNLICENSED"`,
  `"SEE LICENSE IN ..."`, and `""` — exactly the behaviour we want for non-inferential
  matching, provided we order literal matching first and SPDX shape second.
- `@npmcli/arborist@9.7.0` declares `engines.node: "^20.17.0 || >=22.9.0"`. Our current
  `>=22` is too loose.

Stakeholders: commercial consumers of npm packages who need a CI-time veto before
shipping. The user persona is "lawyer-aligned engineer who picks a finite set of licences
and refuses anything else".

## Goals / Non-Goals

**Goals:**

- Default-deny gate: anything not literally allowed is a violation.
- Discover the **entire** installed graph (root + workspaces + non-hoisted + nested
  duplicates) without writing a `node_modules` walker.
- Non-inferential license detection: read only `package.json#license` when it is a
  non-empty string after trimming; everything else is `could not determine`.
- Literal-first matching with SPDX boolean shape (OR / AND / parens) as a secondary stage.
  Each leaf is still a literal allowlist lookup. No normalisation, no `spdx-correct`, no
  `spdx-satisfies`.
- Fixed allowlist file paths at the project root to prevent CI-line policy relaxation.
- Strict, explicit grammar for package overrides — three forms only.
- Visible overrides in reports (no silent excludes).
- Collect-all-then-exit: never fail-fast.
- Two commands only: `check` and `collect`. Output flags only: `check --json <path>`,
  `collect --json <path>`, `collect --out <path>`.
- Pure-policy / pure-graph / pure-reporter layers; only `commands/` does I/O and exit.
- Two top-level policy violation reasons (`license-not-in-allowlist`,
  `package-not-in-allowlist`) with diagnostic detail codes for SPDX outcomes.
- Ship as the npm package `@mirasen/license-gate` with binary `license-gate`, runnable via
  `npx`, local install + `npx license-gate ...`, and npm scripts.

**Non-Goals:**

- Project-root walk-up autodiscovery. The project root is always `process.cwd()`.
- `--cwd`, `--root`, `--project`, or any equivalent location flag.
- Clarification JSON, checksum-based evidence, `licenseStart`/`licenseEnd`.
- License-text reading (`LICENSE`, `LICENCE`, `COPYING`, `README`).
- License normalisation, `spdx-correct`, `spdx-satisfies`.
- Denylist files.
- Configurable allowlist paths in v1.
- pnpm / yarn / Gradle / Maven / non-npm support.
- Bundle-level Vite/Rollup analysis.
- Markdown reports / tree visualisers.
- Silent excludes of any kind.
- Enterprise / SaaS / upload modes.
- Unwrapping deprecated `license` object form or `licenses[]` array form.
- A configurable boolean `--json` toggling stdout format.
- `--workspace --all` (default already means all).
- `check --out <path>` (no human file output for `check` in v1).

## Decisions

### D1. Project root is `process.cwd()` only — no walk-up

**Choice:** The CLI treats `process.cwd()` as the project root. It requires
`package.json` to exist directly in `process.cwd()`. If absent, exit code 2 with a clear
message. If present and it declares `workspaces`, the project is a workspace project;
otherwise it is a single-package project.

**Why:** Walk-up autodiscovery rescues users from running from the wrong directory at the
cost of CI ambiguity ("which root did the gate run against?"). For a strict gate, the
right answer is to refuse rather than to guess. CI and humans alike must run from the
intended npm project root.

**Alternatives considered:**

- Walk up to the nearest `package.json` with `workspaces`: rejected — hides the actual
  project root from the user, lets a CI step accidentally evaluate a parent project.
- `--cwd <path>`: rejected for v1 — increases surface area without earning its weight when
  callers can `cd` first.

### D2. Graph discovery uses `@npmcli/arborist.loadActual()` + `tree.inventory`

**Choice:** Always `new Arborist({ path: process.cwd() }); await arb.loadActual();` then
iterate `tree.inventory.values()`. The Arborist `path` is always `process.cwd()` — never
an ancestor (no walk-up rescue) and never the path of a `--workspace` selection. If
`process.cwd()` happens to be a workspace subdirectory, that directory is treated as the
project root and Arborist is invoked there; the fact that some other ancestor declares
`workspaces` is irrelevant to v1.

**Why:** Empirically verified that this single call captures non-hoisted workspace
installs, nested transitive duplicates at distinct realpaths, and workspace-as-link
nodes — every discovery edge case the v1 must handle. Pinning Arborist to
`process.cwd()` keeps the project-root rule self-consistent: there is exactly one root,
and the user picked it by `cd`.

**Alternatives considered:**

- Hand-rolled `fs.readdir` recursion over `node_modules/**/package.json`: forces us to
  re-implement workspace symlink loops, scoped-name parsing, link-vs-target dedup, nested
  install corner cases. Rejected as bug surface.
- `Arborist.loadVirtual()` (lock-file based): inaccurate when `node_modules` is the
  source of truth (post-`npm ci`); we are gating shipped graphs, not lockfiles.
- `Arborist.buildIdealTree()`: describes what _should_ be installed, not what _is_.

**Trade-off:** Arborist 9 brings ~113 transitive packages. Acceptable for v1 and
encapsulated behind `src/graph/load.ts` so the implementation is replaceable later.

### D3. `--workspace` resolves and narrows in the cwd-rooted tree; never re-points Arborist

**Choice:** When `--workspace <name|path>` is used from a workspace project root,
Arborist still loads from `process.cwd()` per D2. The selected workspace is then resolved
inside that already-loaded tree — by name via `tree.workspaces.get(name)`, or by path by
resolving the user-provided path against `process.cwd()` and matching it to a workspace
node's `node.realpath`/`node.path`. Narrowing is performed by BFS over
`node.edgesOut → edge.to` from the resolved workspace node; the evaluation set is
`{wsNode} ∪ reachable`, deduplicated by `realpath`. The system never invokes Arborist with
the selected workspace's path.

**Why:** Empirical finding — invoking Arborist at a workspace subdirectory loses every
hoisted dependency that the workspace transitively depends on. Realpath-prefix filtering
also loses hoisted deps because they live under the project root, not under the workspace
path. Loading once at `process.cwd()` and filtering by edge-reachability is the only
approach that captures hoisted reachable deps for a single workspace.

**Note on the no-walk-up rule:** D3 does not contradict D1/D2. The "Arborist is never
invoked at a workspace subdirectory" rule applies specifically to `--workspace`
narrowing — it forbids the implementation from re-pointing Arborist at the selected
workspace. It does not say the tool refuses to run when `process.cwd()` is itself a
workspace subdirectory; in that case `process.cwd()` is the project root by D1 and
Arborist is invoked there by D2.

**Alternatives considered:**

- Realpath-prefix filter only: rejected — misses hoisted deps.
- Re-running Arborist at the workspace path for narrowing: rejected — same reason.

### D4. License detection is non-inferential: only `package.json#license` as string

**Choice:** Read `node.package.license`. If it is a string and is non-empty after trimming,
record the trimmed string verbatim. Anything else (missing, empty, object, array,
non-string) → record the sentinel `"could not determine"`.

**Why:** Any other path is inference. Even unwrapping `{type: "MIT"}` is schema-level
inference and creates a soft trust hole. Strict v1 keeps the trust path flat.

**Alternatives considered:**

- Reading `LICENSE`/`COPYING` text: rejected — explicit non-goal.
- Unwrapping deprecated `{type}` and `licenses[]` forms: rejected for v1; reconsider only
  if real-world friction emerges in v1.x.

### D5. Literal-first evaluation; SPDX shape as supported npm syntax

**Choice:** For each evaluated package, the decision pipeline is:

```
1. If license == "could not determine":
     if package matches an allowed-packages.txt rule:
         decision: allowed-by-{scope|package-version}-rule
     else:
         decision: violation { reason: "package-not-in-allowlist" }
2. If the literal license string equals any line in allowed-hard.txt:
     decision: allowed-by-license
3. Otherwise try spdx-expression-parse on the license string:
     a. parse fails:
          if package matches an allowed-packages.txt rule:
              decision: allowed-by-{scope|package-version}-rule
          else:
              decision: violation {
                  reason: "license-not-in-allowlist",
                  detailCode: "literal-not-allowed-and-spdx-unparseable",
                  raw: <license string>
              }
     b. parse succeeds: walk AST literally:
          - leaf: literal-match against allowed-hard.txt; a leaf produced by an SPDX
                  WITH-exception is treated as ONE literal string of the form
                  "<license-id> WITH <exception-id>" (verbatim, no normalisation)
          - OR  : satisfied if EITHER side satisfied
          - AND : satisfied if BOTH sides satisfied
        if satisfied:
            decision: allowed-by-license
        else:
            if package matches an allowed-packages.txt rule:
                decision: allowed-by-{scope|package-version}-rule
            else:
                decision: violation {
                    reason: "license-not-in-allowlist",
                    detailCode: "spdx-expression-not-satisfied",
                    raw: <license string>,
                    offendingLeaves: [<leaves not in allowed-hard.txt>]
                }
4. If both license-allow AND override match: license-allow wins (overrides are escape
   hatches; matchedPackageRule is not reported in that case).
```

**Why:** Literal-first prevents the SPDX parser from acting as a normalisation engine —
strings like `"Apache 2.0"`, `"UNLICENSED"`, `"SEE LICENSE IN LICENSE.md"` reach the
allowlist as-is and pass only when the user has literally permitted them. SPDX shape is
included because modern npm encodes multi-licence packages (`(MIT OR Apache-2.0)`,
`(MIT AND BSD-3-Clause)`) in this exact syntax — refusing to parse the shape would force
every multi-licence package through `allowed-packages.txt`.

### D5a. SPDX WITH-exception evaluation

**Choice:** A WITH-exception leaf in a parsed SPDX AST (`{ license: "<id>", exception:
"<exc>" }`) is treated as **one literal string** of the form
`"<license-id> WITH <exception-id>"`, joined with a single ASCII space on each side of
`WITH`. That single composite string is the literal compared against `allowed-hard.txt`.
The system SHALL NOT split the leaf, SHALL NOT consider the bare `<license-id>` against
the allowlist, SHALL NOT normalise the licence id, SHALL NOT normalise the exception id,
and SHALL NOT apply any legal-compatibility semantics.

The same flow as D5 applies around it:

- Step (2) — full literal match — runs first against the original `license` string.
- If that fails and the string parses as SPDX with a WITH-exception leaf, step (3b)
  walks the AST and reduces the WITH leaf to a single literal `"<id> WITH <exc>"` for
  allowlist comparison.
- If `spdx-expression-parse` cannot parse the string at all, the package fails per step
  (3a) with `reason: "license-not-in-allowlist"` and
  `detailCode: "literal-not-allowed-and-spdx-unparseable"`.

**Example.**

`license: "GPL-2.0-only WITH Classpath-exception-2.0"`:

1. Full-literal match: `"GPL-2.0-only WITH Classpath-exception-2.0"` is searched in
   `allowed-hard.txt`. If present, decision is `allowed-by-license` and SPDX is not
   consulted.
2. If absent, attempt SPDX parse. If parsing succeeds and yields a WITH-exception leaf,
   the leaf is rendered back to the literal `"GPL-2.0-only WITH Classpath-exception-2.0"`
   and that exact string is searched in `allowed-hard.txt`. (For a single-leaf input,
   step 1 and step 3b's leaf compare necessarily produce the same result; for an input
   like `"(MIT OR (GPL-2.0-only WITH Classpath-exception-2.0))"` the WITH leaf is one of
   the OR branches and is compared as a single literal string.)
3. If SPDX parsing fails, the package fails with
   `reason: "license-not-in-allowlist"` and
   `detailCode: "literal-not-allowed-and-spdx-unparseable"`.

**Why:** Treating `<id> WITH <exc>` as one literal preserves the no-normalisation
discipline. The user has to consciously add the precise composite string to
`allowed-hard.txt` — this acknowledges that a licence with an exception is not the same
policy artefact as the bare licence, and avoids the SPDX parser becoming a back-door
relaxation engine.

**Alternatives considered:**

- Compare only the bare `<license-id>` part against `allowed-hard.txt`: rejected —
  silently drops the exception from the policy decision; effectively normalises by
  discarding information.
- Apply `spdx-satisfies` semantics for exceptions: rejected — pulls semantic
  compatibility into v1, which is a non-goal.

### D6. Two top-level policy violation reasons; SPDX outcomes are diagnostic detail

**Choice:** The decision union has exactly two top-level policy violation reasons:

- `license-not-in-allowlist` — package has a usable explicit `package.json` license string
  that did not match `allowed-hard.txt` literally and was not satisfied by SPDX shape (or
  failed SPDX parsing), and is not covered by `allowed-packages.txt`.
- `package-not-in-allowlist` — package's recorded license is `could not determine` and is
  not covered by `allowed-packages.txt`.

`license-not-in-allowlist` carries an optional `detailCode`:

- `literal-not-allowed-and-spdx-unparseable` — when SPDX parsing failed.
- `spdx-expression-not-satisfied` — when SPDX parsing succeeded but the expression was not
  satisfied.

When `detailCode === "spdx-expression-not-satisfied"`, the violation also carries
`offendingLeaves: string[]`.

**Why:** Top-level policy reasons are the language operators see in CI output and JSON
filtering. Two reasons map cleanly to the two human questions: "do we know what licence
this is?" and "is the licence on our list?". Diagnostic codes preserve the SPDX-vs-literal
distinction for engineers debugging a finding.

**Alternatives considered:**

- Three or four top-level reasons (`license-could-not-determine`,
  `license-not-in-allowlist`, `license-expression-unparseable`,
  `license-expression-leaf-not-allowed`): rejected — finer granularity than policy users
  want, and conflates "we don't know the licence" with structural issues better expressed
  as detail codes.

### D7. Fixed allowlist file paths

**Choice:** `licenses/allowed-hard.txt` (required for `check`, never read by `collect`)
and `licenses/allowed-packages.txt` (optional, read only by `check`), resolved relative to
`process.cwd()`. No CLI flag, no `package.json` config, no env var.

**Why:** A configurable hard gate is a relaxable hard gate. CI invocations should not be
able to point at a permissive file.

**Trade-off:** Power users in unusual layouts cannot relocate the files. Acceptable for
v1; revisit only on concrete pressure.

### D8. allowed-packages.txt grammar — three forms, strict reject otherwise

**Accepted:**

- `@scope/*` — trusted internal namespace.
- `package-name@version` — exact installed package version.
- `@scope/package@version` — exact installed scoped package version.

**Rejected (config error, exit 2):** bare names, scoped without version, any form ending
in `*` other than `@scope/*`, semver ranges (`^1.2.3`, `~1.2.3`, `1.x`, `>=1.0.0`, etc.),
`*`, regex, generic globs, prefix matching, partial wildcards.

**Why:** Each rejected form opens a different inference path. The grammar is intentionally
narrow so that human reviewers reading `allowed-packages.txt` know exactly what it
permits.

### D9. Override precedence in reports

When multiple overrides match a package — for example both `@scope/*` and
`@scope/foo@1.2.3` — the **more specific** rule wins in the report's `matchedPackageRule`
field. This gives the audit trail more information, not less.

When license-allowlist and override both match, the decision is `allowed-by-license`. The
`matchedPackageRule` field is omitted in that case (overrides only show up when they
actually saved the package).

### D10. Workspace package handling

- The **root** package is **skipped** when `--workspace` is not specified. It is the
  project being checked, not a dependency. Skipping is acknowledged in the report as
  `(skipped: project root)`, never silent.
- **Workspace** packages **are** evaluated like any other dependency. Internal monorepo
  packages should be listed via `@scope/*` in `allowed-packages.txt`.
- When `--workspace <name|path>` is supplied, the workspace node itself is included in
  the evaluation set (it is now the root of attention).

### D11. CLI parser: `node:util.parseArgs`

**Choice:** Built-in `parseArgs` from Node ≥22.9. No `commander`, `yargs`, `nopt`.

**Why:** Two subcommands and a small flag set. The built-in is sufficient and brings zero
dependencies. Strict unknown-flag rejection is straightforward.

### D12. Output model

- `check`: human-readable to stdout always. `--json <path>` writes machine-readable JSON
  additionally. **`check --out <path>` is rejected with exit 2** (the policy verdict
  belongs on stdout/CI logs, not a side file).
- `collect`: human-readable to stdout by default. `--out <path>` writes the same human
  report to a file and **suppresses** stdout duplication (only a one-line "wrote N records
  to <path>" stays on stdout). `--json <path>` writes machine-readable JSON.
- JSON / human files are awaited and closed before `process.exit`. We do not require
  `fsync` — normal awaited write/close is sufficient on Node 22.
- `--json` is **never** a boolean toggle.
- Failure to write `--json`/`--out` paths → exit 2.

### D13. Exit codes

- `0` — success (no violations on `check`; `collect` finished).
- `1` — at least one policy violation.
- `2` — usage / config / runtime error: invalid CLI args (including unknown subcommands,
  unknown flags, and `check --out`), missing required `licenses/allowed-hard.txt`,
  invalid override rule, missing `package.json` in `process.cwd()`, missing
  `node_modules`, unknown/invalid workspace, unwritable output path.

### D14. Engines and dependencies

- `engines.node`: tighten to `>=22.9.0` (forced by Arborist 9, also gives us a stable
  `node:util.parseArgs`).
- Runtime deps: `@npmcli/arborist`, `spdx-expression-parse`. Nothing else.
- No new dev deps.

### D15. Module structure and purity boundaries

```
src/
├── index.ts                  # programmatic API: { check, collect }
├── cli.ts                    # bin entry: util.parseArgs → dispatch
├── graph/
│   ├── load.ts               # Arborist load wrapper
│   ├── narrow.ts             # --workspace BFS reachability filter
│   └── record.ts             # Arborist node → InstalledPackageRecord
├── policy/
│   ├── allowed-hard.ts       # parse & validate allowed-hard.txt
│   ├── allowed-packages.ts   # parse & strictly validate allowed-packages.txt
│   ├── spdx-shape.ts         # boolean walk over spdx-expression-parse AST
│   └── evaluate.ts           # records + allowlists → Decision[]
├── report/
│   ├── human.ts              # human-readable report
│   └── json.ts               # JSON serialiser
└── commands/
    ├── check.ts              # orchestrate check
    └── collect.ts            # orchestrate collect
```

Import discipline (enforced by review):

- `policy/` — pure functions over types. **No** fs, **no** Arborist.
- `graph/` — knows fs and Arborist. **No** policy knowledge.
- `report/` — consumes already-decided records. **No** fs, **no** graph, **no** Arborist.
- `commands/` — only layer doing I/O, exit codes, stdout/stderr.
- `index.ts` — re-exports `check`/`collect` programmatic API.
- `cli.ts` — only argv parsing and dispatch; no business logic.

There is no `repo-root.ts` module: `process.cwd()` is the project root.

### D16. Internal types

```ts
type InstalledPackageRecord = {
  name: string;
  version: string;
  packageId: string;        // `${name}@${version}`
  path: string;             // node.realpath
  workspace: string | null; // closest workspace node's name, or null
  license: string | "could not determine";
  repository?: string;
  publisher?: string;
  email?: string;
};

type Decision =
  | { record: InstalledPackageRecord; outcome: "allowed-by-license" }
  | { record: InstalledPackageRecord; outcome: "allowed-by-scope-rule";
      matchedPackageRule: string }
  | { record: InstalledPackageRecord; outcome: "allowed-by-package-version-rule";
      matchedPackageRule: string }
  | { record: InstalledPackageRecord; outcome: "violation"; reason: ViolationReason };

type ViolationReason =
  | { kind: "license-not-in-allowlist";
      raw: string;
      detailCode?: "literal-not-allowed-and-spdx-unparseable"
                 | "spdx-expression-not-satisfied";
      offendingLeaves?: string[]; // present when detailCode === "spdx-expression-not-satisfied"
    }
  | { kind: "package-not-in-allowlist" };

type ConfigError =
  | { kind: "missing-package-json"; cwd: string }
  | { kind: "missing-node-modules"; cwd: string }
  | { kind: "missing-allowed-hard-file"; path: string }
  | { kind: "invalid-package-override-rule"; line: string; lineNumber: number; path: string }
  | { kind: "invalid-workspace"; query: string }
  | { kind: "output-path-unwritable"; path: string; cause: string }
  | { kind: "invalid-usage"; message: string }; // e.g. `check --out`
```

`Decision` and `ViolationReason` are closed discriminated unions. Reporters must
exhaustively match.

`ConfigError` is separate from `ViolationReason`: config errors halt evaluation and exit
2; violations are aggregated and exit 1.

### D17. Packaging and bin

- `package.json` declares `bin: { "license-gate": "./dist/cli.js" }`.
- `src/cli.ts` is the bin entry source. `tsc` emits `dist/cli.js`. The build pipeline
  ensures the emitted file starts with a `#!/usr/bin/env node` shebang and is executable.
  The simplest path: `src/cli.ts` first line is `#!/usr/bin/env node`; `tsc` preserves it
  (TypeScript treats top-of-file shebangs as comments). A small post-build step ensures
  the file mode includes the executable bit.
- A packaging smoke test (`tests/smoke/`) runs the built binary in a child process and
  asserts at least: `--help`-like exit, version output if any, and a known-good fixture
  invocation against a tiny throwaway project. The test runs from `dist/`.

## Risks / Trade-offs

- **[Risk] Arborist transitive footprint (~113 packages).** → Encapsulated behind
  `graph/load.ts`. Documented in README. Replaceable behind a stable internal interface
  if it becomes a real complaint.
- **[Risk] `npm` version skew.** → Document: run `license-gate` after `npm ci` in the
  same environment that produces the shipped graph.
- **[Risk] Optional dependencies that did not install on the host platform are
  invisible.** → `loadActual()` reflects the *physically* installed graph, which is the
  right surface for a gate. Document.
- **[Risk] `WITH` exception expressions** (e.g. `GPL-2.0-only WITH
  Classpath-exception-2.0`). Per D5a, a parsed WITH-exception leaf is reduced to one
  literal `"<id> WITH <exc>"` string and compared verbatim against `allowed-hard.txt`.
  If `spdx-expression-parse` cannot parse the input at all, the package fails with
  `license-not-in-allowlist` / `literal-not-allowed-and-spdx-unparseable`. Users who
  need to ship such a package without listing the composite literal can allow it via
  `allowed-packages.txt`. Documented as deterministic v1 behaviour.
- **[Risk] First-party workspace packages without explicit `license` field.** → They
  become `package-not-in-allowlist`. Mitigation: README tells users to add their own
  scope (`@my-co/*`) to `allowed-packages.txt`. Intentional, not a bug — silent
  acceptance would violate the no-silent-excludes rule.
- **[Risk] CI step launched from the wrong directory.** → No walk-up rescue; we exit 2
  with a clear "no package.json in <cwd>" message. CI failure surfaces the
  misconfiguration immediately.
- **[Trade-off] No `check --out`.** → `check`'s output is the verdict; tee or redirect
  shells if you want both stdout and a file copy. JSON is the structured contract.
- **[Trade-off] Fixed allowlist paths reduce flexibility.** → Accepted: an unforgeable
  policy file path is a feature.
- **[Trade-off] No deprecated license-shape unwrapping.** → Accepted; revisit only on
  concrete real-world friction.

## Migration Plan

This is a greenfield package at version `0.0.0`. No migration: the change introduces the
binary, the runtime deps, the engines bump, and the spec. Release happens through the
existing `changeset` flow already wired in the bootstrap.

Rollback strategy: revert the change. There are no consumers yet.

## Open Questions

(Resolved in this revision.)

- Project root: `process.cwd()` only, no walk-up. Resolved.
- `--cwd`: not in v1. Resolved.
- `check --out`: not in v1. Resolved.
- `collect` and `--workspace`: yes, supported. Resolved.
- `collect` reading allowlist files: no — `collect` performs no policy I/O. Resolved.
- Behaviour when `node_modules` is absent: exit 2 with `missing-node-modules` and a hint
  to run `npm ci`. Resolved.

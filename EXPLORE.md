# Exploration report — `@mirasen/license-gate`

> Status: thinking artefact (explore mode, not a proposal). No code written.
> Mode: empirical — claims here are backed by probes against a real
> workspace fixture and the registry, not just by reading docs.

---

## TL;DR

- `@npmcli/arborist`'s `loadActual()` + `tree.inventory` solves the entire
  graph-discovery problem in one call, including non-hoisted workspace
  installs and nested transitive duplicates. Verified on a fixture.
- `spdx-expression-parse` is exactly the right level: it parses SPDX boolean
  shape and **fails** on non-SPDX strings (`UNLICENSED`, `Apache 2.0`,
  `SEE LICENSE IN ...`). That failure is what lets us be non-inferential.
- Real engines requirement is **Node `^20.17.0 || >=22.9.0`** for Arborist 9.
  Our current `engines.node: ">=22"` is _too loose_ — must tighten to
  `>=22.9.0` (or accept Arborist 8 as an alternative).
- The reference repo's clarifications/license-text-guessing/spdx-correct
  stack must be explicitly avoided. None of those primitives belong in our
  trust path.
- One MVP change is enough: `add-license-gate-mvp`. Concrete shape below.

---

## 1. Current repository state

This is a fresh bootstrap from a Mirasen template:

```
license-gate/
├── src/index.ts          # `export {};` — public API is a blank slate
├── tests/.gitkeep        # no tests yet
├── package.json          # 0.0.0, type: module, engines node>=22, no bin, no runtime deps
├── tsconfig.base.json    # NodeNext, strict, ES2022 target / ES2023 lib
├── tsconfig.json         # rootDir=src, dist with .d.ts and sourcemaps
├── tsconfig-release.json # release variant (no maps)
├── tsconfig-test.json    # noEmit for tests/
├── vitest.config.ts      # istanbul coverage, passWithNoTests
├── eslint.config.js      # flat config + tseslint + prettier
├── .changeset/           # changesets wired in
├── openspec/
│   ├── config.yaml       # spec-driven, project context empty
│   └── changes/archive/  # empty
└── (CI workflows for ci/release/contribution flow already in .github/)
```

What this means for design:

- ESM-only consumer (`type: module`, NodeNext). Affects the Arborist import.
- No legacy, no migration debt. We design from scratch.
- No `bin` field yet — adding one is part of the MVP change.
- No runtime `dependencies` at all. Every dep we add is a deliberate choice.
- Tests are a clean slate — fixture-driven design is realistic.
- OpenSpec is initialised, no active or archived changes. The MVP will be
  the first change.

---

## 2. Reference: `license-checker-rseidelsohn` (limited inspection)

### What's worth knowing as reference

| Reference detail                                                                                                  | What we take from it                                                                    |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Uses `@npmcli/arborist` via `readInstalledPackagesWithArborist.js`                                                | Confirms direction: Arborist is the right primary dep                                   |
| Pattern: `new Arborist({ path }); await arb.loadActual()`                                                         | Same call we want, but we'll consume `tree.inventory` instead of recursing `children`   |
| Node properties used: `node.path`, `node.realpath`, `node.package`, `node.target`, `node.isLink`, `node.children` | We add `node.isRoot`, `node.isWorkspace`, `node.location` — see §4                      |
| Aggregates errors into a flat object keyed by `name@version`                                                      | Same flat-record shape works for us, but with explicit decision/violation discriminator |
| `process.exit(1)` after evaluation                                                                                | Same model — but **after** full collection, not per-package                             |
| `spdx-expression-parse` dependency                                                                                | Same dep, used the same way (boolean shape only)                                        |

### What we explicitly avoid

| Reference behaviour                                                                                            | Why we reject it                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `clarifications` JSON with semver-range, checksum, `licenseStart/End`                                          | Inference at config layer disguised as override. Our `allowed-packages.txt` is a literal pin; no semver, no checksum |
| Reading `LICENSE`/`COPYING`/`README` text when metadata is empty                                               | Pure license inference. Fails our policy by design                                                                   |
| `spdx-correct` to convert `Apache 2.0` → `Apache-2.0`                                                          | Normalisation is inference. Different strings stay different strings                                                 |
| `spdx-satisfies` semantic compatibility                                                                        | We only ask "is this leaf literally in the allowlist?" — no semantics                                                |
| `LICENSE_TITLE_UNKNOWN = "UNKNOWN"` as a soft sentinel                                                         | We use `"could not determine"` and treat it as a violation unless overridden                                         |
| `exitIfCheckHits` calling `process.exit(1)` mid-loop                                                           | Hides the rest of the violations. We collect-all-then-exit                                                           |
| `--depth`, `--direct`, `--production`, `--development`, `--exclude`, `--includePackages`, `--customPath`, etc. | CLI surface bloat. We hold the line: `check`, `collect`, `--workspace`, `--json <path>`, `--out <path>`              |
| Node `>=24` and npm `>=11`                                                                                     | Unjustified for our scope. We aim Node `>=22.9.0` (Arborist 9 floor)                                                 |
| `chalk`, `treeify`, `mkdirp`, `lodash.clonedeep`, `nopt` deps                                                  | We can do without all of these via `node:` builtins + `node:util.parseArgs`                                          |
| No explicit workspace handling in their code                                                                   | A genuine gap we close on purpose                                                                                    |

---

## 3. Empirical probes (the actually-investigated bit)

### 3.1 Fixture

I built a real workspace monorepo fixture at `/tmp/lg-probe/root` and
installed it with npm, deliberately engineering a non-hoisted version
conflict:

```
root/                           ← workspaces: ["apps/*","packages/*"], MIT, lodash@4.17.21
├── apps/
│   ├── api/                    ← MIT, deps: @probe/utils, ms@2.1.3
│   └── web/                    ← Apache-2.0, deps: lodash@3.10.1
└── packages/
    └── utils/                  ← (MIT OR Apache-2.0)
```

After `npm install`, the actual on-disk layout:

```
root/node_modules/lodash@4.17.21          ← hoisted
root/node_modules/ms@2.1.3                ← hoisted
root/node_modules/@probe/utils -> ../../packages/utils   (workspace symlink)
root/apps/web/node_modules/lodash@3.10.1  ← NON-hoisted — version conflict
root/apps/api/node_modules                ← does not exist (fully hoisted)
```

This is exactly the layout we said we must not miss packages in.

### 3.2 What `Arborist.loadActual()` returns

Run from repo root. Verified live:

- `tree.isRoot === true`, `tree.realpath === /private/tmp/lg-probe/root`
- `tree.inventory` is a Map of **123 unique installed copies** (incl. all
  Arborist's own deps, which is fine — we just iterate them all)
- Inventory contains:
  - the root node itself (`isRoot: true`)
  - every workspace as `isWorkspace: true, isLink: true` with the correct
    `realpath` to `apps/api`, `apps/web`, `packages/utils`
  - **`lodash@3.10.1`** at `apps/web/node_modules/lodash` ✅ (the
    non-hoisted one we worried about)
  - **`lodash@4.17.21`** at `node_modules/lodash` ✅
  - **two distinct `minipass@3.3.6`** copies nested under
    `node_modules/minipass-flush/node_modules/minipass` and
    `node_modules/minipass-pipeline/node_modules/minipass` — each a separate
    inventory entry ✅ (transitive duplicates handled)
  - `minipass@7.1.3` at the top — also separate entry
- `tree.workspaces` is a `Map<name, Node>` — gives us the workspace lookup
  for `--workspace <name>`
- `tree.children` includes workspace symlinks at child level too
  (e.g. `node_modules/@probe/utils -> ../../packages/utils`) — but they
  resolve to the same `realpath` as the workspace, so iterating `inventory`
  with realpath-based dedup is the right primitive

### 3.3 Subdir invocation does **not** do what we want

Running `new Arborist({ path: '/tmp/lg-probe/root/apps/web' })`:

- treats `apps/web` as **its own root** (`tree.name === "web"`)
- inventory size **= 2**: only `web` itself and its non-hoisted `lodash@3.10.1`
- it does **not** see hoisted deps from the parent root
- workspace siblings (`apps/api`, `packages/utils`) are invisible

So the implementation pattern for `--workspace <name|path>` must be:

> **Always invoke Arborist with `path = repo root`. Then filter inventory
> to the subtree of the chosen workspace.**

Filter strategy options (decide in design):

- **By realpath prefix**: keep node iff `node.realpath` starts with the
  workspace's realpath, OR the node is reachable via edges from the
  workspace. Realpath-prefix alone misses hoisted deps (they live under
  the root). So we need edge traversal.
- **By edge traversal**: BFS from `tree.workspaces.get(name)` following
  `node.edgesOut` to actual `Node`s, accumulating reachables. This matches
  user intent ("what does this workspace actually use?").
- **Hybrid (recommended)**: BFS the workspace's reachable inventory subset.
  The workspace itself + everything you can reach by `edgesOut → resolve`.

### 3.4 `node.package` shape

Confirmed values for typical inventory entries:

```
lodash@3.10.1       license: "MIT"               (string)
lodash@4.17.21      license: "MIT"               (string)
ms@2.1.3            license: "MIT"               (string)
@probe/utils@0.0.0  license: "(MIT OR Apache-2.0)" (SPDX expression)
                    isWorkspace: true, isLink: true
```

Notes:

- `node.package` is the parsed `package.json`. We read **only its
  declared fields**: `license`, optionally `licenses` (deprecated array),
  `repository`, `author`. **No file reads.**
- For a workspace node, `node.package` contains the workspace's own
  `package.json` — useful when we decide whether workspace packages are
  evaluated themselves (Q1 below).

### 3.5 `spdx-expression-parse` behaviour on real inputs

Verified live:

| Input                                              | Outcome                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------- |
| `"MIT"`                                            | OK → `{license:"MIT"}`                                                      |
| `"Apache-2.0"`                                     | OK → `{license:"Apache-2.0"}`                                               |
| `"Apache 2.0"`                                     | **FAIL** (`Unexpected 'A' at offset 0`)                                     |
| `"(MIT OR Apache-2.0)"`                            | OK → `{left:{license:"MIT"},conjunction:"or",right:{license:"Apache-2.0"}}` |
| `"MIT OR GPL-3.0"`                                 | OK                                                                          |
| `"MIT AND CC-BY-4.0"`                              | OK                                                                          |
| `"(MIT OR (GPL-2.0 AND classpath-exception-2.0))"` | **FAIL** (parser doesn't accept inline exception form)                      |
| `"MIT OR"`                                         | **FAIL** (malformed)                                                        |
| `"SEE LICENSE IN LICENSE.md"`                      | **FAIL**                                                                    |
| `"UNLICENSED"`                                     | **FAIL**                                                                    |
| `""`                                               | **FAIL** (null deref)                                                       |

This is excellent for us — the parser is non-correcting. But it has two
implications we must build around:

1. **Strings like `UNLICENSED`, `SEE LICENSE IN LICENSE.md` are not SPDX**
   but **are** legitimate npm license values. They are still **literal
   strings**. So our evaluation order must be:

   ```
   if license === sentinel "could not determine":     → violation (unless override)
   if license is literally in allowed-hard.txt:        → allowed-by-license
   else try spdx parse:
     if parse OK and every leaf is in allowed-hard:    → allowed-by-license
     if parse OK and OR-shape and any leaf in allowed: → allowed-by-license
     if parse OK but leaves not satisfied:             → violation
     if parse FAIL:                                    → violation (unparseable)
   else → violation (license-not-in-allowlist)
   ```

   The "literal first, then SPDX" order is what makes `UNLICENSED` work
   when an org explicitly opts in to it via allowlist — without making us
   touch `spdx-correct`-style normalisation.

2. **AND semantics** (`MIT AND CC-BY-4.0`): every leaf must be allowed.
   **OR semantics**: any one leaf is enough. Pure boolean walk. Empty
   parses are violation.

3. **License with exception** (`GPL-2.0 WITH classpath-exception-2.0`)
   may parse — we should test it. If it doesn't, document that consumers
   needing such expressions allow them via `allowed-packages.txt` overrides.

### 3.6 Engines-floor finding

`@npmcli/arborist@9.7.0` declares:

```
"engines": { "node": "^20.17.0 || >=22.9.0" }
```

Our current `package.json` has `"engines": { "node": ">=22" }`. That admits
`22.0.0`–`22.8.x`, where Arborist 9 will warn or break. **Action for
proposal**: tighten to `">=22.9.0"`. Alternative would be Arborist 8, but
that's older — keep 9.

Arborist 9 is still **CommonJS** (`main: "lib/index.js"`, no `exports.import`).
With our `type: module` + NodeNext, default import works (`import Arborist
from '@npmcli/arborist'`) — verified by the live probes above which used
exactly that. No interop hassle.

### 3.7 Dep footprint reality

`@npmcli/arborist@9` brings 113 transitive packages on a fresh install
(verified). That is the price of correct npm-tree semantics. The
alternative — a hand-rolled `fs.readdir`/`realpath` walker — saves the
footprint at the cost of recreating bugs the npm team already fixed
(workspace symlink loops, scoped-name parsing, link-vs-target dedup,
nested install corner cases). Trade-off is worth it for v1; if footprint
becomes an actual complaint we can revisit behind a stable internal
interface.

---

## 4. Recommended graph-discovery approach

```
1. findRepoRoot(cwd):
     walk up until package.json found.
     If that package.json declares "workspaces" → that's the root.
     Else the package.json itself is the (single-package) target;
       still treat it as root for Arborist.

2. arb = new Arborist({ path: repoRoot })
   tree = await arb.loadActual()

3. inventoryToEvaluate(tree, opts):
     if opts.workspace is undefined:
       return [...tree.inventory.values()]         // full graph
     else:
       wsNode = resolveWorkspace(tree, opts.workspace)  // by name OR by absolute path
       if !wsNode: throw UsageError
       reachable = bfs(wsNode, n => n.edgesOut)
                   .map(edge => edge.to).filter(Boolean)
       return [wsNode, ...reachable] deduped by realpath

4. For each node:
     skip if node.isRoot AND opts.workspace is undefined        // see Q1
     extract InstalledPackageRecord from node.package + node paths
```

Subtleties handled by virtue of using inventory:

- non-hoisted workspace-local installs (verified)
- transitive duplicates with different versions at different paths (verified)
- workspace symlinks resolve to canonical workspace nodes (verified)

---

## 5. Recommended minimal module structure

```
src/
├── index.ts                       # public API: { check, collect }
├── cli.ts                         # bin entry: util.parseArgs → dispatch
│
├── graph/
│   ├── repo-root.ts               # findRepoRoot(cwd)
│   ├── load.ts                    # arborist load wrapper
│   ├── narrow.ts                  # --workspace filter (BFS reachable)
│   └── record.ts                  # node → InstalledPackageRecord
│
├── policy/
│   ├── allowed-hard.ts            # parse + validate allowed-hard.txt
│   ├── allowed-packages.ts        # parse + STRICT validate allowed-packages.txt
│   ├── spdx-shape.ts              # boolean walk over spdx-expression-parse AST
│   └── evaluate.ts                # record + allowlists → Decision
│
├── report/
│   ├── human.ts                   # default stdout (readable)
│   └── json.ts                    # --json <path> serialiser
│
└── commands/
    ├── check.ts                   # orchestrate check
    └── collect.ts                 # orchestrate collect
```

Boundaries (enforced by import direction):

- `policy/` is pure functions over types. **No fs, no Arborist.**
- `graph/` knows Arborist + fs. **No knowledge of policy.**
- `report/` consumes already-decided records. **No fs or graph.**
- `commands/` is the only layer doing I/O + setting `process.exitCode`.
- `index.ts` exports `check()`/`collect()` for programmatic consumers.
- `cli.ts` is just argv parse + call API + print. **No business logic.**

### Drafted internal types

```ts
type InstalledPackageRecord = {
	name: string;
	version: string;
	packageId: string; // `${name}@${version}`
	path: string; // node.realpath
	workspace: string | null; // closest workspace node's name, or null
	license: string | 'could not determine';
	// licenseFile only when package.json explicitly references one — never inferred
	licenseFile?: string;
	repository?: string;
	publisher?: string;
	email?: string;
};

type Decision =
	| { record: InstalledPackageRecord; outcome: 'allowed-by-license' }
	| { record: InstalledPackageRecord; outcome: 'allowed-by-scope-rule'; matchedPackageRule: string }
	| {
			record: InstalledPackageRecord;
			outcome: 'allowed-by-package-version-rule';
			matchedPackageRule: string;
	  }
	| { record: InstalledPackageRecord; outcome: 'violation'; reason: ViolationReason };

type ViolationReason =
	| { kind: 'license-could-not-determine' }
	| { kind: 'license-not-in-allowlist'; literal: string }
	| { kind: 'license-expression-unparseable'; raw: string }
	| { kind: 'license-expression-leaf-not-allowed'; raw: string; offendingLeaves: string[] };
```

Closed discriminated union forces the reporter to handle every outcome.

---

## 6. CLI shape recommendation

```
license-gate <command> [options]

commands
  check                            evaluate graph against policy
  collect                          enumerate graph + license metadata

global options
  --workspace <name|path>          narrow to one workspace (only valid if
                                   the project declares workspaces)
  --cwd <path>                     alternative repo root (default: cwd)

per-command options
  --json <path>                    write machine-readable JSON to <path>
  --out  <path>                    write human-readable report to <path>
                                   (stdout always prints; flags are extra)

exit codes
  0   no violations / collect succeeded
  1   violations found
  2   usage error / invalid allowed-packages.txt rule / config error
```

Hard rules:

- `--json` is **always** a path, **never** a stdout-format toggle. Removes
  the "CI surprise" failure mode.
- No `--workspace --all`. Default already is "everything".
- Allowlist file paths are **fixed**: `licenses/allowed-hard.txt` and
  `licenses/allowed-packages.txt`, resolved relative to repo root. Not
  configurable in v1 — that's a feature, not a limitation.
- `node:util.parseArgs` for CLI parsing (Node ≥22 has it). No commander/
  yargs/nopt.

---

## 7. Edge cases to test

### Discovery

- single-package project (no `workspaces`)
- workspace project, all hoisted
- workspace project with **non-hoisted version conflict** (covered by §3.1
  fixture pattern — must be in tests verbatim)
- workspace symlink in root `node_modules/<workspace-name>`
- transitive nested duplicates (`a/node_modules/b` + `c/node_modules/b`)
- workspace depending on another workspace
- bundled dependencies inside a published package
- run from subdirectory: `cwd != repoRoot`, must walk up
- `--workspace web` (by name), `--workspace ./apps/web` (by path),
  `--workspace /abs/path` (absolute)
- `--workspace` on non-workspace project → exit 2
- `--workspace nonexistent` → exit 2
- repo with no `node_modules/` at all → clear error message

### License detection (non-inferential)

- `"MIT"` (string) → literal `MIT`
- `{ type: "MIT", url: "..." }` (deprecated object form) → **`could not
determine`** (Q2 strict — see open questions)
- `licenses: [{ type: "MIT" }]` (deprecated array form) → **`could not
determine`** (Q2 strict)
- `"SEE LICENSE IN LICENSE.md"` → literal string; passes only if literally
  allowed; we never read the file
- `"UNLICENSED"` → literal string
- `"Apache 2.0"` (with space) → literal; differs from `"Apache-2.0"`
- `"(MIT OR Apache-2.0)"` → SPDX shape; OR; one allowed leaf is enough
- `"MIT AND CC-BY-4.0"` → SPDX shape; AND; both must be allowed
- `"GPL-2.0 WITH classpath-exception-2.0"` → SPDX expression with WITH;
  **test what spdx-expression-parse does** with it; if it parses, leaf
  treatment must be defined; if it fails, → `unparseable`
- `""` empty string → `could not determine`
- missing `license` field entirely → `could not determine`
- malformed `"MIT OR"` → `unparseable`

### Allowlist files

- missing `allowed-hard.txt` → exit 2 (Q3 strict — see open questions)
- empty `allowed-hard.txt` → only `allowed-packages.txt` overrides can pass
- `# comment` and blank lines stripped
- trailing whitespace / leading whitespace on rule lines — trim or not?
  Recommend: trim (whitespace is parsing artefact, not part of the literal
  license string)
- duplicate lines → silently dedup
- missing `allowed-packages.txt` → ok, no overrides
- invalid rules in `allowed-packages.txt`:
  - `lodash` (no version) → exit 2
  - `@scope/foo` (no version, no `*`) → exit 2
  - `lodash@*` → exit 2
  - `@scope/foo@*` → exit 2
  - `lodash@^4` (semver range) → exit 2
  - regex / glob / `*` → exit 2
- valid rules: `@scope/*`, `lodash@4.17.21`, `@scope/foo@1.2.3`

### Decisions / reporting

- both an `@scope/*` and a more specific `@scope/foo@1.2.3` match → log the
  more specific one (better audit trail)
- license is in `allowed-hard.txt` AND package is overridden → prefer
  `allowed-by-license` outcome (overrides are the escape hatch, not the
  default story)
- many violations on one run → all collected, all printed, then exit 1
- JSON file write must complete before exit, even on violations
- `--json <path>` to a non-writable location → exit 2

---

## 8. Open questions / risks

### Q1. Are workspace packages themselves evaluated?

Workspaces are local first-party code. Their `license` strings are real,
but evaluating them against the same allowlist is mildly weird (your own
internal MIT package will trivially pass).

**Recommendation:** **Yes, evaluate them.** Skipping would be a silent
exclude — exactly what we said we wouldn't do. README directs users with
internal packages to declare their scope as `@my-co/*` in
`allowed-packages.txt`. This keeps the policy explicit.

Variant: skip the **root** package (it's the project itself, not a
dependency) but evaluate every other workspace. Recommend this
combination.

### Q2. Deprecated `license` shapes — accept or reject?

- `license: { type: "MIT", url: "..." }`
- `licenses: [{ type: "MIT" }, { type: "Apache-2.0" }]`

Reading `.type` is not "license-text inference" but it is _schema
inference_ across deprecated forms. Two stances:

- **Strict (recommended for v1):** only `license: "<string>"` is read.
  Anything else → `could not determine`. Pure, explicit, no hidden mapping.
- **Pragmatic (v1.x):** unwrap object → string, array → join with `OR`.

Strict in v1 keeps the trust path absolutely flat; loosen later if needed.

### Q3. Missing allowlist file

Two stances:

- **Hard error (recommended):** missing `allowed-hard.txt` → exit 2 with
  message "license-gate requires licenses/allowed-hard.txt — create one."
  Refuses to give an empty default that might be mistaken for "no
  policy".
- **Silent default:** `[]` (empty allowlist) — every package becomes a
  violation unless overridden.

The first is more user-friendly and harder to misconfigure.

### Q4. Configurable allowlist paths (`--allowlist <path>`)?

Tempting for monorepos with multiple sub-policies. But it lets people
"temporarily relax" gates from CI invocation lines. **Recommend: no in
v1.** Fixed paths are part of the strict-gate brand.

### Q5. Programmatic API surface

Yes, export `check()` and `collect()` from `src/index.ts`. Trivial cost
(same functions, different caller), real value (custom CI scripts and
pre-commit hooks without shelling out).

### R1. Arborist transitive footprint (~113 packages)

Documented in §3.7. Acceptable for v1; encapsulated behind `graph/load.ts`
so we can swap implementations later.

### R2. `npm` version skew between dev and CI

Different npm versions can produce different `node_modules` layouts. Not
our bug, but document: "run `license-gate` after `npm ci` in the same
environment that produces the shipped graph."

### R3. `peer`/`optional` dependencies

`loadActual()` reflects what's physically installed, so optional deps that
were skipped on the platform won't be checked. This is correct: we gate
the actual shipped surface, not the theoretical graph. Document.

### R4. Engines tightening

`>=22` admits 22.0–22.8 where Arborist 9 won't run. Tighten to
`">=22.9.0"` in the MVP change. Mention in proposal.

---

## 9. Suggested next step for `/opsx:propose`

A single MVP change covers everything above:

**Change name:** `add-license-gate-mvp`
**Capability spec:** `license-gate` (new)

**In scope (v1):**

1. `check` command — full installed graph, collect-all then exit, exit 1
   on any violation
2. `collect` command — flat enumeration with human-readable stdout default
3. Workspace-aware default discovery via `Arborist.loadActual()` +
   `tree.inventory`
4. `--workspace <name|path>` filter via BFS over `edgesOut` from the
   selected workspace
5. `licenses/allowed-hard.txt` parser with literal matching, comments,
   blank lines
6. `licenses/allowed-packages.txt` parser with three strict rule forms and
   strict rejection of everything else
7. SPDX boolean-shape evaluator on top of `spdx-expression-parse`
   (literal-first ordering — see §3.5)
8. Decision discriminated union + human and JSON reporters
9. Programmatic API exported from `src/index.ts`
10. CLI `bin` entry at `src/cli.ts` using `node:util.parseArgs`
11. `package.json` updates: `bin`, `dependencies` (`@npmcli/arborist`,
    `spdx-expression-parse`), `engines.node` → `">=22.9.0"`
12. Fixture-based vitest suite covering every edge case in §7

**Explicitly out of scope (lock down in proposal Non-goals):**

- clarifications JSON / checksum-based evidence / licenseStart-End
- license text reading or inference of any kind
- normalisation / SPDX correction / spdx-satisfies semantics
- pnpm / yarn / Gradle / Maven
- bundle analyser / markdown / tree visualiser
- denylist file / silent excludes / enterprise modes
- configurable allowlist paths (Q4)
- deprecated `{type}` and `licenses[]` package.json shapes (Q2 — strict v1)

**Decisions to record in design.md when proposing:**

- Q1: workspaces evaluated; root package skipped only when scope is "all"
- Q2: strict — only `license: "<string>"` read in v1
- Q3: missing `allowed-hard.txt` → exit 2 with explicit message
- Conflict resolution: more-specific override rule wins in audit log;
  `allowed-by-license` beats `allowed-by-*-rule` when both apply
- Engines: tighten to `">=22.9.0"`

When you're ready, `/opsx:propose add-license-gate-mvp` with this report
as input is the natural next step. I won't run it from here — that's your
call.

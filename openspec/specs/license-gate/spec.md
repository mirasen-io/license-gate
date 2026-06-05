## Purpose

`@mirasen/license-gate` is a strict, local, default-deny license policy gate over the
installed npm dependency graph. It supports single-package projects, npm workspaces,
and monorepos. Discovery uses `@npmcli/arborist` (`loadActual()` + `tree.inventory`),
matching is literal-first with SPDX boolean shape (OR / AND / parens; WITH-exception
leaves rendered as composite literals) as a secondary stage, and every decision is
either explicitly allowed (by literal license match or by a visible
`allowed-packages.txt` override) or a top-level violation. The gate collects every
violation before exiting and refuses to infer, normalise, or read license-text files.

## Requirements

### Requirement: CLI surface

The system SHALL expose a `license-gate` binary with exactly two subcommands, `check` and
`collect`, parsed via `node:util.parseArgs`. For `check`, the system SHALL accept only
`--cwd <path>`, `--workspace <name|path>`, and `--json <path>`. For `collect`, the
system SHALL accept only `--cwd <path>`, `--workspace <name|path>`, `--out <path>`, and
`--json <path>`. The system SHALL reject every other flag, including `--root`,
`--project`, `--allowed`, `--allowed-packages`, include/exclude filters,
depth/production/development flags, markdown/tree output flags, and a workspace-all
flag, with exit code 2.

#### Scenario: bare invocation prints usage

- **WHEN** the user runs `license-gate` with no subcommand
- **THEN** the CLI prints usage to stderr and exits with code 2

#### Scenario: unknown subcommand

- **WHEN** the user runs `license-gate audit`
- **THEN** the CLI prints an error naming the unknown subcommand to stderr and exits with code 2

#### Scenario: unknown flag rejected

- **WHEN** the user runs `license-gate check --allowed ./mine.txt`
- **THEN** the CLI prints an error identifying the unknown flag to stderr and exits with code 2

#### Scenario: --root alias is not accepted

- **WHEN** the user runs `license-gate check --root /tmp/proj`
- **THEN** the CLI exits with code 2 because `--root` is unknown

#### Scenario: check --out is rejected

- **WHEN** the user runs `license-gate check --out ./report.txt`
- **THEN** the CLI exits with code 2 with an `invalid-usage` error explaining that `check` does not support `--out`

### Requirement: Project root selection

The system SHALL treat the **selected project root** as the operating root. The
selected project root is `--cwd <path>` when supplied, otherwise `process.cwd()`. The
system SHALL require `package.json` to exist directly at the selected project root. The
system SHALL NOT walk upward from the selected project root looking for an ancestor
`package.json`, SHALL NOT auto-detect a parent project root, and SHALL NOT provide
`--root` or `--project` aliases. If `package.json` is missing at the selected project
root, the system SHALL exit with code 2 with a message identifying the selected project
root and stating that `package.json` was not found there. If `package.json` declares an
npm `workspaces` field, the selected project root is treated as a workspace project
root; otherwise it is treated as a single-package project. All project-relative paths
(`licenses/allowed-hard.txt`, `licenses/allowed-packages.txt`, relative `--workspace`
paths, `--out`, `--json`) SHALL be resolved against the selected project root.

#### Scenario: no package.json at selected project root

- **WHEN** the user runs `license-gate check` from a directory whose `package.json` does not exist (and no `--cwd` was provided)
- **THEN** the CLI exits with code 2 with a message stating that `package.json` was not found at the selected project root

#### Scenario: --cwd selects an explicit project root

- **WHEN** the user runs `license-gate check --cwd /path/to/project` from any other directory and `/path/to/project/package.json` exists
- **THEN** the CLI evaluates `/path/to/project` as the project root and resolves all project-relative paths against it

#### Scenario: collect --cwd selects an explicit project root

- **WHEN** the user runs `license-gate collect --cwd /path/to/project`
- **THEN** the CLI uses `/path/to/project` as the project root for graph discovery and output paths

#### Scenario: --cwd does not walk upward

- **WHEN** the user runs `license-gate check --cwd /tmp` and `/tmp/package.json` does not exist
- **THEN** the CLI exits with code 2 and SHALL NOT walk up the filesystem to find an ancestor `package.json`

#### Scenario: no walk-up from a workspace subdirectory

- **WHEN** the user runs `license-gate check` from `apps/web/` of a workspace project where `apps/web/package.json` exists but is not a workspace project root
- **THEN** the CLI evaluates the `apps/web` directory as the project root (single-package treatment), and SHALL NOT walk up to the workspace root

#### Scenario: workspace project root is detected by workspaces field

- **WHEN** the selected project root's `package.json` declares `workspaces`
- **THEN** the CLI treats it as a workspace project root and evaluates the full project graph

#### Scenario: single-package project is detected by absent workspaces field

- **WHEN** the selected project root's `package.json` does not declare `workspaces`
- **THEN** the CLI treats it as a single-package project and evaluates that package's installed dependency graph

### Requirement: Graph discovery via Arborist inventory

The system SHALL use `@npmcli/arborist` with `new Arborist({ path: <selectedProjectRoot> })`
followed by `await arb.loadActual()`, and SHALL enumerate installed packages by iterating
`tree.inventory.values()`. The system SHALL NOT walk `node_modules` directories by hand.
The system SHALL always invoke Arborist with `path` set to the selected project root
(`--cwd` if provided, otherwise `process.cwd()`) and SHALL NOT walk upward to rescue a
wrong working directory. If the selected project root is itself a workspace
subdirectory, the system SHALL treat that directory as the project root and invoke
Arborist there. When `--workspace <name|path>` is used together with a selected project
root that declares workspaces, the system SHALL NOT invoke Arborist with the selected
workspace's path; instead, Arborist still loads from the selected project root and the
workspace narrowing is performed inside that already-loaded tree (see the Workspace
narrowing requirement).

#### Scenario: full graph in a single-package project

- **WHEN** the user runs `license-gate check` in a single-package project
- **THEN** every installed package in the project's `node_modules` is included in evaluation

#### Scenario: full graph in a workspace project with all deps hoisted

- **WHEN** the user runs `license-gate check` in a workspace project where all deps are hoisted
- **THEN** every installed package in the root `node_modules` is included in evaluation

#### Scenario: non-hoisted version conflict in workspace-local node_modules

- **WHEN** a workspace contains a non-hoisted dependency at `apps/web/node_modules/lodash@3.10.1` while the project root has `node_modules/lodash@4.17.21`
- **THEN** both `lodash@3.10.1` and `lodash@4.17.21` appear in the evaluation set as distinct entries with distinct `path` (realpath)

#### Scenario: duplicate transitive packages at different physical paths

- **WHEN** two transitive copies of the same package version exist at different nested `node_modules` locations
- **THEN** each physical copy appears as a distinct entry in the evaluation set

#### Scenario: workspace symlink in root node_modules

- **WHEN** a workspace package is symlinked from `node_modules/<workspace-name>` to the workspace directory
- **THEN** the workspace appears once in the evaluation set with `realpath` pointing to the workspace directory

#### Scenario: workspace depending on another workspace

- **WHEN** workspace A declares a dependency on workspace B and B is reachable in the installed tree
- **THEN** workspace B appears in the evaluation set when the full project is checked

#### Scenario: missing node_modules

- **WHEN** the user runs `license-gate check` in a project where `node_modules` does not exist
- **THEN** the CLI exits with code 2 and a message instructing the user to install dependencies (e.g. `npm ci`)

#### Scenario: cwd is itself a workspace subdirectory

- **WHEN** the user runs `license-gate check` from `apps/web/` of a workspace project, where `apps/web/package.json` exists
- **THEN** the system treats `apps/web` as the project root and invokes Arborist with `path = apps/web` (no walk-up; the parent's workspaces field is irrelevant)

### Requirement: Workspace narrowing

When `--workspace <name|path>` is provided, the system SHALL load Arborist from the
selected project root (per the Graph discovery requirement) and SHALL NOT re-invoke or
re-point Arborist at the selected workspace's path. The system SHALL resolve the
workspace node inside the already-loaded tree by name (matching `tree.workspaces`) or
by path (relative paths resolved against the selected project root, then matched
against `node.realpath`/`node.path`), and narrow the evaluation set to the workspace
node plus every node reachable from it via `node.edgesOut → edge.to`, deduplicated by
`realpath`. The system SHALL NOT filter by realpath prefix alone, because hoisted
dependencies live outside the workspace's realpath.

#### Scenario: --workspace by name

- **WHEN** the user runs `license-gate check --workspace web` in a workspace project
- **THEN** evaluation includes the `web` workspace and every dependency reachable from it (including hoisted deps installed in the project root `node_modules`)

#### Scenario: --workspace by relative path

- **WHEN** the user runs `license-gate check --workspace ./apps/web`
- **THEN** the system resolves the path against the selected project root to a workspace node and narrows evaluation accordingly

#### Scenario: --workspace by absolute path

- **WHEN** the user runs `license-gate check --workspace /abs/path/to/apps/web`
- **THEN** the system resolves the path to a workspace node and narrows evaluation accordingly

#### Scenario: --cwd combined with --workspace

- **WHEN** the user runs `license-gate check --cwd /path/to/monorepo --workspace apps/web`
- **THEN** Arborist loads at `/path/to/monorepo`, not at `/path/to/monorepo/apps/web`, and the workspace narrowing is performed inside that already-loaded tree

#### Scenario: --workspace on non-workspace project

- **WHEN** the user runs `license-gate check --workspace web` in a single-package project that does not declare `workspaces`
- **THEN** the CLI exits with code 2 and a message saying the project does not declare workspaces

#### Scenario: --workspace nonexistent

- **WHEN** the user runs `license-gate check --workspace nonexistent` in a workspace project that has no such workspace
- **THEN** the CLI exits with code 2 with a message saying the workspace was not found

#### Scenario: --workspace narrowing reaches hoisted deps

- **WHEN** a workspace's transitive dependency is hoisted into the project root `node_modules`
- **THEN** the hoisted dependency is included in the evaluation set (because narrowing is by reachable graph, not by realpath prefix)

### Requirement: Root and workspace package treatment

When evaluating the full project graph (no `--workspace`), the system SHALL skip the root
package itself and SHALL evaluate every workspace package as a normal dependency. Root
skipping SHALL be visible in reports as `(skipped: project root)`. The system SHALL NOT
silently exclude any other package.

#### Scenario: root package is skipped in full-project check

- **WHEN** the user runs `license-gate check` in a workspace project
- **THEN** the root package's own license is not evaluated against `allowed-hard.txt`, and the report explicitly notes the root was skipped

#### Scenario: workspace packages are evaluated

- **WHEN** a workspace package's `package.json` declares `license: "Apache-2.0"` and `Apache-2.0` is not in `allowed-hard.txt`
- **THEN** the workspace package produces a `license-not-in-allowlist` violation unless it matches an `allowed-packages.txt` rule

### Requirement: Non-inferential license detection

The system SHALL determine each evaluated package's license exclusively from
`node.package.license`. If that field is a non-empty string after trimming whitespace,
the system SHALL record the trimmed string verbatim. If the field is missing, an empty
string, an object (e.g. `{type, url}`), an array (`licenses`), or any non-string shape,
the system SHALL record the sentinel `"could not determine"`. The system SHALL NOT read
any file from the package directory (including `LICENSE`, `LICENCE`, `COPYING`,
`README`), SHALL NOT normalise license strings, SHALL NOT convert `Apache 2.0` to
`Apache-2.0` or any similar transform, and SHALL NOT use `spdx-correct` or
`spdx-satisfies`.

#### Scenario: license string preserved verbatim

- **WHEN** a package has `license: "MIT"`
- **THEN** the recorded license is exactly `MIT`

#### Scenario: Apache 2.0 with space preserved verbatim

- **WHEN** a package has `license: "Apache 2.0"`
- **THEN** the recorded license is exactly `Apache 2.0` (not `Apache-2.0`)

#### Scenario: missing license becomes could not determine

- **WHEN** a package has no `license` field
- **THEN** the recorded license is `could not determine`

#### Scenario: empty license becomes could not determine

- **WHEN** a package has `license: ""`
- **THEN** the recorded license is `could not determine`

#### Scenario: object license form becomes could not determine

- **WHEN** a package has `license: { type: "MIT", url: "..." }`
- **THEN** the recorded license is `could not determine`

#### Scenario: deprecated licenses array becomes could not determine

- **WHEN** a package has `licenses: [{ type: "MIT" }]` and no string `license`
- **THEN** the recorded license is `could not determine`

#### Scenario: license file is never read

- **WHEN** a package has no `license` field but contains a `LICENSE` file with MIT text
- **THEN** the recorded license is `could not determine` and the system does not open the file

### Requirement: Allowlist files at fixed paths

The system SHALL read `licenses/allowed-hard.txt` and (optionally)
`licenses/allowed-packages.txt`, resolved relative to the **selected project root**
(`--cwd` if provided, otherwise `process.cwd()`). The system SHALL NOT accept CLI flags
for relocating these files, SHALL NOT read environment variables for them, and SHALL
NOT read `package.json` config for them. For `check`, the `licenses/allowed-hard.txt`
file SHALL be required: when missing, the system SHALL exit with code 2; the
`licenses/allowed-packages.txt` file SHALL be optional. The `collect` command SHALL NOT
read either file.

#### Scenario: missing allowed-hard.txt during check

- **WHEN** the user runs `license-gate check` in a project without `licenses/allowed-hard.txt`
- **THEN** the CLI exits with code 2 and a message naming the missing required file

#### Scenario: collect works without allowed-hard.txt

- **WHEN** the user runs `license-gate collect` in a project without `licenses/allowed-hard.txt`
- **THEN** the CLI completes successfully without reading any allowlist files

#### Scenario: empty allowed-hard.txt

- **WHEN** `licenses/allowed-hard.txt` exists but contains no non-comment, non-blank lines
- **THEN** `check` runs; every package not covered by an `allowed-packages.txt` override produces a violation

#### Scenario: missing allowed-packages.txt is allowed

- **WHEN** `licenses/allowed-packages.txt` does not exist
- **THEN** `check` runs without overrides

#### Scenario: no CLI flag relocates allowlist

- **WHEN** the user passes `--allowed ./other.txt` (or any equivalent flag)
- **THEN** the CLI exits with code 2 because the flag is unknown

### Requirement: allowed-hard.txt grammar

The system SHALL parse `licenses/allowed-hard.txt` as one license string per line. Blank
lines SHALL be ignored. Lines whose first non-whitespace character is `#` SHALL be
ignored as comments. Leading and trailing whitespace SHALL be trimmed for parsing
convenience only; the trimmed value is the literal compared against package licenses.
The system SHALL NOT support regex, glob, or any normalisation. Duplicate entries MAY be
deduplicated silently.

#### Scenario: comments and blank lines ignored

- **WHEN** `allowed-hard.txt` contains `# comment` lines and blank lines among license entries
- **THEN** only the non-comment, non-blank trimmed lines act as the allowlist

#### Scenario: literal license matches

- **WHEN** `allowed-hard.txt` contains `MIT` and a package has `license: "MIT"`
- **THEN** the package is `allowed-by-license`

#### Scenario: literal mismatch fails

- **WHEN** `allowed-hard.txt` contains `Apache-2.0` and a package has `license: "Apache 2.0"`
- **THEN** the package produces a `license-not-in-allowlist` violation

#### Scenario: duplicate lines deduped

- **WHEN** `allowed-hard.txt` lists `MIT` on multiple lines
- **THEN** the gate behaves identically to having `MIT` once

### Requirement: allowed-packages.txt grammar

The system SHALL parse `licenses/allowed-packages.txt` as one rule per line. Blank lines
SHALL be ignored. Lines whose first non-whitespace character is `#` SHALL be ignored as
comments. Leading and trailing whitespace SHALL be trimmed. Each non-empty rule SHALL be
one of exactly five accepted forms:

1. `@scope/*` — scope wildcard (existing).
2. `package-name@version` — exact unscoped package version (existing).
3. `@scope/package@version` — exact scoped package version (existing).
4. `package-name@*` — package-name wildcard, unscoped (new).
5. `@scope/package@*` — package-name wildcard, scoped (new).

In every form, `package-name` and `scope` SHALL contain neither `@`, `/`, `*`, nor
whitespace, and `version` SHALL contain neither `*`, `@`, nor whitespace. Any other
syntax — including but not limited to bare names (`pkg`, `@scope/pkg`), prefix
wildcards (`pkg*`, `@scope/weird-*`), wildcard-everywhere (`*@*`),
wildcard-scope-with-wildcard-version (`@scope/*@*`), semver ranges (`pkg@^1.0.0`,
`pkg@~1.0.0`, `pkg@>=4`, `pkg@1.x`), and regex-shaped strings (`/lodash.*/`) — SHALL
cause the system to exit with code 2 and an error identifying the offending file, line
number, and rule text. The `collect` command SHALL NOT read this file.

#### Scenario: valid scope rule

- **WHEN** `allowed-packages.txt` contains `@mirasen/*`
- **THEN** the rule is accepted and applies to any installed package whose name begins with `@mirasen/`

#### Scenario: valid package@version

- **WHEN** `allowed-packages.txt` contains `lodash@4.17.21`
- **THEN** the rule is accepted and applies only to the installed package `lodash@4.17.21`

#### Scenario: valid @scope/package@version

- **WHEN** `allowed-packages.txt` contains `@types/node@22.0.0`
- **THEN** the rule is accepted and applies only to the installed package `@types/node@22.0.0`

#### Scenario: valid package-name wildcard (unscoped)

- **WHEN** `allowed-packages.txt` contains `lodash@*`
- **THEN** the rule is accepted and applies to any installed version of the package whose name is exactly `lodash`

#### Scenario: valid package-name wildcard (scoped)

- **WHEN** `allowed-packages.txt` contains `@scope/weird-package@*`
- **THEN** the rule is accepted and applies to any installed version of the package whose name is exactly `@scope/weird-package`

#### Scenario: invalid bare package name

- **WHEN** `allowed-packages.txt` contains `lodash`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid scoped without version or wildcard

- **WHEN** `allowed-packages.txt` contains `@types/node`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid scope-and-version both wildcard

- **WHEN** `allowed-packages.txt` contains `@scope/*@*`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid wildcard everything

- **WHEN** `allowed-packages.txt` contains `*@*`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid prefix wildcard on package name

- **WHEN** `allowed-packages.txt` contains `lodash*` or `@scope/weird-*`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid semver range

- **WHEN** `allowed-packages.txt` contains `lodash@^4.17.0` or `lodash@~4.17.0` or `lodash@>=4` or `lodash@1.x`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid generic glob or regex or star

- **WHEN** `allowed-packages.txt` contains `*`, `/lodash.*/`, or any other prefix-wildcard
- **THEN** the CLI exits with code 2 and identifies the invalid rule

### Requirement: Literal-first license evaluation with SPDX expression support

The system SHALL evaluate each package's license in the following order: (1) if the
recorded license is the sentinel `"could not determine"`, then if the package matches an
`allowed-packages.txt` rule the decision SHALL be `allowed-by-scope-rule`,
`allowed-by-package-version-rule`, or `allowed-by-package-name-rule` per the package
override precedence requirement, otherwise the decision SHALL be a violation with reason
`package-not-in-allowlist`. (2) If the literal license string equals any line in
`allowed-hard.txt`, the decision SHALL be `allowed-by-license`. (3) Otherwise the system
SHALL attempt SPDX expression parsing using `spdx-expression-parse` for boolean shape
(OR, AND, parentheses). If parsing fails and no override matches, the violation SHALL
have reason `license-not-in-allowlist` with `detailCode:
"literal-not-allowed-and-spdx-unparseable"`. If parsing succeeds, the system SHALL walk
the AST treating each leaf license literally against `allowed-hard.txt`: an OR node is
satisfied if either side is satisfied; an AND node is satisfied if both sides are
satisfied. A leaf produced by an SPDX WITH-exception (an AST leaf carrying both a
license id and an exception id) SHALL be reduced to one literal string of the form
`"<license-id> WITH <exception-id>"` (joined with single ASCII spaces, no
normalisation), and that single composite string SHALL be the literal compared against
`allowed-hard.txt`; the bare license id SHALL NOT be considered separately, the licence
id SHALL NOT be normalised, and the exception id SHALL NOT be normalised. If satisfied,
the decision SHALL be `allowed-by-license`; otherwise, if no override matches, the
violation SHALL have reason `license-not-in-allowlist` with `detailCode:
"spdx-expression-not-satisfied"` and `offendingLeaves` listing the leaves (including any
WITH-exception leaves rendered as composite literals) that failed. If a violation in
steps (3a) or (3b) is matched by an `allowed-packages.txt` rule, the decision SHALL be
`allowed-by-scope-rule`, `allowed-by-package-version-rule`, or
`allowed-by-package-name-rule` (per the package override precedence requirement) instead
of the violation. The system SHALL NOT use the SPDX parser as a normalisation engine and
SHALL NOT use `spdx-correct` or `spdx-satisfies`.

#### Scenario: literal MIT in allowlist passes

- **WHEN** a package has `license: "MIT"` and `allowed-hard.txt` contains `MIT`
- **THEN** the decision is `allowed-by-license`

#### Scenario: literal SEE LICENSE IN passes when listed

- **WHEN** a package has `license: "SEE LICENSE IN LICENSE.md"` and `allowed-hard.txt` contains `SEE LICENSE IN LICENSE.md`
- **THEN** the decision is `allowed-by-license`

#### Scenario: literal UNLICENSED passes when listed

- **WHEN** a package has `license: "UNLICENSED"` and `allowed-hard.txt` contains `UNLICENSED`
- **THEN** the decision is `allowed-by-license`

#### Scenario: SPDX OR with one allowed leaf passes

- **WHEN** a package has `license: "(MIT OR Apache-2.0)"` and `allowed-hard.txt` contains `MIT` only
- **THEN** the decision is `allowed-by-license`

#### Scenario: SPDX AND requires all leaves

- **WHEN** a package has `license: "(MIT AND BSD-3-Clause)"` and `allowed-hard.txt` contains `MIT` only
- **THEN** the decision is a violation with reason `license-not-in-allowlist`, `detailCode: "spdx-expression-not-satisfied"`, and `offendingLeaves: ["BSD-3-Clause"]`

#### Scenario: parenthesised expression

- **WHEN** a package has `license: "(MIT OR Apache-2.0)"` and `allowed-hard.txt` contains `Apache-2.0`
- **THEN** the decision is `allowed-by-license`

#### Scenario: malformed expression unparseable

- **WHEN** a package has `license: "MIT OR"` (incomplete) and the literal does not match `allowed-hard.txt`
- **THEN** the decision is a violation with reason `license-not-in-allowlist` and `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: SEE LICENSE IN unparseable when not literally allowed

- **WHEN** a package has `license: "SEE LICENSE IN LICENSE.md"` and the literal is not in `allowed-hard.txt` and SPDX parsing fails
- **THEN** the decision is a violation with reason `license-not-in-allowlist` and `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: UNLICENSED unparseable when not literally allowed

- **WHEN** a package has `license: "UNLICENSED"` and the literal is not in `allowed-hard.txt` and SPDX parsing fails
- **THEN** the decision is a violation with reason `license-not-in-allowlist` and `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: literal-first prevents normalisation

- **WHEN** a package has `license: "Apache 2.0"` and `allowed-hard.txt` contains `Apache-2.0` only
- **THEN** the decision is a `license-not-in-allowlist` violation (literal does not match; SPDX parse fails on the spaced form)

#### Scenario: parsed WITH-exception leaf passes only when full composite literal is allowed

- **WHEN** a package has `license: "GPL-2.0-only WITH Classpath-exception-2.0"`, `spdx-expression-parse` parses it as a WITH-exception leaf, and `allowed-hard.txt` contains exactly the line `GPL-2.0-only WITH Classpath-exception-2.0`
- **THEN** the decision is `allowed-by-license`

#### Scenario: parsed WITH-exception leaf fails when only the bare licence id is allowed

- **WHEN** a package has `license: "GPL-2.0-only WITH Classpath-exception-2.0"`, `spdx-expression-parse` parses it as a WITH-exception leaf, and `allowed-hard.txt` contains only `GPL-2.0-only` (without the exception)
- **THEN** the decision is a `license-not-in-allowlist` violation with `detailCode: "spdx-expression-not-satisfied"` and `offendingLeaves: ["GPL-2.0-only WITH Classpath-exception-2.0"]`

#### Scenario: WITH-exception leaf inside an OR

- **WHEN** a package has `license: "(MIT OR (GPL-2.0-only WITH Classpath-exception-2.0))"`, parsing succeeds, and `allowed-hard.txt` contains only `MIT`
- **THEN** the decision is `allowed-by-license` (the OR is satisfied by the `MIT` branch)

#### Scenario: malformed WITH-like string is unparseable

- **WHEN** a package has `license: "GPL-2.0-only WITH"` (incomplete) and the literal does not match `allowed-hard.txt` and `spdx-expression-parse` fails
- **THEN** the decision is a `license-not-in-allowlist` violation with `detailCode: "literal-not-allowed-and-spdx-unparseable"`

### Requirement: Visible package overrides

The system SHALL make every `allowed-packages.txt` override visible in reports. When a
decision is `allowed-by-scope-rule`, `allowed-by-package-version-rule`, or
`allowed-by-package-name-rule`, the report SHALL include the matched rule string
verbatim in a `matchedPackageRule` field. Overrides SHALL NOT silently exclude packages
from reports. When several `allowed-packages.txt` rules match the same installed
package, the system SHALL apply them in this strict precedence order, with the first
applicable rule producing the final decision: (a) exact `package@version` /
`@scope/package@version` rule yields `allowed-by-package-version-rule`; (b) otherwise
`package@*` / `@scope/package@*` rule yields `allowed-by-package-name-rule`; (c)
otherwise `@scope/*` rule yields `allowed-by-scope-rule`. When both an
`allowed-hard.txt` license match and any `allowed-packages.txt` override apply, the
decision SHALL be `allowed-by-license` and `matchedPackageRule` SHALL NOT be reported.
Package-name wildcard overrides SHALL NOT be collapsed into scope overrides.

#### Scenario: package-version override is reported

- **WHEN** a package matches `lodash@4.17.21` in `allowed-packages.txt` and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-version-rule` with `matchedPackageRule: "lodash@4.17.21"`

#### Scenario: scope override is reported

- **WHEN** a package `@mirasen/foo@1.0.0` matches `@mirasen/*` in `allowed-packages.txt` and its license is `could not determine`
- **THEN** the decision is `allowed-by-scope-rule` with `matchedPackageRule: "@mirasen/*"`

#### Scenario: package-name wildcard override is reported (unscoped)

- **WHEN** an installed package `some-package@1.2.3` matches `some-package@*` in `allowed-packages.txt` and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-name-rule` with `matchedPackageRule: "some-package@*"`

#### Scenario: package-name wildcard override is reported (scoped)

- **WHEN** an installed package `@scope/weird-package@4.5.6` matches `@scope/weird-package@*` in `allowed-packages.txt` and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-name-rule` with `matchedPackageRule: "@scope/weird-package@*"`

#### Scenario: package-name wildcard does not match similarly named package

- **WHEN** an installed package `some-package-extra@1.2.3` is evaluated and `allowed-packages.txt` contains only `some-package@*`
- **THEN** the rule does not match `some-package-extra`; the package must pass by license or fail

#### Scenario: scoped package-name wildcard does not match other packages in same scope

- **WHEN** an installed package `@scope/other-package@4.5.6` is evaluated and `allowed-packages.txt` contains only `@scope/weird-package@*`
- **THEN** the rule does not match `@scope/other-package`

#### Scenario: exact version rule wins over package-name wildcard

- **WHEN** `allowed-packages.txt` contains both `some-package@1.2.3` and `some-package@*`, and an installed package `some-package@1.2.3` is evaluated and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-version-rule` with `matchedPackageRule: "some-package@1.2.3"`

#### Scenario: package-name wildcard wins over scope wildcard

- **WHEN** `allowed-packages.txt` contains both `@scope/*` and `@scope/weird-package@*`, and an installed package `@scope/weird-package@4.5.6` is evaluated and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-name-rule` with `matchedPackageRule: "@scope/weird-package@*"`

#### Scenario: more specific exact version still wins over package-name wildcard and scope wildcard

- **WHEN** `allowed-packages.txt` contains all three of `@scope/*`, `@scope/weird-package@*`, and `@scope/weird-package@4.5.6`, and an installed package `@scope/weird-package@4.5.6` is evaluated and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-version-rule` with `matchedPackageRule: "@scope/weird-package@4.5.6"`

#### Scenario: license-allow beats every override

- **WHEN** a package's license is in `allowed-hard.txt` and the package also matches `package@*`, `package@version`, or `@scope/*`
- **THEN** the decision is `allowed-by-license` and `matchedPackageRule` is not present

### Requirement: Collect-all-then-exit semantics

The system SHALL evaluate every package in the resolved evaluation set, collecting all
violations and all decisions before terminating. The system SHALL NOT exit on the first
violation. After all packages are evaluated, if any violations exist the system SHALL
exit with code 1; otherwise with code 0.

#### Scenario: multiple violations are all reported

- **WHEN** three different packages produce three different violation outcomes in one run
- **THEN** all three violations appear in stdout (and in `--json` output if requested) and the process exits with code 1

#### Scenario: clean run exits 0

- **WHEN** every evaluated package is allowed (by license or override)
- **THEN** the process exits with code 0

### Requirement: check command behaviour

The system SHALL implement `license-gate check` to: load the installed graph from the
selected project root (`--cwd` if provided, otherwise `process.cwd()`), narrow it if
`--workspace` is supplied, parse `licenses/allowed-hard.txt` and
`licenses/allowed-packages.txt` (validating override rules), evaluate every package per
the literal-first algorithm, print a human-readable policy result to stdout, optionally
write JSON to `--json <path>`, and exit 0 (clean) / 1 (violations) / 2 (config or
runtime error). The `check` command SHALL NOT accept `--out`. The JSON file SHALL be
awaited and closed before the process exits, including when exiting with code 1.

#### Scenario: human report on stdout

- **WHEN** the user runs `license-gate check`
- **THEN** stdout contains a human-readable report summarising counts, allowed packages, and any violations with their reasons and detail codes when applicable

#### Scenario: --json writes JSON file before exit 1

- **WHEN** the user runs `license-gate check --json ./report.json` in a project with violations
- **THEN** the file `./report.json` exists and contains the complete machine-readable report when the process exits with code 1

#### Scenario: --json write failure

- **WHEN** the user runs `license-gate check --json /unwritable/path.json`
- **THEN** the CLI exits with code 2 and a message identifying the unwritable path

#### Scenario: check rejects --out

- **WHEN** the user runs `license-gate check --out ./report.txt`
- **THEN** the CLI exits with code 2 with an `invalid-usage` error

### Requirement: collect command behaviour

The system SHALL implement `license-gate collect` to: load the installed graph from the
selected project root (`--cwd` if provided, otherwise `process.cwd()`), narrow it if
`--workspace` is supplied, build a flat list of installed package records (name,
version, packageId, path, workspace, license, optional metadata directly present in
`package.json`), and emit a human-readable report. The system SHALL NOT read
`licenses/allowed-hard.txt` or `licenses/allowed-packages.txt` for `collect`, and SHALL
NOT make any policy decisions in `collect`. By default the report SHALL go to stdout.
With `--out <path>`, the report SHALL be written to the file and stdout SHALL contain
only a one-line "wrote N records to <path>" summary. With `--json <path>`,
machine-readable JSON SHALL be written to the file. Output files SHALL be awaited and
closed before the process exits.

#### Scenario: human stdout by default

- **WHEN** the user runs `license-gate collect`
- **THEN** stdout contains a human-readable list of installed packages with their license strings (or `could not determine`)

#### Scenario: --out suppresses stdout duplication

- **WHEN** the user runs `license-gate collect --out ./collected.txt`
- **THEN** the human report is written to `./collected.txt` and stdout contains only a single summary line naming the file

#### Scenario: --json emits structured records

- **WHEN** the user runs `license-gate collect --json ./collected.json`
- **THEN** `./collected.json` contains a JSON array of installed-package records

#### Scenario: collect does not read license files

- **WHEN** a package has no `license` field but contains a `LICENSE` file
- **THEN** the collected record's `license` is `could not determine`

#### Scenario: collect does not read allowlist files

- **WHEN** the user runs `license-gate collect`
- **THEN** the system does not open `licenses/allowed-hard.txt` or `licenses/allowed-packages.txt`

#### Scenario: collect supports --workspace

- **WHEN** the user runs `license-gate collect --workspace web`
- **THEN** the collected report includes only the workspace's reachable graph (same narrowing as `check`)

### Requirement: Internal data model

The system SHALL represent each installed package as an `InstalledPackageRecord`
containing at minimum: `name`, `version`, `packageId` (= `${name}@${version}`), `path`
(the realpath of the installed copy), `workspace` (the closest containing workspace
name, or `null`), and `license` (a literal string or the sentinel `"could not
determine"`). Optional fields `repository`, `publisher`, and `email` MAY be included
only when they are directly available from `package.json` without inference. The system
SHALL NOT include a `licenseFile` field in v1. Decisions SHALL be a closed
discriminated union with outcomes `allowed-by-license`, `allowed-by-scope-rule`,
`allowed-by-package-version-rule`, `allowed-by-package-name-rule`, and `violation`.
Violations SHALL carry exactly one top-level reason: either `license-not-in-allowlist`
or `package-not-in-allowlist`. `license-not-in-allowlist` MAY include `detailCode` of
either `literal-not-allowed-and-spdx-unparseable` or
`spdx-expression-not-satisfied`, and MAY include `offendingLeaves: string[]` when
`detailCode === "spdx-expression-not-satisfied"`.

#### Scenario: record contains realpath

- **WHEN** a non-hoisted dependency lives at `apps/web/node_modules/lodash`
- **THEN** the record's `path` field is the absolute realpath of that directory

#### Scenario: workspace field reflects containment

- **WHEN** a transitive dependency is installed under a workspace's local `node_modules`
- **THEN** the record's `workspace` field is the name of the containing workspace

#### Scenario: licenseFile is absent in v1

- **WHEN** any record is emitted in `check` or `collect` output
- **THEN** the record contains no `licenseFile` field

#### Scenario: violation reasons are exactly two

- **WHEN** any violation is emitted by `check`
- **THEN** the top-level `reason` is exactly one of `license-not-in-allowlist` or `package-not-in-allowlist`

#### Scenario: license-not-in-allowlist may carry diagnostic detail

- **WHEN** a violation has reason `license-not-in-allowlist` and arose from SPDX parse failure
- **THEN** the violation includes `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: spdx-expression-not-satisfied includes offendingLeaves

- **WHEN** a violation has `detailCode: "spdx-expression-not-satisfied"`
- **THEN** the violation includes `offendingLeaves` listing the literal leaves that did not match `allowed-hard.txt`

#### Scenario: decision union includes package-name rule outcome

- **WHEN** a consumer enumerates the `Decision` discriminated union
- **THEN** `allowed-by-package-name-rule` is one of its variants alongside `allowed-by-license`, `allowed-by-scope-rule`, `allowed-by-package-version-rule`, and `violation`

### Requirement: Package-name wildcard override semantics

The system SHALL match an `allowed-packages.txt` rule of the form `package-name@*` to
an installed package iff the package's `name` field is exactly `package-name` (byte-for-byte). The
system SHALL match a rule of the form `@scope/package@*` iff the package's `name` field
is exactly `@scope/package` (byte-for-byte). The system SHALL NOT use prefix matching,
glob expansion, or regular-expression matching for these rules. The system SHALL NOT
allow an unscoped `package-name@*` rule to match a scoped package, and SHALL NOT allow a
scoped `@scope/package@*` rule to match other packages in the same scope. Version
information on the installed package is irrelevant for these rules: any installed
version satisfies the match.

#### Scenario: package wildcard allows any installed version of exact unscoped package

- **GIVEN** an installed package `some-package@1.2.3`, the package's license is missing or not allowed by `allowed-hard.txt`, and `allowed-packages.txt` contains `some-package@*`
- **THEN** the package is allowed and the report includes `matchedPackageRule: "some-package@*"` with outcome `allowed-by-package-name-rule`

#### Scenario: package wildcard does not match similarly named unscoped package

- **GIVEN** an installed package `some-package-extra@1.2.3` and `allowed-packages.txt` contains only `some-package@*`
- **THEN** the rule does not match `some-package-extra`; the package must pass by license or produce a violation

#### Scenario: scoped package wildcard allows any installed version of exact scoped package

- **GIVEN** an installed package `@scope/weird-package@4.5.6`, the package's license is missing or not allowed, and `allowed-packages.txt` contains `@scope/weird-package@*`
- **THEN** the package is allowed and the report includes `matchedPackageRule: "@scope/weird-package@*"` with outcome `allowed-by-package-name-rule`

#### Scenario: scoped package wildcard does not match other packages in same scope

- **GIVEN** an installed package `@scope/other-package@4.5.6` and `allowed-packages.txt` contains only `@scope/weird-package@*`
- **THEN** the rule does not match `@scope/other-package`

#### Scenario: unscoped package wildcard does not match scoped package of the same trailing name

- **GIVEN** an installed package `@scope/weird-package@4.5.6` and `allowed-packages.txt` contains only `weird-package@*`
- **THEN** the rule does not match `@scope/weird-package`

### Requirement: README documents accepted override forms

The README SHALL document the five accepted forms in
`licenses/allowed-packages.txt`:

- `@scope/*` — scope wildcard, intended only for trusted internal namespaces (for
  example `@mirasen/*`).
- `package-name@version` and `@scope/package@version` — exact pin, the highest-precision
  override.
- `package-name@*` and `@scope/package@*` — package-name wildcard, intended for
  manually reviewed packages whose Dependabot/version bumps should not require
  re-editing the override on every bump.

The README SHALL keep the standing warning that all `allowed-packages.txt` overrides
are escape hatches that remain audit-visible in reports, and SHALL NOT present
`package-name@*` as the default first choice.

#### Scenario: README lists all five accepted forms

- **WHEN** the published README is inspected after this change
- **THEN** it documents `@scope/*`, `package-name@version`, `@scope/package@version`, `package-name@*`, and `@scope/package@*` as the accepted forms

#### Scenario: README guides ordering of choice

- **WHEN** the published README is inspected after this change
- **THEN** the override section recommends `package-name@version` for the highest precision, frames `package-name@*` as the manually-reviewed-package convenience form, and reserves `@scope/*` for trusted internal namespaces such as `@mirasen/*`

### Requirement: Module purity boundaries

The implementation SHALL maintain the following import boundaries: `policy/` modules
are pure functions over types and SHALL NOT import `node:fs`, `node:path` for I/O, or
`@npmcli/arborist`. `graph/` modules SHALL handle filesystem and Arborist concerns and
SHALL NOT import `policy/`. `report/` modules SHALL consume already-decided records and
SHALL NOT perform filesystem reads beyond what is necessary to write output paths.
`commands/` modules SHALL be the only layer that calls `process.exit` or writes to
stdout/stderr.

#### Scenario: pure policy is unit-testable without fs

- **WHEN** a unit test imports `policy/evaluate.ts`
- **THEN** the test exercises evaluation with in-memory inputs, requiring no filesystem fixtures

### Requirement: Runtime targets and dependencies

The system SHALL declare `engines.node >=22.9.0`. The runtime `dependencies` SHALL
contain exactly `@npmcli/arborist` and `spdx-expression-parse` for v1. The CLI SHALL
parse arguments using `node:util.parseArgs`. The system SHALL NOT add `commander`,
`yargs`, `nopt`, `chalk`, `treeify`, `lodash`, `mkdirp`, `spdx-correct`, or
`spdx-satisfies` in v1.

#### Scenario: package.json declares correct engines

- **WHEN** `package.json` is inspected after this change
- **THEN** `engines.node` is `>=22.9.0`

#### Scenario: runtime dependencies are minimal

- **WHEN** `package.json` is inspected after this change
- **THEN** `dependencies` contains exactly `@npmcli/arborist` and `spdx-expression-parse`

### Requirement: Exit code contract

The system SHALL exit with code `0` on a successful `check` with no violations or a
successful `collect`; with code `1` only when `check` produced one or more violations;
and with code `2` for usage, configuration, or runtime errors including unknown
commands or flags, `check --out`, missing `package.json` at the selected project root,
missing
`licenses/allowed-hard.txt` during `check`, invalid rules in
`licenses/allowed-packages.txt`, invalid `--workspace` queries, missing `node_modules`,
and unwritable `--json`/`--out` paths.

#### Scenario: exit 0 on clean check

- **WHEN** every package is allowed
- **THEN** the process exits with code 0

#### Scenario: exit 1 on violations

- **WHEN** at least one violation is reported
- **THEN** the process exits with code 1

#### Scenario: exit 2 on config error

- **WHEN** `licenses/allowed-packages.txt` contains `lodash@^4`
- **THEN** the process exits with code 2 and reports the invalid rule with line number

### Requirement: Packaging and bin

The package SHALL be published as `@mirasen/license-gate`. The `package.json` SHALL
declare a `bin` mapping with the command name `license-gate` pointing to the built CLI
output. The built CLI output SHALL begin with a valid Node shebang
(`#!/usr/bin/env node`) and SHALL be executable. The bin entry source SHALL be
`src/cli.ts`. The CLI parsing layer SHALL stay thin; business logic SHALL live in
`src/commands/` and `src/index.ts`. The bin SHALL invoke the same command/API logic as
programmatic usage.

#### Scenario: package.json declares the bin

- **WHEN** `package.json` is inspected after this change
- **THEN** `bin` maps `license-gate` to the built CLI output (e.g. `./dist/cli.js`)

#### Scenario: built CLI has a Node shebang

- **WHEN** the build pipeline produces the bin file
- **THEN** the first line of that file is `#!/usr/bin/env node` and the file is executable

#### Scenario: npx invocation works

- **WHEN** the user runs `npx @mirasen/license-gate check` in a prepared project
- **THEN** the binary executes and produces the expected check behaviour

#### Scenario: local install + npx invocation works

- **WHEN** the user runs `npm install -D @mirasen/license-gate` followed by `npx license-gate check`
- **THEN** the binary executes and produces the expected check behaviour

#### Scenario: packaging smoke test runs the built binary

- **WHEN** the test suite runs the packaging smoke test
- **THEN** the test invokes the built `license-gate` binary in a child process against a fixture and asserts a known exit code and output

### Requirement: Arborist types sourced from DefinitelyTyped

The system SHALL source Arborist structural types (`Arborist` class, `Node`, `Link`,
`Edge`, and the supporting shapes for `inventory`, `workspaces`, `children`,
`edgesOut`, `package`, `path`, `realpath`, `location`, `isRoot`, `isWorkspace`,
`isLink`, `target`) from the DefinitelyTyped package `@types/npmcli__arborist`. The
package SHALL be declared in `devDependencies` only. The system SHALL NOT add any new
runtime dependency for this purpose. The system SHALL NOT keep an ambient
`declare module '@npmcli/arborist'` stub in source; the ambient stub for
`spdx-expression-parse` is unaffected. The system MAY retain narrow local helpers or
type-narrowing guards inside the graph layer when DefinitelyTyped coverage of a
specific field is incomplete, awkward, or incorrect; each retained helper SHALL be
documented inline at its declaration site with a one-line comment naming the concrete
typing gap. Any remaining type assertions (`as ...`) SHALL be localised inside the
graph layer and accompanied by a one-line comment naming the typing gap they bridge.

#### Scenario: devDependency present

- **WHEN** `package.json` is inspected after this change
- **THEN** `devDependencies` includes `@types/npmcli__arborist` and `dependencies` is
  unchanged from before the change

#### Scenario: ambient Arborist stub removed

- **WHEN** `src/types-vendor.d.ts` is inspected after this change
- **THEN** it no longer contains a `declare module '@npmcli/arborist'` block, and it
  still contains the `declare module 'spdx-expression-parse'` block

#### Scenario: Arborist values are typed by DefinitelyTyped

- **WHEN** `src/graph/load.ts`, `src/graph/narrow.ts`, and `src/graph/record.ts` are
  inspected
- **THEN** values that are Arborist nodes, links, edges, the Arborist class instance,
  or the result of `loadActual()` are typed using imports from `@npmcli/arborist`
  (resolved via `@types/npmcli__arborist`), not using locally hand-written
  Arborist-shaped types

#### Scenario: any retained local Arborist helper is justified inline

- **WHEN** the implementation retains a local Arborist-related type alias, narrowing
  helper, or type guard inside the graph layer
- **THEN** the declaration is accompanied by a one-line comment naming the concrete
  DefinitelyTyped gap it covers (for example, "narrows the broad manifest type to the
  fields we read" or "narrowing isLink === true to a Link with required target")

### Requirement: Arborist types are a graph-layer implementation detail

The system SHALL contain Arborist-specific types entirely inside the graph layer
(`src/graph/`). The system SHALL NOT export, re-export, or otherwise reference any
Arborist type from `src/types.ts`, `src/index.ts`, `src/cli.ts`, `src/policy/`,
`src/report/`, or `src/commands/`, directly or transitively. The boundary at which
Arborist values become project-owned values SHALL remain `nodeToRecord` in
`src/graph/record.ts`, which converts an Arborist `Node` into an
`InstalledPackageRecord`. Project-owned types — including `InstalledPackageRecord`,
`Decision`, `ViolationReason`, `ConfigError`, `LicenseGateConfigError`,
`CheckResult`, `CollectResult`, `CollectedRecord`, and the report JSON shapes — SHALL
remain free of any Arborist-typed field, parameter, or return value.

#### Scenario: public API does not expose Arborist types

- **WHEN** the build's published types (`dist/index.d.ts` and the types reachable
  from it) are inspected after this change
- **THEN** none of the exported types reference any symbol exported from
  `@npmcli/arborist` or `@types/npmcli__arborist`

#### Scenario: graph layer is the only Arborist consumer

- **WHEN** the source tree is inspected for imports of `@npmcli/arborist` or types
  from `@types/npmcli__arborist`
- **THEN** every such import is in `src/graph/`

#### Scenario: project-owned types remain unchanged in shape

- **WHEN** `src/types.ts` is inspected after this change
- **THEN** the exported types `InstalledPackageRecord`, `Decision`, `ViolationReason`,
  `ConfigError`, `LicenseGateConfigError`, `CheckResult`, `CollectResult`, and
  `CollectedRecord` are byte-for-byte unchanged in shape from before the change

### Requirement: Type-only cleanup preserves runtime behaviour

The change SHALL be type-level / internal only. The system SHALL preserve every
existing runtime behaviour, output, exit code, and surface defined by the existing
`license-gate` capability requirements: CLI surface (allowed flags and rejected
flags), project root selection (no walk-up), graph discovery via Arborist inventory,
workspace narrowing semantics (load at the project root, narrow to reachable graph
via `edgesOut`, dedup by realpath, no realpath-prefix filter), root and workspace
package treatment, non-inferential license detection, allowlist file paths and
parsing, allowlist grammar, literal-first license evaluation with SPDX boolean
support, visible package overrides, collect-all-then-exit semantics, the JSON and
human report shapes, the exit code contract, and packaging.

#### Scenario: existing test suite passes unchanged

- **WHEN** `npm test` is run after this change against the existing fixture-driven
  vitest suite (single-package layouts, hoisted workspaces, non-hoisted conflict,
  nested duplicates, workspace-on-workspace, workspace narrowing reaching hoisted
  deps, license-shape variants, allowed-packages grammar errors, SPDX
  OR/AND/parens/WITH cases, exit codes, and the packaging smoke test)
- **THEN** every test passes without modification of test sources or fixtures

#### Scenario: build, lint, and typecheck pass

- **WHEN** `npm run check`, `npm run lint`, and `npm run build` are run after this
  change
- **THEN** each command exits 0 with no new errors and no broadening of types in
  `src/types.ts` or in any module outside `src/graph/`

#### Scenario: packaging surface unchanged

- **WHEN** `npm pack --dry-run --json` is run after this change
- **THEN** the published file list and the shape of `dist/index.d.ts` are equivalent
  to before the change (no Arborist symbol leaks into the published types, and no
  files are added to or removed from the package)

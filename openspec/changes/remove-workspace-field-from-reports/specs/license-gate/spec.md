## MODIFIED Requirements

### Requirement: Internal data model

The system SHALL represent each installed package as an `InstalledPackageRecord`
containing at minimum: `name`, `version`, `packageId` (= `${name}@${version}`), `path`
(the path of the installed copy relative to the selected project root, using
POSIX-style `/` separators, with the project root itself exposed as `"."`), and
`license` (a literal string or the sentinel `"could not determine"`). Optional fields
`repository`, `publisher`, and `email` MAY be included only when they are directly
available from `package.json` without inference. Records SHALL NOT include a
`workspace` field; physical placement of an installed copy is communicated entirely
through `path`. The system SHALL NOT include a `licenseFile` field in v1. Decisions
SHALL be a closed discriminated union with outcomes `allowed-by-license`,
`allowed-by-scope-rule`, `allowed-by-package-version-rule`,
`allowed-by-package-name-rule`, and `violation`. Violations SHALL carry exactly one
top-level reason: either `license-not-in-allowlist` or `package-not-in-allowlist`.
`license-not-in-allowlist` MAY include `detailCode` of either
`literal-not-allowed-and-spdx-unparseable` or `spdx-expression-not-satisfied`, and
MAY include `offendingLeaves: string[]` when
`detailCode === "spdx-expression-not-satisfied"`.

#### Scenario: record contains relative path

- **WHEN** a non-hoisted dependency lives at `apps/web/node_modules/lodash` of the selected project root
- **THEN** the record's `path` field is `apps/web/node_modules/lodash`

#### Scenario: project root path

- **WHEN** the project root itself appears in collect output
- **THEN** its record's `path` field is `"."`

#### Scenario: hoisted dependency path

- **WHEN** a dependency is hoisted to the project root's `node_modules/foo`
- **THEN** the record's `path` field is `node_modules/foo` regardless of which workspaces (if any) require it

#### Scenario: no workspace field on records

- **WHEN** any record is emitted in `check` JSON, `collect` JSON, or any human report
- **THEN** the record contains no `workspace` field, and the human report contains no `[workspace: <name>]` decoration

#### Scenario: licenseFile is absent in v1

- **WHEN** any record is emitted in `check` or `collect` output
- **THEN** the record contains no `licenseFile` field

#### Scenario: violation reasons are exactly two

- **WHEN** any violation is emitted by `check`
- **THEN** the top-level `reason` is exactly one of `license-not-in-allowlist` or `package-not-in-allowlist`

#### Scenario: license-not-in-allowlist may carry diagnostic detail

- **WHEN** a `license-not-in-allowlist` violation is emitted
- **THEN** it MAY carry a `detailCode` of `literal-not-allowed-and-spdx-unparseable` or `spdx-expression-not-satisfied`, and MAY include `offendingLeaves: string[]` when `detailCode === "spdx-expression-not-satisfied"`

## REMOVED Requirements

### Requirement: workspace field reflects containment

**Reason**: The `workspace` field on `InstalledPackageRecord` was misleading. It described physical containment (the workspace directory under whose `node_modules` an installed copy sat), not dependency ownership. In typical hoisted installs it was `null` for nearly every record — including for the workspace packages themselves and for hoisted dependencies that only one workspace required — so users reasonably mis-read it as "which workspace requires this dependency". Physical placement is already visible through the relative `path` field (`apps/web/node_modules/foo` vs `node_modules/foo`), making the field redundant.

**Migration**: Consumers of `license-gate check --json` and `license-gate collect --json` SHALL stop reading `record.workspace`. To reason about physical placement of an installed copy, read `record.path` (e.g., a path beginning with `apps/<workspace>/node_modules/` indicates a non-hoisted copy local to that workspace). True dependency-ownership attribution (which workspace(s) require a given package via the dependency graph) is intentionally not provided by this change and would be introduced as a separate, edge-graph-based requirement (e.g., a `requiredByWorkspaces: string[]` field) in a future change. The `--workspace <name|path>` CLI narrowing flag is unaffected and continues to scope evaluation to a workspace's reachable graph.

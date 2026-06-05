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

- **WHEN** a violation has reason `license-not-in-allowlist` and arose from SPDX parse failure
- **THEN** the violation includes `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: spdx-expression-not-satisfied includes offendingLeaves

- **WHEN** a violation has `detailCode: "spdx-expression-not-satisfied"`
- **THEN** the violation includes `offendingLeaves` listing the literal leaves that did not match `allowed-hard.txt`

#### Scenario: decision union includes package-name rule outcome

- **WHEN** a consumer enumerates the `Decision` discriminated union
- **THEN** `allowed-by-package-name-rule` is one of its variants alongside `allowed-by-license`, `allowed-by-scope-rule`, `allowed-by-package-version-rule`, and `violation`

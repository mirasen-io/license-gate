## ADDED Requirements

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

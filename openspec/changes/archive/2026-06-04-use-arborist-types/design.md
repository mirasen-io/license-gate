## Context

The MVP capability `license-gate` is implemented and shipped. Graph discovery uses
`@npmcli/arborist` (`new Arborist({path}).loadActual()` plus `tree.inventory.values()`).
Because DefinitelyTyped coverage was assumed missing at MVP time, the graph layer
currently carries hand-written structural types for everything Arborist returns:

- [src/types-vendor.d.ts](src/types-vendor.d.ts) declares an ambient module
  `@npmcli/arborist` with a minimal class shape (`new Arborist({path})` and
  `loadActual(): Promise<unknown>`).
- [src/graph/load.ts](src/graph/load.ts) defines `ArboristNode`, `ArboristEdge`, and
  `ArboristPackageJson` as exported structural types covering the fields we read:
  `name`, `version`, `location`, `path`, `realpath`, `isRoot`, `isWorkspace`,
  `isLink`, `package`, `children`, `edgesOut`, `target`, `inventory`, `workspaces`
  (Node); `name`, `type`, `to` (Edge); `name`, `version`, `license`, `licenses`,
  `repository`, `author` (PackageJson).
- [src/graph/narrow.ts](src/graph/narrow.ts) imports `ArboristNode` and uses it for
  `tree`, `tree.workspaces`, `tree.inventory`, `tree.children`, `node.realpath`,
  `node.isLink`, `node.target`, `node.edgesOut`, and `edge.to`.
- [src/graph/record.ts](src/graph/record.ts) imports `ArboristNode` and
  `ArboristPackageJson` and converts a Node into a project-owned
  `InstalledPackageRecord` — this is the existing internal/public boundary.

`@types/npmcli__arborist` exists on DefinitelyTyped and exposes the relevant types:
the default-exported `Arborist` class, `Node`, `Link`, `Edge`, plus the supporting
shapes for inventory, children, edgesOut, workspaces, package, path, realpath,
location, isRoot, isWorkspace, isLink, target. Adopting it removes ~50 lines of
hand-written shape and replaces them with maintained typings. There is no behaviour
change anywhere; the public API does not reference Arborist types and SHALL NOT begin
to.

This design covers a small, internal type-safety cleanup. It is included because the
change crosses the graph-layer / public-API boundary that the MVP capability spec
explicitly fixes ("Arborist is an implementation detail; do not leak Arborist types
into the public API"), and because the right answer for each retained local type
needs a single decision per call site.

## Goals / Non-Goals

**Goals:**

- Add `@types/npmcli__arborist` as a `devDependency`.
- Replace local structural types in [src/graph/load.ts](src/graph/load.ts) with the
  DefinitelyTyped `Node`, `Link`, `Edge`, and the typed default-exported `Arborist`
  class.
- Keep Arborist-typed values strictly inside `src/graph/`. Convert to project-owned
  types at `nodeToRecord` (already the boundary).
- Keep small local adapter / type-narrowing helpers only where DefinitelyTyped is
  incomplete or awkward, with each retention justified by a one-line comment naming
  the gap.
- Preserve the existing public API ([src/types.ts](src/types.ts), exports from
  [src/index.ts](src/index.ts)) byte-for-byte in shape.
- Preserve all existing runtime behaviour, CLI surface, exit codes, and report shapes.

**Non-Goals:**

- No product behaviour changes. No new flag, no new rule kind, no new report channel,
  no `package@*` / `@scope/package@*` rules, no SARIF, no GitHub Action, no init
  command, no pnpm/yarn support, no markdown/tree reports, no extra config system, no
  license file scanning, no README/LICENSE/COPYING scanning, no SPDX
  correction/normalisation, no deprecated `license` object/array unwrapping, no
  clarifications, no checksum evidence.
- No change to policy behaviour, allowlist grammar, report shape, CLI command
  surface, exit codes, JSON output format, human output format, or npm graph-discovery
  behaviour.
- No change to the `spdx-expression-parse` ambient module declaration in
  [src/types-vendor.d.ts](src/types-vendor.d.ts). That stub stays.
- No new runtime dependency. `@npmcli/arborist` and `spdx-expression-parse` remain the
  only runtime deps.

## Decisions

### 1. Source of Arborist types: DefinitelyTyped, not local

**Decision.** Add `@types/npmcli__arborist` to `devDependencies` and delete the
ambient `declare module '@npmcli/arborist'` block from
[src/types-vendor.d.ts](src/types-vendor.d.ts). Import the `Arborist` class and the
`Node` / `Link` / `Edge` types directly from `@npmcli/arborist` in
[src/graph/load.ts](src/graph/load.ts).

**Rationale.** Maintained types track Arborist's real surface (e.g. accurate
`Node.children: Map<string, Node>`, `Node.edgesOut: Map<string, Edge>`,
`Edge.to: Node | null`, `Node.target?: Node`, `Node.workspaces?: Map<string, string>`).
Hand-written equivalents drift silently when the real shape changes. The local stub
also types `loadActual()` as `Promise<unknown>` and forces an `as ArboristNode` cast
at the call site; the DefinitelyTyped types let us drop that cast.

**Alternatives considered.**

- _Keep hand-written types, just expand them._ Rejected: maintenance burden and the
  same drift problem.
- _Generate types via `tsc` against the JS source._ Rejected: noisier and the
  community-maintained DefinitelyTyped package already exists.

### 2. Scope: graph layer only

**Decision.** Arborist types appear only inside `src/graph/`
([load.ts](src/graph/load.ts), [narrow.ts](src/graph/narrow.ts),
[record.ts](src/graph/record.ts)). They MUST NOT appear in [src/types.ts](src/types.ts),
[src/index.ts](src/index.ts), [src/cli.ts](src/cli.ts),
[src/policy/](src/policy/), [src/report/](src/report/), or
[src/commands/](src/commands/). The boundary is `nodeToRecord` in
[src/graph/record.ts](src/graph/record.ts), which already returns an
`InstalledPackageRecord`.

**Rationale.** The MVP spec fixes this boundary
(`license-gate` capability, "Module purity boundaries" requirement). Public
consumers of the programmatic `check()` / `collect()` API see project-owned types
only; Arborist remains an implementation detail that we can swap or version-bump
without breaking consumers.

**Alternatives considered.**

- _Re-export `Node` from the public API for advanced users._ Rejected: makes Arborist a
  load-bearing part of our SemVer surface.

### 3. What replaces what

For each of the structural names the proposal calls out:

| Local name (today)                         | Replacement                                                                                              | Notes                                                                                                                                                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Arborist` (ambient class stub)            | `import Arborist from '@npmcli/arborist'`                                                                | Constructor shape `new Arborist({path})` is preserved.                                                                                                                               |
| Result of `await arb.loadActual()`         | DefinitelyTyped return type (`Node`)                                                                     | Drops the `as ArboristNode` cast at the call site.                                                                                                                                   |
| `ArboristNode`                             | DefinitelyTyped `Node` (and `Link` where the link branch needs the non-optional `target`)                | Re-exported only inside the graph layer if convenient; not re-exported from `src/index.ts`.                                                                                          |
| `ArboristEdge`                             | DefinitelyTyped `Edge`                                                                                   | `Edge.to: Node \| null` is what we already check for.                                                                                                                                |
| `node.inventory`                           | DefinitelyTyped `Node['inventory']`                                                                      | We only need `.values()`.                                                                                                                                                            |
| `tree.workspaces`                          | DefinitelyTyped `Node['workspaces']`                                                                     | Already typed `Map<string, string> \| undefined`-ish; we keep the existing nullish guard.                                                                                            |
| `node.edgesOut`                            | DefinitelyTyped `Node['edgesOut']`                                                                       | Already a `Map`-shaped iterable of `Edge`.                                                                                                                                           |
| `node.children`                            | DefinitelyTyped `Node['children']`                                                                       | We only need `.values()`.                                                                                                                                                            |
| `node.package`                             | DefinitelyTyped `Node['package']` plus a local `ArboristPackageJson` narrowing helper inside `record.ts` | DefinitelyTyped types `package` as the npm manifest (broad). The narrowing helper restricts to the four fields we actually read. Justified inline as "manifest field-set narrowing". |
| `node.path` / `node.realpath`              | DefinitelyTyped string fields                                                                            | No local helper needed.                                                                                                                                                              |
| `node.location`                            | DefinitelyTyped string field                                                                             | No local helper needed.                                                                                                                                                              |
| `node.isRoot` / `node.isWorkspace`         | DefinitelyTyped boolean fields                                                                           | No local helper needed.                                                                                                                                                              |
| `node.isLink` plus `node.target` narrowing | DefinitelyTyped `Link` (a `Node` subtype with required `target: Node`)                                   | We keep a tiny local helper / narrowing guard for the `isLink && target` branch in `narrow.ts`. Justified inline.                                                                    |

### 4. Retained local types

We keep two small local helpers, each with a one-line justification comment at the
declaration site:

1. `ArboristPackageJson` (local) — narrows the broad DefinitelyTyped manifest to the
   exact fields we read in [src/graph/record.ts](src/graph/record.ts) (`name`,
   `version`, `license`, `repository`, `author`). Using the broad type would force
   noisier `unknown` casts inside `extractRepository` and `extractAuthor`. Comment:
   `"narrows DefinitelyTyped manifest to the four fields we read"`.

2. A local link-narrowing helper (a type guard or small inline `Link`-typed branch)
   inside [src/graph/narrow.ts](src/graph/narrow.ts) for the `isLink && node.target ? node.target : node`
   pattern at lines 92 and 113. DefinitelyTyped exposes `Link` with a required
   `target: Node`; we use that to drop the runtime `node.target ?` guard or to make
   it expressively narrow. Comment: `"narrowing isLink === true to Link with required target"`.

Any `as` casts that survive in the graph layer SHALL be on a single line with a
trailing comment of the form `// <typing-gap>:<one-line-reason>`.

### 5. Narrowing the boundary

The boundary stays exactly where it is: `nodeToRecord` in
[src/graph/record.ts](src/graph/record.ts) accepts a DefinitelyTyped `Node` and
returns the project-owned `InstalledPackageRecord` from
[src/types.ts](src/types.ts). No callers of `nodeToRecord` change.
[src/graph/load.ts](src/graph/load.ts) returns a DefinitelyTyped `Node` (the
already-loaded tree). [src/graph/narrow.ts](src/graph/narrow.ts) operates on
DefinitelyTyped `Node`/`Link`/`Edge` only.

### 6. Tests run for verification

This is purely type-level / internal. The verification set is:

- `npm run check` — `tsc --noEmit` against `tsconfig.json`. Must pass; no new errors.
- `npm run lint` — Prettier + ESLint. Must pass; no broadening of `any`/`unknown`
  outside the graph layer.
- `npm run build` — production build. Must pass; produced `dist/` shape unchanged.
- `npm test` — `tsc --project tsconfig-test.json` plus `vitest run --run`. The
  existing fixture-driven graph and policy suites (single-package, hoisted
  workspaces, non-hoisted conflict, nested duplicates, workspace-on-workspace,
  workspace narrowing reaches hoisted deps, license-shape variants, allowed-packages
  grammar errors, SPDX OR/AND/parens/WITH cases, exit codes, packaging smoke test)
  must pass without modification.
- `npm pack --dry-run --json` — packaging surface unchanged. The published file list
  must match the pre-change list (no `.d.ts` shape changes leaking out, no new files
  added or dropped).

No new tests are required for this change; existing tests already exercise every
branch of the graph layer. If a typing gap forces a new helper or guard, an existing
test scenario that exercises that branch is sufficient to validate it.

## Risks / Trade-offs

- **Risk: DefinitelyTyped types for `Node` / `Link` / `Edge` are looser or stricter than
  Arborist's runtime shape, causing build errors or unsafe access.**
  Mitigation: we already touch only a small surface of fields; if a field is typed too
  loosely (e.g. `package` as broad manifest), the retained `ArboristPackageJson`
  narrowing helper covers it; if a field is typed too strictly, we add a minimal
  type-narrowing helper inline with a one-line gap comment. No casts outside the graph
  layer.

- **Risk: type changes accidentally widen `src/types.ts` (the public surface).**
  Mitigation: the proposal forbids it, and the verification step `npm pack --dry-run --json`
  combined with manual diff of the published `dist/index.d.ts` confirms nothing about
  the public surface changed. If a `Node`-typed value reaches `src/types.ts`, the
  build will fail (because `src/types.ts` does not import from `@npmcli/arborist`).

- **Risk: import order changes break the existing `as ArboristNode` cast removal.**
  Mitigation: removing the local ambient module in
  [src/types-vendor.d.ts](src/types-vendor.d.ts) immediately after adding the
  DefinitelyTyped package ensures one and only one declaration of
  `@npmcli/arborist` is in scope. If both coexist transiently, TypeScript will
  surface the duplicate-declaration error.

- **Trade-off: a future Arborist major-version bump may break the build (good) where
  hand-written types would have silently kept compiling against a stale shape (bad).**
  This is the intended outcome — surfacing breakage at build time is exactly what we
  want from typed external dependencies.

- **Trade-off: `@types/npmcli__arborist` becomes a devDependency we must keep
  approximately aligned with the runtime `@npmcli/arborist` major.** Mitigation: this
  is normal DefinitelyTyped hygiene and matches our existing `@types/node` posture.

## Migration Plan

Internal-only, no consumer migration. Implementation order:

1. Add `@types/npmcli__arborist` to `devDependencies` and `npm install`.
2. Update [src/graph/load.ts](src/graph/load.ts): remove local `ArboristNode` /
   `ArboristEdge` exports, drop the `as ArboristNode` cast on `loadActual()`, import
   `Arborist` and the relevant types from `@npmcli/arborist`.
3. Update [src/graph/narrow.ts](src/graph/narrow.ts): replace `ArboristNode` imports
   with DefinitelyTyped `Node`/`Link`/`Edge`; add the small link-narrowing helper if
   needed.
4. Update [src/graph/record.ts](src/graph/record.ts): replace `ArboristNode` /
   `ArboristPackageJson` imports; keep the local `ArboristPackageJson` narrowing helper
   with a one-line gap comment.
5. Delete the `declare module '@npmcli/arborist'` block from
   [src/types-vendor.d.ts](src/types-vendor.d.ts). Keep the
   `spdx-expression-parse` block.
6. Run the full verification suite (see Decision 6).

Rollback: revert the commit. No data, config, or persisted-output rollback is needed
because nothing about runtime behaviour, output format, or the public API changed.

## Open Questions

- None. DefinitelyTyped coverage of the fields we currently use has been confirmed to
  be sufficient; any small gap is handled by the retained-helpers rule (Decision 4).

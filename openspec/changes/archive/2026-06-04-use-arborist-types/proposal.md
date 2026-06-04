## Why

The MVP implementation uses `@npmcli/arborist` (`loadActual()` + `tree.inventory`) as the
sole graph-discovery primitive, but the graph layer types Arborist nodes, edges,
inventory, workspaces, and the Arborist class itself with hand-written structural types
in [src/graph/load.ts](src/graph/load.ts) and [src/types-vendor.d.ts](src/types-vendor.d.ts).
Those types were authored when DefinitelyTyped coverage was assumed missing. A
DefinitelyTyped package — `@types/npmcli__arborist` — does exist, and using it lets us
delete most of the local Arborist-shaped types, get accurate field signatures (e.g.
`Edge.to: Node | null`, `Node.children: Map<string, Node>`, `Node.inventory`,
`Node.workspaces`), and reduce the surface where a future Arborist field shape change
silently goes unnoticed. This is internal type-safety hygiene only — there is no
runtime, behavioural, output, exit-code, or public-API change.

## What Changes

- Add `@types/npmcli__arborist` as a `devDependency`. No runtime dependency is added or
  removed.
- Replace the local structural Arborist types in the graph layer with the DefinitelyTyped
  types where the official typings are accurate enough:
  - `ArboristNode` → DefinitelyTyped `Node` (and `Link` where a link narrowing is needed).
  - `ArboristEdge` → DefinitelyTyped `Edge`.
  - The `Arborist` class itself, `loadActual()` return type, the `Node.inventory` map,
    `Node.workspaces` map, `Node.children` map, `Node.edgesOut` map, `Node.package`,
    `Node.path`, `Node.realpath`, `Node.location`, `Node.isRoot`, `Node.isWorkspace`,
    `Node.isLink` — all sourced from DefinitelyTyped instead of the local module
    declaration.
- Delete the `declare module '@npmcli/arborist'` ambient stub in
  [src/types-vendor.d.ts](src/types-vendor.d.ts). The `spdx-expression-parse` ambient
  stub in the same file SHALL remain (out of scope for this change).
- Keep small local adapter / type-narrowing helpers only where DefinitelyTyped coverage
  is incomplete, awkward, or wrong — for example, narrowing a generic `Node` to "node
  with a non-null `target`" for the `isLink` branch in
  [src/graph/narrow.ts](src/graph/narrow.ts#L92), or the local
  `ArboristPackageJson` shape used by [src/graph/record.ts](src/graph/record.ts) for
  reading `name` / `version` / `license` / `repository` / `author` off
  `node.package`. Each retained local type SHALL be justified inline with a one-line
  comment naming the concrete typing gap (the `package` field carries a
  `Record<string, unknown>`-shaped manifest and the local shape narrows it for our
  reads; the link/target narrowing turns a potentially undefined `target` into a
  required one inside an `isLink === true` branch).
- Keep all Arborist-typed values inside the graph layer
  ([src/graph/load.ts](src/graph/load.ts), [src/graph/narrow.ts](src/graph/narrow.ts),
  [src/graph/record.ts](src/graph/record.ts)). The boundary at which Arborist types are
  converted to project-owned types is `nodeToRecord` in
  [src/graph/record.ts](src/graph/record.ts), which already returns an
  `InstalledPackageRecord`. That boundary stays exactly where it is.
- Public/project-owned types — `InstalledPackageRecord`, `Decision`, `ViolationReason`,
  `ConfigError`, `LicenseGateConfigError`, `CheckResult`, `CollectResult`,
  `CollectedRecord`, the report JSON shapes — SHALL remain project-owned and SHALL NOT
  reference any Arborist type, directly or transitively. The exported surface from
  [src/index.ts](src/index.ts) and [src/types.ts](src/types.ts) does not change.
- Any remaining casts SHALL be localised inside the graph layer and justified by a
  named, concrete typing gap (e.g. "DefinitelyTyped types `Node.package` as the npm
  manifest record; we narrow it to the fields we read").

## Capabilities

### New Capabilities

(none — this change introduces no new capability.)

### Modified Capabilities

- `license-gate`: no requirement-level behaviour changes. The change adds a single
  internal-only requirement under the existing `license-gate` capability stating that
  Arborist types come from `@types/npmcli__arborist` and that those types do not leak
  out of the graph layer into the public API. Every existing requirement (CLI surface,
  project root selection, graph discovery, workspace narrowing, license detection,
  allowlist files, evaluation algorithm, overrides, collect-all-then-exit, exit codes,
  packaging) keeps its current behaviour and scenarios verbatim.

## Impact

- **Code touched**: [src/graph/load.ts](src/graph/load.ts) (the structural type
  definitions and the `Arborist` instantiation site), [src/graph/narrow.ts](src/graph/narrow.ts)
  (parameter / return / local type annotations for nodes), [src/graph/record.ts](src/graph/record.ts)
  (parameter type for `nodeToRecord`; the local `ArboristPackageJson` shape may stay as
  a narrowing helper), [src/types-vendor.d.ts](src/types-vendor.d.ts) (drop the
  `@npmcli/arborist` block; keep `spdx-expression-parse`).
- **`package.json`**: add `@types/npmcli__arborist` to `devDependencies`. No runtime
  `dependencies` change.
- **Public API**: unchanged. The exported types from [src/types.ts](src/types.ts) and
  the exports of [src/index.ts](src/index.ts) are byte-identical in shape. No Arborist
  type appears in the public surface.
- **CLI surface**: unchanged. No new flags, no removed flags, no changed flag
  semantics.
- **Reports**: unchanged. JSON shape, human shape, exit codes, and counts are
  identical.
- **Tests**: no test fixtures or scenarios change. The existing fixture-driven vitest
  suite continues to cover graph discovery, workspace narrowing, the literal-first /
  SPDX evaluator, override grammar, the collect command, and the packaging smoke test.
- **Verification**: `npm run check`, `npm run lint`, `npm run build`, `npm test`, and
  `npm pack --dry-run --json` are all expected to pass without any source-of-truth
  type widening.
- **Out of scope** (no product behaviour added): `package@*`, `@scope/package@*`, SARIF,
  GitHub Action, init command, pnpm/yarn support, markdown/tree reports, additional
  config systems, additional CLI flags, license-file scanning, README/LICENSE/COPYING
  scanning, SPDX correction/normalisation, deprecated `license` object/array
  unwrapping, clarifications, checksum evidence.

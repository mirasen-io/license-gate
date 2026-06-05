## Why

The `workspace` field on `InstalledPackageRecord` (and therefore on every check / collect JSON record) is misleading. Users reasonably read it as "which workspace owns or requires this package", but its actual meaning is "which workspace directory physically contains this installed package copy". In practice it is `null` for nearly every record — including for the workspace packages themselves, and for hoisted dependencies that are only ever required by a single workspace — and only becomes non-null for the rare case of a non-hoisted version conflict installed under a workspace-local `node_modules`. Dogfooding `@mirasen/license-gate` against `@mirasen/chess-lore` surfaced this confusion. The relative `path` field already communicates physical placement clearly (`apps/web/node_modules/foo` vs `node_modules/foo`), so the `workspace` field carries no information that `path` does not already carry.

We are still pre-1.0, so we drop the misleading field from the public report schema before it ossifies. A real workspace-attribution feature (which workspace(s) require a given package) is a separate, edge-graph-based design and is explicitly out of scope here.

## What Changes

- **BREAKING (pre-1.0 schema cleanup)**: Remove the `workspace` field from `InstalledPackageRecord` and `CollectedRecord`, and therefore from every check JSON decision record and every collect JSON report record.
- Remove the `workspace` label from human report formatting (the `[workspace: <name>]` decoration on package identifiers and skipped-root lines).
- Remove the internal `findContainingWorkspace` containment logic that exists solely to populate this field, along with the `WorkspaceInfo`/`workspaceList` plumbing in scope resolution.
- Update tests to drop `workspace` expectations and assert that JSON records no longer carry the field.
- Update `README.md` and `openspec/specs/license-gate/spec.md` to remove references to the field and its scenario.
- Keep the `--workspace <name|path>` CLI flag and all narrowing behavior unchanged.
- Keep graph loading, dedup, policy evaluation, allowlist behavior, package-name/version overrides, SPDX evaluation, exit codes, and relative path reporting unchanged.

Out of scope (explicitly not added by this change): workspace ownership / dependents attribution, `requiredByWorkspace`, `requiredByWorkspaces`, dependency tree reports, new CLI flags, new output formats, SARIF, GitHub Action, pnpm/yarn support, config system, license file scanning, SPDX normalization/correction, deprecated license shape unwrapping, any policy behavior changes.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `license-gate`: The `Internal data model` requirement no longer lists `workspace` as a field of `InstalledPackageRecord`, and the `workspace field reflects containment` scenario is removed.

## Impact

- **Public report schema (BREAKING, pre-1.0)**: `workspace` disappears from every record emitted by `license-gate check --json` and `license-gate collect --json`. Any consumer reading that field today will need to drop the read; nothing replaces it for now (use `path` for physical placement).
- **Code**:
  - [src/types.ts](src/types.ts): drop `workspace` from `InstalledPackageRecord`.
  - [src/graph/scope.ts](src/graph/scope.ts): remove `findContainingWorkspace`, `WorkspaceInfo`, and the `workspaceList` build-up — the `--workspace` narrowing path is unaffected because narrowing is driven separately via `narrowToWorkspace`.
  - [src/graph/record.ts](src/graph/record.ts): drop the `workspace` parameter from `nodeToRecord`.
  - [src/report/human.ts](src/report/human.ts): drop the two `[workspace: …]` formatting branches.
- **Tests**: update [tests/report/report-branches.test.ts](tests/report/report-branches.test.ts), [tests/report/report-package-name-rule.test.ts](tests/report/report-package-name-rule.test.ts), [tests/policy/evaluate.test.ts](tests/policy/evaluate.test.ts) to drop `workspace: null` from in-test record literals; add small assertions that rendered JSON records do NOT contain a `workspace` key.
- **Docs**: update [README.md](README.md) (any record/report shape references) and the spec delta described above.
- **No change** to `--workspace` flag behavior, narrowing semantics, exit codes, allowlists, decision shapes, or path reporting.

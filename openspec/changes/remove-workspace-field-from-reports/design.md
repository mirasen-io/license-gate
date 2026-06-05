## Context

`@mirasen/license-gate` is pre-1.0. Its public outputs are the JSON reports
emitted by `license-gate check --json` and `license-gate collect --json`, plus
the human reports printed to stdout. Both shapes flow from a single internal
type, `InstalledPackageRecord`, which currently includes a `workspace: string |
null` field.

The field is computed in [src/graph/scope.ts](src/graph/scope.ts) by
`findContainingWorkspace`: for each evaluation node, it looks up the node's
`realpath` against the project's declared workspaces (via
`tree.workspaces`) and returns the name of the closest workspace whose
`realpath` is a strict prefix of the node's `realpath`. By design the function
returns `null` when the node IS the workspace itself, so workspace packages get
`workspace: null` too.

Why this is misleading in practice:

- Modern package managers (npm 7+, yarn classic, pnpm with hoist) hoist almost
  every dependency into the project root's `node_modules`. A hoisted dep
  required only by `apps/web` lives at `node_modules/<dep>`, so its `realpath`
  does not start with `apps/web/`, so its `workspace` is `null`.
- A workspace package's own `realpath` is `apps/web` itself, which the function
  treats as identity (not containment) and returns `null`.
- The only records with a non-null `workspace` are non-hoisted copies sitting
  under a workspace-local `node_modules` (typically version conflicts) — a
  small minority of records in any real project.

A separate, also-misleading interaction: the `--workspace <name|path>`
narrowing CLI flag is unrelated to this field. Narrowing scopes the evaluation
set to one workspace's reachable graph (driven by
[src/graph/narrow.ts](src/graph/narrow.ts)); the `workspace` field on records
is never used to drive any control flow. Removing the field does not affect
narrowing.

Existing consumers: this project is pre-1.0 and the field is documented in the
spec but has no known external readers. Internal uses are confined to two
formatting branches in [src/report/human.ts](src/report/human.ts).

## Goals / Non-Goals

**Goals:**

- Drop `workspace` from every public record shape (`InstalledPackageRecord`,
  `CollectedRecord`, every `Decision.record`, `CheckJsonReport.decisions[]`,
  `CollectJsonReport.records[]`, `skippedProjectRoot`).
- Drop the `[workspace: <name>]` decoration from human report output.
- Remove the now-orphaned `findContainingWorkspace` and its supporting
  `WorkspaceInfo` plumbing in `src/graph/scope.ts`, and the corresponding
  parameter of `nodeToRecord` in `src/graph/record.ts`.
- Update the spec capability `license-gate` so the `Internal data model`
  requirement no longer mentions `workspace` and the `workspace field reflects
  containment` scenario is removed.
- Update tests to remove `workspace: null` literals from in-test record
  fixtures and add explicit assertions that JSON outputs do NOT contain a
  `workspace` key.
- Leave `--workspace <name|path>` narrowing, graph loading, dedup, policy
  evaluation, allowlists, package overrides, SPDX evaluation, exit codes, and
  relative `path` reporting untouched.

**Non-Goals:**

- No workspace-ownership / dependents attribution, no `requiredByWorkspace(s)`,
  no dependency-edge analysis. That is a separate future change.
- No new CLI flags, output formats, SARIF, GitHub Action, pnpm/yarn support,
  config system, license file scanning, SPDX normalisation, or deprecated
  license shape unwrapping.
- No changes to policy behavior, allowlist grammar, exit codes, or path
  reporting.

## Decisions

### Decision 1: Delete the field outright (no deprecation, no migration alias)

We are pre-1.0; removing a field is the cheap, honest move. We do NOT keep a
`workspace: null` placeholder, do NOT emit a deprecation warning, and do NOT
add a migration flag.

Alternatives considered:

- **Keep the field, document it more carefully**: rejected. The field's
  meaning ("physical containment") is genuinely not what users expect, and
  `path` already conveys it. Better docs would not change that.
- **Replace with `requiredByWorkspaces: string[]`** in the same change:
  rejected as scope creep. Edge-graph attribution requires a different
  computation (BFS from each workspace, intersected with each evaluation node)
  and a different testing surface (hoisting interactions, transitive
  closures). It deserves its own proposal where the shape can be discussed on
  its own merits.
- **Soft-deprecation period (always emit `null`, plan to remove later)**:
  rejected. Pre-1.0 schema, no known consumers; no value in carrying dead
  state.

### Decision 2: Remove `findContainingWorkspace` along with the field

The function exists solely to populate the field. Once the field is gone, the
function and its `WorkspaceInfo`/`workspaceList` build-up in
`src/graph/scope.ts` become dead code. Deleting them keeps `scope.ts` focused
on "narrow + dedup + project-relative paths" and removes a code path that
performed `realpath`/`startsWith` work for every node on every run.

We continue to read `tree.workspaces` (the Map) inside `narrow.ts` for
`--workspace` resolution; that is a separate use site and stays.

### Decision 3: nodeToRecord loses its workspace parameter

`nodeToRecord(node, workspace, projectRoot)` becomes `nodeToRecord(node,
projectRoot)`. The signature change is local — only callers in
`src/graph/scope.ts` use it. We update those at the same time.

### Decision 4: Test strategy — remove existing assertions, add absence checks

Existing tests carry `workspace: null` in record literals (in
`tests/report/report-branches.test.ts`,
`tests/report/report-package-name-rule.test.ts`, and
`tests/policy/evaluate.test.ts`). We delete those properties. We add a small
number of new assertions (one each in the check JSON test, the collect JSON
test, and a human-report test) that verify the rendered output contains NO
`"workspace"` key and no `[workspace:` substring. The non-hoisted conflict
fixture (`buildNonHoistedConflictFixture`) already exercises the only case
where the field used to be non-null, so we add the absence check there.

The existing `--workspace` narrowing tests
([tests/graph/narrow.test.ts](tests/graph/narrow.test.ts)) continue unchanged
and act as the regression net for narrowing behavior.

### Decision 5: Spec delta uses MODIFIED + REMOVED

The `Internal data model` requirement carries the field name in its prose AND
has multiple scenarios (some of which we want to keep). MODIFIED is the right
operation for that block: paste the full updated requirement text and full
scenario list. The `workspace field reflects containment` scenario is removed
via a top-level REMOVED Requirements block (treating the standalone scenario
as a removable requirement-equivalent), with `Reason` and `Migration` notes
pointing consumers to `path`.

## Risks / Trade-offs

- **[Risk] Silent breakage for any external consumer reading
  `record.workspace`** → Mitigation: change is pre-1.0 and called out as
  BREAKING in the proposal and the changeset entry; the migration path
  (read `path` instead) is documented in the spec's REMOVED requirement.
- **[Risk] Loss of the only "this is a non-hoisted local conflict" signal in
  human output** → Mitigation: `record.path` already shows
  `apps/web/node_modules/<dep>` for that case, which is the underlying
  evidence; the workspace label was a redundant restating of the path prefix.
- **[Risk] Future workspace-attribution change might want a field named
  `workspace` and we will have orphaned the name** → Mitigation: we will name
  the future field `requiredByWorkspaces` (plural, edge-graph based) anyway,
  because hoisted deps can be required by multiple workspaces. The semantics
  differ, so reusing the old name would itself be a footgun.
- **[Trade-off] We ship a hard break instead of a deprecation cycle** →
  Acceptable pre-1.0; the changeset records the break, and the schema
  comment in `src/report/json.ts` ("stable across v1.x") is honored because
  this lands before 1.x.

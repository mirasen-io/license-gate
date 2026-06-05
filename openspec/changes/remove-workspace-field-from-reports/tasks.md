## 1. Types and core graph

- [ ] 1.1 Remove the `workspace: string | null` field (and its docblock) from `InstalledPackageRecord` in [src/types.ts](src/types.ts). Confirm `CollectedRecord` and `Decision` (which carry records) compile-error in any caller that still spells `workspace`.
- [ ] 1.2 In [src/graph/record.ts](src/graph/record.ts), drop the `workspace` parameter from `nodeToRecord` and stop emitting the field on the returned record. Update the function's docblock to remove the workspace bullet.
- [ ] 1.3 In [src/graph/scope.ts](src/graph/scope.ts), delete `findContainingWorkspace`, the `WorkspaceInfo` type, the `canonical` workspace-path build-up, and the `workspaceList`/`tree.workspaces` walk used solely to populate it. Update the two `nodeToRecord(...)` call sites to the new 2-arg signature.
- [ ] 1.4 Search the rest of `src/` for any remaining reference to `record.workspace`, `.workspace` on a record value, or the literal string `"workspace"` used as a field name (excluding `--workspace` flag, `tree.workspaces`, `narrowToWorkspace`, `invalid-workspace`, and `WorkspaceInfo` removed in 1.3) and remove each.

## 2. Reporters

- [ ] 2.1 In [src/report/human.ts](src/report/human.ts), drop the `record.workspace ? ... : ...` branch around line 14 so the package label is just `record.packageId`. Also drop the `[workspace: ...]` decoration around line 136 in the skipped-root summary.
- [ ] 2.2 Confirm [src/report/json.ts](src/report/json.ts) requires no source change (it serialises records as-is); the docblock comment about "stable across v1.x" stays accurate since this lands pre-1.0.

## 3. Tests — remove obsolete expectations

- [ ] 3.1 In [tests/report/report-branches.test.ts](tests/report/report-branches.test.ts) drop the `workspace: null` property from any in-test record literal.
- [ ] 3.2 In [tests/report/report-package-name-rule.test.ts](tests/report/report-package-name-rule.test.ts) drop the `workspace: null` property from any in-test record literal.
- [ ] 3.3 In [tests/policy/evaluate.test.ts](tests/policy/evaluate.test.ts) drop the `workspace: null` property from any in-test record literal.
- [ ] 3.4 Verify [tests/graph/narrow.test.ts](tests/graph/narrow.test.ts), [tests/graph/load.test.ts](tests/graph/load.test.ts), and [tests/cli/cli-dispatch.test.ts](tests/cli/cli-dispatch.test.ts) need no changes (they reference `--workspace` narrowing only, never the record field).

## 4. Tests — add absence assertions

- [ ] 4.1 Add a unit assertion in [tests/report/exposed-paths.test.ts](tests/report/exposed-paths.test.ts) (or a new sibling test) that for the hoisted-workspace fixture and the single-package fixture, every record produced by `runCollect` lacks an own property named `workspace` (use `Object.prototype.hasOwnProperty.call`, not `=== null`).
- [ ] 4.2 Add an absence assertion against the non-hoisted conflict fixture (`buildNonHoistedConflictFixture`), which is the only case that previously emitted a non-null value, asserting that `apps/web/node_modules/fake-shared@3.0.0`'s collected record has no `workspace` key while its `path` still contains `apps/web/node_modules/fake-shared`.
- [ ] 4.3 Add an assertion that the rendered JSON string from `renderCheckJson` and `renderCollectJson` does not contain the substring `"workspace"`.
- [ ] 4.4 Add an assertion that the rendered human report (from `runCheck` against a workspace fixture) does not contain the substring `[workspace:`.

## 5. Spec and docs

- [ ] 5.1 Apply the spec delta to [openspec/specs/license-gate/spec.md](openspec/specs/license-gate/spec.md): edit the `Internal data model` requirement so it no longer lists `workspace` as a record field, replace the `record contains realpath` scenario wording to match the relative-path semantics already in code, add the new scenarios from the delta (`project root path`, `hoisted dependency path`, `no workspace field on records`), and delete the `workspace field reflects containment` scenario. Source of truth for the final wording is `openspec/changes/remove-workspace-field-from-reports/specs/license-gate/spec.md`.
- [ ] 5.2 Scan [README.md](README.md) for any prose suggesting reports include workspace ownership / containment metadata. Today the README mentions only `--workspace` (narrowing) and the record types' name in passing — confirm no JSON shape examples need editing. If anything is added or rephrased, keep it accurate: `path` shows physical placement; `--workspace` narrows the evaluation graph; workspace ownership/dependents attribution is not part of the report model.
- [ ] 5.3 Add a changeset entry for the breaking schema cleanup (new file under `.changeset/`, e.g. `remove-workspace-field.md`, marking `@mirasen/license-gate` as `major` since the prior MVP changeset is also `major` and the package has not shipped yet — or as `minor`/`patch` if the team lands them all under the same release; confirm with the existing `.changeset/license-gate-mvp.md` convention before choosing).

## 6. Verification

- [ ] 6.1 Run `npm run check` and confirm clean.
- [ ] 6.2 Run `npm run lint` and confirm clean.
- [ ] 6.3 Run `npm run build` and confirm clean.
- [ ] 6.4 Run `npm test` and confirm all suites pass, including the new absence assertions in §4.
- [ ] 6.5 Run `npm pack --dry-run --json` and confirm the published file list still includes `dist/`, `README.md`, the `licenses/` shipped sample (if any), and that no removed files leaked into the pack.
- [ ] 6.6 Smoke-test against the dogfooding consumer that surfaced this issue: from `@mirasen/chess-lore` (or any local workspace project), run `npx --yes <local pack>` for both `license-gate check --json` and `license-gate collect --json`, and confirm no record carries a `workspace` key and no human-report line contains `[workspace:`.

## 7. OpenSpec close-out

- [ ] 7.1 Run `openspec validate remove-workspace-field-from-reports --strict` and confirm it passes.
- [ ] 7.2 After implementation lands and the verification in §6 is green, run `/opsx:archive remove-workspace-field-from-reports` to fold the delta into `openspec/specs/license-gate/spec.md` and move the change to `openspec/changes/archive/`.

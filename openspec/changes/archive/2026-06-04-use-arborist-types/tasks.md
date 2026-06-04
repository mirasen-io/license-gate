## 1. Inspect current Arborist usage

- [x] 1.1 Confirm the full set of Arborist-typed values in `src/graph/load.ts`, `src/graph/narrow.ts`, and `src/graph/record.ts` (Arborist class instance, `loadActual()` return, `Node`, `Link`, `Edge`, `inventory`, `workspaces`, `children`, `edgesOut`, `package`, `path`, `realpath`, `location`, `isRoot`, `isWorkspace`, `isLink`, `target`)
- [x] 1.2 Confirm `src/types.ts`, `src/index.ts`, `src/cli.ts`, `src/policy/`, `src/report/`, and `src/commands/` have zero references to Arborist-shaped types and record any incidental occurrences to remove
- [x] 1.3 Capture the current shape of `dist/index.d.ts` (or run `npm run build` and snapshot the public types) for a post-change diff

## 2. Add the DefinitelyTyped package

- [x] 2.1 Add `@types/npmcli__arborist` to `devDependencies` in `package.json` at a major version aligned with `@npmcli/arborist@^9.7.0`
- [x] 2.2 Run `npm install` and verify `package-lock.json` updates only the dev tree (no runtime dep changes)
- [x] 2.3 Verify `dependencies` is unchanged and contains exactly `@npmcli/arborist` and `spdx-expression-parse`

## 3. Drop the local ambient Arborist stub

- [x] 3.1 Remove the `declare module '@npmcli/arborist'` block from `src/types-vendor.d.ts`
- [x] 3.2 Confirm the `declare module 'spdx-expression-parse'` block remains intact in the same file
- [x] 3.3 Run `npm run check` and confirm no duplicate-declaration errors and no missing-module errors for `@npmcli/arborist`

## 4. Replace local Arborist types in `src/graph/load.ts`

- [x] 4.1 Remove the exported local `ArboristNode`, `ArboristEdge`, and `ArboristPackageJson` type definitions from `src/graph/load.ts`
- [x] 4.2 Import `Arborist` (default) and the relevant `Node`/`Link`/`Edge` types from `@npmcli/arborist` at the top of `src/graph/load.ts`
- [x] 4.3 Update `loadInstalledGraph`'s return type to the DefinitelyTyped `Node` and drop the `as ArboristNode` cast on `loadActual()`
- [x] 4.4 If `ArboristPackageJson` (the narrow manifest helper) is still wanted, move it to `src/graph/record.ts` (or keep a tiny export from `load.ts`) with a one-line comment naming the typing gap it bridges

## 5. Replace local Arborist types in `src/graph/narrow.ts`

- [x] 5.1 Replace `import type { ArboristNode } from './load.js'` with imports of `Node` (and `Link`/`Edge` as needed) from `@npmcli/arborist`
- [x] 5.2 Update parameter and return type annotations on `resolveWorkspaceNode`, `reachableFrom`, `narrowToWorkspace`, and the local `NarrowedTree` type
- [x] 5.3 Add a small inline link-narrowing helper or type guard for the `node.isLink && node.target ? node.target : node` pattern, with a one-line comment naming the typing gap (DefinitelyTyped's `Link` has a required `target`)
- [x] 5.4 Confirm `tree.workspaces`, `tree.inventory`, `tree.children`, `node.edgesOut`, `node.realpath`, `node.path`, and `edge.to` all type-check against the DefinitelyTyped types without new casts

## 6. Replace local Arborist types in `src/graph/record.ts`

- [x] 6.1 Replace `import type { ArboristNode, ArboristPackageJson } from './load.js'` with the appropriate DefinitelyTyped imports plus, if retained, the local `ArboristPackageJson` narrowing helper
- [x] 6.2 Update the parameter type of `nodeToRecord` and `detectLicense` to use the DefinitelyTyped `Node` and the local manifest narrowing helper respectively
- [x] 6.3 If the local `ArboristPackageJson` helper is retained, document it inline at its declaration with a one-line comment such as "narrows DefinitelyTyped manifest to the four fields we read"
- [x] 6.4 Verify the existing `extractRepository` / `extractAuthor` casts continue to compile; if any new `as` is needed, place it on a single line with a one-line gap comment

## 7. Sweep for boundary leaks

- [x] 7.1 Grep the source tree for `@npmcli/arborist` and confirm every import is in `src/graph/`
- [x] 7.2 Grep the source tree for the deleted local names (`ArboristNode`, `ArboristEdge`, `ArboristPackageJson`) and confirm no stale references remain anywhere outside `src/graph/`
- [x] 7.3 Confirm `src/types.ts`, `src/index.ts`, `src/cli.ts`, `src/policy/*`, `src/report/*`, and `src/commands/*` do not import anything from `@npmcli/arborist` or reference any Arborist-shaped type

## 8. Verification

- [x] 8.1 `npm run check` exits 0 with no errors
- [x] 8.2 `npm run lint` (Prettier check + ESLint) exits 0 with no errors
- [x] 8.3 `npm run build` exits 0; `dist/` is produced cleanly
- [x] 8.4 `npm test` (typecheck of test sources + `vitest run --run`) passes the entire fixture-driven suite without test-source modifications
- [x] 8.5 `npm pack --dry-run --json` succeeds; the published file list matches the pre-change snapshot, and `dist/index.d.ts` (and the types reachable from it) contains no symbols from `@npmcli/arborist`
- [x] 8.6 Diff `dist/index.d.ts` against the pre-change snapshot from task 1.3 and confirm the public types are unchanged in shape

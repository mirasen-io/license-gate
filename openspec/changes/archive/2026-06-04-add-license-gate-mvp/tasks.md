## 1. Project setup

- [x] 1.1 Update `package.json`: tighten `engines.node` to `>=22.9.0`
- [x] 1.2 Update `package.json`: add `bin: { "license-gate": "./dist/cli.js" }`
- [x] 1.3 Update `package.json`: add runtime `dependencies` `@npmcli/arborist` and `spdx-expression-parse`
- [x] 1.4 Run `npm install` and commit lockfile changes
- [x] 1.5 Verify `tsc --project tsconfig.json` still succeeds with the new deps
- [x] 1.6 Confirm CI workflows still pass on the bare repo before adding code

## 2. Internal types

- [x] 2.1 Create `src/types.ts` with `InstalledPackageRecord`
- [x] 2.2 Add `Decision` discriminated union (`allowed-by-license`, `allowed-by-scope-rule`, `allowed-by-package-version-rule`, `violation`)
- [x] 2.3 Add `ViolationReason` discriminated union with exactly two top-level reasons (`license-not-in-allowlist`, `package-not-in-allowlist`); `license-not-in-allowlist` carries optional `detailCode` and optional `offendingLeaves`
- [x] 2.4 Add `ConfigError` discriminated union (`missing-package-json`, `missing-node-modules`, `missing-allowed-hard-file`, `invalid-package-override-rule`, `invalid-workspace`, `output-path-unwritable`, `invalid-usage`)
- [x] 2.5 Add `AllowedHardList` and `AllowedPackagesRule` shapes in `src/types.ts`

## 3. Graph layer

- [x] 3.1 Implement `src/graph/load.ts` that asserts `<selectedProjectRoot>/package.json` exists (else `ConfigError { kind: "missing-package-json" }`) and wraps `new Arborist({ path: selectedProjectRoot }).loadActual()`. The selected project root is `--cwd` if provided, otherwise `process.cwd()`; never walk upward.
- [x] 3.2 Detect missing `node_modules` and surface as `ConfigError { kind: "missing-node-modules" }` (no walk-up, no rescue)
- [x] 3.3 Implement `src/graph/record.ts` mapping an Arborist `Node` to `InstalledPackageRecord` (name, version, packageId, realpath, workspace, license)
- [x] 3.4 Implement `src/graph/narrow.ts` BFS-by-`edgesOut` workspace narrowing; resolve workspace by name (via `tree.workspaces`) or by path (relative paths resolved against the selected project root); error with `invalid-workspace` on non-workspace project or unknown workspace
- [x] 3.5 Skip the root node when no `--workspace` is supplied; never silently exclude anything else; mark root as `(skipped: project root)` for reporters

## 4. Policy layer (pure)

- [x] 4.1 Implement `src/policy/allowed-hard.ts` parser (trim, skip blanks/comments, dedup, no normalisation)
- [x] 4.2 Implement `src/policy/allowed-packages.ts` parser with strict three-form grammar (`@scope/*`, `package@version`, `@scope/package@version`); ConfigError on any other shape with file/line/text
- [x] 4.3 Implement `src/policy/spdx-shape.ts` boolean-walk over `spdx-expression-parse` AST (OR / AND / parens; literal leaves)
- [x] 4.4 Implement `src/policy/evaluate.ts` literal-first evaluation per design D5: (1) override-then-`package-not-in-allowlist` for `could not determine`; (2) literal allowed-hard match → `allowed-by-license`; (3a) SPDX parse fail → override-or-`license-not-in-allowlist` with `literal-not-allowed-and-spdx-unparseable`; (3b) SPDX parse OK → walk; satisfied → `allowed-by-license`; unsatisfied → override-or-`license-not-in-allowlist` with `spdx-expression-not-satisfied` and `offendingLeaves`
- [x] 4.5 Implement override precedence: more-specific `package@version` beats `@scope/*` in reported `matchedPackageRule`
- [x] 4.6 Implement license-allow vs override precedence: `allowed-by-license` wins; no `matchedPackageRule` when license-allow wins
- [x] 4.7 Verify: policy modules import nothing from `node:fs`, `node:path` (for I/O), or `@npmcli/arborist`

## 5. Reporters

- [x] 5.1 Implement `src/report/human.ts` rendering decisions and violations as readable text (counts, allowed list, violation list with reason and detail code where applicable)
- [x] 5.2 Implement `src/report/json.ts` serialising decisions to a stable JSON shape (records, decisions with reason/detailCode/offendingLeaves/matchedPackageRule)
- [x] 5.3 Ensure both reporters exhaustively switch on `Decision` and `ViolationReason` unions (TypeScript exhaustiveness check)

## 6. Commands

- [x] 6.1 Implement `src/commands/check.ts` orchestrating discovery → parse allowlists → policy → reporting; require `licenses/allowed-hard.txt` (else exit 2)
- [x] 6.2 Implement `src/commands/collect.ts` orchestrating discovery → flat record list → reporting; do NOT read `allowed-hard.txt` or `allowed-packages.txt`
- [x] 6.3 Ensure `check` collects all violations before exiting (never fail-fast)
- [x] 6.4 Ensure `--json` file write completes (await write/close) before `process.exit` on both commands; no `fsync` required
- [x] 6.5 Ensure `collect --out <path>` writes file and emits only a one-line summary on stdout
- [x] 6.6 Ensure `check --out <path>` is rejected with `ConfigError { kind: "invalid-usage" }` and exit 2

## 7. CLI entry

- [x] 7.1 Implement `src/cli.ts` using `node:util.parseArgs`; first source line is `#!/usr/bin/env node`
- [x] 7.2 Reject unknown subcommands with exit code 2
- [x] 7.3 Reject unknown flags (including `--root`, `--project`, `--allowed`, `--allowed-packages`, `--all`, depth/production/dev, markdown/tree) with exit code 2. `--cwd` is accepted for both subcommands.
- [x] 7.4 Wire `--workspace <name|path>` for both subcommands
- [x] 7.5 Wire `--json <path>` for both subcommands; wire `--out <path>` for `collect` only
- [x] 7.6 Reject `check --out <path>` with exit 2 and `invalid-usage` message
- [x] 7.7 Map every `ConfigError` variant to exit code 2 with a clear stderr message
- [x] 7.8 Build pipeline ensures `dist/cli.js` retains the shebang and is executable (post-build `chmod +x` step if needed)

## 8. Programmatic API

- [x] 8.1 Re-export `check` and `collect` from `src/index.ts` with typed signatures
- [x] 8.2 Document the public types exported from `src/index.ts`

## 9. Allowlist asset bootstrapping (dev-only)

- [x] 9.1 Create example `licenses/allowed-hard.txt` (header comment + a few common entries) at the repo root for demo/dev only
- [x] 9.2 Create example `licenses/allowed-packages.txt` (header comment only) for demo/dev only
- [x] 9.3 Confirm these example files are NOT shipped in the published package (`files` field excludes them)

## 10. Test fixtures

- [x] 10.1 Add a single-package fixture in `tests/fixtures/single-pkg/` with a deterministic `package-lock.json`
- [x] 10.2 Add a hoisted-workspace fixture in `tests/fixtures/workspaces-hoisted/`
- [x] 10.3 Add a non-hoisted conflict fixture in `tests/fixtures/workspaces-non-hoisted/` reproducing `lodash@4` at root and `lodash@3` at `apps/web/node_modules/`
- [x] 10.4 Add a workspace-on-workspace fixture in `tests/fixtures/workspace-deps-workspace/`
- [x] 10.5 Add fixtures with parseable and unparseable WITH-exception licence strings (hand-built fake packages in `node_modules`): one with `license: "GPL-2.0-only WITH Classpath-exception-2.0"` (parseable WITH-exception leaf) and one with `license: "GPL-2.0-only WITH"` (unparseable, for the `literal-not-allowed-and-spdx-unparseable` path)
- [x] 10.6 Add a fixture with deprecated `{type, url}` license object form
- [x] 10.7 Add a fixture with deprecated `licenses[]` array form
- [x] 10.8 Document a setup helper (vitest `globalSetup` or `tests/setup.sh`) that runs `npm ci` against fixtures on demand without polluting CI

## 11. Tests — discovery

- [x] 11.1 Single-package: every installed package appears in evaluation
- [x] 11.2 Hoisted workspaces: every installed package appears in evaluation
- [x] 11.3 Non-hoisted conflict: both physical copies appear with distinct realpaths
- [x] 11.4 Workspace symlink in root `node_modules` is resolved to the workspace
- [x] 11.5 Duplicate transitive copies at different physical paths are listed separately
- [x] 11.6 Workspace depending on another workspace works
- [x] 11.7 Run from the correct project root succeeds
- [x] 11.8 Run from a directory without `package.json` exits 2 with a clear message
- [x] 11.9 No walk-up rescue: running from a workspace subdirectory does NOT find the workspace project root
- [x] 11.9a Running from a workspace subdirectory whose own `package.json` exists is accepted as the project root and Arborist is invoked at that subdirectory (single-package treatment)
- [x] 11.10 `--workspace <name>` includes hoisted deps reachable from the workspace
- [x] 11.11 `--workspace <relative-path>` resolves against the selected project root to the same node as by name
- [x] 11.12 `--workspace <absolute-path>` resolves to the same node as by name
- [x] 11.13 `--workspace` on non-workspace project exits 2
- [x] 11.14 Nonexistent workspace exits 2
- [x] 11.15 Missing `node_modules` exits 2
- [x] 11.16 `check --cwd <path>` uses the supplied path as the project root and resolves all project-relative paths against it
- [x] 11.17 `collect --cwd <path>` uses the supplied path as the project root
- [x] 11.18 `--cwd <path>` does NOT walk upward when `package.json` is missing at the supplied path (exit 2)
- [x] 11.19 `--cwd <root> --workspace <name>` loads Arborist at `<root>` and narrows inside that already-loaded tree

## 12. Tests — license detection

- [x] 12.1 String `MIT` recorded verbatim
- [x] 12.2 String `Apache-2.0` recorded verbatim
- [x] 12.3 String `Apache 2.0` (with space) recorded verbatim and treated as distinct from `Apache-2.0`
- [x] 12.4 Missing license → `could not determine`
- [x] 12.5 Empty license → `could not determine`
- [x] 12.6 Object license `{ type, url }` → `could not determine` (no unwrap)
- [x] 12.7 `licenses[]` array → `could not determine` (no unwrap)
- [x] 12.8 `SEE LICENSE IN LICENSE.md` literal — passes only when literally allowed
- [x] 12.9 `UNLICENSED` literal — passes only when literally allowed
- [x] 12.10 No file in any package directory is read during license detection (assert via fs spy or fixture audit)

## 13. Tests — SPDX expression evaluation

- [x] 13.1 `(MIT OR Apache-2.0)` passes if `MIT` is in `allowed-hard.txt`
- [x] 13.2 `(MIT OR Apache-2.0)` passes if `Apache-2.0` is in `allowed-hard.txt`
- [x] 13.3 `(MIT AND BSD-3-Clause)` passes only when both leaves are in `allowed-hard.txt`
- [x] 13.4 `(MIT AND BSD-3-Clause)` with only `MIT` allowed → violation `license-not-in-allowlist` with `detailCode: spdx-expression-not-satisfied` and `offendingLeaves: ["BSD-3-Clause"]`
- [x] 13.5 `MIT OR` malformed → violation `license-not-in-allowlist` with `detailCode: literal-not-allowed-and-spdx-unparseable`
- [x] 13.6 `Apache 2.0` (space) does not match SPDX parser → violation `license-not-in-allowlist` with `detailCode: literal-not-allowed-and-spdx-unparseable` (unless literally listed)
- [x] 13.7 `SEE LICENSE IN LICENSE.md` not literally allowed → violation `license-not-in-allowlist` with `detailCode: literal-not-allowed-and-spdx-unparseable`
- [x] 13.8 `UNLICENSED` not literally allowed → violation `license-not-in-allowlist` with `detailCode: literal-not-allowed-and-spdx-unparseable`
- [x] 13.9 Parsed WITH-exception leaf — full composite literal `GPL-2.0-only WITH Classpath-exception-2.0` allowed in `allowed-hard.txt` → `allowed-by-license`
- [x] 13.10 Parsed WITH-exception leaf — only the bare `GPL-2.0-only` allowed (no exception) → violation `license-not-in-allowlist` with `detailCode: spdx-expression-not-satisfied` and `offendingLeaves: ["GPL-2.0-only WITH Classpath-exception-2.0"]`
- [x] 13.11 WITH-exception leaf inside an OR — `(MIT OR (GPL-2.0-only WITH Classpath-exception-2.0))` with `allowed-hard.txt` listing only `MIT` → `allowed-by-license`
- [x] 13.12 Malformed WITH-like string — `GPL-2.0-only WITH` (incomplete) → violation `license-not-in-allowlist` with `detailCode: literal-not-allowed-and-spdx-unparseable`
- [x] 13.13 SPDX evaluation never normalises licence ids or exception ids (assert via fixtures using non-canonical casing/spacing where possible)

## 14. Tests — allowlist files

- [x] 14.1 Missing `allowed-hard.txt` during `check` → exit 2 with message naming the file
- [x] 14.2 `collect` runs successfully without `allowed-hard.txt`
- [x] 14.3 Empty `allowed-hard.txt` parses to empty allowlist
- [x] 14.4 Comments and blank lines skipped
- [x] 14.5 Duplicate entries in `allowed-hard.txt` are deduped
- [x] 14.6 Missing `allowed-packages.txt` is OK; no overrides applied
- [x] 14.7 `collect` does NOT open `allowed-hard.txt` or `allowed-packages.txt` (assert via fs spy)
- [x] 14.8 Valid `@scope/*` rule accepted
- [x] 14.9 Valid `package-name@version` rule accepted
- [x] 14.10 Valid `@scope/package@version` rule accepted
- [x] 14.11 Bare `package-name` rule rejected; exit 2 with file/line/text
- [x] 14.12 `@scope/package` (no version) rejected
- [x] 14.13 `lodash@*` rejected
- [x] 14.14 `@scope/package@*` rejected
- [x] 14.15 `lodash@^4`, `~4`, `>=4`, `4.x` semver-range rules all rejected
- [x] 14.16 `lodash*`, `*`, glob/regex/star rules rejected
- [x] 14.17 No CLI flag relocates allowlist (verify `--allowed`, `--allowed-packages` are unknown flags)

## 15. Tests — policy and reporting

- [x] 15.1 All violations across many packages are collected before exit 1
- [x] 15.2 Exact literal license match → `allowed-by-license`
- [x] 15.3 Explicit license string not in allowlist and not satisfied by SPDX parse → `license-not-in-allowlist`
- [x] 15.4 No usable license and no package override → `package-not-in-allowlist`
- [x] 15.5 Override match → reported with `matchedPackageRule`
- [x] 15.6 Overrides are not silent — every override-allowed package is in the report
- [x] 15.7 `allowed-by-license` beats override when both apply (no `matchedPackageRule` reported)
- [x] 15.8 More-specific `@scope/foo@1.2.3` wins over `@scope/*` in `matchedPackageRule`
- [x] 15.9 `check --json <path>` writes file before exit 1
- [x] 15.10 `check --out <path>` rejected with exit 2 and `invalid-usage`
- [x] 15.11 `collect --out <path>` writes the file and stdout has only a one-line summary
- [x] 15.12 Unwritable `--json` path exits 2
- [x] 15.13 Root project package is skipped in `check` and explicitly noted as `(skipped: project root)`
- [x] 15.14 Workspaces themselves are evaluated and can produce violations
- [x] 15.15 Top-level violation reasons are exactly two (`license-not-in-allowlist`, `package-not-in-allowlist`); detail codes appear only under `license-not-in-allowlist`

## 16. CLI / packaging tests

- [x] 16.1 Building the project produces `dist/cli.js` with `#!/usr/bin/env node` as the first line
- [x] 16.2 `dist/cli.js` has the executable bit set after build
- [x] 16.3 Smoke test: spawn the built `license-gate` binary in a child process against a clean fixture and assert exit code, stdout, and absence of side effects on the project
- [x] 16.4 Smoke test: `npm pack` the package, install the tarball into a fresh fixture project, run `npx license-gate check`, and assert exit code and output
- [x] 16.5 Document `npx @mirasen/license-gate check` and `npx @mirasen/license-gate collect` invocations in README
- [x] 16.6 Document local-install + `npx license-gate check` invocation in README

## 17. Documentation

- [x] 17.1 Update `README.md` with: purpose, philosophy, installation, two commands, exit codes, allowlist file format, override grammar, explicit non-goals
- [x] 17.2 Add a "Strict by design" section enumerating what `license-gate` will NOT do (license text reading, normalisation, denylists, configurable allowlist paths, project-root walk-up, `--root`/`--project` aliases, etc.)
- [x] 17.3 Add an "FAQ" section explaining `Apache 2.0` vs `Apache-2.0`, why `UNLICENSED` is a literal, how SPDX expressions are evaluated literally per leaf, how to handle internal scopes, and why the tool refuses to walk up
- [x] 17.4 Document Node ≥22.9.0 requirement and recommend running `license-gate` after `npm ci`
- [x] 17.5 Document the two top-level violation reasons and the two diagnostic detail codes

## 18. Release prep

- [x] 18.1 Add a changeset describing the v1 release (likely `0.1.0`)
- [x] 18.2 Verify `npm run build` produces a working `dist/cli.js` with correct shebang and executable bit
- [x] 18.3 Verify `npm run lint` and `npm run test` pass cleanly
- [x] 18.4 Verify `publint` (already wired via `prepack`) reports no issues
- [x] 18.5 Smoke-test the published artefact via `npm pack` and a local install in a fresh fixture

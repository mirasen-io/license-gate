## 1. Types and decision union

- [ ] 1.1 Extend the `Decision` discriminated union in `src/types.ts` with the new variant `allowed-by-package-name-rule` carrying a `matchedPackageRule: string` (the verbatim rule text). Keep all existing variants byte-for-byte unchanged.
- [ ] 1.2 Update any internal exhaustive `switch (decision.outcome)` sites flagged by the TypeScript compiler so the new variant is handled (no runtime behaviour change for existing variants).

## 2. Allowed-packages parser

- [ ] 2.1 In `src/policy/parse-allowed-packages.ts`, extend the rule grammar to accept `package-name@*` and `@scope/package@*`. Keep all existing valid forms (`@scope/*`, `package-name@version`, `@scope/package@version`) accepted unchanged.
- [ ] 2.2 Tag each parsed rule with its kind so evaluation can branch deterministically (suggested: `scope-wildcard`, `package-version`, `package-name-wildcard`). Carry the original rule text verbatim alongside the parsed shape so it can be surfaced in `matchedPackageRule`.
- [ ] 2.3 Reject every other shape with the existing exit-2 path: bare names (`pkg`, `@scope/pkg`), prefix wildcards (`pkg*`, `@scope/weird-*`), wildcard-everywhere (`*@*`), wildcard-scope-with-wildcard-version (`@scope/*@*`), semver ranges (`pkg@^1.0.0`, `pkg@~1.0.0`, `pkg@>=4`, `pkg@1.x`), and regex-shaped strings.

## 3. Policy evaluation

- [ ] 3.1 In `src/policy/evaluate.ts`, implement deterministic precedence for package overrides: (a) exact `package@version` first, (b) then `package@*` / `@scope/package@*`, (c) then `@scope/*`. License-allow continues to short-circuit before any package override is consulted.
- [ ] 3.2 When (b) matches, set the decision's outcome to `allowed-by-package-name-rule` and `matchedPackageRule` to the verbatim wildcard rule text (e.g. `some-package@*`, `@scope/weird-package@*`).
- [ ] 3.3 Confirm that `package-name@*` rules match only the exact `name` byte-for-byte: do not match prefixes (`some-package` does not match `some-package-extra`), do not match across scope boundaries (`weird-package@*` does not match `@scope/weird-package`; `@scope/weird-package@*` does not match `@scope/weird-package-extra`).
- [ ] 3.4 Verify the existing "license-allow beats every override" behaviour is preserved: when a package's license satisfies `allowed-hard.txt` (literal or via SPDX boolean shape), the decision is `allowed-by-license` even if package overrides also match, and `matchedPackageRule` is omitted.

## 4. Reporting

- [ ] 4.1 Update `src/report/*` (human and JSON paths) to surface the new outcome `allowed-by-package-name-rule` and to emit `matchedPackageRule` verbatim on it.
- [ ] 4.2 Confirm that the human report distinguishes the new outcome visibly (suggested phrasing: "allowed by package wildcard rule", concrete wording is an implementation detail) and that wildcard overrides are never silent.
- [ ] 4.3 Verify the JSON report shape is byte-compatible with prior versions for existing variants and only adds the new outcome's records.

## 5. Tests

- [ ] 5.1 Add parser tests covering each newly accepted form (`lodash@*`, `@scope/weird-package@*`).
- [ ] 5.2 Add parser tests covering each newly rejected shape with exit code 2 and a message identifying the file, line number, and rule text: `lodash`, `@scope/weird-package`, `lodash*`, `@scope/weird-*`, `@scope/*@*`, `*@*`, `lodash@^4.17.0`, `lodash@~4.17.0`, `lodash@>=4`, `lodash@1.x`, `/lodash.*/`.
- [ ] 5.3 Add evaluation tests for matching: package wildcard allows any installed version of the exact unscoped package; scoped package wildcard allows any installed version of the exact scoped package.
- [ ] 5.4 Add evaluation tests for non-matching: similarly named unscoped package, other packages in the same scope, scope-vs-unscoped name boundary.
- [ ] 5.5 Add precedence tests: exact `package@version` wins over `package@*`; `package@*` wins over `@scope/*`; license-allow still beats every override.
- [ ] 5.6 Add reporting tests asserting `matchedPackageRule` is the verbatim rule text (`some-package@*`, `@scope/weird-package@*`) for the new outcome on both human and JSON output paths.

## 6. Documentation

- [ ] 6.1 Update `README.md` to list the five accepted forms in the override section: `@scope/*`, `package-name@version`, `@scope/package@version`, `package-name@*`, `@scope/package@*`.
- [ ] 6.2 Add intent guidance in the README: prefer `package-name@version` for highest precision; use `package-name@*` only for manually reviewed packages where Dependabot/version bumps would otherwise require allowlist edits; reserve `@scope/*` for trusted internal namespaces such as `@mirasen/*`. Do NOT present `package-name@*` as the default first choice.
- [ ] 6.3 Keep the standing warning that all `allowed-packages.txt` overrides are escape hatches and remain audit-visible in reports.

## 7. Verification

- [ ] 7.1 Run `npm run check` and confirm it exits 0.
- [ ] 7.2 Run `npm run lint` and confirm it exits 0.
- [ ] 7.3 Run `npm run build` and confirm it exits 0 and produces the bin with a valid `#!/usr/bin/env node` shebang.
- [ ] 7.4 Run `npm test` and confirm every test (existing and newly added) passes.
- [ ] 7.5 Run `npm pack --dry-run --json` and confirm the published file list and the shape of `dist/index.d.ts` are unchanged except for the additive `Decision` variant `allowed-by-package-name-rule`.

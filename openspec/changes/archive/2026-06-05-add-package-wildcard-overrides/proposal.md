## Why

The MVP of `@mirasen/license-gate` accepts only three override forms in
`licenses/allowed-packages.txt`: `@scope/*`, `package-name@version`, and
`@scope/package@version`. This was deliberate: each override is auditable and
narrowly scoped. In practice, however, manually approved packages whose license
is unparseable or unlisted (for example a package that ships
`license: "SEE LICENSE IN LICENSE.md"`) require an explicit
`package-name@version` rule that has to be re-pinned on every Dependabot patch
or minor bump. That friction encourages the wrong escape — pushing reviewers
toward the very broad `@scope/*` namespace rule even for unrelated third-party
packages — and produces noisy churn on the allowlist file.

Adding a single, narrowly-defined wildcard form, `package-name@*` (and its
scoped twin `@scope/package@*`), removes that friction without weakening
auditability: it stays a literal, explicit, line-level allowlist entry that
names exactly one package by name and intentionally ignores its version.

## What Changes

- **Override grammar**: extend `licenses/allowed-packages.txt` to accept exactly
  two new forms: `package-name@*` and `@scope/package@*`. All other forms
  (bare names, prefix wildcards like `pkg*`, semver ranges, regex, `@scope/*@*`,
  `*@*`) continue to fail config validation with exit code 2.
- **Decision outcome**: introduce a new decision outcome
  `allowed-by-package-name-rule` for matches against `package@*` /
  `@scope/package@*`. Existing outcomes (`allowed-by-license`,
  `allowed-by-scope-rule`, `allowed-by-package-version-rule`, `violation`) keep
  their current meanings unchanged. Package wildcard overrides are NOT
  collapsed into scope overrides.
- **Precedence (deterministic)**: when several rules match the same installed
  package, the gate SHALL apply, in order: (1) `allowed-by-license`,
  (2) exact `package@version` / `@scope/package@version`,
  (3) `package@*` / `@scope/package@*`, (4) `@scope/*`.
- **Reporting**: human and JSON reports show the matched wildcard rule
  verbatim via `matchedPackageRule` (e.g. `"some-package@*"`). Wildcard
  overrides are never silent.
- **Validation**: invalid rules (including `pkg`, `pkg*`, `pkg@^1.0.0`,
  `pkg@1.x`, `@scope/pkg`, `@scope/*@*`, `*@*`) continue to exit with code 2
  and identify the offending file, line number, and rule text.
- **Internal data model**: `Decision` gains the new outcome variant; the
  violation reasons set is unchanged.
- **README**: document the new forms with intent guidance — prefer
  `package@version` for highest precision; use `package@*` only for manually
  reviewed packages where Dependabot bumps would otherwise force allowlist
  edits; keep `@scope/*` reserved for trusted internal namespaces.
- **Tests**: add scenarios for matching, non-matching, precedence, and config
  validation.

This change is **non-breaking**. Existing rules and existing reports continue
to work unchanged; the new forms are purely additive.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `license-gate`: extend `allowed-packages.txt` grammar to accept
  `package-name@*` and `@scope/package@*`; add the
  `allowed-by-package-name-rule` decision outcome; define deterministic
  precedence between license-allow, exact package-version, package-name
  wildcard, and scope wildcard rules; surface the matched rule verbatim in
  reports.

## Impact

- **Affected code** (no implementation in this change, design-only):
  - `src/policy/parse-allowed-packages.ts` — accept the two new forms, keep
    rejecting everything else.
  - `src/policy/evaluate.ts` — add the wildcard match branch and apply the
    new precedence ordering deterministically.
  - `src/types.ts` — extend `Decision` with `allowed-by-package-name-rule`.
  - `src/report/*` — surface the new outcome and `matchedPackageRule` in
    human and JSON output paths.
  - `tests/` — new fixtures and unit/integration tests for the eight
    scenarios listed in the spec delta.
  - `README.md` — document the new accepted forms and intended use.
- **APIs / output**: the JSON report's `Decision` union grows by one variant.
  Consumers that exhaustively switch on `Decision.outcome` will see a new
  case; no existing variant is removed or renamed.
- **Dependencies**: none. No new runtime or dev dependency is introduced.
- **CLI surface**: unchanged. No new flags, no new subcommands, no new
  configuration files.
- **Out of scope** (explicitly not introduced by this change): bare
  package-name overrides, semver ranges, regex, generic globbing, prefix
  matching, wildcard package names, wildcard scopes beyond the existing
  `@scope/*` form, configurable allowlist paths, new CLI flags,
  include/exclude flags, SARIF, GitHub Action, init command, pnpm/yarn
  support, markdown/tree reports, a config system, license-file scanning,
  README/LICENSE/COPYING scanning, SPDX correction or normalisation,
  unwrapping of deprecated license object/array shapes, clarifications, and
  checksum evidence.

## Context

The MVP `license-gate` capability accepts three override forms in
`licenses/allowed-packages.txt`: `@scope/*`, `package-name@version`, and
`@scope/package@version`. This was intentionally strict so every override is
an audit-visible, narrowly scoped escape hatch.

In real-world use, two pain points emerged:

1. Packages whose `package.json` declares a non-SPDX-parseable license
   (`SEE LICENSE IN LICENSE.md`, `UNLICENSED`, missing entirely) but that have
   been manually reviewed must be allow-listed by exact `package@version`. Any
   Dependabot patch or minor bump invalidates that pin and forces a noisy
   allowlist edit.
2. Reviewers who don't want to babysit version pins reach for `@scope/*`
   instead — a much broader override than the situation warrants. That blunts
   the signal of `@scope/*` being reserved for trusted internal namespaces
   (e.g. `@mirasen/*`) and turns the allowlist into a less reliable audit
   record.

The narrow fix is a new override form — `package-name@*` and
`@scope/package@*` — that names exactly one package and explicitly accepts
"any installed version of this exact name". It is still a literal,
per-line, audit-visible entry; it is not a regex, not a semver range, not a
generic glob, and not a prefix match.

## Goals / Non-Goals

**Goals:**

- Accept `package-name@*` and `@scope/package@*` as valid rules in
  `licenses/allowed-packages.txt`.
- Match installed packages whose `name` is exactly the rule's package name,
  for any installed version.
- Surface the matched rule verbatim in human and JSON reports via
  `matchedPackageRule`.
- Define deterministic precedence between license-allow, exact
  package-version, package-name wildcard, and scope wildcard rules so
  audit output is unambiguous.
- Keep all other behaviour, exit codes, output shapes, and CLI surface
  unchanged.

**Non-Goals:**

- Bare package-name overrides (`lodash`, `@scope/pkg`).
- Semver ranges (`^4`, `~4.17`, `>=4`, `1.x`).
- Regex (`/lodash.*/`).
- Generic globbing or prefix matching (`lodash*`, `@scope/weird-*`).
- Wildcard package names or wildcard scopes beyond the existing
  `@scope/*` form (`@scope/*@*`, `*@*`).
- Configurable allowlist paths, new CLI flags, or new subcommands.
- Anything else listed in the proposal's "out of scope" set (SARIF, GitHub
  Action, init command, pnpm/yarn support, markdown/tree reports, config
  system, license-file scanning, README/LICENSE/COPYING scanning, SPDX
  correction/normalisation, deprecated license object/array unwrapping,
  clarifications, checksum evidence).

## Decisions

### Decision 1: New decision outcome `allowed-by-package-name-rule`

Add a new `Decision` variant `allowed-by-package-name-rule` for matches
against `package@*` / `@scope/package@*`. Existing variants
(`allowed-by-license`, `allowed-by-scope-rule`,
`allowed-by-package-version-rule`, `violation`) are unchanged.

**Why this over the alternatives:**

- _Alternative A (chosen)_: introduce
  `allowed-by-package-name-rule` and keep `allowed-by-package-version-rule`
  reserved for exact `name@version` matches. This makes the audit log
  self-explanatory: a reader can tell at a glance whether an entry was
  pinned to a specific version or accepted across versions.
- _Alternative B_: keep `allowed-by-package-version-rule` and add
  `allowed-by-package-rule` as a more generic outcome. Rejected: it would
  force `allowed-by-package-version-rule` to be re-read as
  "exact-version-only" while leaving the older, broader-sounding name in
  place — confusing for downstream consumers and slightly historically
  revisionist.
- _Alternative C_: collapse package wildcard overrides into
  `allowed-by-scope-rule`. Rejected explicitly per the proposal:
  package-name wildcards are a different kind of override (one named
  package, any version) from scope wildcards (any package in a namespace,
  any version) and conflating them destroys audit clarity.

The downstream cost is one new case in any consumer that switches over
`Decision.outcome`. That cost is acceptable and intended — exhaustive
switches that compile-warn on the new variant are a feature.

### Decision 2: Deterministic precedence ordering

When multiple rules can match the same installed package, evaluation
applies them in this order, with the first applicable rule producing the
final decision:

1. `allowed-by-license` (license literal in `allowed-hard.txt`, including
   SPDX OR/AND/parens/WITH composite literals).
2. Exact `package@version` / `@scope/package@version`.
3. `package@*` / `@scope/package@*` (this change's new form).
4. `@scope/*`.

**Why:**

- License-allow always wins so a package with a clean license is reported
  as `allowed-by-license` even if a redundant override happens to match.
  This preserves the existing requirement "license-allow beats override".
- Exact `name@version` is more specific than `name@*`, so it wins.
- `name@*` is more specific than `@scope/*`, so a scoped package with
  both `@scope/foo@*` and `@scope/*` reports the package-name rule (the
  narrower one).
- This is the same "more-specific rule wins" intuition as the existing
  scope-vs-version rule; the new ordering is its natural extension.

**Implementation shape (informative, not prescriptive):** when collecting
package rules at parse time, keep three buckets — exact `name@version`,
package-name wildcard `name@*`, and scope wildcard `@scope/*` — and probe
them in that order during evaluation. License-allow is checked first as
already specified. The matching wildcard rule's verbatim text (e.g.
`some-package@*`) is what `matchedPackageRule` records.

### Decision 3: Match by exact `name`

`package@*` matches an installed package iff its `name` equals the rule's
package name byte-for-byte. Specifically:

- `lodash@*` matches `lodash@*.*.*` for any installed version, but does
  NOT match `lodash-es`, `lodash.merge`, or `@scope/lodash`.
- `@scope/weird-package@*` matches only `@scope/weird-package` for any
  installed version, NOT `@scope/weird-package-extra` and NOT
  `@scope/other-package`.
- `@scope/*` keeps its existing meaning: any installed package whose name
  starts with `@scope/`.

There is no prefix matching, no regex, no glob. The only metacharacter is
the literal `@*` suffix, and only at the position immediately after the
full package name.

### Decision 4: Grammar tightened, not loosened

The rule grammar adds two new productions and otherwise keeps every
existing rejection rule. In particular:

- `pkg` (bare name) — still invalid.
- `pkg*` (prefix wildcard on name) — still invalid.
- `pkg@^1.0.0`, `pkg@~1.0.0`, `pkg@>=4`, `pkg@1.x` (semver ranges) —
  still invalid.
- `@scope/pkg` (bare scoped name without `@*`) — still invalid.
- `@scope/*@*` (wildcard scope plus wildcard version) — invalid; the
  trusted-namespace form remains exactly `@scope/*` with no trailing
  `@*`.
- `*@*` (wildcard everything) — invalid.
- regex-shaped strings (e.g. `/lodash.*/`) — invalid.

A reasonable parser shape is a single regex (or its hand-written
equivalent) with three alternatives matched in order:

1. `^@[^/@*\s]+/\*$` — `@scope/*`
2. `^(@[^/@*\s]+/)?[^/@*\s][^/@*\s]*@\*$` — `name@*` /
   `@scope/name@*`
3. `^(@[^/@*\s]+/)?[^/@*\s][^/@*\s]*@[^*@\s]+$` — exact
   `name@version` / `@scope/name@version`

Anything else fails parsing with the existing exit-2 path. The exact
regex shape is implementation-level; the spec only constrains the set of
accepted strings.

### Decision 5: Reporting always shows wildcard overrides

For both human and JSON output, an `allowed-by-package-name-rule`
decision SHALL set `matchedPackageRule` to the rule string verbatim
(`some-package@*` or `@scope/weird-package@*`). The decision is never
silent and never collapsed into another outcome. This mirrors how
`allowed-by-package-version-rule` and `allowed-by-scope-rule` already
report their matched rule.

### Decision 6: Backwards-compatibility

The change is additive at the grammar level and additive at the type
level. All existing fixtures and reports continue to validate; existing
overrides do not change outcomes. The only consumer-visible difference
is the new `Decision` variant.

## Risks / Trade-offs

- **Risk**: a reviewer sees `package@*` in the allowlist and forgets it
  also accepts a future major-version bump that may relicense.
  → _Mitigation_: README guidance keeps `package@version` as the
  recommended highest-precision form and frames `package@*` as the
  middle ground for already-reviewed packages whose maintainers don't
  change license terms across versions. Reports surface
  `matchedPackageRule` verbatim, so audits can flag wildcard overrides
  for re-review on cadence without needing a separate field.

- **Risk**: a downstream consumer that pattern-matches on
  `Decision.outcome` and does not handle the new variant will silently
  fall through.
  → _Mitigation_: the new outcome is documented in the spec and called
  out in the proposal's Impact section. TypeScript consumers using
  exhaustive switches will get a compile error; this is intentional.

- **Risk**: confusion between `@scope/*` (scope-wide) and
  `@scope/pkg@*` (one scoped package across versions).
  → _Mitigation_: the spec defines both forms separately, the precedence
  rule explicitly says the package-name wildcard wins over the scope
  wildcard for the same package, and `matchedPackageRule` makes the
  active rule visible in the report.

- **Risk**: someone tries to write `@scope/*@*` thinking it's a "match
  any version of any package in this scope" form.
  → _Mitigation_: the grammar rejects it and the validator emits an
  exit-2 error naming the offending line. This is covered by a test
  scenario.

- **Trade-off**: a single alternative outcome name was chosen over a more
  generic one (see Decision 1). Adding it now is cheaper than renaming
  later; renaming the existing outcome would be a breaking change for
  any user persisting JSON reports.

## Migration Plan

This is a forward-only, additive change.

- No data migration. No file renames. No flag removals.
- Existing `licenses/allowed-packages.txt` files keep working byte-for-byte.
- After deploy, users who want the new behaviour add `package@*` /
  `@scope/package@*` lines themselves. Users who don't change their
  files see no behavioural difference.
- Rollback: revert. Any allowlist file authored to use the new forms
  will fail validation under the previous version with the existing
  exit-2 path, which is the correct, loud behaviour.

## Open Questions

None blocking. The proposal explicitly chose Option A
(`allowed-by-package-name-rule`) and the precedence ordering. Any
remaining wording polish (e.g. exact human-report phrasing for
"allowed by package wildcard/name rule") is an implementation detail
and does not block the spec/design phase.

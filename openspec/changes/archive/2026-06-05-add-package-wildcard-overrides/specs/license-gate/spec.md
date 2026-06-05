## MODIFIED Requirements

### Requirement: allowed-packages.txt grammar

The system SHALL parse `licenses/allowed-packages.txt` as one rule per line. Blank lines
SHALL be ignored. Lines whose first non-whitespace character is `#` SHALL be ignored as
comments. Leading and trailing whitespace SHALL be trimmed. Each non-empty rule SHALL be
one of exactly five accepted forms:

1. `@scope/*` — scope wildcard (existing).
2. `package-name@version` — exact unscoped package version (existing).
3. `@scope/package@version` — exact scoped package version (existing).
4. `package-name@*` — package-name wildcard, unscoped (new).
5. `@scope/package@*` — package-name wildcard, scoped (new).

In every form, `package-name` and `scope` SHALL contain neither `@`, `/`, `*`, nor
whitespace, and `version` SHALL contain neither `*`, `@`, nor whitespace. Any other
syntax — including but not limited to bare names (`pkg`, `@scope/pkg`), prefix
wildcards (`pkg*`, `@scope/weird-*`), wildcard-everywhere (`*@*`),
wildcard-scope-with-wildcard-version (`@scope/*@*`), semver ranges (`pkg@^1.0.0`,
`pkg@~1.0.0`, `pkg@>=4`, `pkg@1.x`), and regex-shaped strings (`/lodash.*/`) — SHALL
cause the system to exit with code 2 and an error identifying the offending file, line
number, and rule text. The `collect` command SHALL NOT read this file.

#### Scenario: valid scope rule

- **WHEN** `allowed-packages.txt` contains `@mirasen/*`
- **THEN** the rule is accepted and applies to any installed package whose name begins with `@mirasen/`

#### Scenario: valid package@version

- **WHEN** `allowed-packages.txt` contains `lodash@4.17.21`
- **THEN** the rule is accepted and applies only to the installed package `lodash@4.17.21`

#### Scenario: valid @scope/package@version

- **WHEN** `allowed-packages.txt` contains `@types/node@22.0.0`
- **THEN** the rule is accepted and applies only to the installed package `@types/node@22.0.0`

#### Scenario: valid package-name wildcard (unscoped)

- **WHEN** `allowed-packages.txt` contains `lodash@*`
- **THEN** the rule is accepted and applies to any installed version of the package whose name is exactly `lodash`

#### Scenario: valid package-name wildcard (scoped)

- **WHEN** `allowed-packages.txt` contains `@scope/weird-package@*`
- **THEN** the rule is accepted and applies to any installed version of the package whose name is exactly `@scope/weird-package`

#### Scenario: invalid bare package name

- **WHEN** `allowed-packages.txt` contains `lodash`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid scoped without version or wildcard

- **WHEN** `allowed-packages.txt` contains `@types/node`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid scope-and-version both wildcard

- **WHEN** `allowed-packages.txt` contains `@scope/*@*`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid wildcard everything

- **WHEN** `allowed-packages.txt` contains `*@*`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid prefix wildcard on package name

- **WHEN** `allowed-packages.txt` contains `lodash*` or `@scope/weird-*`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid semver range

- **WHEN** `allowed-packages.txt` contains `lodash@^4.17.0` or `lodash@~4.17.0` or `lodash@>=4` or `lodash@1.x`
- **THEN** the CLI exits with code 2 and identifies the invalid rule

#### Scenario: invalid generic glob or regex or star

- **WHEN** `allowed-packages.txt` contains `*`, `/lodash.*/`, or any other prefix-wildcard
- **THEN** the CLI exits with code 2 and identifies the invalid rule

### Requirement: Literal-first license evaluation with SPDX expression support

The system SHALL evaluate each package's license in the following order: (1) if the
recorded license is the sentinel `"could not determine"`, then if the package matches an
`allowed-packages.txt` rule the decision SHALL be `allowed-by-scope-rule`,
`allowed-by-package-version-rule`, or `allowed-by-package-name-rule` per the package
override precedence requirement, otherwise the decision SHALL be a violation with reason
`package-not-in-allowlist`. (2) If the literal license string equals any line in
`allowed-hard.txt`, the decision SHALL be `allowed-by-license`. (3) Otherwise the system
SHALL attempt SPDX expression parsing using `spdx-expression-parse` for boolean shape
(OR, AND, parentheses). If parsing fails and no override matches, the violation SHALL
have reason `license-not-in-allowlist` with `detailCode:
"literal-not-allowed-and-spdx-unparseable"`. If parsing succeeds, the system SHALL walk
the AST treating each leaf license literally against `allowed-hard.txt`: an OR node is
satisfied if either side is satisfied; an AND node is satisfied if both sides are
satisfied. A leaf produced by an SPDX WITH-exception (an AST leaf carrying both a
license id and an exception id) SHALL be reduced to one literal string of the form
`"<license-id> WITH <exception-id>"` (joined with single ASCII spaces, no
normalisation), and that single composite string SHALL be the literal compared against
`allowed-hard.txt`; the bare license id SHALL NOT be considered separately, the licence
id SHALL NOT be normalised, and the exception id SHALL NOT be normalised. If satisfied,
the decision SHALL be `allowed-by-license`; otherwise, if no override matches, the
violation SHALL have reason `license-not-in-allowlist` with `detailCode:
"spdx-expression-not-satisfied"` and `offendingLeaves` listing the leaves (including any
WITH-exception leaves rendered as composite literals) that failed. If a violation in
steps (3a) or (3b) is matched by an `allowed-packages.txt` rule, the decision SHALL be
`allowed-by-scope-rule`, `allowed-by-package-version-rule`, or
`allowed-by-package-name-rule` (per the package override precedence requirement) instead
of the violation. The system SHALL NOT use the SPDX parser as a normalisation engine and
SHALL NOT use `spdx-correct` or `spdx-satisfies`.

#### Scenario: literal MIT in allowlist passes

- **WHEN** a package has `license: "MIT"` and `allowed-hard.txt` contains `MIT`
- **THEN** the decision is `allowed-by-license`

#### Scenario: literal SEE LICENSE IN passes when listed

- **WHEN** a package has `license: "SEE LICENSE IN LICENSE.md"` and `allowed-hard.txt` contains `SEE LICENSE IN LICENSE.md`
- **THEN** the decision is `allowed-by-license`

#### Scenario: literal UNLICENSED passes when listed

- **WHEN** a package has `license: "UNLICENSED"` and `allowed-hard.txt` contains `UNLICENSED`
- **THEN** the decision is `allowed-by-license`

#### Scenario: SPDX OR with one allowed leaf passes

- **WHEN** a package has `license: "(MIT OR Apache-2.0)"` and `allowed-hard.txt` contains `MIT` only
- **THEN** the decision is `allowed-by-license`

#### Scenario: SPDX AND requires all leaves

- **WHEN** a package has `license: "(MIT AND BSD-3-Clause)"` and `allowed-hard.txt` contains `MIT` only
- **THEN** the decision is a violation with reason `license-not-in-allowlist`, `detailCode: "spdx-expression-not-satisfied"`, and `offendingLeaves: ["BSD-3-Clause"]`

#### Scenario: parenthesised expression

- **WHEN** a package has `license: "(MIT OR Apache-2.0)"` and `allowed-hard.txt` contains `Apache-2.0`
- **THEN** the decision is `allowed-by-license`

#### Scenario: malformed expression unparseable

- **WHEN** a package has `license: "MIT OR"` (incomplete) and the literal does not match `allowed-hard.txt`
- **THEN** the decision is a violation with reason `license-not-in-allowlist` and `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: SEE LICENSE IN unparseable when not literally allowed

- **WHEN** a package has `license: "SEE LICENSE IN LICENSE.md"` and the literal is not in `allowed-hard.txt` and SPDX parsing fails
- **THEN** the decision is a violation with reason `license-not-in-allowlist` and `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: UNLICENSED unparseable when not literally allowed

- **WHEN** a package has `license: "UNLICENSED"` and the literal is not in `allowed-hard.txt` and SPDX parsing fails
- **THEN** the decision is a violation with reason `license-not-in-allowlist` and `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: literal-first prevents normalisation

- **WHEN** a package has `license: "Apache 2.0"` and `allowed-hard.txt` contains `Apache-2.0` only
- **THEN** the decision is a `license-not-in-allowlist` violation (literal does not match; SPDX parse fails on the spaced form)

#### Scenario: parsed WITH-exception leaf passes only when full composite literal is allowed

- **WHEN** a package has `license: "GPL-2.0-only WITH Classpath-exception-2.0"`, `spdx-expression-parse` parses it as a WITH-exception leaf, and `allowed-hard.txt` contains exactly the line `GPL-2.0-only WITH Classpath-exception-2.0`
- **THEN** the decision is `allowed-by-license`

#### Scenario: parsed WITH-exception leaf fails when only the bare licence id is allowed

- **WHEN** a package has `license: "GPL-2.0-only WITH Classpath-exception-2.0"`, `spdx-expression-parse` parses it as a WITH-exception leaf, and `allowed-hard.txt` contains only `GPL-2.0-only` (without the exception)
- **THEN** the decision is a `license-not-in-allowlist` violation with `detailCode: "spdx-expression-not-satisfied"` and `offendingLeaves: ["GPL-2.0-only WITH Classpath-exception-2.0"]`

#### Scenario: WITH-exception leaf inside an OR

- **WHEN** a package has `license: "(MIT OR (GPL-2.0-only WITH Classpath-exception-2.0))"`, parsing succeeds, and `allowed-hard.txt` contains only `MIT`
- **THEN** the decision is `allowed-by-license` (the OR is satisfied by the `MIT` branch)

#### Scenario: malformed WITH-like string is unparseable

- **WHEN** a package has `license: "GPL-2.0-only WITH"` (incomplete) and the literal does not match `allowed-hard.txt` and `spdx-expression-parse` fails
- **THEN** the decision is a `license-not-in-allowlist` violation with `detailCode: "literal-not-allowed-and-spdx-unparseable"`

### Requirement: Visible package overrides

The system SHALL make every `allowed-packages.txt` override visible in reports. When a
decision is `allowed-by-scope-rule`, `allowed-by-package-version-rule`, or
`allowed-by-package-name-rule`, the report SHALL include the matched rule string
verbatim in a `matchedPackageRule` field. Overrides SHALL NOT silently exclude packages
from reports. When several `allowed-packages.txt` rules match the same installed
package, the system SHALL apply them in this strict precedence order, with the first
applicable rule producing the final decision: (a) exact `package@version` /
`@scope/package@version` rule yields `allowed-by-package-version-rule`; (b) otherwise
`package@*` / `@scope/package@*` rule yields `allowed-by-package-name-rule`; (c)
otherwise `@scope/*` rule yields `allowed-by-scope-rule`. When both an
`allowed-hard.txt` license match and any `allowed-packages.txt` override apply, the
decision SHALL be `allowed-by-license` and `matchedPackageRule` SHALL NOT be reported.
Package-name wildcard overrides SHALL NOT be collapsed into scope overrides.

#### Scenario: package-version override is reported

- **WHEN** a package matches `lodash@4.17.21` in `allowed-packages.txt` and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-version-rule` with `matchedPackageRule: "lodash@4.17.21"`

#### Scenario: scope override is reported

- **WHEN** a package `@mirasen/foo@1.0.0` matches `@mirasen/*` in `allowed-packages.txt` and its license is `could not determine`
- **THEN** the decision is `allowed-by-scope-rule` with `matchedPackageRule: "@mirasen/*"`

#### Scenario: package-name wildcard override is reported (unscoped)

- **WHEN** an installed package `some-package@1.2.3` matches `some-package@*` in `allowed-packages.txt` and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-name-rule` with `matchedPackageRule: "some-package@*"`

#### Scenario: package-name wildcard override is reported (scoped)

- **WHEN** an installed package `@scope/weird-package@4.5.6` matches `@scope/weird-package@*` in `allowed-packages.txt` and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-name-rule` with `matchedPackageRule: "@scope/weird-package@*"`

#### Scenario: package-name wildcard does not match similarly named package

- **WHEN** an installed package `some-package-extra@1.2.3` is evaluated and `allowed-packages.txt` contains only `some-package@*`
- **THEN** the rule does not match `some-package-extra`; the package must pass by license or fail

#### Scenario: scoped package-name wildcard does not match other packages in same scope

- **WHEN** an installed package `@scope/other-package@4.5.6` is evaluated and `allowed-packages.txt` contains only `@scope/weird-package@*`
- **THEN** the rule does not match `@scope/other-package`

#### Scenario: exact version rule wins over package-name wildcard

- **WHEN** `allowed-packages.txt` contains both `some-package@1.2.3` and `some-package@*`, and an installed package `some-package@1.2.3` is evaluated and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-version-rule` with `matchedPackageRule: "some-package@1.2.3"`

#### Scenario: package-name wildcard wins over scope wildcard

- **WHEN** `allowed-packages.txt` contains both `@scope/*` and `@scope/weird-package@*`, and an installed package `@scope/weird-package@4.5.6` is evaluated and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-name-rule` with `matchedPackageRule: "@scope/weird-package@*"`

#### Scenario: more specific exact version still wins over package-name wildcard and scope wildcard

- **WHEN** `allowed-packages.txt` contains all three of `@scope/*`, `@scope/weird-package@*`, and `@scope/weird-package@4.5.6`, and an installed package `@scope/weird-package@4.5.6` is evaluated and its license fails the allowlist
- **THEN** the decision is `allowed-by-package-version-rule` with `matchedPackageRule: "@scope/weird-package@4.5.6"`

#### Scenario: license-allow beats every override

- **WHEN** a package's license is in `allowed-hard.txt` and the package also matches `package@*`, `package@version`, or `@scope/*`
- **THEN** the decision is `allowed-by-license` and `matchedPackageRule` is not present

### Requirement: Internal data model

The system SHALL represent each installed package as an `InstalledPackageRecord`
containing at minimum: `name`, `version`, `packageId` (= `${name}@${version}`), `path`
(the realpath of the installed copy), `workspace` (the closest containing workspace
name, or `null`), and `license` (a literal string or the sentinel `"could not
determine"`). Optional fields `repository`, `publisher`, and `email` MAY be included
only when they are directly available from `package.json` without inference. The system
SHALL NOT include a `licenseFile` field in v1. Decisions SHALL be a closed
discriminated union with outcomes `allowed-by-license`, `allowed-by-scope-rule`,
`allowed-by-package-version-rule`, `allowed-by-package-name-rule`, and `violation`.
Violations SHALL carry exactly one top-level reason: either `license-not-in-allowlist`
or `package-not-in-allowlist`. `license-not-in-allowlist` MAY include `detailCode` of
either `literal-not-allowed-and-spdx-unparseable` or
`spdx-expression-not-satisfied`, and MAY include `offendingLeaves: string[]` when
`detailCode === "spdx-expression-not-satisfied"`.

#### Scenario: record contains realpath

- **WHEN** a non-hoisted dependency lives at `apps/web/node_modules/lodash`
- **THEN** the record's `path` field is the absolute realpath of that directory

#### Scenario: workspace field reflects containment

- **WHEN** a transitive dependency is installed under a workspace's local `node_modules`
- **THEN** the record's `workspace` field is the name of the containing workspace

#### Scenario: licenseFile is absent in v1

- **WHEN** any record is emitted in `check` or `collect` output
- **THEN** the record contains no `licenseFile` field

#### Scenario: violation reasons are exactly two

- **WHEN** any violation is emitted by `check`
- **THEN** the top-level `reason` is exactly one of `license-not-in-allowlist` or `package-not-in-allowlist`

#### Scenario: license-not-in-allowlist may carry diagnostic detail

- **WHEN** a violation has reason `license-not-in-allowlist` and arose from SPDX parse failure
- **THEN** the violation includes `detailCode: "literal-not-allowed-and-spdx-unparseable"`

#### Scenario: spdx-expression-not-satisfied includes offendingLeaves

- **WHEN** a violation has `detailCode: "spdx-expression-not-satisfied"`
- **THEN** the violation includes `offendingLeaves` listing the literal leaves that did not match `allowed-hard.txt`

#### Scenario: decision union includes package-name rule outcome

- **WHEN** a consumer enumerates the `Decision` discriminated union
- **THEN** `allowed-by-package-name-rule` is one of its variants alongside `allowed-by-license`, `allowed-by-scope-rule`, `allowed-by-package-version-rule`, and `violation`

## ADDED Requirements

### Requirement: Package-name wildcard override semantics

The system SHALL match an `allowed-packages.txt` rule of the form `package-name@*` to
an installed package iff the package's `name` field is exactly `package-name` (byte-for-byte). The
system SHALL match a rule of the form `@scope/package@*` iff the package's `name` field
is exactly `@scope/package` (byte-for-byte). The system SHALL NOT use prefix matching,
glob expansion, or regular-expression matching for these rules. The system SHALL NOT
allow an unscoped `package-name@*` rule to match a scoped package, and SHALL NOT allow a
scoped `@scope/package@*` rule to match other packages in the same scope. Version
information on the installed package is irrelevant for these rules: any installed
version satisfies the match.

#### Scenario: package wildcard allows any installed version of exact unscoped package

- **GIVEN** an installed package `some-package@1.2.3`, the package's license is missing or not allowed by `allowed-hard.txt`, and `allowed-packages.txt` contains `some-package@*`
- **THEN** the package is allowed and the report includes `matchedPackageRule: "some-package@*"` with outcome `allowed-by-package-name-rule`

#### Scenario: package wildcard does not match similarly named unscoped package

- **GIVEN** an installed package `some-package-extra@1.2.3` and `allowed-packages.txt` contains only `some-package@*`
- **THEN** the rule does not match `some-package-extra`; the package must pass by license or produce a violation

#### Scenario: scoped package wildcard allows any installed version of exact scoped package

- **GIVEN** an installed package `@scope/weird-package@4.5.6`, the package's license is missing or not allowed, and `allowed-packages.txt` contains `@scope/weird-package@*`
- **THEN** the package is allowed and the report includes `matchedPackageRule: "@scope/weird-package@*"` with outcome `allowed-by-package-name-rule`

#### Scenario: scoped package wildcard does not match other packages in same scope

- **GIVEN** an installed package `@scope/other-package@4.5.6` and `allowed-packages.txt` contains only `@scope/weird-package@*`
- **THEN** the rule does not match `@scope/other-package`

#### Scenario: unscoped package wildcard does not match scoped package of the same trailing name

- **GIVEN** an installed package `@scope/weird-package@4.5.6` and `allowed-packages.txt` contains only `weird-package@*`
- **THEN** the rule does not match `@scope/weird-package`

### Requirement: README documents accepted override forms

The README SHALL document the five accepted forms in
`licenses/allowed-packages.txt`:

- `@scope/*` — scope wildcard, intended only for trusted internal namespaces (for
  example `@mirasen/*`).
- `package-name@version` and `@scope/package@version` — exact pin, the highest-precision
  override.
- `package-name@*` and `@scope/package@*` — package-name wildcard, intended for
  manually reviewed packages whose Dependabot/version bumps should not require
  re-editing the override on every bump.

The README SHALL keep the standing warning that all `allowed-packages.txt` overrides
are escape hatches that remain audit-visible in reports, and SHALL NOT present
`package-name@*` as the default first choice.

#### Scenario: README lists all five accepted forms

- **WHEN** the published README is inspected after this change
- **THEN** it documents `@scope/*`, `package-name@version`, `@scope/package@version`, `package-name@*`, and `@scope/package@*` as the accepted forms

#### Scenario: README guides ordering of choice

- **WHEN** the published README is inspected after this change
- **THEN** the override section recommends `package-name@version` for the highest precision, frames `package-name@*` as the manually-reviewed-package convenience form, and reserves `@scope/*` for trusted internal namespaces such as `@mirasen/*`

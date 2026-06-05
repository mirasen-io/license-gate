[![NPM Version](https://img.shields.io/npm/v/%40mirasen%2Flicense-gate)](https://www.npmjs.com/package/@mirasen/license-gate)
[![CI](https://github.com/mirasen-io/license-gate/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mirasen-io/license-gate/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=mirasen-io_license-gate&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=mirasen-io_license-gate)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=mirasen-io_license-gate&metric=coverage)](https://sonarcloud.io/summary/new_code?id=mirasen-io_license-gate)
[![License](https://img.shields.io/npm/l/@mirasen/license-gate)](./LICENSE)

# @mirasen/license-gate

A strict, local, default-deny license policy gate for npm projects — single-package, npm
workspaces, and monorepos.

`license-gate` reads your installed dependency graph (via `@npmcli/arborist`), checks every
package against a literal license allowlist you control, and exits non-zero when anything
fails. It is intentionally small and refuses to guess.

## Install

```bash
npm install -D @mirasen/license-gate
```

Requires **Node ≥ 22.9.0**.

Run `license-gate` after `npm ci` (or after any install that produces the `node_modules`
layout you intend to ship). The gate evaluates what is **physically installed**.

## Usage

```bash
# Full project graph (project root = process.cwd())
npx license-gate check

# Run from any directory; --cwd selects the project root explicitly
npx license-gate check --cwd /path/to/project

# Narrow to one workspace
npx license-gate check --workspace apps/web

# Combine: explicit project root + workspace narrow
npx license-gate check --cwd /path/to/monorepo --workspace apps/web

# Enumerate all installed packages with their licenses (no policy I/O)
npx license-gate collect
```

You can also invoke without local install:

```bash
npx @mirasen/license-gate check
npx @mirasen/license-gate collect
```

Or as an npm script:

```json
{
	"scripts": {
		"lint:licenses": "license-gate check"
	}
}
```

### Commands

```
license-gate check   [--cwd <path>] [--workspace <name|path>] [--json <path>]
license-gate collect [--cwd <path>] [--workspace <name|path>] [--out <path>] [--json <path>]
```

`check` requires `licenses/allowed-hard.txt` at the project root. `collect` does not.

### Project root

The project root is `--cwd <path>` if provided, otherwise `process.cwd()`. `package.json`
must exist directly at that path — `license-gate` does **not** walk upward to find a
parent project. All project-relative paths (`licenses/allowed-hard.txt`,
`licenses/allowed-packages.txt`, `--workspace` relative paths, `--out`, `--json`) resolve
against the project root.

When `--workspace` is used together with `--cwd`, Arborist still loads the graph at the
project root (never at the workspace path); narrowing is performed inside that already
loaded tree.

### Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| `0`  | clean: no violations (`check`) / completed (`collect`) |
| `1`  | one or more policy violations                          |
| `2`  | usage / config / runtime error                         |

`check` always collects every violation before exiting; it never fails fast.

## Policy files

`license-gate` reads two fixed files relative to the **selected project root**
(`--cwd` if provided, otherwise `process.cwd()`):

- `licenses/allowed-hard.txt` — **required for `check`**. The literal license allowlist.
- `licenses/allowed-packages.txt` — optional. Visible package overrides.

These paths are not configurable. There is no `--allowed`, no `package.json` config, no
environment variable. A configurable hard gate is a relaxable hard gate.

### `licenses/allowed-hard.txt`

```
# One literal accepted license string per line.
# Blank lines and `#` comments are ignored. No regex, no glob, no normalisation.

MIT
Apache-2.0
BSD-3-Clause
ISC
0BSD
```

A package's `license` string must appear **verbatim** on a line above. SPDX expressions
(`(MIT OR Apache-2.0)`, `(MIT AND BSD-3-Clause)`) are evaluated literally per leaf — each
leaf must appear verbatim above.

### `licenses/allowed-packages.txt`

```
# Package overrides. Five forms accepted, anything else is a config error (exit 2):
#
#   @scope/*                  trusted internal namespace
#   package-name@version      exact installed unscoped package version
#   @scope/package@version    exact installed scoped package version
#   package-name@*            any installed version of exact unscoped package
#   @scope/package@*          any installed version of exact scoped package

@mirasen/*
internal-tool@1.2.3
@types/node@22.0.0
spawndamnit@*
@scope/weird-package@*
```

Override matches are **always visible** in the report (`matchedPackageRule`); they are
never silent excludes. When several rules match the same package, the most specific rule
wins in the audit trail, with this strict precedence: license-allow first, then exact
`package@version`, then `package@*` / `@scope/package@*`, then `@scope/*`. When a package
is in `allowed-hard.txt`, `allowed-by-license` wins — overrides are escape hatches, not
the default story.

**When to use which form** (most-precise to least-precise, prefer the narrower form):

- `package-name@version` / `@scope/package@version` — highest precision; pin exactly
  one version of one package. Use this for one-off, manually-reviewed packages whose
  license terms you accept at a specific version.
- `package-name@*` / `@scope/package@*` — same package, any version. Use this for a
  manually reviewed package whose maintainers don't change license terms across
  versions, when you don't want to re-edit the override every time Dependabot bumps
  it. **Not** the default first choice — prefer the exact-version form unless version
  bumps would routinely force allowlist edits.
- `@scope/*` — broadest. Reserve for trusted internal namespaces such as `@mirasen/*`.
  Do not use for unrelated third-party packages that happen to share a namespace.

All five forms are escape hatches and remain audit-visible. The JSON report's
`matchedPackageRule` field carries the matching rule verbatim so reviewers can see at
a glance which override was applied.

## Strict by design — what `license-gate` will NOT do

- **No license file reading.** `LICENSE`, `LICENCE`, `COPYING`, `README` are never opened.
- **No license inference or normalisation.** `Apache 2.0` (with space) is **not** the
  same as `Apache-2.0`. `UNLICENSED`, `SEE LICENSE IN LICENSE.md` are literal strings.
- **No `spdx-correct`. No `spdx-satisfies`.** SPDX support is exclusively about parsing
  the boolean shape of npm's `license` field — each leaf is a literal allowlist lookup.
- **No deprecated `license` shape unwrapping.** A package whose `package.json` has
  `license: { type: "MIT" }` or `licenses: [...]` is treated as `could not determine`.
- **No clarification system, no checksum-based evidence, no `licenseStart`/`licenseEnd`.**
- **No project-root walk-up.** The project root is `--cwd` if provided, otherwise
  `process.cwd()`. `license-gate` never walks upward to rescue a wrong working directory.
- **No `--root`, `--project`, `--allowed`, `--allowed-packages`** flags. `--cwd <path>` is
  the only way to point the gate at a different project root, and it is an explicit
  project root, not a search starting point.
- **No silent excludes.** Every package the gate considered is accounted for. The JSON
  report (`check --json <path>`) contains a `Decision` entry for **every** evaluated
  package — allowed and violating alike. The human report on stdout summarises the
  allowed-by-license bucket as a count and lists every package override
  (`matchedPackageRule`) and every violation in full; nothing is dropped.
- **No denylist file** — strict allowlist only.
- **No pnpm, yarn, Gradle, or Maven support.** npm only in v1.
- **No bundle-level analysis.** Vite/Rollup/etc. are out of scope.
- **No markdown/tree visualisers, no SaaS upload modes, no enterprise tiers.**

## Violation model

There are exactly **two** top-level violation reasons:

| `reason`                   | When                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `license-not-in-allowlist` | Package has a usable `license` string that does not satisfy the allowlist             |
| `package-not-in-allowlist` | Package's license is `could not determine` and no `allowed-packages.txt` rule matches |

`license-not-in-allowlist` carries an optional `detailCode`:

| `detailCode`                               | When                                                                                     |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `literal-not-allowed-and-spdx-unparseable` | Literal license is not allowed, and SPDX parsing failed                                  |
| `spdx-expression-not-satisfied`            | SPDX parsed successfully but the expression was not satisfied; carries `offendingLeaves` |

## SPDX semantics in plain words

1. The full literal license string is checked against `allowed-hard.txt` first.
2. If it is not literally listed, the string is parsed as an SPDX expression
   (OR / AND / parens; WITH-exception leaves).
3. Each leaf is compared literally against `allowed-hard.txt`. A WITH-exception leaf is
   reduced to one composite literal `"<license-id> WITH <exception-id>"` and that whole
   string must be in the allowlist; the bare licence id is not considered separately.
4. AND requires every leaf to be allowed; OR requires any one leaf.

## FAQ

**Why does `Apache 2.0` (with a space) fail when `Apache-2.0` is allowed?**
Because they are different strings. `license-gate` does not normalise — that's the
point. Add `Apache 2.0` to your allowlist if you intentionally accept that exact form.

**Why is `UNLICENSED` not automatically rejected?**
It is a literal string, not a parsed SPDX value. If you want to allow `UNLICENSED` for
some private dependency, add it to `allowed-packages.txt` (preferred) or, if your policy
genuinely accepts it everywhere, add `UNLICENSED` to `allowed-hard.txt`.

**How do I allow my own internal packages?**
Add your scope to `allowed-packages.txt`: `@my-co/*`. The override will be visible in
every report.

**Why does it refuse to walk up to my workspace root?**
Because doing so would silently change which project is being gated, and we want the
project under check to be exactly what the user typed. `cd` to the workspace root and
run `license-gate check --workspace apps/web`, or pass `--cwd <workspace-root>
--workspace apps/web` from anywhere.

**Why is `check --out` rejected?**
The check verdict belongs in stdout / CI logs. Use `--json <path>` for a structured
report; use shell redirection if you need a copy of the human output.

## Programmatic API

```ts
import { runCheck, runCollect } from '@mirasen/license-gate';

const result = await runCheck({ workspace: 'apps/web', jsonPath: 'report.json' });
if (result.exitCode === 1) {
	console.error(`license-gate found ${result.violations.length} violation(s).`);
}
```

The library never calls `process.exit`. Callers control exit. See `src/index.ts` for the
full set of exported types (`Decision`, `ViolationReason`, `InstalledPackageRecord`,
`LicenseGateConfigError`, etc.).

## License

[MIT](./LICENSE) © Mirasen

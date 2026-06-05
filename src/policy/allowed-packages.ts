/**
 * Parser for `licenses/allowed-packages.txt`.
 *
 * Pure: takes the file contents and a path (for error reporting), returns
 * either a list of validated rules or throws a `LicenseGateConfigError` with
 * `kind: 'invalid-package-override-rule'` carrying the offending line.
 *
 * Accepted rule forms (and ONLY these):
 *   1. `@scope/*`                   trusted internal namespace
 *   2. `package-name@version`       exact installed unscoped package version
 *   3. `@scope/package@version`     exact installed scoped package version
 *   4. `package-name@*`             package-name wildcard (any version),
 *                                   unscoped — narrowly scoped escape hatch
 *                                   for manually reviewed packages whose
 *                                   version bumps should not require
 *                                   re-editing this file.
 *   5. `@scope/package@*`           package-name wildcard (any version),
 *                                   scoped — same intent as form 4.
 *
 * Everything else is rejected, including:
 *   - bare `package-name` (no version)
 *   - bare `@scope/package` (no version, no `*`)
 *   - semver ranges: `^1.2.3`, `~1.2.3`, `1.x`, `>=1.0.0`, ...
 *   - `@scope/*@*`, `*@*`
 *   - regex, generic glob, prefix wildcard, bare `*`
 *   - any whitespace inside the rule
 */

import {
	LicenseGateConfigError,
	type AllowedPackages,
	type AllowedPackagesRule
} from '../types.js';

// Unscoped package name: lowercase letters, digits, '.', '_', '-', no leading dot or underscore.
// We are conservative — npm itself allows more, but policy files are author-edited so a tight
// pattern catches typos rather than letting them through.
const UNSCOPED_NAME = /^[a-z0-9][a-z0-9._-]*$/;
const SCOPE = /^@[a-z0-9][a-z0-9._-]*$/;
// Strict semver-like version: digits.digits.digits with optional pre-release/build.
// We do NOT accept ranges, partials, or `*` here — those are rejected.
const EXACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function rejectWith(path: string, lineNumber: number, line: string, hint: string): never {
	throw new LicenseGateConfigError(
		{ kind: 'invalid-package-override-rule', path, lineNumber, line },
		`license-gate: ${path}:${lineNumber}: invalid package override rule "${line}". ${hint} Accepted forms: "@scope/*", "package@version", "@scope/package@version", "package@*", "@scope/package@*".`
	);
}

function parseRule(path: string, lineNumber: number, raw: string): AllowedPackagesRule {
	const trimmed = raw.trim();
	// Whitespace inside the rule is invalid.
	if (/\s/.test(trimmed)) {
		rejectWith(path, lineNumber, trimmed, 'rule must not contain internal whitespace.');
	}

	// Form 1: @scope/*
	if (trimmed.endsWith('/*')) {
		const scope = trimmed.slice(0, -2);
		if (!SCOPE.test(scope)) {
			rejectWith(
				path,
				lineNumber,
				trimmed,
				'scope rules must be exactly `@scope/*` with a valid scope.'
			);
		}
		return { kind: 'scope', scope, ruleText: trimmed };
	}

	// Forms 4 and 5: package-name wildcard `name@*` / `@scope/name@*`.
	// The `*` is allowed ONLY as the trailing version sentinel; the head must
	// be a valid (scoped or unscoped) package name with no other `*`.
	if (trimmed.endsWith('@*')) {
		const head = trimmed.slice(0, -2);
		// Reject if `*` appears anywhere in the head — covers `@scope/*@*`,
		// `*@*`, `pkg*@*`, etc.
		if (head.length === 0 || head.includes('*')) {
			rejectWith(
				path,
				lineNumber,
				trimmed,
				'package-name wildcard must be `package@*` or `@scope/package@*`.'
			);
		}
		if (head.startsWith('@')) {
			const slash = head.indexOf('/');
			if (slash <= 1 || slash === head.length - 1) {
				rejectWith(
					path,
					lineNumber,
					trimmed,
					'scoped package-name wildcard must be `@scope/name@*`.'
				);
			}
			const scope = head.slice(0, slash);
			const subname = head.slice(slash + 1);
			if (!SCOPE.test(scope) || !UNSCOPED_NAME.test(subname)) {
				rejectWith(path, lineNumber, trimmed, 'scope or package name is malformed.');
			}
			return { kind: 'scoped-package-name', scope, name: head, ruleText: trimmed };
		}
		if (!UNSCOPED_NAME.test(head)) {
			rejectWith(path, lineNumber, trimmed, 'package name is malformed.');
		}
		return { kind: 'package-name', name: head, ruleText: trimmed };
	}

	// Reject genuinely glob/regex-like characters early. We deliberately do
	// NOT include `+` here because `+` is a valid SemVer build-metadata
	// separator (e.g. `pkg@1.2.3+build.42`); the head/version regexes below
	// still reject `+` if it appears in the package-name part. Likewise `-`
	// is a valid SemVer pre-release separator.
	if (trimmed === '*' || trimmed.includes('*') || /[\\(){}|^$?]/.test(trimmed)) {
		rejectWith(path, lineNumber, trimmed, 'wildcards, regex, and glob syntax are not allowed.');
	}

	// Must contain `@` separating name and version (for the version-bearing forms).
	// For scoped names the version `@` is the LAST `@`.
	const lastAt = trimmed.lastIndexOf('@');
	if (lastAt <= 0) {
		rejectWith(
			path,
			lineNumber,
			trimmed,
			'missing version. Override rules must pin an exact version.'
		);
	}

	const head = trimmed.slice(0, lastAt);
	const version = trimmed.slice(lastAt + 1);
	if (!EXACT_VERSION.test(version)) {
		rejectWith(
			path,
			lineNumber,
			trimmed,
			`version must be an exact semver (got "${version}"). Semver ranges, "*" and partial versions are not allowed.`
		);
	}

	if (head.startsWith('@')) {
		// Scoped: @scope/name
		const slash = head.indexOf('/');
		if (slash <= 1 || slash === head.length - 1) {
			rejectWith(path, lineNumber, trimmed, 'scoped package must be `@scope/name@version`.');
		}
		const scope = head.slice(0, slash);
		const subname = head.slice(slash + 1);
		if (!SCOPE.test(scope) || !UNSCOPED_NAME.test(subname)) {
			rejectWith(path, lineNumber, trimmed, 'scope or package name is malformed.');
		}
		return {
			kind: 'scoped-package-version',
			scope,
			name: head,
			version,
			ruleText: trimmed
		};
	}

	if (!UNSCOPED_NAME.test(head)) {
		rejectWith(path, lineNumber, trimmed, 'package name is malformed.');
	}
	return { kind: 'package-version', name: head, version, ruleText: trimmed };
}

export function parseAllowedPackages(contents: string, path: string): AllowedPackages {
	const out: AllowedPackagesRule[] = [];
	let lineNumber = 0;
	for (const rawLine of contents.split(/\r?\n/)) {
		lineNumber++;
		const trimmed = rawLine.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.startsWith('#')) continue;
		out.push(parseRule(path, lineNumber, trimmed));
	}
	return out;
}

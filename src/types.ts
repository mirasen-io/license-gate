/**
 * Internal types for @mirasen/license-gate.
 *
 * Closed discriminated unions throughout. Reporters and command layers should
 * exhaustively switch on `outcome` and `kind` so that adding a new variant is
 * a compile-time signal across the codebase.
 */

/** Sentinel string used when a package's license cannot be determined from
 *  `package.json#license` (missing, empty, or non-string shape). */
export const LICENSE_COULD_NOT_DETERMINE = 'could not determine';
export type LicenseCouldNotDetermine = typeof LICENSE_COULD_NOT_DETERMINE;

/** A flat record of one physically-installed package copy. `path` is the
 *  copy's location relative to the selected project root; two copies of the
 *  same `name@version` at different physical paths are still distinct
 *  records. */
export type InstalledPackageRecord = {
	name: string;
	version: string;
	/** `${name}@${version}` — convenience composite. */
	packageId: string;
	/** Path of the installed copy relative to the selected project root,
	 *  using POSIX-style `/` separators. The project root itself is exposed
	 *  as `"."`. Internal graph/fs logic continues to use absolute paths;
	 *  this field is the public, redaction-safe form. Physical placement of
	 *  an installed copy (hoisted vs. workspace-local) is communicated
	 *  entirely through this field. */
	path: string;
	/** Trimmed verbatim string from `package.json#license`, or the
	 *  `LICENSE_COULD_NOT_DETERMINE` sentinel. Never normalised. */
	license: string | LicenseCouldNotDetermine;
	repository?: string;
	publisher?: string;
	email?: string;
};

/** A parsed `licenses/allowed-hard.txt`. Keys are the literal accepted license
 *  strings (after trim, dedup, and skipping blank/comment lines). */
export type AllowedHardList = ReadonlySet<string>;

/** A parsed rule from `licenses/allowed-packages.txt`. The original line text
 *  is preserved verbatim for inclusion in reports as `matchedPackageRule`. */
export type AllowedPackagesRule =
	| { kind: 'scope'; scope: string; ruleText: string } // `@scope/*`
	| { kind: 'package-version'; name: string; version: string; ruleText: string } // `pkg@1.0.0`
	| {
			kind: 'scoped-package-version';
			scope: string;
			name: string; // full `@scope/name`
			version: string;
			ruleText: string;
	  }
	| { kind: 'package-name'; name: string; ruleText: string } // `pkg@*`
	| {
			kind: 'scoped-package-name';
			scope: string;
			name: string; // full `@scope/name`
			ruleText: string;
	  }; // `@scope/pkg@*`

/** Parsed allowlists used by the policy evaluator. */
export type AllowedPackages = ReadonlyArray<AllowedPackagesRule>;

/** A policy decision for one installed package record. */
export type Decision =
	| { record: InstalledPackageRecord; outcome: 'allowed-by-license' }
	| {
			record: InstalledPackageRecord;
			outcome: 'allowed-by-scope-rule';
			matchedPackageRule: string;
	  }
	| {
			record: InstalledPackageRecord;
			outcome: 'allowed-by-package-version-rule';
			matchedPackageRule: string;
	  }
	| {
			record: InstalledPackageRecord;
			outcome: 'allowed-by-package-name-rule';
			matchedPackageRule: string;
	  }
	| { record: InstalledPackageRecord; outcome: 'violation'; reason: ViolationReason };

/** The two top-level policy violation reasons. SPDX outcomes are diagnostic
 *  detail under `license-not-in-allowlist`. */
export type ViolationReason =
	| {
			kind: 'license-not-in-allowlist';
			/** The original license string from package.json, verbatim. */
			raw: string;
			/** Diagnostic detail explaining how the SPDX evaluator landed here. */
			detailCode?: 'literal-not-allowed-and-spdx-unparseable' | 'spdx-expression-not-satisfied';
			/** Present iff `detailCode === "spdx-expression-not-satisfied"`. */
			offendingLeaves?: string[];
	  }
	| { kind: 'package-not-in-allowlist' };

/** Configuration / runtime errors that halt execution before policy
 *  evaluation completes. They map to exit code 2. */
export type ConfigError =
	| { kind: 'missing-package-json'; cwd: string }
	| { kind: 'missing-node-modules'; cwd: string }
	| { kind: 'missing-allowed-hard-file'; path: string }
	| {
			kind: 'invalid-package-override-rule';
			path: string;
			lineNumber: number;
			line: string;
	  }
	| { kind: 'invalid-workspace'; query: string; reason: string }
	| { kind: 'output-path-unwritable'; path: string; cause: string }
	| { kind: 'invalid-usage'; message: string };

/** Custom error wrapper so the CLI can recognise and exit 2 cleanly. */
export class LicenseGateConfigError extends Error {
	readonly detail: ConfigError;
	constructor(detail: ConfigError, message: string) {
		super(message);
		this.name = 'LicenseGateConfigError';
		this.detail = detail;
	}
}

/** A `collect` row — the same as `InstalledPackageRecord` plus a flag for the
 *  project-root entry, which is included in `collect` output but skipped from
 *  `check` evaluation. */
export type CollectedRecord = InstalledPackageRecord & {
	isProjectRoot?: boolean;
};

/** The result returned by the programmatic `check()` API. */
export type CheckResult = {
	decisions: Decision[];
	violations: Array<Extract<Decision, { outcome: 'violation' }>>;
	skippedProjectRoot: InstalledPackageRecord | null;
};

/** The result returned by the programmatic `collect()` API. */
export type CollectResult = {
	records: CollectedRecord[];
};

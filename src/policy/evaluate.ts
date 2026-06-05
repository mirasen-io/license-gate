/**
 * Policy evaluator — pure: maps records + allowlists → decisions.
 *
 * Per design D5/D5a + add-package-wildcard-overrides:
 *   1. license == "could not determine":
 *        override matches  → allowed-by-{scope|package-version|package-name}-rule
 *        else              → violation { reason: "package-not-in-allowlist" }
 *   2. literal license string in allowed-hard.txt:
 *        → allowed-by-license   (override is ignored: license-allow wins)
 *   3. otherwise SPDX evaluation (with WITH-exception leaves reduced to
 *      "<id> WITH <exc>" composite literals):
 *        satisfied                  → allowed-by-license
 *        unsatisfied + override     → allowed-by-{scope|package-version|package-name}-rule
 *        unsatisfied + no override  → license-not-in-allowlist
 *                                      / spdx-expression-not-satisfied
 *        unparseable + override     → allowed-by-{scope|package-version|package-name}-rule
 *        unparseable + no override  → license-not-in-allowlist
 *                                      / literal-not-allowed-and-spdx-unparseable
 *
 * Override precedence when multiple `allowed-packages.txt` rules match the
 * same installed package (most-specific wins, license-allow already short-
 * circuits earlier):
 *   (a) exact `package@version` / `@scope/package@version`
 *   (b) `package@*` / `@scope/package@*`
 *   (c) `@scope/*`
 */

import {
	LICENSE_COULD_NOT_DETERMINE,
	type AllowedHardList,
	type AllowedPackages,
	type AllowedPackagesRule,
	type Decision,
	type InstalledPackageRecord
} from '../types.js';
import { evaluateSpdx } from './spdx-shape.js';

/** Find the override rule that matches a record. When several match (e.g.
 *  both `@scope/*`, `@scope/foo@*`, and `@scope/foo@1.2.3`), apply the
 *  precedence: exact version > package-name wildcard > scope wildcard. */
function findMatchingOverride(
	record: InstalledPackageRecord,
	rules: AllowedPackages
): AllowedPackagesRule | null {
	let scopeMatch: AllowedPackagesRule | null = null;
	let nameMatch: AllowedPackagesRule | null = null;
	let exactMatch: AllowedPackagesRule | null = null;
	for (const rule of rules) {
		switch (rule.kind) {
			case 'package-version':
				if (rule.name === record.name && rule.version === record.version) {
					exactMatch = rule;
				}
				break;
			case 'scoped-package-version':
				if (rule.name === record.name && rule.version === record.version) {
					exactMatch = rule;
				}
				break;
			case 'package-name':
				if (rule.name === record.name) {
					nameMatch = rule;
				}
				break;
			case 'scoped-package-name':
				if (rule.name === record.name) {
					nameMatch = rule;
				}
				break;
			case 'scope':
				if (record.name.startsWith(`${rule.scope}/`)) {
					scopeMatch = rule;
				}
				break;
			default: {
				const _never: never = rule;
				throw new Error(`unreachable rule: ${JSON.stringify(_never)}`);
			}
		}
	}
	return exactMatch ?? nameMatch ?? scopeMatch;
}

function overrideToDecision(record: InstalledPackageRecord, rule: AllowedPackagesRule): Decision {
	switch (rule.kind) {
		case 'scope':
			return {
				record,
				outcome: 'allowed-by-scope-rule',
				matchedPackageRule: rule.ruleText
			};
		case 'package-version':
		case 'scoped-package-version':
			return {
				record,
				outcome: 'allowed-by-package-version-rule',
				matchedPackageRule: rule.ruleText
			};
		case 'package-name':
		case 'scoped-package-name':
			return {
				record,
				outcome: 'allowed-by-package-name-rule',
				matchedPackageRule: rule.ruleText
			};
		default: {
			const _never: never = rule;
			throw new Error(`unreachable rule: ${JSON.stringify(_never)}`);
		}
	}
}

export function evaluateRecord(
	record: InstalledPackageRecord,
	allowedHard: AllowedHardList,
	allowedPackages: AllowedPackages
): Decision {
	// Step 1 — could not determine.
	if (record.license === LICENSE_COULD_NOT_DETERMINE) {
		const override = findMatchingOverride(record, allowedPackages);
		if (override) return overrideToDecision(record, override);
		return {
			record,
			outcome: 'violation',
			reason: { kind: 'package-not-in-allowlist' }
		};
	}

	const licenseString = record.license;

	// Step 2 — literal full-string match wins, ignores any override.
	if (allowedHard.has(licenseString)) {
		return { record, outcome: 'allowed-by-license' };
	}

	// Step 3 — SPDX evaluation.
	const spdx = evaluateSpdx(licenseString, allowedHard);
	if (spdx.kind === 'satisfied') {
		return { record, outcome: 'allowed-by-license' };
	}

	// Both unsatisfied and unparseable can be rescued by an override.
	const override = findMatchingOverride(record, allowedPackages);
	if (override) return overrideToDecision(record, override);

	if (spdx.kind === 'unparseable') {
		return {
			record,
			outcome: 'violation',
			reason: {
				kind: 'license-not-in-allowlist',
				raw: licenseString,
				detailCode: 'literal-not-allowed-and-spdx-unparseable'
			}
		};
	}

	// spdx.kind === 'unsatisfied'
	return {
		record,
		outcome: 'violation',
		reason: {
			kind: 'license-not-in-allowlist',
			raw: licenseString,
			detailCode: 'spdx-expression-not-satisfied',
			offendingLeaves: spdx.offendingLeaves
		}
	};
}

/** Evaluate a list of records, returning all decisions in the same order. */
export function evaluateAll(
	records: InstalledPackageRecord[],
	allowedHard: AllowedHardList,
	allowedPackages: AllowedPackages
): Decision[] {
	return records.map((r) => evaluateRecord(r, allowedHard, allowedPackages));
}

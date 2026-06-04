/**
 * JSON reporters for `check` and `collect`. Stable, machine-readable.
 *
 * The shape is intentionally explicit so consumers can rely on it across
 * v1.x without surprises.
 */

import type { CollectedRecord, Decision, InstalledPackageRecord } from '../types.js';

export type CheckJsonReport = {
	skippedProjectRoot: InstalledPackageRecord | null;
	counts: {
		evaluated: number;
		allowedByLicense: number;
		allowedByScopeRule: number;
		allowedByPackageVersionRule: number;
		violations: number;
	};
	decisions: Decision[];
};

export function renderCheckJson(input: {
	decisions: Decision[];
	skippedProjectRoot: InstalledPackageRecord | null;
}): string {
	let allowedByLicense = 0;
	let allowedByScopeRule = 0;
	let allowedByPackageVersionRule = 0;
	let violations = 0;
	for (const d of input.decisions) {
		switch (d.outcome) {
			case 'allowed-by-license':
				allowedByLicense++;
				break;
			case 'allowed-by-scope-rule':
				allowedByScopeRule++;
				break;
			case 'allowed-by-package-version-rule':
				allowedByPackageVersionRule++;
				break;
			case 'violation':
				violations++;
				break;
			default: {
				const _never: never = d;
				throw new Error(`unreachable decision: ${JSON.stringify(_never)}`);
			}
		}
	}
	const report: CheckJsonReport = {
		skippedProjectRoot: input.skippedProjectRoot,
		counts: {
			evaluated: input.decisions.length,
			allowedByLicense,
			allowedByScopeRule,
			allowedByPackageVersionRule,
			violations
		},
		decisions: input.decisions
	};
	return JSON.stringify(report, null, 2) + '\n';
}

export type CollectJsonReport = {
	records: CollectedRecord[];
};

export function renderCollectJson(records: CollectedRecord[]): string {
	const report: CollectJsonReport = { records };
	return JSON.stringify(report, null, 2) + '\n';
}

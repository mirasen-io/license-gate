/**
 * Human-readable reporters for `check` and `collect`.
 * Pure functions returning strings; the command layer prints/writes them.
 */

import type {
	CollectedRecord,
	Decision,
	InstalledPackageRecord,
	ViolationReason
} from '../types.js';

function fmtPackageId(record: InstalledPackageRecord): string {
	return record.workspace
		? `${record.packageId} [workspace: ${record.workspace}]`
		: record.packageId;
}

function fmtViolationReason(reason: ViolationReason): string {
	switch (reason.kind) {
		case 'package-not-in-allowlist':
			return 'package-not-in-allowlist (no usable package.json#license string and no allowed-packages.txt rule matched)';
		case 'license-not-in-allowlist': {
			const head = `license-not-in-allowlist (raw: "${reason.raw}")`;
			if (reason.detailCode === 'literal-not-allowed-and-spdx-unparseable') {
				return `${head} — literal not allowed; SPDX expression unparseable`;
			}
			if (reason.detailCode === 'spdx-expression-not-satisfied') {
				const leaves = reason.offendingLeaves?.join(', ') ?? '';
				return `${head} — SPDX expression parsed but not satisfied; offending leaves: [${leaves}]`;
			}
			return head;
		}
		default: {
			// Exhaustiveness check.
			const _never: never = reason;
			return `unknown violation (${JSON.stringify(_never)})`;
		}
	}
}

/** Render the `check` result as readable text. */
export function renderCheckHuman(input: {
	decisions: Decision[];
	skippedProjectRoot: InstalledPackageRecord | null;
}): string {
	const { decisions, skippedProjectRoot } = input;
	const lines: string[] = [];

	const allowedByLicense: Decision[] = [];
	const allowedByScope: Decision[] = [];
	const allowedByPackageVersion: Decision[] = [];
	const allowedByPackageName: Decision[] = [];
	const violations: Extract<Decision, { outcome: 'violation' }>[] = [];

	for (const d of decisions) {
		switch (d.outcome) {
			case 'allowed-by-license':
				allowedByLicense.push(d);
				break;
			case 'allowed-by-scope-rule':
				allowedByScope.push(d);
				break;
			case 'allowed-by-package-version-rule':
				allowedByPackageVersion.push(d);
				break;
			case 'allowed-by-package-name-rule':
				allowedByPackageName.push(d);
				break;
			case 'violation':
				violations.push(d);
				break;
			default: {
				const _never: never = d;
				throw new Error(`unreachable decision: ${JSON.stringify(_never)}`);
			}
		}
	}

	lines.push('license-gate check');
	if (skippedProjectRoot) {
		lines.push(
			`  (skipped: project root) ${skippedProjectRoot.packageId} [${skippedProjectRoot.path}]`
		);
	}
	lines.push(`  evaluated:                  ${decisions.length}`);
	lines.push(`  allowed by license:         ${allowedByLicense.length}`);
	lines.push(`  allowed by scope rule:      ${allowedByScope.length}`);
	lines.push(`  allowed by package@version: ${allowedByPackageVersion.length}`);
	lines.push(`  allowed by package@*:       ${allowedByPackageName.length}`);
	lines.push(`  violations:                 ${violations.length}`);
	lines.push('');

	if (
		allowedByScope.length > 0 ||
		allowedByPackageVersion.length > 0 ||
		allowedByPackageName.length > 0
	) {
		lines.push('Package overrides applied:');
		for (const d of [...allowedByPackageVersion, ...allowedByPackageName, ...allowedByScope]) {
			if (
				d.outcome !== 'allowed-by-scope-rule' &&
				d.outcome !== 'allowed-by-package-version-rule' &&
				d.outcome !== 'allowed-by-package-name-rule'
			)
				continue;
			lines.push(`  ✓ ${fmtPackageId(d.record)} — ${d.matchedPackageRule}`);
		}
		lines.push('');
	}

	if (violations.length > 0) {
		lines.push('Violations:');
		for (const v of violations) {
			lines.push(`  ✗ ${fmtPackageId(v.record)}`);
			lines.push(`      ${fmtViolationReason(v.reason)}`);
			lines.push(`      path: ${v.record.path}`);
		}
		lines.push('');
		lines.push('FAILED: at least one license policy violation.');
	} else {
		lines.push('PASSED: no license policy violations.');
	}

	return lines.join('\n') + '\n';
}

/** Render the `collect` result as readable text. */
export function renderCollectHuman(records: CollectedRecord[]): string {
	const lines: string[] = [];
	lines.push('license-gate collect');
	lines.push(`  records: ${records.length}`);
	lines.push('');
	for (const r of records) {
		const tag = r.isProjectRoot ? ' (project root)' : '';
		const ws = r.workspace ? ` [workspace: ${r.workspace}]` : '';
		lines.push(`  ${r.packageId}${tag}${ws}`);
		lines.push(`    license: ${r.license}`);
		lines.push(`    path:    ${r.path}`);
		if (r.repository) lines.push(`    repo:    ${r.repository}`);
		if (r.publisher || r.email) {
			const author = [r.publisher, r.email ? `<${r.email}>` : null].filter(Boolean).join(' ');
			lines.push(`    author:  ${author}`);
		}
	}
	return lines.join('\n') + '\n';
}

/**
 * Focused branch coverage for the report renderers.
 *
 * The integration tests already exercise the most common paths (license,
 * package-name wildcards, basic violations); this file covers branches that
 * the integration tests don't reach without contrived fixtures:
 *
 *   - JSON `counts` for `allowed-by-scope-rule` and
 *     `allowed-by-package-version-rule`
 *   - human violation detail for `spdx-expression-not-satisfied`
 *     (the `offendingLeaves` branch)
 *   - human collect output for records that carry `repository`, `publisher`,
 *     and `email`
 *
 * Pure renderer tests — no fixtures, no Arborist, no I/O.
 */

import { describe, expect, it } from 'vitest';

import { renderCheckHuman, renderCollectHuman } from '../../src/report/human.js';
import { renderCheckJson, type CheckJsonReport } from '../../src/report/json.js';
import type { CollectedRecord, Decision, InstalledPackageRecord } from '../../src/types.js';

function rec(over: Partial<InstalledPackageRecord> = {}): InstalledPackageRecord {
	return {
		name: 'pkg',
		version: '1.0.0',
		packageId: 'pkg@1.0.0',
		path: 'node_modules/pkg',
		workspace: null,
		license: 'MIT',
		...over
	};
}

describe('renderCheckJson — counts cover every override branch', () => {
	it('counts scope-rule and package-version-rule outcomes alongside license + name + violation', () => {
		const decisions: Decision[] = [
			{
				record: rec({ name: 'mit-pkg', packageId: 'mit-pkg@1.0.0' }),
				outcome: 'allowed-by-license'
			},
			{
				record: rec({ name: '@scope/a', packageId: '@scope/a@1.0.0' }),
				outcome: 'allowed-by-scope-rule',
				matchedPackageRule: '@scope/*'
			},
			{
				record: rec({ name: 'pinned', packageId: 'pinned@2.3.4' }),
				outcome: 'allowed-by-package-version-rule',
				matchedPackageRule: 'pinned@2.3.4'
			},
			{
				record: rec({ name: 'wild', packageId: 'wild@9.9.9' }),
				outcome: 'allowed-by-package-name-rule',
				matchedPackageRule: 'wild@*'
			},
			{
				record: rec({ name: 'bad', packageId: 'bad@1.0.0', license: 'WTFPL' }),
				outcome: 'violation',
				reason: { kind: 'license-not-in-allowlist', raw: 'WTFPL' }
			}
		];
		const text = renderCheckJson({ decisions, skippedProjectRoot: null });
		const parsed = JSON.parse(text) as CheckJsonReport;
		expect(parsed.counts).toEqual({
			evaluated: 5,
			allowedByLicense: 1,
			allowedByScopeRule: 1,
			allowedByPackageVersionRule: 1,
			allowedByPackageNameRule: 1,
			violations: 1
		});
	});
});

describe('renderCheckHuman — violation detail branches', () => {
	it('renders offendingLeaves for `spdx-expression-not-satisfied`', () => {
		const decisions: Decision[] = [
			{
				record: rec({ name: 'gpl-pkg', packageId: 'gpl-pkg@1.0.0', license: 'GPL-3.0' }),
				outcome: 'violation',
				reason: {
					kind: 'license-not-in-allowlist',
					raw: '(MIT AND GPL-3.0)',
					detailCode: 'spdx-expression-not-satisfied',
					offendingLeaves: ['GPL-3.0', 'GPL-3.0-only']
				}
			}
		];
		const text = renderCheckHuman({ decisions, skippedProjectRoot: null });
		expect(text).toContain('SPDX expression parsed but not satisfied');
		expect(text).toContain('offending leaves: [GPL-3.0, GPL-3.0-only]');
		expect(text).toContain('FAILED');
	});
});

describe('renderCollectHuman — author and repository lines', () => {
	it('renders repo, publisher, and email when present', () => {
		const records: CollectedRecord[] = [
			rec({
				name: 'authored',
				packageId: 'authored@1.0.0',
				repository: 'https://example.test/authored',
				publisher: 'Alice',
				email: 'alice@example.test'
			})
		];
		const text = renderCollectHuman(records);
		expect(text).toContain('repo:    https://example.test/authored');
		expect(text).toContain('author:  Alice <alice@example.test>');
	});

	it('renders just the publisher when no email is present', () => {
		const records: CollectedRecord[] = [
			rec({
				name: 'pub-only',
				packageId: 'pub-only@1.0.0',
				publisher: 'Bob'
			})
		];
		const text = renderCollectHuman(records);
		expect(text).toContain('author:  Bob');
		expect(text).not.toContain('<>');
	});
});

import { describe, expect, it } from 'vitest';

import { renderCheckJson, type CheckJsonReport } from '../../src/report/json.js';
import { renderCheckHuman } from '../../src/report/human.js';
import type { Decision, InstalledPackageRecord } from '../../src/types.js';

function rec(over: Partial<InstalledPackageRecord>): InstalledPackageRecord {
	return {
		name: 'pkg',
		version: '1.0.0',
		packageId: 'pkg@1.0.0',
		path: '/fake/node_modules/pkg',
		workspace: null,
		license: 'MIT',
		...over
	};
}

describe('reporters — package-name wildcard rule visibility', () => {
	const decisions: Decision[] = [
		{
			record: rec({ name: 'some-package', version: '1.2.3', packageId: 'some-package@1.2.3' }),
			outcome: 'allowed-by-package-name-rule',
			matchedPackageRule: 'some-package@*'
		},
		{
			record: rec({
				name: '@scope/weird-package',
				version: '4.5.6',
				packageId: '@scope/weird-package@4.5.6'
			}),
			outcome: 'allowed-by-package-name-rule',
			matchedPackageRule: '@scope/weird-package@*'
		}
	];

	it('JSON report counts and surfaces matchedPackageRule verbatim', () => {
		const text = renderCheckJson({ decisions, skippedProjectRoot: null });
		const parsed = JSON.parse(text) as CheckJsonReport;
		expect(parsed.counts.allowedByPackageNameRule).toBe(2);
		expect(parsed.counts.allowedByPackageVersionRule).toBe(0);
		expect(parsed.counts.allowedByScopeRule).toBe(0);
		expect(parsed.counts.violations).toBe(0);
		expect(parsed.decisions[0]).toMatchObject({
			outcome: 'allowed-by-package-name-rule',
			matchedPackageRule: 'some-package@*'
		});
		expect(parsed.decisions[1]).toMatchObject({
			outcome: 'allowed-by-package-name-rule',
			matchedPackageRule: '@scope/weird-package@*'
		});
	});

	it('human report lists each wildcard override visibly with verbatim rule text', () => {
		const text = renderCheckHuman({ decisions, skippedProjectRoot: null });
		expect(text).toContain('Package overrides applied:');
		expect(text).toContain('some-package@1.2.3 — some-package@*');
		expect(text).toContain('@scope/weird-package@4.5.6 — @scope/weird-package@*');
		// Counts line
		expect(text).toContain('allowed by package@*:       2');
	});
});

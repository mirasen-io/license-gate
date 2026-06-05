/**
 * Integration tests for the `check` command.
 *
 * Use programmatic fixtures in tmpdirs and the runCheck() programmatic API.
 */

import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { runCheck } from '../../src/commands/check.js';
import {
	buildLicenseShapesFixture,
	buildNonHoistedConflictFixture,
	buildSinglePackageFixture,
	withCwd,
	writeAllowedHard,
	writeAllowedPackages
} from '../helpers/build-fixture.js';
import { LicenseGateConfigError } from '../../src/types.js';

describe('runCheck — discovery and full-graph evaluation', () => {
	it('passes a single-package fixture when MIT and Apache-2.0 are allowed', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		const result = await withCwd(root, () => runCheck());
		expect(result.exitCode).toBe(0);
		expect(result.violations).toHaveLength(0);
		// Project root skipped, evaluation set is two packages.
		expect(result.skippedProjectRoot).not.toBeNull();
		expect(result.skippedProjectRoot?.name).toBe('single-pkg-fixture');
	});

	it('reports a violation when a license is missing from allowed-hard', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\n'); // no Apache-2.0
		const result = await withCwd(root, () => runCheck());
		expect(result.exitCode).toBe(1);
		expect(result.violations).toHaveLength(1);
		const v = result.violations[0];
		expect(v.record.name).toBe('fake-apache');
		if (v.reason.kind === 'license-not-in-allowlist') {
			expect(v.reason.raw).toBe('Apache-2.0');
		}
	});

	it('non-hoisted conflict: both physical copies are evaluated', async () => {
		const root = await buildNonHoistedConflictFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		const result = await withCwd(root, () => runCheck());
		const sharedDecisions = result.decisions.filter((d) => d.record.name === 'fake-shared');
		expect(sharedDecisions).toHaveLength(2);
		const versions = sharedDecisions.map((d) => d.record.version).sort();
		expect(versions).toEqual(['3.0.0', '4.0.0']);
	});

	it('skips the project root in full mode and reports it', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		const result = await withCwd(root, () => runCheck());
		expect(result.skippedProjectRoot?.name).toBe('single-pkg-fixture');
		expect(result.humanReport).toContain('(skipped: project root)');
	});

	it('evaluates workspaces themselves and can flag them', async () => {
		const root = await buildNonHoistedConflictFixture();
		// Workspace has license: Apache-2.0 — make it disallowed.
		await writeAllowedHard(root, 'MIT\n');
		const result = await withCwd(root, () => runCheck());
		expect(result.exitCode).toBe(1);
		const wsViolation = result.violations.find((v) => v.record.name === '@probe/web');
		expect(wsViolation).toBeDefined();
	});
});

describe('runCheck — allowed-packages overrides', () => {
	it('rescues a could-not-determine package via @scope/* override', async () => {
		const root = await buildLicenseShapesFixture();
		await writeAllowedHard(root, 'MIT\n');
		await writeAllowedPackages(
			root,
			'pkg-no-license@1.0.0\npkg-empty-license@1.0.0\npkg-object-license@1.0.0\npkg-licenses-array@1.0.0\npkg-deprecated-only@1.0.0\n'
		);
		const result = await withCwd(root, () => runCheck());
		const targetPackages = [
			'pkg-no-license',
			'pkg-empty-license',
			'pkg-object-license',
			'pkg-licenses-array',
			'pkg-deprecated-only'
		];
		for (const name of targetPackages) {
			const decision = result.decisions.find((d) => d.record.name === name);
			expect(decision).toBeDefined();
			expect(decision?.outcome).toBe('allowed-by-package-version-rule');
		}
	});

	it('reports invalid override rules with file/line info (exit 2)', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		await writeAllowedPackages(root, 'lodash\n');
		try {
			await withCwd(root, () => runCheck());
		} catch (err) {
			expect(err).toBeInstanceOf(LicenseGateConfigError);
			const e = err as LicenseGateConfigError;
			expect(e.detail.kind).toBe('invalid-package-override-rule');
			return;
		}
		throw new Error('expected runCheck to throw');
	});
});

describe('runCheck — required allowed-hard.txt', () => {
	it('throws missing-allowed-hard-file when file is absent', async () => {
		const root = await buildSinglePackageFixture();
		try {
			await withCwd(root, () => runCheck());
		} catch (err) {
			expect(err).toBeInstanceOf(LicenseGateConfigError);
			const e = err as LicenseGateConfigError;
			expect(e.detail.kind).toBe('missing-allowed-hard-file');
			return;
		}
		throw new Error('expected runCheck to throw');
	});
});

describe('runCheck — license shapes integration', () => {
	let savedCwd: string;
	afterEach(() => {
		if (savedCwd) process.chdir(savedCwd);
	});

	it('produces precisely the expected violation set', async () => {
		const root = await buildLicenseShapesFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\nBSD-3-Clause\nUNLICENSED\n');
		savedCwd = process.cwd();
		const result = await withCwd(root, () => runCheck());

		// pkg-mit, pkg-or, pkg-paren, pkg-and, pkg-unlicensed are allowed.
		// Apache 2.0 (space) NOT allowed; everything in could-not-determine bucket NOT allowed
		// without override; pkg-malformed, pkg-with-broken, pkg-see-license unparseable;
		// pkg-with-exception not allowed (composite literal not in list);
		// pkg-with-exception-or allowed via OR fallback to MIT.
		const violationNames = result.violations.map((v) => v.record.name).sort();
		expect(violationNames).toEqual(
			[
				'pkg-apache-spaced',
				'pkg-deprecated-only',
				'pkg-empty-license',
				'pkg-licenses-array',
				'pkg-malformed',
				'pkg-no-license',
				'pkg-object-license',
				'pkg-see-license',
				'pkg-with-broken',
				'pkg-with-exception'
			].sort()
		);

		// Verify reasons partition.
		const reasons = new Map<string, string>();
		for (const v of result.violations) {
			const r = v.reason;
			if (r.kind === 'license-not-in-allowlist') {
				reasons.set(v.record.name, r.detailCode ?? 'license-not-in-allowlist');
			} else {
				reasons.set(v.record.name, 'package-not-in-allowlist');
			}
		}
		expect(reasons.get('pkg-no-license')).toBe('package-not-in-allowlist');
		expect(reasons.get('pkg-empty-license')).toBe('package-not-in-allowlist');
		expect(reasons.get('pkg-object-license')).toBe('package-not-in-allowlist');
		expect(reasons.get('pkg-licenses-array')).toBe('package-not-in-allowlist');
		expect(reasons.get('pkg-deprecated-only')).toBe('package-not-in-allowlist');
		expect(reasons.get('pkg-apache-spaced')).toBe('literal-not-allowed-and-spdx-unparseable');
		expect(reasons.get('pkg-malformed')).toBe('literal-not-allowed-and-spdx-unparseable');
		expect(reasons.get('pkg-with-broken')).toBe('literal-not-allowed-and-spdx-unparseable');
		expect(reasons.get('pkg-see-license')).toBe('literal-not-allowed-and-spdx-unparseable');
		expect(reasons.get('pkg-with-exception')).toBe('spdx-expression-not-satisfied');
	});
});

describe('runCheck — JSON output', () => {
	it('writes JSON file before exit on violations', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\n'); // Apache-2.0 will fail
		const jsonPath = `${root}/report.json`;
		const result = await withCwd(root, () => runCheck({ jsonPath: 'report.json' }));
		expect(result.exitCode).toBe(1);
		expect(existsSync(jsonPath)).toBe(true);
		const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
		expect(parsed.counts.violations).toBeGreaterThan(0);
	});

	it('throws output-path-unwritable for unwritable JSON path', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		try {
			await withCwd(root, () => runCheck({ jsonPath: '/this/path/does/not/exist/x.json' }));
		} catch (err) {
			expect(err).toBeInstanceOf(LicenseGateConfigError);
			const e = err as LicenseGateConfigError;
			expect(e.detail.kind).toBe('output-path-unwritable');
			return;
		}
		throw new Error('expected throw');
	});
});

describe('runCheck — collect-all-then-exit', () => {
	it('collects every violation in one run before throwing', async () => {
		const root = await buildLicenseShapesFixture();
		await writeAllowedHard(root, 'MIT\n');
		const result = await withCwd(root, () => runCheck());
		expect(result.exitCode).toBe(1);
		// At least 6 different violations expected.
		expect(result.violations.length).toBeGreaterThanOrEqual(6);
	});
});

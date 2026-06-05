/**
 * Tests for the public/report path exposure rule:
 *
 * `InstalledPackageRecord.path` and every report path must be relative to
 * the selected project root with POSIX-style separators (`/`). The project
 * root itself is exposed as `"."`. Absolute local paths must never reach
 * human or JSON output — they leak usernames and machine-specific paths.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { runCheck } from '../../src/commands/check.js';
import { runCollect } from '../../src/commands/collect.js';
import { toExposedPath } from '../../src/graph/record.js';
import {
	buildHoistedWorkspaceFixture,
	buildNonHoistedConflictFixture,
	buildSinglePackageFixture,
	withCwd,
	writeAllowedHard
} from '../helpers/build-fixture.js';

describe('toExposedPath — pure helper', () => {
	it('renders the project root itself as "."', () => {
		expect(toExposedPath('/Users/me/repo', '/Users/me/repo')).toBe('.');
	});

	it('renders a root node_modules package relative to the project root', () => {
		expect(toExposedPath('/Users/me/repo/node_modules/foo', '/Users/me/repo')).toBe(
			'node_modules/foo'
		);
	});

	it('renders a workspace package relative to the project root', () => {
		expect(toExposedPath('/Users/me/repo/apps/web', '/Users/me/repo')).toBe('apps/web');
	});

	it('renders a nested workspace node_modules package relative to the project root', () => {
		expect(toExposedPath('/Users/me/repo/apps/web/node_modules/foo', '/Users/me/repo')).toBe(
			'apps/web/node_modules/foo'
		);
	});

	it('always uses POSIX-style "/" separators', () => {
		const out = toExposedPath('/Users/me/repo/apps/web/node_modules/foo', '/Users/me/repo');
		expect(out).not.toContain('\\');
		expect(out.split('/').length).toBeGreaterThan(1);
	});
});

describe('runCollect — record paths are relative to the project root', () => {
	it('exposes the project root as "." and root node_modules as relative paths', async () => {
		const root = await buildSinglePackageFixture();
		const result = await withCwd(root, () => runCollect());

		const projectRoot = result.records.find((r) => r.isProjectRoot);
		expect(projectRoot?.path).toBe('.');

		const fakeMit = result.records.find((r) => r.name === 'fake-mit');
		expect(fakeMit?.path).toBe('node_modules/fake-mit');
		const fakeApache = result.records.find((r) => r.name === 'fake-apache');
		expect(fakeApache?.path).toBe('node_modules/fake-apache');
	});

	it('exposes a workspace package relative to the project root', async () => {
		const root = await buildHoistedWorkspaceFixture();
		const result = await withCwd(root, () => runCollect());
		const ws = result.records.find((r) => r.name === '@probe/web');
		// Workspaces resolve through their on-disk path (apps/web), not the
		// node_modules symlink — that's already the rule for graph dedup.
		expect(ws?.path).toBe('apps/web');
	});

	it('exposes nested workspace node_modules paths relative to the project root', async () => {
		const root = await buildNonHoistedConflictFixture();
		const result = await withCwd(root, () => runCollect());
		const versions = result.records
			.filter((r) => r.name === 'fake-shared')
			.map((r) => ({ version: r.version, path: r.path }))
			.sort((a, b) => a.version.localeCompare(b.version));
		expect(versions).toEqual([
			{ version: '3.0.0', path: 'apps/web/node_modules/fake-shared' },
			{ version: '4.0.0', path: 'node_modules/fake-shared' }
		]);
	});

	it('exposed paths use POSIX-style "/" separators only', async () => {
		const root = await buildSinglePackageFixture();
		const result = await withCwd(root, () => runCollect());
		for (const r of result.records) {
			expect(r.path).not.toContain('\\');
		}
	});

	it('uses --cwd as the project root for relative paths', async () => {
		const root = await buildSinglePackageFixture();
		// Run from somewhere unrelated; --cwd selects the project root.
		const result = await runCollect({ cwd: root });
		const fakeMit = result.records.find((r) => r.name === 'fake-mit');
		expect(fakeMit?.path).toBe('node_modules/fake-mit');
		const projectRoot = result.records.find((r) => r.isProjectRoot);
		expect(projectRoot?.path).toBe('.');
	});

	it('human collect output never contains the absolute project root', async () => {
		const root = await buildSinglePackageFixture();
		const result = await withCwd(root, () => runCollect());
		expect(result.humanReport).not.toContain(root);
	});

	it('JSON collect output never contains the absolute project root', async () => {
		const root = await buildSinglePackageFixture();
		await withCwd(root, () => runCollect({ jsonPath: 'collected.json' }));
		const text = readFileSync(`${root}/collected.json`, 'utf8');
		expect(text).not.toContain(root);
		const parsed = JSON.parse(text) as { records: { path: string }[] };
		for (const r of parsed.records) {
			expect(r.path.startsWith('/')).toBe(false);
			expect(r.path).not.toContain('\\');
		}
	});
});

describe('runCheck — record paths are relative to the project root', () => {
	it('skippedProjectRoot.path is "." and decisions hold relative paths', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		const result = await withCwd(root, () => runCheck());
		expect(result.skippedProjectRoot?.path).toBe('.');
		const fakeMit = result.decisions.find((d) => d.record.name === 'fake-mit');
		expect(fakeMit?.record.path).toBe('node_modules/fake-mit');
	});

	it('human check output never contains the absolute project root', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\n'); // Apache-2.0 fails — violation includes a path line
		const result = await withCwd(root, () => runCheck());
		expect(result.humanReport).not.toContain(root);
		// And the violation entry shows the relative path.
		expect(result.humanReport).toContain('path: node_modules/fake-apache');
	});

	it('JSON check output never contains the absolute project root', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\n');
		await withCwd(root, () => runCheck({ jsonPath: 'report.json' }));
		const reportPath = `${root}/report.json`;
		expect(existsSync(reportPath)).toBe(true);
		const text = readFileSync(reportPath, 'utf8');
		expect(text).not.toContain(root);
		const parsed = JSON.parse(text) as {
			skippedProjectRoot: { path: string } | null;
			decisions: { record: { path: string } }[];
		};
		expect(parsed.skippedProjectRoot?.path).toBe('.');
		for (const d of parsed.decisions) {
			expect(d.record.path.startsWith('/')).toBe(false);
			expect(d.record.path).not.toContain('\\');
		}
	});

	it('uses --cwd as the project root for relative paths', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		const result = await runCheck({ cwd: root });
		expect(result.skippedProjectRoot?.path).toBe('.');
		const fakeMit = result.decisions.find((d) => d.record.name === 'fake-mit');
		expect(fakeMit?.record.path).toBe('node_modules/fake-mit');
	});
});

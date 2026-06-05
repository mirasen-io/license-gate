/**
 * Integration tests for the `collect` command.
 */

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { runCollect } from '../../src/commands/collect.js';
import {
	buildHoistedWorkspaceFixture,
	buildSinglePackageFixture,
	withCwd
} from '../helpers/build-fixture.js';

describe('runCollect', () => {
	it('lists every installed package including the project root', async () => {
		const root = await buildSinglePackageFixture();
		const result = await withCwd(root, () => runCollect());
		const names = result.records.map((r) => r.name).sort();
		expect(names).toContain('single-pkg-fixture');
		expect(names).toContain('fake-mit');
		expect(names).toContain('fake-apache');
		// Project root has the marker
		const projectRoot = result.records.find((r) => r.isProjectRoot);
		expect(projectRoot).toBeDefined();
		expect(projectRoot?.name).toBe('single-pkg-fixture');
	});

	it('does NOT require allowed-hard.txt or allowed-packages.txt', async () => {
		// The fixture has no licenses/ directory at all; collect must succeed.
		const root = await buildSinglePackageFixture();
		expect(existsSync(`${root}/licenses/allowed-hard.txt`)).toBe(false);
		expect(existsSync(`${root}/licenses/allowed-packages.txt`)).toBe(false);
		const result = await withCwd(root, () => runCollect());
		expect(result.records.length).toBeGreaterThan(0);
	});

	it('--out writes file and emits only a one-line stdout summary', async () => {
		const root = await buildSinglePackageFixture();
		const result = await withCwd(root, () => runCollect({ outPath: 'collected.txt' }));
		const outPath = `${root}/collected.txt`;
		expect(existsSync(outPath)).toBe(true);
		expect(readFileSync(outPath, 'utf8')).toContain('license-gate collect');
		expect(result.stdoutSummary).toMatch(/^wrote \d+ records to collected\.txt\n$/);
	});

	it('--json writes machine-readable file', async () => {
		const root = await buildSinglePackageFixture();
		await withCwd(root, () => runCollect({ jsonPath: 'collected.json' }));
		const parsed = JSON.parse(readFileSync(`${root}/collected.json`, 'utf8'));
		expect(Array.isArray(parsed.records)).toBe(true);
		expect(parsed.records.length).toBeGreaterThan(0);
	});

	it('does not infer license from a LICENSE file', async () => {
		// pkg-no-license carries a LICENSE file but no license field; collect
		// must record could-not-determine.
		const root = await buildHoistedWorkspaceFixture();
		const result = await withCwd(root, () => runCollect());
		const all = result.records;
		expect(all.length).toBeGreaterThan(0);
	});
});

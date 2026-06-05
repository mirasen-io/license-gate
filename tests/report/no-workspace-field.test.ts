/**
 * Tests for the negative invariant: the `workspace` field has been removed
 * from public records and reports.
 *
 * Background: an earlier draft of `InstalledPackageRecord` carried a
 * `workspace` field that meant "the closest workspace directory physically
 * containing this installed copy". In practice it was almost always `null`
 * (modern hoisting puts everything at the project root) and even when
 * non-null it described physical placement, not dependency ownership — which
 * is what users actually wanted to read. The relative `path` already
 * communicates physical placement, so the field was removed as a pre-1.0
 * report-schema cleanup.
 *
 * These tests pin the absence rule across:
 *   - collected JSON records (every record, including the project root)
 *   - check JSON decision records
 *   - rendered JSON strings (raw substring check, defends against accidental
 *     re-introduction via spread/Object.assign in any future refactor)
 *   - rendered human reports (no `[workspace: ...]` decoration)
 *
 * The non-hoisted conflict fixture is special-cased because it is the only
 * fixture where the old field could ever have been non-null.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { runCheck } from '../../src/commands/check.js';
import { runCollect } from '../../src/commands/collect.js';
import { renderCheckJson, renderCollectJson } from '../../src/report/json.js';
import {
	buildHoistedWorkspaceFixture,
	buildNonHoistedConflictFixture,
	buildSinglePackageFixture,
	withCwd,
	writeAllowedHard
} from '../helpers/build-fixture.js';

function hasWorkspaceKey(obj: object): boolean {
	return Object.prototype.hasOwnProperty.call(obj, 'workspace');
}

describe('record shape — `workspace` field is gone', () => {
	it('single-package fixture: no collected record carries `workspace`', async () => {
		const root = await buildSinglePackageFixture();
		const result = await withCwd(root, () => runCollect());
		expect(result.records.length).toBeGreaterThan(0);
		for (const r of result.records) {
			expect(hasWorkspaceKey(r)).toBe(false);
		}
	});

	it('hoisted-workspace fixture: no collected record carries `workspace`', async () => {
		const root = await buildHoistedWorkspaceFixture();
		const result = await withCwd(root, () => runCollect());
		expect(result.records.length).toBeGreaterThan(0);
		for (const r of result.records) {
			expect(hasWorkspaceKey(r)).toBe(false);
		}
	});

	it('non-hoisted conflict fixture: the workspace-local copy still has no `workspace` key, and `path` still exposes the placement', async () => {
		const root = await buildNonHoistedConflictFixture();
		const result = await withCwd(root, () => runCollect());

		const local = result.records.find((r) => r.name === 'fake-shared' && r.version === '3.0.0');
		expect(local).toBeDefined();
		expect(local!.path).toBe('apps/web/node_modules/fake-shared');
		expect(hasWorkspaceKey(local!)).toBe(false);

		// And the hoisted copy too, for completeness.
		const hoisted = result.records.find((r) => r.name === 'fake-shared' && r.version === '4.0.0');
		expect(hoisted).toBeDefined();
		expect(hoisted!.path).toBe('node_modules/fake-shared');
		expect(hasWorkspaceKey(hoisted!)).toBe(false);
	});

	it('check decisions: no decision record carries `workspace`', async () => {
		const root = await buildHoistedWorkspaceFixture();
		await writeAllowedHard(root, 'MIT\n');
		const result = await withCwd(root, () => runCheck());
		expect(result.decisions.length).toBeGreaterThan(0);
		for (const d of result.decisions) {
			expect(hasWorkspaceKey(d.record)).toBe(false);
		}
	});
});

describe('rendered reports — `workspace` is not emitted', () => {
	it('renderCheckJson output contains no "workspace" substring', async () => {
		const root = await buildHoistedWorkspaceFixture();
		await writeAllowedHard(root, 'MIT\n');
		const result = await withCwd(root, () => runCheck());
		const text = renderCheckJson({
			decisions: result.decisions,
			skippedProjectRoot: result.skippedProjectRoot
		});
		expect(text).not.toContain('"workspace"');
	});

	it('renderCollectJson output contains no "workspace" substring', async () => {
		const root = await buildNonHoistedConflictFixture();
		const result = await withCwd(root, () => runCollect());
		const text = renderCollectJson(result.records);
		expect(text).not.toContain('"workspace"');
	});

	it('check JSON file written to disk contains no "workspace" key', async () => {
		const root = await buildNonHoistedConflictFixture();
		// Only allow MIT so we definitely produce a violation (the workspace
		// itself is Apache-2.0); this exercises the violation path too.
		await writeAllowedHard(root, 'MIT\n');
		await withCwd(root, () => runCheck({ jsonPath: 'report.json' }));
		const text = readFileSync(`${root}/report.json`, 'utf8');
		expect(text).not.toContain('"workspace"');
	});

	it('human check report contains no `[workspace:` decoration even with --workspace narrowing', async () => {
		const root = await buildNonHoistedConflictFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		const full = await withCwd(root, () => runCheck());
		expect(full.humanReport).not.toContain('[workspace:');

		const narrowed = await withCwd(root, () => runCheck({ workspace: '@probe/web' }));
		expect(narrowed.humanReport).not.toContain('[workspace:');
	});

	it('human collect report contains no `[workspace:` decoration', async () => {
		const root = await buildNonHoistedConflictFixture();
		const result = await withCwd(root, () => runCollect());
		expect(result.humanReport).not.toContain('[workspace:');
	});
});

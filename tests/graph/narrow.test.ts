/**
 * Tests for `--workspace` narrowing.
 *
 * Verifies that:
 *   - hoisted deps reachable from the workspace ARE included in the
 *     evaluation set (we resolve via edgesOut, not realpath prefix);
 *   - resolution by name and by path both work;
 *   - --workspace on a non-workspace project errors with exit 2;
 *   - nonexistent workspace errors with exit 2.
 */

import { describe, expect, it } from 'vitest';

import { runCheck } from '../../src/commands/check.js';
import { LicenseGateConfigError } from '../../src/types.js';
import {
	buildHoistedWorkspaceFixture,
	buildSinglePackageFixture,
	withCwd,
	writeAllowedHard
} from '../helpers/build-fixture.js';

describe('runCheck --workspace narrowing', () => {
	it('narrows to a workspace by name and includes hoisted deps reachable from it', async () => {
		const root = await buildHoistedWorkspaceFixture();
		await writeAllowedHard(root, 'MIT\n');
		const result = await withCwd(root, () => runCheck({ workspace: '@probe/web' }));
		// Should be clean: workspace is MIT, fake-mit (hoisted) is MIT.
		expect(result.exitCode).toBe(0);
		const names = result.decisions.map((d) => d.record.name).sort();
		// Both the workspace itself and the hoisted dependency are in scope.
		expect(names).toContain('fake-mit');
	});

	it('narrows to a workspace by relative path', async () => {
		const root = await buildHoistedWorkspaceFixture();
		await writeAllowedHard(root, 'MIT\n');
		const result = await withCwd(root, () => runCheck({ workspace: './apps/web' }));
		expect(result.exitCode).toBe(0);
		const names = result.decisions.map((d) => d.record.name).sort();
		expect(names).toContain('fake-mit');
	});

	it('narrows to a workspace by absolute path', async () => {
		const root = await buildHoistedWorkspaceFixture();
		await writeAllowedHard(root, 'MIT\n');
		const result = await withCwd(root, () => runCheck({ workspace: `${root}/apps/web` }));
		expect(result.exitCode).toBe(0);
	});

	it('rejects --workspace on a non-workspace project (exit 2)', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\n');
		try {
			await withCwd(root, () => runCheck({ workspace: 'web' }));
		} catch (err) {
			expect(err).toBeInstanceOf(LicenseGateConfigError);
			const e = err as LicenseGateConfigError;
			expect(e.detail.kind).toBe('invalid-workspace');
			return;
		}
		throw new Error('expected runCheck to throw');
	});

	it('rejects nonexistent workspace (exit 2)', async () => {
		const root = await buildHoistedWorkspaceFixture();
		await writeAllowedHard(root, 'MIT\n');
		try {
			await withCwd(root, () => runCheck({ workspace: 'nonexistent' }));
		} catch (err) {
			expect(err).toBeInstanceOf(LicenseGateConfigError);
			const e = err as LicenseGateConfigError;
			expect(e.detail.kind).toBe('invalid-workspace');
			return;
		}
		throw new Error('expected runCheck to throw');
	});
});

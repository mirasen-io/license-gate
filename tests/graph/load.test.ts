import { describe, expect, it } from 'vitest';

import { loadInstalledGraph } from '../../src/graph/load.js';
import { LicenseGateConfigError } from '../../src/types.js';
import {
	buildHoistedWorkspaceFixture,
	buildNonHoistedConflictFixture,
	buildSinglePackageFixture,
	buildWorkspaceDepsWorkspaceFixture,
	newTmpRoot
} from '../helpers/build-fixture.js';

describe('graph/load — Arborist invocation rules', () => {
	it('throws missing-package-json when cwd has no package.json', async () => {
		const empty = await newTmpRoot('emptycwd');
		await expect(loadInstalledGraph(empty)).rejects.toThrow(LicenseGateConfigError);
		try {
			await loadInstalledGraph(empty);
		} catch (err) {
			const e = err as LicenseGateConfigError;
			expect(e.detail.kind).toBe('missing-package-json');
		}
	});

	it('throws missing-node-modules when node_modules is absent', async () => {
		// Build a fixture and then nuke its node_modules.
		const root = await buildSinglePackageFixture();
		const { rmSync } = await import('node:fs');
		rmSync(`${root}/node_modules`, { recursive: true, force: true });
		try {
			await loadInstalledGraph(root);
		} catch (err) {
			const e = err as LicenseGateConfigError;
			expect(e.detail.kind).toBe('missing-node-modules');
			return;
		}
		throw new Error('expected missing-node-modules');
	});

	it('treats process.cwd() as project root — no walk-up rescue', async () => {
		// Workspace project root with workspaces declared.
		const wsRoot = await buildHoistedWorkspaceFixture();
		// Give apps/web its own (empty) node_modules so it can be loaded as a
		// project root in its own right. The goal of this test is to verify
		// that license-gate does NOT walk up to the workspace root.
		const { mkdir } = await import('node:fs/promises');
		await mkdir(`${wsRoot}/apps/web/node_modules`, { recursive: true });
		const subTree = (await loadInstalledGraph(`${wsRoot}/apps/web`)) as {
			realpath: string;
		};
		// The Arborist root should be the subdir, not the workspace root.
		expect(subTree.realpath.endsWith('/apps/web')).toBe(true);
	});

	it('inventory captures non-hoisted version conflicts', async () => {
		const root = await buildNonHoistedConflictFixture();
		const tree = (await loadInstalledGraph(root)) as {
			inventory: Map<string, { name: string; version?: string; realpath: string }>;
		};
		const sharedCopies = Array.from(tree.inventory.values()).filter(
			(n) => n.name === 'fake-shared'
		);
		const versions = sharedCopies.map((n) => n.version).sort();
		expect(versions).toEqual(['3.0.0', '4.0.0']);
		// And distinct realpaths:
		const paths = new Set(sharedCopies.map((n) => n.realpath));
		expect(paths.size).toBe(2);
	});

	it('workspace declarations are visible via tree.workspaces', async () => {
		const root = await buildHoistedWorkspaceFixture();
		const tree = (await loadInstalledGraph(root)) as {
			workspaces?: Map<string, string>;
		};
		expect(tree.workspaces?.size).toBeGreaterThanOrEqual(1);
		expect(Array.from(tree.workspaces?.keys() ?? [])).toContain('@probe/web');
	});

	it('workspace-deps-workspace fixture exposes both workspaces in tree.workspaces', async () => {
		const root = await buildWorkspaceDepsWorkspaceFixture();
		const tree = (await loadInstalledGraph(root)) as {
			workspaces?: Map<string, string>;
		};
		const wsNames = Array.from(tree.workspaces?.keys() ?? []).sort();
		expect(wsNames).toEqual(['@probe/api', '@probe/utils']);
	});
});

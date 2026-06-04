/**
 * Graph layer — owns filesystem and Arborist concerns.
 * Knows nothing about policy.
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import Arborist from '@npmcli/arborist';

import { LicenseGateConfigError } from '../types.js';

/**
 * Load the installed dependency graph from the **selected project root**.
 * The selected project root is whatever the caller passes in (typically
 * `--cwd <path>` from the CLI, or the `cwd` option in the programmatic API);
 * when omitted it defaults to `process.cwd()`. license-gate never walks
 * upward to rescue a wrong working directory — `package.json` must exist
 * directly at the selected project root, otherwise `LicenseGateConfigError`.
 *
 * Returns the Arborist `tree` (the root Node). Iterate `tree.inventory.values()`
 * for the flat list of unique installed copies.
 */
export async function loadInstalledGraph(cwd: string = process.cwd()): Promise<ArboristNode> {
	const pkgJsonPath = resolve(cwd, 'package.json');
	if (!existsSync(pkgJsonPath)) {
		throw new LicenseGateConfigError(
			{ kind: 'missing-package-json', cwd },
			`license-gate: no package.json at the selected project root ${cwd}. license-gate never walks upward — pass --cwd <path> to point at a different project root, or run from the npm project root directly.`
		);
	}

	const nodeModulesPath = resolve(cwd, 'node_modules');
	if (!existsSync(nodeModulesPath)) {
		throw new LicenseGateConfigError(
			{ kind: 'missing-node-modules', cwd },
			`license-gate: no node_modules at the selected project root ${cwd}. Install dependencies first (e.g. \`npm ci\`).`
		);
	}

	// Canonicalise the cwd before handing it to Arborist so that subsequent
	// realpath comparisons (workspace path matching, dedup) line up. Arborist
	// itself returns canonicalised realpaths internally.
	const canonical = realpathSync(cwd);

	const arb = new Arborist({ path: canonical });
	const tree = (await arb.loadActual()) as ArboristNode;
	return tree;
}

/**
 * A loose structural type covering the parts of an Arborist Node we read.
 * Arborist exposes `Node` and `Link` classes with many runtime fields; the
 * shape below is enough for our needs and lets us avoid pulling Arborist's
 * internal types into the public API surface.
 */
export type ArboristNode = {
	name: string;
	version?: string;
	location: string;
	path: string;
	realpath: string;
	isRoot: boolean;
	isWorkspace: boolean;
	isLink: boolean;
	package: ArboristPackageJson;
	children: Map<string, ArboristNode>;
	edgesOut: Map<string, ArboristEdge>;
	target?: ArboristNode;
	inventory: Map<string, ArboristNode> & { values(): IterableIterator<ArboristNode> };
	workspaces?: Map<string, string>;
};

export type ArboristPackageJson = {
	name?: string;
	version?: string;
	license?: unknown;
	licenses?: unknown;
	repository?: unknown;
	author?: unknown;
};

export type ArboristEdge = {
	name: string;
	type: string;
	to?: ArboristNode | null;
};

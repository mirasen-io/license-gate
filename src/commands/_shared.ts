/**
 * Shared command-layer helpers: building records from the loaded tree,
 * computing the evaluation set, writing output files, etc.
 */

import { existsSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { loadInstalledGraph, type ArboristNode } from '../graph/load.js';
import { narrowToWorkspace } from '../graph/narrow.js';
import { nodeToRecord } from '../graph/record.js';
import {
	LicenseGateConfigError,
	type CollectedRecord,
	type InstalledPackageRecord
} from '../types.js';

export type ResolvedScope = {
	tree: ArboristNode;
	/** Records to evaluate (root excluded when full project mode). */
	evaluationRecords: InstalledPackageRecord[];
	/** All records including the project root (for collect output). */
	allCollectedRecords: CollectedRecord[];
	skippedProjectRoot: InstalledPackageRecord | null;
};

type WorkspaceInfo = { name: string; realpath: string };

function canonical(p: string): string {
	try {
		return existsSync(p) ? realpathSync(p) : p;
	} catch {
		return p;
	}
}

/** Build a record from an Arborist node, computing the closest containing
 *  workspace name. We use `tree.workspaces` as the authoritative source for
 *  declared workspaces — that map is reliably populated whenever the project
 *  declares `workspaces` in package.json, regardless of whether Arborist
 *  ended up tagging individual nodes as `isWorkspace`. */
function findContainingWorkspace(node: ArboristNode, workspaces: WorkspaceInfo[]): string | null {
	if (node.isRoot) return null;
	const real = node.realpath;
	let best: WorkspaceInfo | null = null;
	for (const ws of workspaces) {
		if (real === ws.realpath) {
			// node IS the workspace itself — record `workspace: null` because
			// `workspace` describes containment (a transitive dep installed
			// under the workspace), not identity.
			return null;
		}
		if (real.startsWith(ws.realpath + '/')) {
			if (!best || ws.realpath.length > best.realpath.length) best = ws;
		}
	}
	return best?.name ?? null;
}

/** Resolve the scope for a command, given options. */
export async function resolveScope(opts: {
	cwd: string;
	workspace: string | null;
}): Promise<ResolvedScope> {
	const tree = await loadInstalledGraph(opts.cwd);

	const workspaceList: WorkspaceInfo[] = [];
	if (tree.workspaces) {
		for (const [name, p] of tree.workspaces.entries()) {
			workspaceList.push({ name, realpath: canonical(p) });
		}
	}

	const allInventory: ArboristNode[] = Array.from(tree.inventory.values());

	let evaluationNodes: ArboristNode[];
	let skippedProjectRoot: InstalledPackageRecord | null = null;

	if (opts.workspace) {
		const { evaluationSet } = narrowToWorkspace(tree, opts.workspace, opts.cwd);
		evaluationNodes = evaluationSet;
	} else {
		// Full project: skip the root, evaluate everything else.
		evaluationNodes = [];
		for (const node of allInventory) {
			if (node.isRoot) {
				skippedProjectRoot = nodeToRecord(node, null);
				continue;
			}
			evaluationNodes.push(node);
		}
	}

	// Deduplicate by realpath (in case BFS visits links + targets).
	const seen = new Set<string>();
	const dedupedEvaluation: ArboristNode[] = [];
	for (const n of evaluationNodes) {
		const target = n.isLink && n.target ? n.target : n;
		if (target.isRoot && !opts.workspace) continue;
		if (seen.has(target.realpath)) continue;
		seen.add(target.realpath);
		dedupedEvaluation.push(target);
	}

	const evaluationRecords = dedupedEvaluation.map((n) =>
		nodeToRecord(n, findContainingWorkspace(n, workspaceList))
	);

	// All collected records (for collect output): include the project root too.
	const collectedSeen = new Set<string>();
	const allCollectedRecords: CollectedRecord[] = [];
	if (!opts.workspace) {
		for (const node of allInventory) {
			if (node.isRoot) {
				const rec = nodeToRecord(node, null);
				allCollectedRecords.push({ ...rec, isProjectRoot: true });
				collectedSeen.add(node.realpath);
			}
		}
	}
	for (const r of evaluationRecords) {
		if (collectedSeen.has(r.path)) continue;
		collectedSeen.add(r.path);
		allCollectedRecords.push(r);
	}

	return {
		tree,
		evaluationRecords,
		allCollectedRecords,
		skippedProjectRoot
	};
}

/** Write a string to a path, raising LicenseGateConfigError on failure. */
export async function writeOutputFile(path: string, contents: string, cwd: string): Promise<void> {
	const absolute = resolve(cwd, path);
	try {
		await writeFile(absolute, contents, 'utf8');
	} catch (err) {
		const cause = err instanceof Error ? err.message : String(err);
		throw new LicenseGateConfigError(
			{ kind: 'output-path-unwritable', path: absolute, cause },
			`license-gate: could not write to ${absolute}: ${cause}`
		);
	}
}

/** Resolve fixed allowlist paths relative to cwd. */
export function resolveAllowlistPaths(cwd: string): {
	allowedHard: string;
	allowedPackages: string;
} {
	return {
		allowedHard: resolve(cwd, 'licenses', 'allowed-hard.txt'),
		allowedPackages: resolve(cwd, 'licenses', 'allowed-packages.txt')
	};
}

export function fileExists(path: string): boolean {
	return existsSync(path);
}

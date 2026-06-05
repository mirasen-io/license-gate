/**
 * Build a resolved evaluation scope from the installed graph. This module owns
 * the BFS/dedup/workspace-containment logic that touches Arborist Node fields,
 * so callers in `commands/` only see project-owned `InstalledPackageRecord`
 * values — Arborist types do not leak past this boundary.
 */

import { existsSync, realpathSync } from 'node:fs';
import type Arborist from '@npmcli/arborist';

import type { CollectedRecord, InstalledPackageRecord } from '../types.js';
import { loadInstalledGraph } from './load.js';
import { narrowToWorkspace } from './narrow.js';
import { nodeToRecord } from './record.js';

export type ResolvedScope = {
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

/** Compute the closest containing workspace for a node. We use
 *  `tree.workspaces` as the authoritative source for declared workspaces —
 *  that map is reliably populated whenever the project declares `workspaces`
 *  in package.json, regardless of whether Arborist ended up tagging
 *  individual nodes as `isWorkspace`. */
function findContainingWorkspace(node: Arborist.Node, workspaces: WorkspaceInfo[]): string | null {
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

/** Resolve the scope for a command: load the graph, optionally narrow to a
 *  workspace, and return project-owned records (no Arborist values escape).
 *  All exposed `record.path` values are relative to the selected project root
 *  (`opts.cwd`, canonicalised) — see `toExposedPath`. */
export async function resolveScope(opts: {
	cwd: string;
	workspace: string | null;
}): Promise<ResolvedScope> {
	const tree = await loadInstalledGraph(opts.cwd);

	// Canonicalise the selected project root once so it lines up with
	// Arborist's realpaths (which are themselves canonicalised). This is the
	// base for every exposed relative path.
	const projectRoot = canonical(opts.cwd);

	const workspaceList: WorkspaceInfo[] = [];
	if (tree.workspaces) {
		for (const [name, p] of tree.workspaces.entries()) {
			workspaceList.push({ name, realpath: canonical(p) });
		}
	}

	const allInventory: Arborist.Node[] = Array.from(tree.inventory.values());

	let evaluationNodes: Arborist.Node[];
	let skippedProjectRoot: InstalledPackageRecord | null = null;

	if (opts.workspace) {
		const { evaluationSet } = narrowToWorkspace(tree, opts.workspace, opts.cwd);
		evaluationNodes = evaluationSet;
	} else {
		// Full project: skip the root, evaluate everything else.
		evaluationNodes = [];
		for (const node of allInventory) {
			if (node.isRoot) {
				skippedProjectRoot = nodeToRecord(node, null, projectRoot);
				continue;
			}
			evaluationNodes.push(node);
		}
	}

	// Deduplicate by realpath (in case BFS visits links + targets).
	// Narrowing gap: DefinitelyTyped types `target` on the base Node, but it
	// is only meaningful when `isLink === true`.
	const seen = new Set<string>();
	const dedupedEvaluation: Arborist.Node[] = [];
	for (const n of evaluationNodes) {
		const target = n.isLink && n.target ? n.target : n;
		if (target.isRoot && !opts.workspace) continue;
		if (seen.has(target.realpath)) continue;
		seen.add(target.realpath);
		dedupedEvaluation.push(target);
	}

	const evaluationRecords = dedupedEvaluation.map((n) =>
		nodeToRecord(n, findContainingWorkspace(n, workspaceList), projectRoot)
	);

	// All collected records (for collect output): include the project root too.
	// Dedup by realpath here too — `record.path` is now relative and would
	// collide for legitimately-distinct copies hoisted in different scopes.
	const collectedSeen = new Set<string>();
	const allCollectedRecords: CollectedRecord[] = [];
	if (!opts.workspace) {
		for (const node of allInventory) {
			if (node.isRoot) {
				const rec = nodeToRecord(node, null, projectRoot);
				allCollectedRecords.push({ ...rec, isProjectRoot: true });
				collectedSeen.add(node.realpath);
			}
		}
	}
	for (let i = 0; i < dedupedEvaluation.length; i++) {
		const realpath = dedupedEvaluation[i]!.realpath;
		if (collectedSeen.has(realpath)) continue;
		collectedSeen.add(realpath);
		allCollectedRecords.push(evaluationRecords[i]!);
	}

	return {
		evaluationRecords,
		allCollectedRecords,
		skippedProjectRoot
	};
}

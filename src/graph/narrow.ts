/**
 * Workspace narrowing.
 *
 * `--workspace` always operates on a tree already loaded from the selected
 * project root (`--cwd <path>` if provided, otherwise `process.cwd()`). We
 * never re-invoke Arborist with a workspace path. Given the loaded tree, we
 * resolve the workspace node by name (via `tree.workspaces`) or by path
 * (relative paths resolved against the selected project root, then matched
 * to `node.path`/`node.realpath`), and narrow the evaluation set to the
 * workspace plus everything reachable via `node.edgesOut → edge.to`,
 * deduped by realpath.
 *
 * We deliberately do NOT prefix-filter by realpath, because hoisted
 * dependencies live under the project root and would be missed.
 */

import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type Arborist from '@npmcli/arborist';

import { LicenseGateConfigError } from '../types.js';

/** Result of resolving a workspace within the loaded tree, plus the narrowed
 *  evaluation set (workspace node + reachable deps, deduplicated by realpath). */
export type NarrowedTree = {
	workspaceNode: Arborist.Node;
	evaluationSet: Arborist.Node[];
};

/** Walk through a Link to its target Node; non-link nodes pass through.
 *  Narrowing gap: DefinitelyTyped types `target` on the base `Node` class as
 *  required, but it is only meaningful when `isLink === true`. */
function followLink(node: Arborist.Node | Arborist.Link): Arborist.Node {
	return node.isLink && node.target ? node.target : node;
}

function canonical(p: string): string {
	try {
		return existsSync(p) ? realpathSync(p) : p;
	} catch {
		return p;
	}
}

/** Find a workspace node in the loaded tree.
 *  Authoritative source: `tree.workspaces` Map<name, absolutePath>. We then
 *  match the chosen path back to a Node either via inventory realpath or by
 *  walking children. */
function resolveWorkspaceNode(tree: Arborist.Node, query: string, cwd: string): Arborist.Node {
	const workspacesMap = tree.workspaces;
	if (!workspacesMap || workspacesMap.size === 0) {
		throw new LicenseGateConfigError(
			{
				kind: 'invalid-workspace',
				query,
				reason: 'project does not declare npm workspaces'
			},
			`license-gate: --workspace was used but the project at ${cwd} does not declare any workspaces in package.json.`
		);
	}

	// Build `name -> canonical path` for matching.
	const byName = new Map<string, string>();
	for (const [name, path] of workspacesMap.entries()) {
		byName.set(name, canonical(path));
	}

	// Resolve query → target absolute (canonical) path.
	let targetPath: string | undefined;
	if (byName.has(query)) {
		targetPath = byName.get(query);
	} else {
		const cwdCanon = canonical(cwd);
		const queryAbs = canonical(isAbsolute(query) ? query : resolve(cwdCanon, query));
		for (const [, p] of byName.entries()) {
			if (p === queryAbs) {
				targetPath = p;
				break;
			}
		}
	}

	if (!targetPath) {
		throw new LicenseGateConfigError(
			{
				kind: 'invalid-workspace',
				query,
				reason: 'workspace not found by name or path'
			},
			`license-gate: workspace "${query}" was not found in the project at ${cwd}.`
		);
	}

	// Find the matching Node — first try inventory; fall back to children.
	for (const node of tree.inventory.values()) {
		if (node.realpath === targetPath) return node;
	}
	for (const child of tree.children.values()) {
		const target = followLink(child);
		if (target.realpath === targetPath) return target;
	}

	throw new LicenseGateConfigError(
		{
			kind: 'invalid-workspace',
			query,
			reason: 'workspace path resolved but no matching tree node found'
		},
		`license-gate: workspace "${query}" resolves to ${targetPath} but no installed node matches.`
	);
}

/** BFS from a workspace node along edgesOut, collecting reachable nodes
 *  (deduplicated by realpath). */
function reachableFrom(start: Arborist.Node): Arborist.Node[] {
	const seen = new Map<string, Arborist.Node>();
	const queue: Arborist.Node[] = [start];
	while (queue.length > 0) {
		const node = queue.shift()!;
		const target = followLink(node);
		if (seen.has(target.realpath)) continue;
		seen.set(target.realpath, target);
		if (target.edgesOut) {
			for (const edge of target.edgesOut.values()) {
				if (edge.to) queue.push(edge.to);
			}
		}
	}
	return Array.from(seen.values());
}

/** Narrow the loaded tree to one workspace + its reachable graph. */
export function narrowToWorkspace(tree: Arborist.Node, query: string, cwd: string): NarrowedTree {
	const workspaceNode = resolveWorkspaceNode(tree, query, cwd);
	const evaluationSet = reachableFrom(workspaceNode);
	return { workspaceNode, evaluationSet };
}

/**
 * Shared command-layer helpers: writing output files, resolving allowlist
 * paths, and re-exporting the project-owned scope resolver.
 *
 * Arborist types live in the graph layer; this module never sees them.
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { resolveScope, type ResolvedScope } from '../graph/scope.js';
import { LicenseGateConfigError } from '../types.js';

export { resolveScope };
export type { ResolvedScope };

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

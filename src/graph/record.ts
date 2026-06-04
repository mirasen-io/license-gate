/**
 * Map an Arborist Node to a flat InstalledPackageRecord.
 * Pure: no fs reads, no Arborist methods called here beyond field access.
 */

import {
	LICENSE_COULD_NOT_DETERMINE,
	type InstalledPackageRecord,
	type LicenseCouldNotDetermine
} from '../types.js';
import type { ArboristNode, ArboristPackageJson } from './load.js';

/** Detect the license string from a package.json. v1 is non-inferential:
 *  only a non-empty trimmed string in `license` is accepted; everything else
 *  (missing, empty, object, array) maps to the sentinel. */
export function detectLicense(
	pkg: ArboristPackageJson | undefined
): string | LicenseCouldNotDetermine {
	if (!pkg) return LICENSE_COULD_NOT_DETERMINE;
	const raw = (pkg as { license?: unknown }).license;
	if (typeof raw !== 'string') return LICENSE_COULD_NOT_DETERMINE;
	const trimmed = raw.trim();
	if (trimmed.length === 0) return LICENSE_COULD_NOT_DETERMINE;
	return trimmed;
}

/** Extract a repository URL string when it is directly available without
 *  inference. `repository` may be a string or `{type, url}`; we keep the URL
 *  as-is when present, but never derive one from anywhere else. */
function extractRepository(pkg: ArboristPackageJson | undefined): string | undefined {
	if (!pkg) return undefined;
	const repo = (pkg as { repository?: unknown }).repository;
	if (typeof repo === 'string') return repo;
	if (repo && typeof repo === 'object' && 'url' in repo) {
		const url = (repo as { url?: unknown }).url;
		if (typeof url === 'string') return url;
	}
	return undefined;
}

function extractAuthor(pkg: ArboristPackageJson | undefined): {
	publisher?: string;
	email?: string;
} {
	if (!pkg) return {};
	const author = (pkg as { author?: unknown }).author;
	if (typeof author === 'string') {
		// "Name <email@x>" form — only split when both parts are clearly present;
		// otherwise treat as publisher only.
		const match = /^(.*?)\s*<([^>]+)>\s*$/.exec(author);
		if (match) return { publisher: match[1].trim() || undefined, email: match[2].trim() };
		return { publisher: author };
	}
	if (author && typeof author === 'object') {
		const obj = author as { name?: unknown; email?: unknown };
		const publisher = typeof obj.name === 'string' ? obj.name : undefined;
		const email = typeof obj.email === 'string' ? obj.email : undefined;
		return { publisher, email };
	}
	return {};
}

/** Build an InstalledPackageRecord from an Arborist Node. The `workspace`
 *  field is the closest containing workspace name, computed by the caller
 *  when the project tree is in scope. */
export function nodeToRecord(node: ArboristNode, workspace: string | null): InstalledPackageRecord {
	const pkg = node.package ?? {};
	const name = (pkg.name as string | undefined) ?? node.name ?? '';
	const version = (pkg.version as string | undefined) ?? node.version ?? '';
	const license = detectLicense(pkg);
	const repository = extractRepository(pkg);
	const { publisher, email } = extractAuthor(pkg);

	return {
		name,
		version,
		packageId: `${name}@${version}`,
		path: node.realpath,
		workspace,
		license,
		repository,
		publisher,
		email
	};
}

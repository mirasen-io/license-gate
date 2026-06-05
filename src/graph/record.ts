/**
 * Map an Arborist Node to a flat InstalledPackageRecord.
 * Pure: no fs reads, no Arborist methods called here beyond field access.
 */

import { relative, sep } from 'node:path';
import type Arborist from '@npmcli/arborist';

import {
	LICENSE_COULD_NOT_DETERMINE,
	type InstalledPackageRecord,
	type LicenseCouldNotDetermine
} from '../types.js';

/** Narrowing gap: DefinitelyTyped types `Node.package` as the broad
 *  `PackageJson` shape from `@npm/types`; we narrow to the four fields we
 *  actually read (license, repository, author, plus name/version fall-through). */
type ArboristPackageJson = {
	name?: string;
	version?: string;
	license?: unknown;
	licenses?: unknown;
	repository?: unknown;
	author?: unknown;
};

/** Read the package manifest off a Node, narrowed to our four fields. */
function manifestOf(node: Arborist.Node): ArboristPackageJson | undefined {
	// Cast bridges the broad DefinitelyTyped manifest to our narrow shape.
	return node.package as ArboristPackageJson | undefined;
}

/**
 * Convert an absolute filesystem path into the path we expose in public
 * records and reports: relative to the selected project root, POSIX-style
 * separators, and `"."` when the path equals the project root.
 *
 * Centralised here so reporters and the public API never see absolute local
 * paths — those would leak `/Users/<name>/...` style strings into JSON
 * artifacts, CI logs, and collected reports.
 */
export function toExposedPath(absolutePath: string, projectRoot: string): string {
	const rel = relative(projectRoot, absolutePath);
	if (rel === '' || rel === '.') return '.';
	// Normalise platform separators to POSIX `/` for stable cross-platform output.
	return sep === '/' ? rel : rel.split(sep).join('/');
}

/** Detect the license string from a package.json. v1 is non-inferential:
 *  only a non-empty trimmed string in `license` is accepted; everything else
 *  (missing, empty, object, array) maps to the sentinel. */
export function detectLicense(
	pkg: ArboristPackageJson | undefined
): string | LicenseCouldNotDetermine {
	if (!pkg) return LICENSE_COULD_NOT_DETERMINE;
	const raw = pkg.license;
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
	const repo = pkg.repository;
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

	const author = pkg.author;

	if (typeof author === 'string') {
		return parseAuthorString(author);
	}

	if (author && typeof author === 'object') {
		const obj = author as { name?: unknown; email?: unknown };
		const publisher = typeof obj.name === 'string' ? obj.name : undefined;
		const email = typeof obj.email === 'string' ? obj.email : undefined;
		return { publisher, email };
	}

	return {};
}

function parseAuthorString(author: string): {
	publisher?: string;
	email?: string;
} {
	const trimmed = author.trim();

	if (!trimmed.endsWith('>')) {
		return { publisher: trimmed || undefined };
	}

	const openIndex = trimmed.lastIndexOf('<');

	// Require both parts to be clearly present: "Name <email@x>".
	if (openIndex <= 0) {
		return { publisher: trimmed || undefined };
	}

	const publisher = trimmed.slice(0, openIndex).trim();
	const email = trimmed.slice(openIndex + 1, -1).trim();

	if (!publisher || !email) {
		return { publisher: trimmed || undefined };
	}

	return { publisher, email };
}

/** Build an InstalledPackageRecord from an Arborist Node.
 *
 *  `projectRoot` is the selected project root (canonicalised) and is used
 *  to convert the node's absolute realpath to the relative POSIX-style path
 *  that the record exposes. */
export function nodeToRecord(node: Arborist.Node, projectRoot: string): InstalledPackageRecord {
	const pkg = manifestOf(node);
	const name = pkg?.name ?? node.name ?? '';
	const version = pkg?.version ?? node.version ?? '';
	const license = detectLicense(pkg);
	const repository = extractRepository(pkg);
	const { publisher, email } = extractAuthor(pkg);

	return {
		name,
		version,
		packageId: `${name}@${version}`,
		path: toExposedPath(node.realpath, projectRoot),
		license,
		repository,
		publisher,
		email
	};
}

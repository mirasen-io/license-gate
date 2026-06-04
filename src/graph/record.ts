/**
 * Map an Arborist Node to a flat InstalledPackageRecord.
 * Pure: no fs reads, no Arborist methods called here beyond field access.
 */

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

/** Build an InstalledPackageRecord from an Arborist Node. The `workspace`
 *  field is the closest containing workspace name, computed by the caller
 *  when the project tree is in scope. */
export function nodeToRecord(
	node: Arborist.Node,
	workspace: string | null
): InstalledPackageRecord {
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
		path: node.realpath,
		workspace,
		license,
		repository,
		publisher,
		email
	};
}

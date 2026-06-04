/**
 * Programmatic fixture builders.
 *
 * Each function builds a complete on-disk fixture in a fresh tmpdir and
 * returns its path. Fixtures are constructed by writing package.json files
 * directly — we never call `npm install`, which keeps tests offline,
 * deterministic, and fast.
 *
 * Arborist.loadActual() reads physical node_modules from disk, so as long
 * as the directory layout is correct (real package.json files at the right
 * paths and real symlinks for workspaces), Arborist treats the result as
 * a normal installation.
 */

import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type PkgJson = Record<string, unknown> & {
	name: string;
	version: string;
};

async function writePkg(dir: string, pkg: PkgJson): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n', 'utf8');
}

async function emptyNodeModules(rootDir: string): Promise<void> {
	await mkdir(join(rootDir, 'node_modules'), { recursive: true });
}

export async function newTmpRoot(label: string): Promise<string> {
	return mkdtemp(join(tmpdir(), `lg-${label}-`));
}

/** Single-package project with two MIT deps. */
export async function buildSinglePackageFixture(): Promise<string> {
	const root = await newTmpRoot('single');
	await writePkg(root, {
		name: 'single-pkg-fixture',
		version: '0.0.0',
		license: 'MIT',
		dependencies: { 'fake-mit': '1.0.0', 'fake-apache': '2.0.0' }
	});
	await emptyNodeModules(root);
	await writePkg(join(root, 'node_modules', 'fake-mit'), {
		name: 'fake-mit',
		version: '1.0.0',
		license: 'MIT'
	});
	await writePkg(join(root, 'node_modules', 'fake-apache'), {
		name: 'fake-apache',
		version: '2.0.0',
		license: 'Apache-2.0'
	});
	return root;
}

/** Workspace project with all deps hoisted at root. */
export async function buildHoistedWorkspaceFixture(): Promise<string> {
	const root = await newTmpRoot('hoisted');
	await writePkg(root, {
		name: 'hoisted-workspace-fixture',
		version: '0.0.0',
		license: 'MIT',
		workspaces: ['apps/*']
	});
	await emptyNodeModules(root);
	await writePkg(join(root, 'apps', 'web'), {
		name: '@probe/web',
		version: '0.0.0',
		license: 'MIT',
		dependencies: { 'fake-mit': '1.0.0' }
	});
	await writePkg(join(root, 'node_modules', 'fake-mit'), {
		name: 'fake-mit',
		version: '1.0.0',
		license: 'MIT'
	});
	// workspace symlink in root node_modules
	await mkdir(join(root, 'node_modules', '@probe'), { recursive: true });
	await symlink('../../apps/web', join(root, 'node_modules', '@probe', 'web'));
	return root;
}

/** Workspace project with a non-hoisted version conflict. */
export async function buildNonHoistedConflictFixture(): Promise<string> {
	const root = await newTmpRoot('nonhoisted');
	await writePkg(root, {
		name: 'nonhoisted-fixture',
		version: '0.0.0',
		license: 'MIT',
		workspaces: ['apps/*'],
		dependencies: { 'fake-shared': '4.0.0' }
	});
	await emptyNodeModules(root);
	// Root-level fake-shared@4
	await writePkg(join(root, 'node_modules', 'fake-shared'), {
		name: 'fake-shared',
		version: '4.0.0',
		license: 'MIT'
	});
	// Workspace
	await writePkg(join(root, 'apps', 'web'), {
		name: '@probe/web',
		version: '0.0.0',
		license: 'Apache-2.0',
		dependencies: { 'fake-shared': '3.0.0' }
	});
	// Non-hoisted older copy local to the workspace
	await writePkg(join(root, 'apps', 'web', 'node_modules', 'fake-shared'), {
		name: 'fake-shared',
		version: '3.0.0',
		license: 'MIT'
	});
	// Workspace symlink
	await mkdir(join(root, 'node_modules', '@probe'), { recursive: true });
	await symlink('../../apps/web', join(root, 'node_modules', '@probe', 'web'));
	return root;
}

/** Workspace depending on another workspace. */
export async function buildWorkspaceDepsWorkspaceFixture(): Promise<string> {
	const root = await newTmpRoot('wsdepsws');
	await writePkg(root, {
		name: 'ws-deps-ws-fixture',
		version: '0.0.0',
		license: 'MIT',
		workspaces: ['apps/*', 'packages/*']
	});
	await emptyNodeModules(root);
	await writePkg(join(root, 'apps', 'api'), {
		name: '@probe/api',
		version: '0.0.0',
		license: 'MIT',
		dependencies: { '@probe/utils': '0.0.0' }
	});
	await writePkg(join(root, 'packages', 'utils'), {
		name: '@probe/utils',
		version: '0.0.0',
		license: '(MIT OR Apache-2.0)'
	});
	await mkdir(join(root, 'node_modules', '@probe'), { recursive: true });
	await symlink('../../apps/api', join(root, 'node_modules', '@probe', 'api'));
	await symlink('../../packages/utils', join(root, 'node_modules', '@probe', 'utils'));
	return root;
}

/** Project with deps exercising the full license-shape matrix. */
export async function buildLicenseShapesFixture(): Promise<string> {
	const root = await newTmpRoot('shapes');
	await writePkg(root, {
		name: 'shapes-fixture',
		version: '0.0.0',
		license: 'MIT',
		dependencies: {
			'pkg-mit': '1.0.0',
			'pkg-apache-spaced': '1.0.0',
			'pkg-or': '1.0.0',
			'pkg-and': '1.0.0',
			'pkg-paren': '1.0.0',
			'pkg-malformed': '1.0.0',
			'pkg-with-exception': '1.0.0',
			'pkg-with-exception-or': '1.0.0',
			'pkg-with-broken': '1.0.0',
			'pkg-see-license': '1.0.0',
			'pkg-unlicensed': '1.0.0',
			'pkg-empty-license': '1.0.0',
			'pkg-no-license': '1.0.0',
			'pkg-object-license': '1.0.0',
			'pkg-licenses-array': '1.0.0',
			'pkg-deprecated-only': '1.0.0'
		}
	});
	await emptyNodeModules(root);
	const nm = (n: string) => join(root, 'node_modules', n);
	await writePkg(nm('pkg-mit'), { name: 'pkg-mit', version: '1.0.0', license: 'MIT' });
	await writePkg(nm('pkg-apache-spaced'), {
		name: 'pkg-apache-spaced',
		version: '1.0.0',
		license: 'Apache 2.0'
	});
	await writePkg(nm('pkg-or'), {
		name: 'pkg-or',
		version: '1.0.0',
		license: '(MIT OR Apache-2.0)'
	});
	await writePkg(nm('pkg-and'), {
		name: 'pkg-and',
		version: '1.0.0',
		license: '(MIT AND BSD-3-Clause)'
	});
	await writePkg(nm('pkg-paren'), {
		name: 'pkg-paren',
		version: '1.0.0',
		license: '(MIT OR Apache-2.0)'
	});
	await writePkg(nm('pkg-malformed'), {
		name: 'pkg-malformed',
		version: '1.0.0',
		license: 'MIT OR'
	});
	await writePkg(nm('pkg-with-exception'), {
		name: 'pkg-with-exception',
		version: '1.0.0',
		license: 'GPL-2.0-only WITH Classpath-exception-2.0'
	});
	await writePkg(nm('pkg-with-exception-or'), {
		name: 'pkg-with-exception-or',
		version: '1.0.0',
		license: '(MIT OR (GPL-2.0-only WITH Classpath-exception-2.0))'
	});
	await writePkg(nm('pkg-with-broken'), {
		name: 'pkg-with-broken',
		version: '1.0.0',
		license: 'GPL-2.0-only WITH'
	});
	await writePkg(nm('pkg-see-license'), {
		name: 'pkg-see-license',
		version: '1.0.0',
		license: 'SEE LICENSE IN LICENSE.md'
	});
	// Also drop a real LICENSE file — tests assert it is never read.
	await writeFile(
		join(nm('pkg-see-license'), 'LICENSE.md'),
		'Copyright (c) 1234 Acme. MIT licensed in spirit. Do not infer.\n',
		'utf8'
	);
	await writePkg(nm('pkg-unlicensed'), {
		name: 'pkg-unlicensed',
		version: '1.0.0',
		license: 'UNLICENSED'
	});
	await writePkg(nm('pkg-empty-license'), {
		name: 'pkg-empty-license',
		version: '1.0.0',
		license: ''
	});
	await writePkg(nm('pkg-no-license'), {
		name: 'pkg-no-license',
		version: '1.0.0'
	});
	// LICENSE file present but never read.
	await writeFile(
		join(nm('pkg-no-license'), 'LICENSE'),
		'The MIT License\nCopyright (c) ... no inference allowed.\n',
		'utf8'
	);
	await writePkg(nm('pkg-object-license'), {
		name: 'pkg-object-license',
		version: '1.0.0',
		license: { type: 'MIT', url: 'https://example.test/' }
	});
	await writePkg(nm('pkg-licenses-array'), {
		name: 'pkg-licenses-array',
		version: '1.0.0',
		licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }]
	});
	await writePkg(nm('pkg-deprecated-only'), {
		name: 'pkg-deprecated-only',
		version: '1.0.0',
		licenses: [{ type: 'BSD-2-Clause' }]
	});
	return root;
}

/** Helper: write licenses/allowed-hard.txt at the project root. */
export async function writeAllowedHard(rootDir: string, contents: string): Promise<void> {
	const dir = join(rootDir, 'licenses');
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'allowed-hard.txt'), contents, 'utf8');
}

/** Helper: write licenses/allowed-packages.txt at the project root. */
export async function writeAllowedPackages(rootDir: string, contents: string): Promise<void> {
	const dir = join(rootDir, 'licenses');
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'allowed-packages.txt'), contents, 'utf8');
}

/** Wrap a function so it runs with `process.cwd()` set to a fixture and
 *  restored afterward. */
export async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
	const previous = process.cwd();
	process.chdir(dir);
	try {
		return await fn();
	} finally {
		process.chdir(previous);
	}
}

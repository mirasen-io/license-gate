/**
 * CLI / packaging smoke tests.
 *
 * Spawns the built `dist/cli.js` in a child process against fixture
 * directories. These tests assume `npm run build` has already produced a
 * working binary. The release-prep script ensures that.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
	buildHoistedWorkspaceFixture,
	buildSinglePackageFixture,
	writeAllowedHard
} from '../helpers/build-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '..', '..');
const CLI = resolve(REPO_ROOT, 'dist', 'cli.js');

function runCli(cwd: string, args: string[]): { stdout: string; stderr: string; code: number } {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		cwd,
		encoding: 'utf8',
		env: { ...process.env, NODE_OPTIONS: '' }
	});
	return {
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
		code: result.status ?? -1
	};
}

const skipIfNotBuilt = !existsSync(CLI);

describe.skipIf(skipIfNotBuilt)('CLI built binary', () => {
	it('built dist/cli.js starts with a Node shebang', () => {
		const head = readFileSync(CLI, 'utf8').slice(0, 32);
		expect(head.startsWith('#!/usr/bin/env node')).toBe(true);
	});

	it('built dist/cli.js has the executable bit set', () => {
		const mode = statSync(CLI).mode;
		// Owner execute bit should be set.
		expect((mode & 0o100) !== 0).toBe(true);
	});

	it('--help prints usage and exits 0', () => {
		const r = runCli(REPO_ROOT, ['--help']);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain('Usage:');
	});

	it('bare invocation prints usage to stderr and exits 2', () => {
		const r = runCli(REPO_ROOT, []);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain('Usage:');
	});

	it('unknown subcommand exits 2', () => {
		const r = runCli(REPO_ROOT, ['audit']);
		expect(r.code).toBe(2);
	});

	it('rejects unknown flags with exit 2', () => {
		const r = runCli(REPO_ROOT, ['check', '--allowed', '/tmp/x.txt']);
		expect(r.code).toBe(2);
	});

	it('accepts --cwd <path> and uses it as the project root', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		// Run from REPO_ROOT but point --cwd at the fixture; check should pass.
		const r = runCli(REPO_ROOT, ['check', '--cwd', root]);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain('PASSED');
	});

	it('--cwd does NOT walk upward', () => {
		// Point --cwd at a path with no package.json; license-gate must exit 2,
		// not climb up to find one.
		const r = runCli(REPO_ROOT, ['check', '--cwd', '/tmp']);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain('package.json');
	});

	it('rejects check --out with exit 2', () => {
		const r = runCli(REPO_ROOT, ['check', '--out', './x.txt']);
		expect(r.code).toBe(2);
		expect(r.stderr).toContain('does not support --out');
	});

	it('runs check on a clean fixture and exits 0', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\nApache-2.0\n');
		const r = runCli(root, ['check']);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain('PASSED');
	});

	it('runs check on a fixture with violations and exits 1', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\n'); // Apache-2.0 will fail
		const r = runCli(root, ['check']);
		expect(r.code).toBe(1);
		expect(r.stdout).toContain('FAILED');
	});

	it('runs collect on a fixture and exits 0', async () => {
		const root = await buildHoistedWorkspaceFixture();
		const r = runCli(root, ['collect']);
		expect(r.code).toBe(0);
		expect(r.stdout).toContain('license-gate collect');
	});

	it('check --json writes the JSON report file', async () => {
		const root = await buildSinglePackageFixture();
		await writeAllowedHard(root, 'MIT\n'); // Apache-2.0 fails
		const r = runCli(root, ['check', '--json', 'report.json']);
		expect(r.code).toBe(1);
		const reportPath = `${root}/report.json`;
		expect(existsSync(reportPath)).toBe(true);
		const parsed = JSON.parse(readFileSync(reportPath, 'utf8'));
		expect(parsed.counts.violations).toBeGreaterThan(0);
	});
});

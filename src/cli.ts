#!/usr/bin/env node
/**
 * `license-gate` CLI entry.
 *
 * Thin: parse argv with node:util.parseArgs, dispatch to command modules,
 * map LicenseGateConfigError to exit code 2 with a stderr message. All
 * business logic lives in src/commands/.
 */

import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { runCheck } from './commands/check.js';
import { runCollect } from './commands/collect.js';
import { LicenseGateConfigError } from './types.js';

type ExitCode = 0 | 1 | 2;

function usageString(): string {
	return [
		'Usage:',
		'  license-gate check   [--cwd <path>] [--workspace <name|path>] [--json <path>]',
		'  license-gate collect [--cwd <path>] [--workspace <name|path>] [--out <path>] [--json <path>]',
		'',
		'Reads policy from licenses/allowed-hard.txt (required for check) and',
		'licenses/allowed-packages.txt (optional), resolved relative to the project root.',
		'The project root is --cwd if provided, otherwise process.cwd(). license-gate',
		'never walks upward — package.json must exist directly at the chosen root.',
		'',
		'Exit codes: 0 clean | 1 violations | 2 usage/config error.'
	].join('\n');
}

function fail(message: string): ExitCode {
	process.stderr.write(`license-gate: ${message}\n`);
	return 2;
}

function failConfig(err: LicenseGateConfigError): ExitCode {
	process.stderr.write(`${err.message}\n`);
	return 2;
}

async function dispatchCheck(rest: string[]): Promise<ExitCode> {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args: rest,
			strict: true,
			allowPositionals: false,
			options: {
				cwd: { type: 'string' },
				workspace: { type: 'string' },
				json: { type: 'string' }
			}
		});
	} catch (err) {
		return fail(`${(err as Error).message}\n${usageString()}`);
	}
	const cwd = (parsed.values.cwd as string | undefined) ?? undefined;
	const workspace = (parsed.values.workspace as string | undefined) ?? null;
	const jsonPath = (parsed.values.json as string | undefined) ?? null;

	try {
		const result = await runCheck({ cwd, workspace, jsonPath });
		process.stdout.write(result.humanReport);
		return result.exitCode;
	} catch (err) {
		if (err instanceof LicenseGateConfigError) return failConfig(err);
		throw err;
	}
}

async function dispatchCollect(rest: string[]): Promise<ExitCode> {
	let parsed: ReturnType<typeof parseArgs>;
	try {
		parsed = parseArgs({
			args: rest,
			strict: true,
			allowPositionals: false,
			options: {
				cwd: { type: 'string' },
				workspace: { type: 'string' },
				out: { type: 'string' },
				json: { type: 'string' }
			}
		});
	} catch (err) {
		return fail(`${(err as Error).message}\n${usageString()}`);
	}
	const cwd = (parsed.values.cwd as string | undefined) ?? undefined;
	const workspace = (parsed.values.workspace as string | undefined) ?? null;
	const outPath = (parsed.values.out as string | undefined) ?? null;
	const jsonPath = (parsed.values.json as string | undefined) ?? null;

	try {
		const result = await runCollect({ cwd, workspace, outPath, jsonPath });
		if (result.stdoutSummary) {
			process.stdout.write(result.stdoutSummary);
		} else {
			process.stdout.write(result.humanReport);
		}
		return 0;
	} catch (err) {
		if (err instanceof LicenseGateConfigError) return failConfig(err);
		throw err;
	}
}

export async function main(argv: string[]): Promise<ExitCode> {
	const [subcommand, ...rest] = argv;

	if (!subcommand) {
		process.stderr.write(`${usageString()}\n`);
		return 2;
	}

	switch (subcommand) {
		case '-h':
		case '--help':
			process.stdout.write(`${usageString()}\n`);
			return 0;
		case 'check': {
			// Reject `check --out` explicitly with invalid-usage (do this before
			// parseArgs, because parseArgs would simply mark `--out` as unknown).
			if (rest.some((a) => a === '--out' || a.startsWith('--out='))) {
				return failConfig(
					new LicenseGateConfigError(
						{
							kind: 'invalid-usage',
							message:
								'`check` does not support --out. Use --json <path> for machine-readable output.'
						},
						'license-gate: `check` does not support --out. Use --json <path> for machine-readable output.'
					)
				);
			}
			return dispatchCheck(rest);
		}
		case 'collect':
			return dispatchCollect(rest);
		default:
			return fail(`unknown command "${subcommand}".\n${usageString()}`);
	}
}

// Entrypoint guard: only run main() when this file is the program entry,
// not when it's imported as a module by a test. We resolve `process.argv[1]`
// through `realpathSync` so that the comparison works when the binary was
// installed as a symlink in `node_modules/.bin`.
const isDirectRun = (() => {
	try {
		const argv1 = process.argv[1];
		if (!argv1) return false;
		const resolved = realpathSync(argv1);
		const url = new URL(`file://${resolved}`);
		return import.meta.url === url.href;
	} catch {
		return false;
	}
})();

if (isDirectRun) {
	main(process.argv.slice(2)).then(
		(code) => {
			process.exit(code);
		},
		(err: unknown) => {
			process.stderr.write(
				`license-gate: unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
			);
			process.exit(2);
		}
	);
}

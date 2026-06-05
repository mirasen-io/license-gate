/**
 * Source-level tests for `src/cli.ts`.
 *
 * The existing `tests/cli/cli.test.ts` spawns the built `dist/cli.js` binary
 * — that exercises packaging but contributes nothing to source coverage of
 * `src/cli.ts`. These tests import `main()` directly and stub out the
 * command modules, so coverage actually instruments the dispatch logic.
 *
 * The aim is dispatch contracts and error paths only:
 *   - subcommand dispatch (check / collect / unknown)
 *   - flag parsing for the supported options
 *   - usage/config failure paths (exit code 2)
 *   - violation exit code (1) propagation from `runCheck`
 *
 * No real Arborist graphs are loaded; no real reports are written.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { LicenseGateConfigError } from '../../src/types.js';
import type { CheckCliResult, CheckOptions } from '../../src/commands/check.js';
import type { CollectCliResult, CollectOptions } from '../../src/commands/collect.js';

// Module-level mocks. Inside vi.mock factories we cannot reference outer
// scope variables, so the spies are exposed via the module exports and
// re-imported below.
vi.mock('../../src/commands/check.js', () => {
	const runCheck = vi.fn();
	return { runCheck };
});
vi.mock('../../src/commands/collect.js', () => {
	const runCollect = vi.fn();
	return { runCollect };
});

// Late-bind imports so the mocks above are in place before main loads them.
const { main } = await import('../../src/cli.js');
const { runCheck } = (await import('../../src/commands/check.js')) as unknown as {
	runCheck: Mock<(opts: CheckOptions) => Promise<CheckCliResult>>;
};
const { runCollect } = (await import('../../src/commands/collect.js')) as unknown as {
	runCollect: Mock<(opts: CollectOptions) => Promise<CollectCliResult>>;
};

type CapturedStreams = {
	stdout: string;
	stderr: string;
	stdoutSpy: ReturnType<typeof vi.spyOn>;
	stderrSpy: ReturnType<typeof vi.spyOn>;
};

function captureStreams(): CapturedStreams {
	const captured: CapturedStreams = {
		stdout: '',
		stderr: '',
		stdoutSpy: vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
			captured.stdout += typeof chunk === 'string' ? chunk : String(chunk);
			return true;
		}),
		stderrSpy: vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
			captured.stderr += typeof chunk === 'string' ? chunk : String(chunk);
			return true;
		})
	};
	return captured;
}

function okCheckResult(over: Partial<CheckCliResult> = {}): CheckCliResult {
	return {
		decisions: [],
		violations: [],
		skippedProjectRoot: null,
		humanReport: 'license-gate check\n  PASSED\n',
		exitCode: 0,
		...over
	};
}

function okCollectResult(over: Partial<CollectCliResult> = {}): CollectCliResult {
	return {
		records: [],
		humanReport: 'license-gate collect\n  records: 0\n',
		stdoutSummary: null,
		...over
	};
}

let streams: CapturedStreams;

beforeEach(() => {
	runCheck.mockReset();
	runCollect.mockReset();
	streams = captureStreams();
});

afterEach(() => {
	streams.stdoutSpy.mockRestore();
	streams.stderrSpy.mockRestore();
});

describe('cli main — bare invocation and help', () => {
	it('bare invocation prints usage to stderr and exits 2', async () => {
		const code = await main([]);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('Usage:');
		expect(runCheck).not.toHaveBeenCalled();
		expect(runCollect).not.toHaveBeenCalled();
	});

	it('--help prints usage to stdout and exits 0', async () => {
		const code = await main(['--help']);
		expect(code).toBe(0);
		expect(streams.stdout).toContain('Usage:');
	});

	it('-h is an alias for --help', async () => {
		const code = await main(['-h']);
		expect(code).toBe(0);
		expect(streams.stdout).toContain('Usage:');
	});
});

describe('cli main — check dispatch', () => {
	it('dispatches `check` with empty options and writes the human report to stdout', async () => {
		runCheck.mockResolvedValueOnce(okCheckResult());
		const code = await main(['check']);
		expect(code).toBe(0);
		expect(runCheck).toHaveBeenCalledTimes(1);
		expect(runCheck).toHaveBeenCalledWith({
			cwd: undefined,
			workspace: null,
			jsonPath: null
		});
		expect(streams.stdout).toContain('PASSED');
	});

	it('passes --cwd, --workspace, --json through to runCheck', async () => {
		runCheck.mockResolvedValueOnce(okCheckResult());
		const code = await main([
			'check',
			'--cwd',
			'/tmp/proj',
			'--workspace',
			'@scope/web',
			'--json',
			'report.json'
		]);
		expect(code).toBe(0);
		expect(runCheck).toHaveBeenCalledWith({
			cwd: '/tmp/proj',
			workspace: '@scope/web',
			jsonPath: 'report.json'
		});
	});

	it('returns the runCheck exit code (1) on violations', async () => {
		runCheck.mockResolvedValueOnce(
			okCheckResult({
				exitCode: 1,
				humanReport: 'license-gate check\n  FAILED\n'
			})
		);
		const code = await main(['check']);
		expect(code).toBe(1);
		expect(streams.stdout).toContain('FAILED');
	});

	it('rejects `check --out` with exit 2 and a clear stderr message', async () => {
		const code = await main(['check', '--out', './x.txt']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('does not support --out');
		expect(runCheck).not.toHaveBeenCalled();
	});

	it('rejects `check --out=value` (=-form) with exit 2', async () => {
		const code = await main(['check', '--out=./x.txt']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('does not support --out');
		expect(runCheck).not.toHaveBeenCalled();
	});

	it('rejects unknown flags with exit 2 and prints usage', async () => {
		const code = await main(['check', '--allowed', '/tmp/x.txt']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('Usage:');
		expect(runCheck).not.toHaveBeenCalled();
	});

	it('rejects a missing option value with exit 2 (e.g. `check --json`)', async () => {
		const code = await main(['check', '--json']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('Usage:');
		expect(runCheck).not.toHaveBeenCalled();
	});

	it('maps a thrown LicenseGateConfigError to exit code 2 and a stderr message', async () => {
		runCheck.mockRejectedValueOnce(
			new LicenseGateConfigError(
				{ kind: 'missing-allowed-hard-file', path: '/tmp/missing.txt' },
				'license-gate: required allowlist file not found: /tmp/missing.txt'
			)
		);
		const code = await main(['check']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('required allowlist file not found');
	});

	it('lets non-LicenseGateConfigError errors bubble out for the entrypoint to handle', async () => {
		runCheck.mockRejectedValueOnce(new Error('boom'));
		await expect(main(['check'])).rejects.toThrow('boom');
	});
});

describe('cli main — collect dispatch', () => {
	it('dispatches `collect` with empty options and writes the human report to stdout', async () => {
		runCollect.mockResolvedValueOnce(okCollectResult());
		const code = await main(['collect']);
		expect(code).toBe(0);
		expect(runCollect).toHaveBeenCalledTimes(1);
		expect(runCollect).toHaveBeenCalledWith({
			cwd: undefined,
			workspace: null,
			outPath: null,
			jsonPath: null
		});
		expect(streams.stdout).toContain('license-gate collect');
	});

	it('passes --cwd, --workspace, --out, --json through to runCollect', async () => {
		runCollect.mockResolvedValueOnce(
			okCollectResult({ stdoutSummary: 'wrote 0 records to out.txt\n' })
		);
		const code = await main([
			'collect',
			'--cwd',
			'/tmp/proj',
			'--workspace',
			'./apps/web',
			'--out',
			'out.txt',
			'--json',
			'out.json'
		]);
		expect(code).toBe(0);
		expect(runCollect).toHaveBeenCalledWith({
			cwd: '/tmp/proj',
			workspace: './apps/web',
			outPath: 'out.txt',
			jsonPath: 'out.json'
		});
		// When stdoutSummary is set, the human report is NOT printed; only the
		// summary line goes to stdout.
		expect(streams.stdout).toBe('wrote 0 records to out.txt\n');
	});

	it('rejects unknown flags with exit 2', async () => {
		const code = await main(['collect', '--allowed', '/tmp/x.txt']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('Usage:');
		expect(runCollect).not.toHaveBeenCalled();
	});

	it('rejects a missing option value with exit 2 (e.g. `collect --out`)', async () => {
		const code = await main(['collect', '--out']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('Usage:');
		expect(runCollect).not.toHaveBeenCalled();
	});

	it('maps a thrown LicenseGateConfigError to exit code 2', async () => {
		runCollect.mockRejectedValueOnce(
			new LicenseGateConfigError(
				{ kind: 'missing-package-json', cwd: '/tmp/missing' },
				'license-gate: no package.json at the selected project root /tmp/missing.'
			)
		);
		const code = await main(['collect']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('no package.json');
	});

	it('lets non-LicenseGateConfigError errors bubble out', async () => {
		runCollect.mockRejectedValueOnce(new Error('kaboom'));
		await expect(main(['collect'])).rejects.toThrow('kaboom');
	});
});

describe('cli main — unknown subcommand', () => {
	it('returns exit code 2 with a usage message', async () => {
		const code = await main(['nope']);
		expect(code).toBe(2);
		expect(streams.stderr).toContain('unknown command "nope"');
		expect(streams.stderr).toContain('Usage:');
		expect(runCheck).not.toHaveBeenCalled();
		expect(runCollect).not.toHaveBeenCalled();
	});
});

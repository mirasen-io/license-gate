/**
 * `check` command — orchestrates discovery → policy → reporting → exit code.
 */

import { readFile } from 'node:fs/promises';

import { evaluateAll } from '../policy/evaluate.js';
import { parseAllowedHard } from '../policy/allowed-hard.js';
import { parseAllowedPackages } from '../policy/allowed-packages.js';
import { renderCheckHuman } from '../report/human.js';
import { renderCheckJson } from '../report/json.js';
import { LicenseGateConfigError, type CheckResult, type Decision } from '../types.js';
import { fileExists, resolveAllowlistPaths, resolveScope, writeOutputFile } from './_shared.js';

export type CheckOptions = {
	cwd?: string;
	workspace?: string | null;
	/** When provided, JSON report is written to this path (relative to cwd). */
	jsonPath?: string | null;
};

export type CheckCliResult = CheckResult & {
	humanReport: string;
	exitCode: 0 | 1;
};

/**
 * Programmatic + CLI-shared check. Returns the decisions and the rendered
 * human report; the caller (CLI or library consumer) decides what to do
 * with stdout and the exit code.
 */
export async function runCheck(opts: CheckOptions = {}): Promise<CheckCliResult> {
	const cwd = opts.cwd ?? process.cwd();
	const workspace = opts.workspace ?? null;

	const scope = await resolveScope({ cwd, workspace });

	const paths = resolveAllowlistPaths(cwd);
	if (!fileExists(paths.allowedHard)) {
		throw new LicenseGateConfigError(
			{ kind: 'missing-allowed-hard-file', path: paths.allowedHard },
			`license-gate: required allowlist file not found: ${paths.allowedHard}`
		);
	}
	const allowedHardContents = await readFile(paths.allowedHard, 'utf8');
	const allowedHard = parseAllowedHard(allowedHardContents);

	const allowedPackages = fileExists(paths.allowedPackages)
		? parseAllowedPackages(await readFile(paths.allowedPackages, 'utf8'), paths.allowedPackages)
		: [];

	// Collect-all-then-exit: never throw mid-evaluation.
	const decisions: Decision[] = evaluateAll(scope.evaluationRecords, allowedHard, allowedPackages);

	const violations = decisions.filter(
		(d): d is Extract<Decision, { outcome: 'violation' }> => d.outcome === 'violation'
	);

	const humanReport = renderCheckHuman({
		decisions,
		skippedProjectRoot: scope.skippedProjectRoot
	});

	if (opts.jsonPath) {
		const jsonReport = renderCheckJson({
			decisions,
			skippedProjectRoot: scope.skippedProjectRoot
		});
		await writeOutputFile(opts.jsonPath, jsonReport, cwd);
	}

	return {
		decisions,
		violations,
		skippedProjectRoot: scope.skippedProjectRoot,
		humanReport,
		exitCode: violations.length > 0 ? 1 : 0
	};
}

/**
 * `collect` command — orchestrates discovery → flat record list → reporting.
 *
 * Performs NO policy I/O: never reads `allowed-hard.txt` or
 * `allowed-packages.txt`. Output is human-readable by default; `--out <path>`
 * writes to a file (and stdout shrinks to a one-line summary); `--json
 * <path>` writes machine-readable JSON.
 */

import { renderCollectHuman } from '../report/human.js';
import { renderCollectJson } from '../report/json.js';
import type { CollectResult } from '../types.js';
import { resolveScope, writeOutputFile } from './_shared.js';

export type CollectOptions = {
	cwd?: string;
	workspace?: string | null;
	/** When provided, human report is written to this path. */
	outPath?: string | null;
	/** When provided, JSON report is written to this path. */
	jsonPath?: string | null;
};

export type CollectCliResult = CollectResult & {
	/** Human report. Always rendered; the CLI decides whether to print. */
	humanReport: string;
	/** When --out was provided, this is the one-line stdout summary. */
	stdoutSummary: string | null;
};

export async function runCollect(opts: CollectOptions = {}): Promise<CollectCliResult> {
	const cwd = opts.cwd ?? process.cwd();
	const workspace = opts.workspace ?? null;

	const scope = await resolveScope({ cwd, workspace });
	const records = scope.allCollectedRecords;

	const humanReport = renderCollectHuman(records);

	let stdoutSummary: string | null = null;
	if (opts.outPath) {
		await writeOutputFile(opts.outPath, humanReport, cwd);
		stdoutSummary = `wrote ${records.length} records to ${opts.outPath}\n`;
	}

	if (opts.jsonPath) {
		await writeOutputFile(opts.jsonPath, renderCollectJson(records), cwd);
	}

	return {
		records,
		humanReport,
		stdoutSummary
	};
}

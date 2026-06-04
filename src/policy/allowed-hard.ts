/**
 * Parser for `licenses/allowed-hard.txt`.
 *
 * Pure: takes the file contents as a string, returns an `AllowedHardList`.
 * The actual file read happens in the command layer.
 *
 * Rules:
 *  - one literal accepted license string per line
 *  - blank lines ignored
 *  - lines whose first non-whitespace char is `#` are comments
 *  - leading/trailing whitespace trimmed (parsing convenience only;
 *    the trimmed value is what gets compared literally)
 *  - duplicates silently deduped
 *  - no regex, no glob, no normalisation
 */

import type { AllowedHardList } from '../types.js';

export function parseAllowedHard(contents: string): AllowedHardList {
	const out = new Set<string>();
	for (const rawLine of contents.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (trimmed.length === 0) continue;
		if (trimmed.startsWith('#')) continue;
		out.add(trimmed);
	}
	return out;
}

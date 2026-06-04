/**
 * SPDX expression evaluation — boolean shape only.
 *
 * Wraps `spdx-expression-parse`. We never use `spdx-correct`, never use
 * `spdx-satisfies`, never normalise license ids or exception ids.
 *
 * AST shapes returned by `spdx-expression-parse`:
 *   { license: "MIT" }                                         // bare leaf
 *   { license: "GPL-2.0-only", exception: "Classpath-..." }    // WITH-leaf
 *   { left: <node>, conjunction: "or"|"and", right: <node> }   // boolean
 *
 * Per design D5/D5a, a WITH-exception leaf reduces to ONE literal string of
 * the form "<license-id> WITH <exception-id>" joined with a single ASCII
 * space, and that composite is the literal compared against allowed-hard.txt.
 * The bare license id is NOT considered separately.
 */

import spdxParse from 'spdx-expression-parse';
import type { AllowedHardList } from '../types.js';

type LeafNode = { license: string; exception?: string };
type AndOrNode = { left: SpdxNode; conjunction: 'and' | 'or'; right: SpdxNode };
type SpdxNode = LeafNode | AndOrNode;

/** Render an AST leaf back to the literal string used for allowlist lookup. */
export function renderLeafLiteral(leaf: LeafNode): string {
	if (typeof leaf.exception === 'string' && leaf.exception.length > 0) {
		return `${leaf.license} WITH ${leaf.exception}`;
	}
	return leaf.license;
}

function isLeaf(node: SpdxNode): node is LeafNode {
	return typeof (node as LeafNode).license === 'string';
}

export type SpdxOutcome =
	| { kind: 'unparseable' }
	| { kind: 'satisfied' }
	| { kind: 'unsatisfied'; offendingLeaves: string[] };

/** Walk an AST; satisfied iff every leaf reachable through the boolean
 *  semantics is in the allowlist. */
function walk(node: SpdxNode, allowed: AllowedHardList, collected: Set<string>): boolean {
	if (isLeaf(node)) {
		const literal = renderLeafLiteral(node);
		if (allowed.has(literal)) return true;
		collected.add(literal);
		return false;
	}
	const leftCollected = new Set<string>();
	const rightCollected = new Set<string>();
	const leftOk = walk(node.left, allowed, leftCollected);
	const rightOk = walk(node.right, allowed, rightCollected);
	if (node.conjunction === 'and') {
		// Both must satisfy. Bubble up offending leaves from any side that
		// failed (only meaningful when AND is unsatisfied).
		if (leftOk && rightOk) return true;
		for (const l of leftCollected) collected.add(l);
		for (const l of rightCollected) collected.add(l);
		return false;
	}
	// OR: either side satisfying is enough.
	if (leftOk || rightOk) return true;
	for (const l of leftCollected) collected.add(l);
	for (const l of rightCollected) collected.add(l);
	return false;
}

/** Evaluate a license string as an SPDX expression against an allowlist. */
export function evaluateSpdx(licenseString: string, allowed: AllowedHardList): SpdxOutcome {
	let ast: SpdxNode;
	try {
		ast = spdxParse(licenseString) as SpdxNode;
	} catch {
		return { kind: 'unparseable' };
	}
	const offending = new Set<string>();
	const ok = walk(ast, allowed, offending);
	if (ok) return { kind: 'satisfied' };
	return { kind: 'unsatisfied', offendingLeaves: Array.from(offending) };
}

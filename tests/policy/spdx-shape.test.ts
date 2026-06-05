import { describe, expect, it } from 'vitest';

import { evaluateSpdx, renderLeafLiteral } from '../../src/policy/spdx-shape.js';

function set(...entries: string[]): ReadonlySet<string> {
	return new Set(entries);
}

describe('evaluateSpdx — bare leaves', () => {
	it('satisfies a leaf in the allowlist', () => {
		expect(evaluateSpdx('MIT', set('MIT'))).toEqual({ kind: 'satisfied' });
	});

	it('reports unsatisfied with the offending leaf when not allowed', () => {
		const out = evaluateSpdx('Apache-2.0', set('MIT'));
		expect(out).toEqual({ kind: 'unsatisfied', offendingLeaves: ['Apache-2.0'] });
	});
});

describe('evaluateSpdx — OR / AND / parens', () => {
	it('OR: passes if any leaf is allowed', () => {
		expect(evaluateSpdx('(MIT OR Apache-2.0)', set('MIT'))).toEqual({ kind: 'satisfied' });
		expect(evaluateSpdx('(MIT OR Apache-2.0)', set('Apache-2.0'))).toEqual({
			kind: 'satisfied'
		});
		expect(evaluateSpdx('MIT OR GPL-3.0', set('MIT'))).toEqual({ kind: 'satisfied' });
	});

	it('OR: unsatisfied when no leaf is allowed', () => {
		const out = evaluateSpdx('(MIT OR Apache-2.0)', set('ISC'));
		expect(out.kind).toBe('unsatisfied');
		if (out.kind === 'unsatisfied') {
			expect(out.offendingLeaves.sort()).toEqual(['Apache-2.0', 'MIT'].sort());
		}
	});

	it('AND: requires all leaves', () => {
		expect(evaluateSpdx('(MIT AND BSD-3-Clause)', set('MIT', 'BSD-3-Clause'))).toEqual({
			kind: 'satisfied'
		});
		const partial = evaluateSpdx('(MIT AND BSD-3-Clause)', set('MIT'));
		expect(partial).toEqual({
			kind: 'unsatisfied',
			offendingLeaves: ['BSD-3-Clause']
		});
	});

	it('parenthesised expression', () => {
		expect(evaluateSpdx('(MIT OR Apache-2.0)', set('Apache-2.0'))).toEqual({
			kind: 'satisfied'
		});
	});
});

describe('evaluateSpdx — unparseable inputs', () => {
	it('reports unparseable for malformed expressions', () => {
		expect(evaluateSpdx('MIT OR', set('MIT'))).toEqual({ kind: 'unparseable' });
		expect(evaluateSpdx('', set('MIT'))).toEqual({ kind: 'unparseable' });
	});

	it('reports unparseable for non-SPDX strings (no normalisation)', () => {
		expect(evaluateSpdx('Apache 2.0', set('Apache-2.0'))).toEqual({ kind: 'unparseable' });
		expect(evaluateSpdx('UNLICENSED', set('UNLICENSED'))).toEqual({ kind: 'unparseable' });
		expect(evaluateSpdx('SEE LICENSE IN LICENSE.md', set())).toEqual({
			kind: 'unparseable'
		});
	});
});

describe('evaluateSpdx — WITH-exception leaves (D5a)', () => {
	const composite = 'GPL-2.0-only WITH Classpath-exception-2.0';

	it('renderLeafLiteral joins license and exception with a single space', () => {
		expect(
			renderLeafLiteral({ license: 'GPL-2.0-only', exception: 'Classpath-exception-2.0' })
		).toBe(composite);
	});

	it('passes only when the full composite literal is in the allowlist', () => {
		expect(evaluateSpdx(composite, set(composite))).toEqual({ kind: 'satisfied' });
	});

	it('fails when only the bare licence id is allowed (no exception)', () => {
		const out = evaluateSpdx(composite, set('GPL-2.0-only'));
		expect(out).toEqual({
			kind: 'unsatisfied',
			offendingLeaves: [composite]
		});
	});

	it('OR-bracketed WITH leaf — alternative branch satisfies', () => {
		expect(evaluateSpdx(`(MIT OR (${composite}))`, set('MIT'))).toEqual({ kind: 'satisfied' });
	});

	it('Malformed `WITH` (no exception) is unparseable', () => {
		expect(evaluateSpdx('GPL-2.0-only WITH', set())).toEqual({ kind: 'unparseable' });
	});
});

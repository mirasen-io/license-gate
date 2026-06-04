import { describe, expect, it } from 'vitest';

import { detectLicense } from '../../src/graph/record.js';
import { LICENSE_COULD_NOT_DETERMINE } from '../../src/types.js';

describe('detectLicense (license shape detection)', () => {
	it('records the string MIT verbatim', () => {
		expect(detectLicense({ license: 'MIT' })).toBe('MIT');
	});

	it('records Apache-2.0 verbatim', () => {
		expect(detectLicense({ license: 'Apache-2.0' })).toBe('Apache-2.0');
	});

	it('records Apache 2.0 (with space) verbatim, distinct from Apache-2.0', () => {
		const v = detectLicense({ license: 'Apache 2.0' });
		expect(v).toBe('Apache 2.0');
		expect(v).not.toBe('Apache-2.0');
	});

	it('trims surrounding whitespace but keeps internal characters', () => {
		expect(detectLicense({ license: '  MIT  ' })).toBe('MIT');
	});

	it('treats missing license as could-not-determine', () => {
		expect(detectLicense({})).toBe(LICENSE_COULD_NOT_DETERMINE);
		expect(detectLicense(undefined)).toBe(LICENSE_COULD_NOT_DETERMINE);
	});

	it('treats empty string license as could-not-determine', () => {
		expect(detectLicense({ license: '' })).toBe(LICENSE_COULD_NOT_DETERMINE);
		expect(detectLicense({ license: '   ' })).toBe(LICENSE_COULD_NOT_DETERMINE);
	});

	it('treats object license form as could-not-determine (no unwrap)', () => {
		expect(detectLicense({ license: { type: 'MIT', url: 'http://x' } as unknown as string })).toBe(
			LICENSE_COULD_NOT_DETERMINE
		);
	});

	it('treats deprecated licenses[] array as could-not-determine (no unwrap)', () => {
		expect(detectLicense({ licenses: [{ type: 'MIT' }] } as never)).toBe(
			LICENSE_COULD_NOT_DETERMINE
		);
	});

	it('preserves SEE LICENSE IN ... and UNLICENSED literally', () => {
		expect(detectLicense({ license: 'SEE LICENSE IN LICENSE.md' })).toBe(
			'SEE LICENSE IN LICENSE.md'
		);
		expect(detectLicense({ license: 'UNLICENSED' })).toBe('UNLICENSED');
	});
});

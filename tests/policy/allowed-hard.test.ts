import { describe, expect, it } from 'vitest';

import { parseAllowedHard } from '../../src/policy/allowed-hard.js';

describe('parseAllowedHard', () => {
	it('parses one literal license per line', () => {
		const set = parseAllowedHard('MIT\nApache-2.0\nBSD-3-Clause\n');
		expect(set.size).toBe(3);
		expect(set.has('MIT')).toBe(true);
		expect(set.has('Apache-2.0')).toBe(true);
		expect(set.has('BSD-3-Clause')).toBe(true);
	});

	it('skips blank lines and # comments', () => {
		const set = parseAllowedHard(`
# header comment
MIT

   # indented comment
Apache-2.0
`);
		expect(Array.from(set)).toEqual(['MIT', 'Apache-2.0']);
	});

	it('trims whitespace around entries', () => {
		const set = parseAllowedHard('   MIT   \n\tBSD-3-Clause\t\n');
		expect(set.has('MIT')).toBe(true);
		expect(set.has('BSD-3-Clause')).toBe(true);
	});

	it('dedupes duplicate entries', () => {
		const set = parseAllowedHard('MIT\nMIT\nMIT\n');
		expect(set.size).toBe(1);
	});

	it('handles an empty file (no entries)', () => {
		expect(parseAllowedHard('').size).toBe(0);
		expect(parseAllowedHard('# only comments\n\n').size).toBe(0);
	});

	it('treats Apache 2.0 (space) and Apache-2.0 (hyphen) as different entries', () => {
		const set = parseAllowedHard('Apache 2.0\nApache-2.0\n');
		expect(set.size).toBe(2);
	});
});

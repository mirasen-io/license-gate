import { describe, expect, it } from 'vitest';

import { parseAllowedPackages } from '../../src/policy/allowed-packages.js';
import { LicenseGateConfigError } from '../../src/types.js';

const PATH = '/fake/licenses/allowed-packages.txt';

function parse(contents: string) {
	return parseAllowedPackages(contents, PATH);
}

function expectInvalid(contents: string, lineFragment?: string) {
	try {
		parse(contents);
	} catch (err) {
		expect(err).toBeInstanceOf(LicenseGateConfigError);
		const e = err as LicenseGateConfigError;
		expect(e.detail.kind).toBe('invalid-package-override-rule');
		if (lineFragment) {
			expect(e.message).toContain(lineFragment);
		}
		return;
	}
	throw new Error(`expected invalid for: ${contents}`);
}

describe('parseAllowedPackages — accepted forms', () => {
	it('accepts @scope/* scope rule', () => {
		const rules = parse('@mirasen/*\n');
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			kind: 'scope',
			scope: '@mirasen',
			ruleText: '@mirasen/*'
		});
	});

	it('accepts package@version rule', () => {
		const rules = parse('lodash@4.17.21\n');
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			kind: 'package-version',
			name: 'lodash',
			version: '4.17.21',
			ruleText: 'lodash@4.17.21'
		});
	});

	it('accepts @scope/package@version rule', () => {
		const rules = parse('@types/node@22.0.0\n');
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			kind: 'scoped-package-version',
			scope: '@types',
			name: '@types/node',
			version: '22.0.0'
		});
	});

	it('accepts package-name wildcard rule (unscoped)', () => {
		const rules = parse('lodash@*\n');
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			kind: 'package-name',
			name: 'lodash',
			ruleText: 'lodash@*'
		});
	});

	it('accepts package-name wildcard rule (scoped)', () => {
		const rules = parse('@scope/weird-package@*\n');
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			kind: 'scoped-package-name',
			scope: '@scope',
			name: '@scope/weird-package',
			ruleText: '@scope/weird-package@*'
		});
	});

	it('accepts SemVer pre-release in version', () => {
		const rules = parse('pkg@1.2.3-rc.1\n');
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			kind: 'package-version',
			name: 'pkg',
			version: '1.2.3-rc.1'
		});
	});

	it('accepts SemVer build metadata in version', () => {
		const rules = parse('pkg@1.2.3+build.42\n');
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			kind: 'package-version',
			name: 'pkg',
			version: '1.2.3+build.42'
		});
	});

	it('accepts SemVer pre-release combined with build metadata', () => {
		const rules = parse('@scope/pkg@1.2.3-rc.1+sha.abc\n');
		expect(rules).toHaveLength(1);
		expect(rules[0]).toMatchObject({
			kind: 'scoped-package-version',
			scope: '@scope',
			name: '@scope/pkg',
			version: '1.2.3-rc.1+sha.abc'
		});
	});

	it('accepts a mix with comments and blanks', () => {
		const rules = parse(`
# header
@mirasen/*

lodash@4.17.21
@types/node@22.0.0
spawndamnit@*
@scope/weird-package@*
`);
		expect(rules).toHaveLength(5);
	});
});

describe('parseAllowedPackages — rejected forms', () => {
	it('rejects bare package name', () => {
		expectInvalid('lodash\n');
	});
	it('rejects scoped package without version', () => {
		expectInvalid('@types/node\n');
		expectInvalid('@scope/weird-package\n');
	});
	it('rejects semver ranges', () => {
		expectInvalid('lodash@^4.17.0\n');
		expectInvalid('lodash@~4.17.0\n');
		expectInvalid('lodash@>=4\n');
		expectInvalid('lodash@4.x\n');
		expectInvalid('lodash@1.x\n');
	});
	it('rejects glob and regex and bare star', () => {
		expectInvalid('lodash*\n');
		expectInvalid('*\n');
		expectInvalid('/lodash.*/\n');
		expectInvalid('lodash{a,b}\n');
		expectInvalid('@scope/weird-*\n');
	});
	it('rejects wildcard scope plus wildcard version', () => {
		expectInvalid('@scope/*@*\n');
	});
	it('rejects wildcard everything', () => {
		expectInvalid('*@*\n');
	});
	it('rejects prefix wildcard on package name combined with @*', () => {
		expectInvalid('lodash*@*\n');
	});
	it('rejects empty head before @*', () => {
		expectInvalid('@*\n');
	});
	it('reports file path and line number', () => {
		try {
			parse('# ok\nlodash\n');
		} catch (err) {
			const e = err as LicenseGateConfigError;
			expect(e.message).toContain('/fake/licenses/allowed-packages.txt:2');
			return;
		}
		throw new Error('expected throw');
	});
});

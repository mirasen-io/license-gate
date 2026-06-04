import { describe, expect, it } from 'vitest';

import { evaluateRecord } from '../../src/policy/evaluate.js';
import { parseAllowedPackages } from '../../src/policy/allowed-packages.js';
import {
	LICENSE_COULD_NOT_DETERMINE,
	type AllowedHardList,
	type InstalledPackageRecord
} from '../../src/types.js';

function rec(over: Partial<InstalledPackageRecord> = {}): InstalledPackageRecord {
	return {
		name: 'lodash',
		version: '4.17.21',
		packageId: 'lodash@4.17.21',
		path: '/fake/node_modules/lodash',
		workspace: null,
		license: 'MIT',
		...over
	};
}

const empty: AllowedHardList = new Set();

describe('evaluateRecord — could-not-determine path', () => {
	it('returns package-not-in-allowlist when no override matches', () => {
		const decision = evaluateRecord(rec({ license: LICENSE_COULD_NOT_DETERMINE }), empty, []);
		expect(decision.outcome).toBe('violation');
		if (decision.outcome === 'violation') {
			expect(decision.reason.kind).toBe('package-not-in-allowlist');
		}
	});

	it('returns allowed-by-scope-rule when @scope/* matches', () => {
		const r = rec({
			name: '@mirasen/foo',
			packageId: '@mirasen/foo@1.0.0',
			version: '1.0.0',
			license: LICENSE_COULD_NOT_DETERMINE
		});
		const rules = parseAllowedPackages('@mirasen/*\n', '/x');
		const decision = evaluateRecord(r, empty, rules);
		expect(decision.outcome).toBe('allowed-by-scope-rule');
		if (decision.outcome === 'allowed-by-scope-rule') {
			expect(decision.matchedPackageRule).toBe('@mirasen/*');
		}
	});

	it('returns allowed-by-package-version-rule when exact match wins over scope', () => {
		const r = rec({
			name: '@mirasen/foo',
			packageId: '@mirasen/foo@1.0.0',
			version: '1.0.0',
			license: LICENSE_COULD_NOT_DETERMINE
		});
		const rules = parseAllowedPackages('@mirasen/*\n@mirasen/foo@1.0.0\n', '/x');
		const decision = evaluateRecord(r, empty, rules);
		expect(decision.outcome).toBe('allowed-by-package-version-rule');
		if (decision.outcome === 'allowed-by-package-version-rule') {
			expect(decision.matchedPackageRule).toBe('@mirasen/foo@1.0.0');
		}
	});
});

describe('evaluateRecord — literal-first matching', () => {
	it('passes a literal MIT match', () => {
		const decision = evaluateRecord(rec({ license: 'MIT' }), new Set(['MIT']), []);
		expect(decision.outcome).toBe('allowed-by-license');
	});

	it('Apache 2.0 (space) does not normalise to Apache-2.0', () => {
		const decision = evaluateRecord(rec({ license: 'Apache 2.0' }), new Set(['Apache-2.0']), []);
		expect(decision.outcome).toBe('violation');
		if (decision.outcome === 'violation') {
			expect(decision.reason.kind).toBe('license-not-in-allowlist');
			if (decision.reason.kind === 'license-not-in-allowlist') {
				expect(decision.reason.detailCode).toBe('literal-not-allowed-and-spdx-unparseable');
				expect(decision.reason.raw).toBe('Apache 2.0');
			}
		}
	});

	it('UNLICENSED passes only when literally allowed', () => {
		const ok = evaluateRecord(rec({ license: 'UNLICENSED' }), new Set(['UNLICENSED']), []);
		expect(ok.outcome).toBe('allowed-by-license');
		const fail = evaluateRecord(rec({ license: 'UNLICENSED' }), new Set(['MIT']), []);
		expect(fail.outcome).toBe('violation');
	});

	it('SEE LICENSE IN ... passes only when literally allowed', () => {
		const literal = 'SEE LICENSE IN LICENSE.md';
		const ok = evaluateRecord(rec({ license: literal }), new Set([literal]), []);
		expect(ok.outcome).toBe('allowed-by-license');
		const fail = evaluateRecord(rec({ license: literal }), new Set(['MIT']), []);
		expect(fail.outcome).toBe('violation');
	});
});

describe('evaluateRecord — SPDX path', () => {
	it('OR with one allowed leaf passes', () => {
		const decision = evaluateRecord(rec({ license: '(MIT OR Apache-2.0)' }), new Set(['MIT']), []);
		expect(decision.outcome).toBe('allowed-by-license');
	});

	it('AND requires all leaves', () => {
		const decision = evaluateRecord(
			rec({ license: '(MIT AND BSD-3-Clause)' }),
			new Set(['MIT']),
			[]
		);
		expect(decision.outcome).toBe('violation');
		if (decision.outcome === 'violation' && decision.reason.kind === 'license-not-in-allowlist') {
			expect(decision.reason.detailCode).toBe('spdx-expression-not-satisfied');
			expect(decision.reason.offendingLeaves).toEqual(['BSD-3-Clause']);
		}
	});

	it('malformed expression yields literal-not-allowed-and-spdx-unparseable', () => {
		const decision = evaluateRecord(rec({ license: 'MIT OR' }), new Set(), []);
		expect(decision.outcome).toBe('violation');
		if (decision.outcome === 'violation' && decision.reason.kind === 'license-not-in-allowlist') {
			expect(decision.reason.detailCode).toBe('literal-not-allowed-and-spdx-unparseable');
		}
	});
});

describe('evaluateRecord — WITH-exception (D5a)', () => {
	const composite = 'GPL-2.0-only WITH Classpath-exception-2.0';

	it('passes when full composite literal is allowed', () => {
		const decision = evaluateRecord(rec({ license: composite }), new Set([composite]), []);
		expect(decision.outcome).toBe('allowed-by-license');
	});

	it('fails with offendingLeaves when only bare licence id is allowed', () => {
		const decision = evaluateRecord(rec({ license: composite }), new Set(['GPL-2.0-only']), []);
		expect(decision.outcome).toBe('violation');
		if (decision.outcome === 'violation' && decision.reason.kind === 'license-not-in-allowlist') {
			expect(decision.reason.detailCode).toBe('spdx-expression-not-satisfied');
			expect(decision.reason.offendingLeaves).toEqual([composite]);
		}
	});

	it('WITH-leaf inside an OR — alternative branch satisfies', () => {
		const decision = evaluateRecord(
			rec({ license: `(MIT OR (${composite}))` }),
			new Set(['MIT']),
			[]
		);
		expect(decision.outcome).toBe('allowed-by-license');
	});

	it('Malformed `WITH` (no exception) yields literal-not-allowed-and-spdx-unparseable', () => {
		const decision = evaluateRecord(
			rec({ license: 'GPL-2.0-only WITH' }),
			new Set(['GPL-2.0-only']),
			[]
		);
		expect(decision.outcome).toBe('violation');
		if (decision.outcome === 'violation' && decision.reason.kind === 'license-not-in-allowlist') {
			expect(decision.reason.detailCode).toBe('literal-not-allowed-and-spdx-unparseable');
		}
	});
});

describe('evaluateRecord — override precedence', () => {
	it('allowed-by-license wins over override; matchedPackageRule absent', () => {
		const r = rec({ name: '@mirasen/foo', license: 'MIT' });
		const rules = parseAllowedPackages('@mirasen/*\n', '/x');
		const decision = evaluateRecord(r, new Set(['MIT']), rules);
		expect(decision.outcome).toBe('allowed-by-license');
		expect((decision as { matchedPackageRule?: string }).matchedPackageRule).toBeUndefined();
	});

	it('override rescues an SPDX unsatisfied violation', () => {
		const r = rec({ name: '@mirasen/foo', license: '(MIT AND CC-BY-4.0)' });
		const rules = parseAllowedPackages('@mirasen/*\n', '/x');
		const decision = evaluateRecord(r, new Set(['MIT']), rules);
		expect(decision.outcome).toBe('allowed-by-scope-rule');
	});

	it('more-specific package@version override wins over @scope/*', () => {
		const r = rec({
			name: '@mirasen/foo',
			version: '1.0.0',
			packageId: '@mirasen/foo@1.0.0',
			license: 'NotInAllowlist'
		});
		const rules = parseAllowedPackages('@mirasen/*\n@mirasen/foo@1.0.0\n', '/x');
		const decision = evaluateRecord(r, new Set(), rules);
		expect(decision.outcome).toBe('allowed-by-package-version-rule');
		if (decision.outcome === 'allowed-by-package-version-rule') {
			expect(decision.matchedPackageRule).toBe('@mirasen/foo@1.0.0');
		}
	});
});

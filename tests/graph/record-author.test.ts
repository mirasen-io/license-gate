import { describe, expect, it } from 'vitest';

import { nodeToRecord } from '../../src/graph/record.js';

/**
 * Build a minimal Arborist-Node-shaped fake exposing only the fields
 * `nodeToRecord` reads: `name`, `version`, `realpath`, and `package`.
 * Tests are routed through `nodeToRecord` so the regex-free author parser
 * is exercised via the existing public conversion path — `parseAuthorString`
 * is intentionally not exported and not imported here.
 */
function fakeNode(pkg: Record<string, unknown>): Parameters<typeof nodeToRecord>[0] {
	return {
		name: 'fake',
		version: '1.0.0',
		realpath: '/fake/path',
		package: pkg
	} as unknown as Parameters<typeof nodeToRecord>[0];
}

describe('extractAuthor (regex-free author parsing via nodeToRecord)', () => {
	it('splits "Name <email@example.com>" into publisher and email', () => {
		const rec = nodeToRecord(fakeNode({ author: 'Name <email@example.com>' }), null);
		expect(rec.publisher).toBe('Name');
		expect(rec.email).toBe('email@example.com');
	});

	it('treats a bare "Name" string as publisher only', () => {
		const rec = nodeToRecord(fakeNode({ author: 'Name' }), null);
		expect(rec.publisher).toBe('Name');
		expect(rec.email).toBeUndefined();
	});

	it('keeps an unterminated "Name <broken" verbatim as publisher (no email)', () => {
		const rec = nodeToRecord(fakeNode({ author: 'Name <broken' }), null);
		expect(rec.publisher).toBe('Name <broken');
		expect(rec.email).toBeUndefined();
	});

	it('keeps "<email@example.com>" verbatim as publisher when the name is missing', () => {
		// Publisher is missing, so this is not the clear "Name <email>" form.
		const rec = nodeToRecord(fakeNode({ author: '<email@example.com>' }), null);
		expect(rec.publisher).toBe('<email@example.com>');
		expect(rec.email).toBeUndefined();
	});

	it('keeps "Name <>" verbatim as publisher when the email is empty', () => {
		// Email is empty — fall back to the verbatim string.
		const rec = nodeToRecord(fakeNode({ author: 'Name <>' }), null);
		expect(rec.publisher).toBe('Name <>');
		expect(rec.email).toBeUndefined();
	});

	it('uses the LAST "<" as the email delimiter for "A <B <email@example.com>"', () => {
		// Parser uses lastIndexOf('<') — everything before the final '<' is
		// the publisher (verbatim, including the inner "<B").
		const rec = nodeToRecord(fakeNode({ author: 'A <B <email@example.com>' }), null);
		expect(rec.publisher).toBe('A <B');
		expect(rec.email).toBe('email@example.com');
	});

	it('reads name and email from an object-form author', () => {
		const rec = nodeToRecord(
			fakeNode({ author: { name: 'Name', email: 'email@example.com' } }),
			null
		);
		expect(rec.publisher).toBe('Name');
		expect(rec.email).toBe('email@example.com');
	});

	it('omits publisher and email when no author field is present', () => {
		const rec = nodeToRecord(fakeNode({}), null);
		expect(rec.publisher).toBeUndefined();
		expect(rec.email).toBeUndefined();
	});
});

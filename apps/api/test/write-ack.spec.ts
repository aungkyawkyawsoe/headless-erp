/**
 * Write acknowledgements — the request-scoped "confirm the warning" channel the
 * duplicate-requisition guard (and future soft guards) reads.
 *
 * The invariants that matter: parsing is tolerant but exact (blank tokens never
 * acknowledge the empty string), an acknowledgement is bound to the request it
 * arrived on, and OUTSIDE any scope the answer is `false` — the safe direction for
 * every non-request caller (CLI, scheduled jobs, tests).
 */
import { describe, expect, it } from 'vitest';

import { parseWriteAcks, runWithWriteAcks, writeAcknowledged } from '@/lib/write-ack';

describe('write acknowledgements', () => {
	it('parses a comma-separated header, trimming and de-duplicating tokens', () => {
		const acks = parseWriteAcks(' requisition-duplicate , other-guard ,requisition-duplicate');
		expect([...acks].sort()).toEqual(['other-guard', 'requisition-duplicate']);
	});

	it('treats an absent / blank header as NO acknowledgement', () => {
		for (const header of [undefined, null, '', '   ', ',,']) {
			expect(parseWriteAcks(header).size).toBe(0);
			expect(writeAcknowledged('')).toBe(false);
		}
	});

	it('answers only for the CURRENT scope, and never outside one', () => {
		expect(writeAcknowledged('requisition-duplicate')).toBe(false);

		runWithWriteAcks(parseWriteAcks('requisition-duplicate'), () => {
			expect(writeAcknowledged('requisition-duplicate')).toBe(true);
			// A different guard's token is not acknowledged by this request.
			expect(writeAcknowledged('some-other-guard')).toBe(false);
			// Scopes nest without leaking outward (the inner run is a fresh set).
			runWithWriteAcks(parseWriteAcks('some-other-guard'), () => {
				expect(writeAcknowledged('some-other-guard')).toBe(true);
				expect(writeAcknowledged('requisition-duplicate')).toBe(false);
			});
			expect(writeAcknowledged('requisition-duplicate')).toBe(true);
		});

		// Back outside every scope.
		expect(writeAcknowledged('requisition-duplicate')).toBe(false);
	});
});

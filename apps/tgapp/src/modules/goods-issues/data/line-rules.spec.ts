import { describe, expect, it } from 'vitest';

import { outboundLineIsComplete, outboundLineQty, parseQty } from './line-rules';

/**
 * The submit gate of an outbound row, and the ONE derivation of its quantity.
 *
 * The regression these pin: a row used to carry its quantity twice — the typed
 * `qty` AND the picked serials — and the typed one capped the picks, so picking a
 * first serial wrote `qty = 1` and the picker then refused every further unit
 * ("can't select multiple serials"). A serial row's quantity is now the picked
 * units themselves, so the cap has nothing to enforce.
 */
describe('outboundLineQty — the row’s single quantity', () => {
	const line = (over: Partial<Parameters<typeof outboundLineQty>[0]> = {}) => ({ qty: '', serials: [], ...over });

	it('reads a standard / batch row’s quantity from the input', () => {
		expect(outboundLineQty(line({ qty: '8' }), 'standard')).toBe(8);
		expect(outboundLineQty(line({ qty: '2.5' }), 'batch')).toBe(2.5);
		expect(outboundLineQty(line({ qty: '' }), 'standard')).toBeNull();
	});

	it('reads a serial row’s quantity from the PICKS, ignoring the stale qty input', () => {
		// The form used to hand a pre-seeded qty here; the picks win, so a request
		// that asked for 3 can never cap what the operator is allowed to select.
		expect(outboundLineQty(line({ qty: '1', serials: ['TY-1', 'TY-2'] }), 'serial')).toBe(2);
		expect(outboundLineQty(line({ qty: '3', serials: ['TY-1'] }), 'serial')).toBe(1);
	});

	it('treats a serial row with nothing picked as having NO quantity (incomplete)', () => {
		expect(outboundLineQty(line({ qty: '3', serials: [] }), 'serial')).toBeNull();
	});

	it('parses a qty input to a number or null', () => {
		expect(parseQty(' 4 ')).toBe(4);
		expect(parseQty('')).toBeNull();
		expect(parseQty('abc')).toBeNull();
	});
});

describe('outboundLineIsComplete — the submit gate', () => {
	const line = (over: Partial<Parameters<typeof outboundLineIsComplete>[0]> = {}) => ({
		modelId: 'm1',
		qty: '',
		serials: [],
		...over,
	});

	it('needs an item and a positive quantity', () => {
		expect(outboundLineIsComplete(line({ modelId: null, qty: '2' }), 'standard')).toBe(false);
		expect(outboundLineIsComplete(line({ qty: '0' }), 'standard')).toBe(false);
		expect(outboundLineIsComplete(line({ qty: '2' }), 'standard')).toBe(true);
	});

	it('accepts a serial row on ONE picked unit, however much the request asked for', () => {
		expect(outboundLineIsComplete(line({ qty: '3', serials: [] }), 'serial')).toBe(false);
		expect(outboundLineIsComplete(line({ qty: '3', serials: ['TY-1'] }), 'serial')).toBe(true);
		expect(outboundLineIsComplete(line({ qty: '', serials: ['TY-1', 'TY-2'] }), 'serial')).toBe(true);
	});
});

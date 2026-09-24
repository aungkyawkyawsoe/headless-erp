import { describe, expect, it } from 'vitest';

import { addSerials, inboundLineIsComplete, parseQty, parseSerials } from './line-rules';

/**
 * The submit gate of a receipt line: a row needs a model and a positive qty, and
 * a serial row needs its typed units to match the qty exactly (the confirm engine
 * refuses a mismatch).
 */
describe('inboundLineIsComplete — the receipt-row gate', () => {
	const line = (over: Partial<Parameters<typeof inboundLineIsComplete>[0]> = {}) => ({
		modelId: 'm1',
		qty: '2',
		serialsText: '',
		...over,
	});

	it('accepts a complete standard row', () => {
		expect(inboundLineIsComplete(line(), 'standard')).toBe(true);
	});

	it('accepts a batch row with a qty', () => {
		expect(inboundLineIsComplete(line(), 'batch')).toBe(true);
	});

	it('refuses a serial row whose units do not match qty', () => {
		// qty 2 but only one unit typed → incomplete (the engine 409s this).
		expect(inboundLineIsComplete(line({ serialsText: 'SN-1' }), 'serial')).toBe(false);
		expect(inboundLineIsComplete(line({ serialsText: 'SN-1 SN-2' }), 'serial')).toBe(true);
	});

	it('needs a model and a positive qty before anything else', () => {
		expect(inboundLineIsComplete(line({ modelId: null }), 'standard')).toBe(false);
		expect(inboundLineIsComplete(line({ qty: '' }), 'standard')).toBe(false);
		expect(inboundLineIsComplete(line({ qty: '0' }), 'standard')).toBe(false);
		expect(inboundLineIsComplete(line({ qty: 'abc' }), 'standard')).toBe(false);
	});

	it('splits serial lists on commas (both scripts) and whitespace', () => {
		expect(parseSerials('SN-1, SN-2၊SN-3 SN-4')).toEqual(['SN-1', 'SN-2', 'SN-3', 'SN-4']);
		expect(parseQty(' 4 ')).toBe(4);
		expect(parseQty('')).toBeNull();
	});
});

/**
 * The serial EDITOR's rule: a unit enters a line's list once, and a repeat is
 * refused with a reason rather than silently dropped — a serial number names ONE
 * physical unit, so a duplicate either double-counts stock or makes the confirm
 * 409 after all the typing is done.
 */
describe('addSerials — one unit, one entry', () => {
	it('adds ONE unit per call and keeps the order typed', () => {
		const first = addSerials([], 'TY-1');
		expect(first.serials).toEqual(['TY-1']);
		expect(first.conflicts).toEqual([]);
		expect(addSerials(first.serials, 'TY-2').serials).toEqual(['TY-1', 'TY-2']);
	});

	it('takes a whole PASTED column in one go', () => {
		// A supplier's list arrives as a paste — commas or a newline column.
		expect(addSerials([], 'TY-1, TY-2၊TY-3 TY-4').serials).toEqual(['TY-1', 'TY-2', 'TY-3', 'TY-4']);
		expect(addSerials([], 'TY-1\nTY-2').serials).toEqual(['TY-1', 'TY-2']);
	});

	it('refuses a unit already on THIS line, and says so', () => {
		const outcome = addSerials(['TY-1'], 'TY-1');
		expect(outcome.serials).toEqual(['TY-1']);
		expect(outcome.conflicts).toEqual([{ serial: 'TY-1', where: null }]);
	});

	it('refuses a unit already on ANOTHER line, naming that line', () => {
		const outcome = addSerials([], 'TY-9', [{ serial: 'TY-9', where: 'item 2' }]);
		expect(outcome.serials).toEqual([]);
		expect(outcome.conflicts).toEqual([{ serial: 'TY-9', where: 'item 2' }]);
	});

	it('keeps the units a paste CAN take and reports only the ones it cannot', () => {
		const outcome = addSerials(['TY-1'], 'TY-2, TY-1, TY-3');
		expect(outcome.serials).toEqual(['TY-1', 'TY-2', 'TY-3']);
		expect(outcome.conflicts).toEqual([{ serial: 'TY-1', where: null }]);
	});

	it('compares case-insensitively — `ty-1` and `TY-1` are ONE unit', () => {
		expect(addSerials(['TY-1'], 'ty-1').conflicts).toEqual([{ serial: 'ty-1', where: null }]);
		expect(addSerials([], 'ty-1', [{ serial: 'TY-1', where: 'item 3' }]).conflicts[0]?.where).toBe('item 3');
	});

	it('is a no-op on an empty entry (nothing added, nothing refused)', () => {
		const outcome = addSerials(['TY-1'], '   ,  ');
		expect(outcome.serials).toEqual(['TY-1']);
		expect(outcome.conflicts).toEqual([]);
	});
});

import { describe, expect, it } from 'vitest';

import { requestKindOf } from './types';

/**
 * One derivation, three shapes: the request's kind follows the SAME rule the
 * engine's execute dispatches on, so the approval card and the writer can never
 * disagree about what a row will do.
 */
describe('requestKindOf', () => {
	it('reads a destination-less write-off as a write-off', () => {
		expect(requestKindOf({ write_off: true, to_location: null })).toBe('write-off');
	});

	it('reads a store destination as a return', () => {
		expect(requestKindOf({ write_off: false, to_location: 'vehicle_store' })).toBe('return');
	});

	it('reads a holder destination as a transfer', () => {
		expect(requestKindOf({ write_off: false, to_location: null })).toBe('transfer');
	});

	it('treats a blank store as no destination (never as a return)', () => {
		expect(requestKindOf({ write_off: false, to_location: '   ' })).toBe('transfer');
	});

	it('lets the flag outrank a stray destination — the engine refuses that row anyway', () => {
		// The compiled guard refuses `write_off` + a destination at BOTH ends, so this
		// shape cannot be filed; if one ever arrives, naming it a write-off matches what
		// the execute would do rather than inventing a move nobody authorised.
		expect(requestKindOf({ write_off: true, to_location: 'main_store' })).toBe('write-off');
	});
});

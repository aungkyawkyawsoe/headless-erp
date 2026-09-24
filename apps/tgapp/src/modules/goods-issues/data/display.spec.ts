import { describe, expect, it } from 'vitest';

import { sourceRequestClosedReason } from './display';

/**
 * The Confirm-block reason for a goods-issue whose SOURCE REQUEST is already
 * closed. Mirrors the server guard in `InventoryService.confirmOutbound`, so an
 * unconfirmable draft says WHY up front instead of failing on submit.
 */
describe('sourceRequestClosedReason', () => {
	it('blocks a fulfilled source request, naming it', () => {
		expect(sourceRequestClosedReason('fulfilled', 'REQ-00001')).toBe(
			'Source request REQ-00001 is fulfilled — no further issues are allowed.',
		);
	});

	it('blocks a cancelled source request', () => {
		expect(sourceRequestClosedReason('cancelled', 'REQ-00004')).toBe(
			'Source request REQ-00004 is cancelled — no further issues are allowed.',
		);
	});

	it('still explains without a label', () => {
		expect(sourceRequestClosedReason('fulfilled', null)).toBe('Source request is fulfilled — no further issues are allowed.');
	});

	it('does NOT block an open request (approved / requested / partial)', () => {
		expect(sourceRequestClosedReason('requested', 'REQ-00009')).toBeNull();
		expect(sourceRequestClosedReason('approved', 'REQ-00008')).toBeNull();
		expect(sourceRequestClosedReason('partially_issued', 'REQ-00008')).toBeNull();
	});

	it('does NOT block when there is no source request', () => {
		expect(sourceRequestClosedReason(null, null)).toBeNull();
		expect(sourceRequestClosedReason(undefined, undefined)).toBeNull();
	});
});

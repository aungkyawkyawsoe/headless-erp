/**
 * Items API — the write-protocol options a caller can attach to a mutation.
 *
 * The one that needs pinning is `ack`: a guard WARNING the server already showed
 * the caller (the MRO same-day duplicate requisition) is confirmed by a header, so
 * an unacknowledged write must carry NO such header — an always-on header would
 * silently disarm every guard the server registers.
 */
import { describe, expect, it } from 'vitest';

import { createItemsApi, WRITE_ACK_HEADER } from '../src/items';
import type { RequestFn, RequestOptionsLike } from '../src/items';

describe('items api — guard-warning acknowledgement', () => {
	/**
	 * A `RequestFn` double that records every options object it is handed. The real
	 * signature is generic over the payload (`{ data: T }` for ANY `T`), so a double
	 * returning one fixed row has to be generic too — hence the payload cast, which
	 * no assertion here reads (they inspect `options`, never `data`).
	 */
	function capture() {
		const calls: RequestOptionsLike[] = [];
		const request: RequestFn = async <T>(_path: string, options?: RequestOptionsLike) => {
			calls.push(options ?? {});
			return { data: { id: 'row-1' } as unknown as T };
		};
		const items = createItemsApi<Record<string, unknown>>('mro_requisitions', request);
		return { calls, items };
	}

	it('sends the acknowledgement header ONLY when a token is passed', async () => {
		const { calls, items } = capture();

		await items.create({ note: 'plain' });
		await items.create({ note: 'confirmed' }, { ack: 'requisition-duplicate' });

		expect(calls[0].headers).toBeUndefined();
		expect(calls[1].headers).toEqual({ [WRITE_ACK_HEADER]: 'requisition-duplicate' });
		// The token never leaks into the record itself.
		expect(JSON.stringify(calls[1].body)).not.toContain('requisition-duplicate');
	});

	it('passes the acknowledgement through on an update too', async () => {
		const { calls, items } = capture();

		await items.update('row-1', { note: 'x' }, { ack: 'requisition-duplicate' });
		expect(calls[0].headers).toEqual({ [WRITE_ACK_HEADER]: 'requisition-duplicate' });
		expect(calls[0].method).toBe('PUT');
	});
});

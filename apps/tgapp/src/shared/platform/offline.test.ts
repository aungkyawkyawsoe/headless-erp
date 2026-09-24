// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { offlineQueue } from '@/shared/api/sdk';
import { isOnline, setOnline, subscribeConnectivity } from './connectivity';
import { discardOffline, flushOffline, pendingCount, subscribeQueue } from './offline';

/**
 * The offline pipeline's two app-level guarantees:
 *   • connectivity is an observable signal (the banner + scheduler read it);
 *   • `pendingCount` tracks the queue and `flushOffline` replays it exactly once,
 *     even when several triggers fire together.
 */
describe('offline pipeline', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		discardOffline();
		setOnline(true);
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		discardOffline();
		setOnline(true);
		vi.restoreAllMocks();
	});

	it('notifies connectivity subscribers only on a real change', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeConnectivity(listener);

		setOnline(false);
		expect(isOnline()).toBe(false);
		expect(listener).toHaveBeenCalledTimes(1);

		// Idempotent — no phantom notification.
		setOnline(false);
		expect(listener).toHaveBeenCalledTimes(1);

		setOnline(true);
		expect(listener).toHaveBeenCalledTimes(2);
		unsubscribe();
	});

	it('tracks the pending queue and notifies subscribers on enqueue', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeQueue(listener);
		expect(pendingCount()).toBe(0);

		offlineQueue.enqueue('POST', '/entities/hr_requests', { id: 'a' });

		expect(pendingCount()).toBe(1);
		expect(listener).toHaveBeenCalled();
		unsubscribe();
	});

	it('replays queued writes and empties the queue', async () => {
		globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;

		offlineQueue.enqueue('POST', '/entities/hr_requests', { id: 'a' });
		offlineQueue.enqueue('PUT', '/entities/hr_requests/a', { note: 'x' });
		expect(pendingCount()).toBe(2);

		await expect(flushOffline()).resolves.toBe(2);
		expect(pendingCount()).toBe(0);
	});

	it('shares one in-flight replay across concurrent triggers', async () => {
		let release: ((value: { ok: boolean; status: number }) => void) | undefined;
		const fetchMock = vi.fn(
			() =>
				new Promise<{ ok: boolean; status: number }>((resolve) => {
					release = resolve;
				}),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		offlineQueue.enqueue('POST', '/entities/hr_requests', { id: 'a' });

		const first = flushOffline();
		const second = flushOffline();
		expect(first).toBe(second);

		release?.({ ok: true, status: 200 });
		await expect(first).resolves.toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

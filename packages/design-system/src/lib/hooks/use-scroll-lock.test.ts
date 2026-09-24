import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isOverlayOpen, lockBodyScroll, subscribeOverlayOpen, unlockBodyScroll, useOverlayOpen } from './use-scroll-lock';

/**
 * The overlay-open signal — the ONE place a sheet/picker/dialog announces it is
 * covering the page. Consumers (the Telegram Mini App's native MainButton) read
 * it instead of re-wiring every caller's `open` state, so a sheet added later is
 * never missed. These pin the counter's nested-safe semantics AND the React
 * binding, since a wrong snapshot there would leak the native button over a sheet.
 */
afterEach(() => {
	// Never leak a lock into the next test (the counter is module-global).
	while (isOverlayOpen()) unlockBodyScroll();
});

describe('isOverlayOpen', () => {
	it('tracks the lock depth — nested overlays keep it open until the last closes', () => {
		expect(isOverlayOpen()).toBe(false);
		lockBodyScroll();
		expect(isOverlayOpen()).toBe(true);
		lockBodyScroll();
		expect(isOverlayOpen()).toBe(true);
		unlockBodyScroll();
		expect(isOverlayOpen()).toBe(true);
		unlockBodyScroll();
		expect(isOverlayOpen()).toBe(false);
	});

	it('ignores an unbalanced unlock (depth never goes negative)', () => {
		unlockBodyScroll();
		expect(isOverlayOpen()).toBe(false);
	});
});

describe('subscribeOverlayOpen', () => {
	it('fires on every transition and stops after unsubscribe', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeOverlayOpen(listener);

		lockBodyScroll();
		expect(listener).toHaveBeenCalledTimes(1);
		unlockBodyScroll();
		expect(listener).toHaveBeenCalledTimes(2);

		unsubscribe();
		lockBodyScroll();
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe('useOverlayOpen', () => {
	it('re-renders the caller open then closed', () => {
		const { result } = renderHook(() => useOverlayOpen());
		expect(result.current).toBe(false);

		act(() => lockBodyScroll());
		expect(result.current).toBe(true);

		act(() => unlockBodyScroll());
		expect(result.current).toBe(false);
	});
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIsNarrow, useMediaQuery } from './use-media-query';

/** Minimal matchMedia stub with a mutable `matches` + fired listeners. */
function stubMatchMedia(initial: boolean) {
	let matches = initial;
	const listeners = new Set<() => void>();
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		get matches() {
			return matches;
		},
		media: query,
		onchange: null,
		addEventListener: (_: string, cb: () => void) => listeners.add(cb),
		removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
	return {
		set(next: boolean) {
			matches = next;
			listeners.forEach((cb) => cb());
		},
	};
}

describe('useMediaQuery', () => {
	const original = window.matchMedia;
	afterEach(() => {
		window.matchMedia = original;
	});

	it('reflects the current match and updates when the query changes', () => {
		const mql = stubMatchMedia(true);
		const { result } = renderHook(() => useMediaQuery('(max-width: 900px)'));
		expect(result.current).toBe(true);
		act(() => mql.set(false));
		expect(result.current).toBe(false);
	});

	it('useIsNarrow resolves to false when matchMedia is unavailable (jsdom/SSR)', () => {
		// jsdom does not implement matchMedia — the hook must degrade, not throw.
		(window as unknown as { matchMedia?: unknown }).matchMedia = undefined;
		const { result } = renderHook(() => useIsNarrow());
		expect(result.current).toBe(false);
	});
});

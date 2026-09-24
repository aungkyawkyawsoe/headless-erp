// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The native MainButton must never sit ON TOP of an open bottom sheet: the
 * Telegram client draws that button above the WebView's bottom edge, so no CSS
 * z-index can cover it. The hook reads the design-system's overlay-open signal
 * (mocked here) and hides itself while ANY sheet/picker is open — the app-wide
 * rule, so a field added later is covered without per-form wiring.
 */
const overlay = vi.hoisted(() => ({ open: false }));
vi.mock('@mmbix/design-system/sheet', () => ({ useOverlayOpen: () => overlay.open }));

import { useTelegramMainButton } from './use-main-button';

// The WebApp bridge is module-cached by `useLiveWebApp` (one poll per page), so
// install ONE stub for the whole file; per-test history is cleared instead.
const calls = {
	setParams: vi.fn(),
	show: vi.fn(),
	hide: vi.fn(),
	showProgress: vi.fn(),
	hideProgress: vi.fn(),
	onClick: vi.fn(),
	offClick: vi.fn(),
};

beforeAll(() => {
	(window as unknown as { Telegram: unknown }).Telegram = {
		WebApp: {
			version: '8.0',
			platform: 'android',
			MainButton: calls,
			onEvent: vi.fn(),
			offEvent: vi.fn(),
		},
	};
});

beforeEach(() => {
	overlay.open = false;
	vi.clearAllMocks();
});

// NOTE: no config `globals` in this app → @testing-library/react does not
// auto-unmount; each test unmounts its own hook.
describe('useTelegramMainButton — an open overlay tucks the native button away', () => {
	it('hides while an overlay is open and shows again when it closes', () => {
		const { rerender, unmount } = renderHook(() => useTelegramMainButton({ text: 'Save', onClick: () => {} }));

		expect(calls.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ is_visible: true }));
		expect(calls.show).toHaveBeenCalled();

		overlay.open = true;
		rerender();
		expect(calls.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ is_visible: false }));
		expect(calls.hide).toHaveBeenCalled();

		overlay.open = false;
		rerender();
		expect(calls.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ is_visible: true }));

		unmount();
	});

	it('stays hidden while an overlay is open even when the caller asks for visible', () => {
		overlay.open = true;
		const { unmount } = renderHook(() => useTelegramMainButton({ text: 'Save', onClick: () => {}, visible: true }));
		expect(calls.setParams).toHaveBeenLastCalledWith(expect.objectContaining({ is_visible: false }));
		expect(calls.hide).toHaveBeenCalled();
		expect(calls.show).not.toHaveBeenCalled();
		unmount();
	});
});

describe('useTelegramMainButton — the returned boolean gates the in-page fallback', () => {
	it('returns false when the caller hides the native button, so the fallback still renders', () => {
		const { result, unmount } = renderHook(() => useTelegramMainButton({ text: 'Save', onClick: () => {}, visible: false }));
		expect(result.current).toBe(false);
		unmount();
	});

	it('returns true only while the native button is the requested control', () => {
		let visible = false;
		const { result, rerender, unmount } = renderHook(() => useTelegramMainButton({ text: 'Save', onClick: () => {}, visible }));
		expect(result.current).toBe(false);
		visible = true;
		rerender();
		expect(result.current).toBe(true);
		visible = false;
		rerender();
		expect(result.current).toBe(false);
		unmount();
	});
});

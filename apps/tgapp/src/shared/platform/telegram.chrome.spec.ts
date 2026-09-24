// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyTelegramChromeColors, shouldReapplyInsets, type TelegramWebApp } from './telegram';

/**
 * Telegram WebView chrome + viewport-event contract.
 *
 * Two independent causes of the "black screen blinks when the keyboard opens"
 * symptom are pinned here:
 *   1. the WebView's own canvas defaults to the CLIENT's background, which often
 *      differs from this app's palette → paint it to the app background;
 *   2. `viewportChanged` fires on every animation frame → only re-apply insets on
 *      the STABLE event, so no mid-animation repaint is forced.
 */

/** A minimal bridge stub whose methods record their calls. */
function stubWebApp(version: string) {
	const calls = {
		setBackgroundColor: vi.fn(),
		setBottomBarColor: vi.fn(),
		setHeaderColor: vi.fn(),
	};
	const wa = { version, ...calls } as unknown as TelegramWebApp;
	(window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram = { WebApp: wa };
	return calls;
}

afterEach(() => {
	delete (window as unknown as { Telegram?: unknown }).Telegram;
});

describe('applyTelegramChromeColors', () => {
	it('paints canvas, bottom bar and header on a modern client', () => {
		const calls = stubWebApp('8.0');
		applyTelegramChromeColors('#EDF0F4');
		expect(calls.setBackgroundColor).toHaveBeenCalledWith('#EDF0F4');
		expect(calls.setBottomBarColor).toHaveBeenCalledWith('#EDF0F4');
		expect(calls.setHeaderColor).toHaveBeenCalledWith('#EDF0F4');
	});

	it('skips the bottom bar (7.10+) on an older client but still paints the canvas', () => {
		const calls = stubWebApp('7.0');
		applyTelegramChromeColors('#111213');
		expect(calls.setBackgroundColor).toHaveBeenCalledWith('#111213');
		expect(calls.setHeaderColor).toHaveBeenCalledWith('#111213');
		expect(calls.setBottomBarColor).not.toHaveBeenCalled();
	});

	it('no-ops (never throws) below Bot API 6.1 and with no bridge at all', () => {
		const calls = stubWebApp('6.0');
		expect(() => applyTelegramChromeColors('#111213')).not.toThrow();
		expect(calls.setBackgroundColor).not.toHaveBeenCalled();

		delete (window as unknown as { Telegram?: unknown }).Telegram;
		expect(() => applyTelegramChromeColors('#111213')).not.toThrow();
	});
});

describe('shouldReapplyInsets', () => {
	it('skips unstable (animating) viewport frames', () => {
		expect(shouldReapplyInsets({ isStateStable: false })).toBe(false);
	});

	it('applies on the stable frame and when no payload is supplied', () => {
		expect(shouldReapplyInsets({ isStateStable: true })).toBe(true);
		expect(shouldReapplyInsets()).toBe(true);
	});
});

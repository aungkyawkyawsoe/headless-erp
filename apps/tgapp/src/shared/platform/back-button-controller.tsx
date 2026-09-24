import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { hapticImpact } from './haptics';
import { popBack } from './history';
import { useLiveWebApp } from './use-live-web-app';
import { versionAtLeast } from './telegram';

/** Screens that own their chrome — the launcher home never shows a back button. */
const ROOT_PATHS = new Set(['/', '/app']);

/**
 * Count of mounted overlays (the image crop editor) that have TAKEN OVER the
 * native BackButton. While any is mounted the controller's own history pop is
 * suppressed, so the header chevron closes the overlay instead of leaving the
 * page behind it. Module-level (not React state) because the controller reads it
 * inside its tap handler, at tap time.
 */
let backButtonOverrideDepth = 0;

/**
 * Take over the native BackButton for as long as the calling component is
 * mounted: the router-level `TelegramBackButtonController` stops popping history
 * and `onBack` runs instead. Used by full-screen overlays (the crop editor) whose
 * own top-left control sits under the native chevron — without this, a tap where
 * the overlay's Close button is would navigate the page away instead.
 */
export function useTelegramBackButtonOverride(onBack: () => void): void {
	const wa = useLiveWebApp();
	const backSupported = !!wa && versionAtLeast(wa, '6.1');
	// Read the latest callback at tap time without rebinding the listener.
	const handler = useRef(onBack);
	handler.current = onBack;

	useEffect(() => {
		backButtonOverrideDepth++;
		return () => {
			backButtonOverrideDepth--;
		};
	}, []);

	useEffect(() => {
		const backButton = wa?.BackButton;
		if (!backSupported || !backButton) return;
		const on = () => {
			hapticImpact('soft');
			handler.current();
		};
		backButton.onClick(on);
		backButton.show();
		return () => {
			backButton.offClick(on);
		};
	}, [wa, backSupported]);
}

/**
 * The SINGLE owner of the Telegram native BackButton (the header chevron).
 *
 * The old per-page approach (each `ModuleShell` show()ing on mount and
 * hide()ing on unmount) lost the race on every module→module navigation:
 * the outgoing page's hide() landed right before the incoming page's show(),
 * and Telegram's header transition drops a show() that immediately follows a
 * hide() — the ✕ CLOSE button stayed instead of the ‹ Back chevron (both
 * Android and iOS). Centralizing the show/hide on the ROUTE means navigating
 * between two module pages never toggles the button at all.
 *
 *  - visible on every screen except `/` and `/app` (the launcher);
 *  - tap = real history back when we pushed the entry ourselves (React Router
 *    stamps `idx` on every entry); a cold deep-link open has nothing to pop,
 *    so it lands on the launcher instead;
 *  - one deferred re-show defeats the same client quirk on first navigation;
 *  - unmount (auth gate kicks us out) always hides the button.
 *
 * The native BackButton ships with Bot API 6.1+ clients ONLY — older clients
 * expose the SDK's stub, which logs "… is not supported in version X" on EVERY
 * method call (telegram-web-app.js), so every touch below is version-gated the
 * same way `useTelegramMainButton` gates the MainButton. On such clients the
 * module pages fall back to the in-page back pill (`ModuleShell` mirrors this
 * gate) — never a screen with no back affordance.
 *
 * Rendered ONCE inside the Router (needs router context) — pages never touch
 * `BackButton` themselves.
 */
export function TelegramBackButtonController() {
	const navigate = useNavigate();
	const { pathname } = useLocation();
	// The bridge can land AFTER this controller mounts (async SDK) — keying the
	// bindings on it arms the button the moment it appears instead of silently
	// no-op'ing forever (the old mount-time `getLiveWebApp()` snapshot missed it).
	const wa = useLiveWebApp();
	// Client-version gate — never call BackButton below Bot API 6.1 (the SDK's
	// stub would log a "not supported in version X" warning on every call).
	const backSupported = !!wa && versionAtLeast(wa, '6.1');

	// Bind the tap handler once per bridge — read the CURRENT history entry at
	// tap time.
	useEffect(() => {
		if (!backSupported) return;
		const backButton = wa?.BackButton;
		if (!backButton) return;
		const onBack = () => {
			// An overlay (crop editor) has taken the button over — its own listener does the work.
			if (backButtonOverrideDepth > 0) return;
			hapticImpact('soft');
			popBack(navigate, '/app');
		};
		backButton.onClick(onBack);
		return () => {
			backButton.offClick(onBack);
		};
	}, [navigate, wa, backSupported]);

	// Mirror the route onto the button — the ONLY place that shows/hides it.
	// NOTE: deliberately NO hide() in this effect's cleanup (that is exactly the
	// hide→show ping-pong this controller exists to remove). Unmount-only hide
	// lives in the effect below.
	useEffect(() => {
		const backButton = wa?.BackButton;
		if (!backSupported || !backButton) return;
		if (ROOT_PATHS.has(pathname)) {
			backButton.hide();
			return;
		}
		backButton.show();
		// Belt-and-braces retry: a show() racing the WebView's own header
		// transition (first paint after a route change) can be silently dropped
		// by the client — re-show shortly after; show() on an already-visible
		// button is a no-op, so this can't flicker.
		const retry = window.setTimeout(() => backButton.show(), 250);
		return () => {
			window.clearTimeout(retry);
		};
	}, [pathname, wa, backSupported]);

	// Unmount-only hide (session expiry → auth gate) — never runs on navigation.
	useEffect(() => {
		const backButton = wa?.BackButton;
		if (!backSupported || !backButton) return;
		return () => {
			backButton.hide();
		};
	}, [wa, backSupported]);

	return null;
}

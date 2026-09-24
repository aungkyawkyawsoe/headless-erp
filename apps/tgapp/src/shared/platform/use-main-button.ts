import { useEffect, useRef, useState } from 'react';
import { useOverlayOpen } from '@mmbix/design-system/sheet';

import { useLiveWebApp } from './use-live-web-app';
import { getLiveWebApp, versionAtLeast } from './telegram';

/** Telegram MainButton colors must be `#RRGGBB`, but the app's theme tokens are
 *  CSS `oklch()` variables — resolve through a 1px canvas (the browser does the
 *  color-space conversion), returning null when the value can't be parsed. */
function cssColorToHex(cssColor: string): string | null {
	if (typeof document === 'undefined' || !cssColor) return null;
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext('2d');
	if (!ctx) return null;
	ctx.fillStyle = '#010203'; // sentinel — an unparsable value leaves this untouched
	ctx.fillStyle = cssColor;
	if (ctx.fillStyle === '#010203') return null;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** The MainButton pair of the ACTIVE scheme — `--primary` button + `--primary-
 *  foreground` label (dark theme flips both: light button, dark text). */
function themeMainButtonColors(): { color?: string; text_color?: string } {
	if (typeof document === 'undefined') return {};
	const rootStyle = getComputedStyle(document.documentElement);
	return {
		color: cssColorToHex(rootStyle.getPropertyValue('--primary').trim()) ?? undefined,
		text_color: cssColorToHex(rootStyle.getPropertyValue('--primary-foreground').trim()) ?? undefined,
	};
}

interface MainButtonOptions {
	/** The button label (Burmese renders fine on Android/Desktop; iOS clips it). */
	text: string;
	/** Click handler — read through a ref, so a new identity never rebinds. */
	onClick: () => void;
	/** Show the native button (default true) — set false to tuck it away. */
	visible?: boolean;
	/** Disabled state — Telegram grays the button out, clicks are swallowed. */
	disabled?: boolean;
	/** Loading state — shows the native spinner and blocks re-submits. */
	loading?: boolean;
}

/**
 * Declarative Telegram MainButton (Bot API 6.1+) control, mirroring how
 * `ModuleShell` drives the native BackButton:
 *
 *  - inside a live Telegram client (version ≥ 6.1) the NATIVE bottom button is
 *    shown with `text`, enabled/disabled per `disabled`, spinner per `loading`;
 *  - EXCEPT on iOS: the native MainButton is drawn by the Telegram client
 *    itself — the WebView's CSS cannot touch it, and iOS renders the Burmese
 *    label with a tight line-height that clips the stacked glyphs (ကျ, ွ, ့…
 *    cut off at the bottom). The Bot API exposes only text/color, so there is
 *    no way to fix the rendering — on `iphone`/`ipad`/`macos` this hook
 *    returns `false` and the page falls back to the in-page button, which
 *    carries the `leading-myanmar` line-height fix;
 *  - the hook returns `true` ONLY when the native button is the active control
 *    (a supported platform AND the caller asked for it via `visible`), so the
 *    page hides its in-page button — never both, the same rule as the
 *    BackButton pill. A caller that hides the native button (`visible: false`,
 *    e.g. an in-sheet host or a page whose own BottomActionBar owns the bottom
 *    edge) therefore gets `false` and MUST render its in-page fallback, or the
 *    form would have NO submit affordance at all;
 *  - in a plain browser (dev) it returns `false` and the page renders its own
 *    fallback button instead;
 *  - unmount always hides the button + unbinds the click so a stale handler can
 *    never fire on the next screen.
 */

/** True on Apple Telegram clients, where the native MainButton's line-height
 *  clips Burmese text (see the hook doc). Covers both the WebApp-reported
 *  platform and the injected bridge user-agent (`Telegram-iOS/…`). */
function isAppleTelegramClient(): boolean {
	const platform = getLiveWebApp()?.platform;
	if (platform === 'iphone' || platform === 'ipad' || platform === 'macos') return true;
	try {
		return /Telegram-(iOS|Mac)/.test(navigator.userAgent);
	} catch {
		return false;
	}
}

export function useTelegramMainButton({ text, onClick, visible = true, disabled = false, loading = false }: MainButtonOptions): boolean {
	// The bridge can land AFTER this hook mounts (async SDK) — keying the bind
	// on it arms the native button the moment it appears instead of reporting
	// "unsupported" forever (the old mount-time snapshot missed it).
	const wa = useLiveWebApp();
	// Any open bottom sheet / picker (the design-system's scroll-lock counter) —
	// the client draws the native MainButton OVER the WebView's bottom edge, so a
	// sheet slides UNDER it and is partly hidden; tuck the button away for as long
	// as any overlay is open, whatever opened it. This is the ONE place that
	// reacts to overlays, so a new sheet can never forget to wire itself in.
	const overlayOpen = useOverlayOpen();
	const [supported, setSupported] = useState(false);
	const [themeColors, setThemeColors] = useState<{ color?: string; text_color?: string }>({});
	// Bumped whenever Telegram announces a NATIVE scheme flip: the client
	// re-applies its own button_color from themeParams on every flip — including
	// the ones OUR Settings page triggers via `setColorScheme` — clobbering the
	// pair set below. The bump re-runs the mirror effect so our colors land LAST.
	const [nativeSchemeTick, setNativeSchemeTick] = useState(0);
	const handlerRef = useRef(onClick);
	handlerRef.current = onClick;

	// Resolve the theme's button/label pair once, and again whenever <html>'s
	// `data-theme`/`class` flips light ↔ dark (see platform/theme.ts).
	useEffect(() => {
		if (typeof document === 'undefined') return;
		const read = () => setThemeColors(themeMainButtonColors());
		read();
		const observer = new MutationObserver(read);
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
		return () => observer.disconnect();
	}, []);

	// Bind once per bridge — the handler ref keeps the latest callback without
	// rebinding. Apple clients are skipped entirely: the native button clips
	// Burmese text (no CSS access, Bot API has no font controls) → in-page
	// fallback instead.
	useEffect(() => {
		if (isAppleTelegramClient()) return;
		const mainButton = wa?.MainButton;
		if (!wa || !mainButton || !versionAtLeast(wa, '6.1')) return;
		setSupported(true);
		const handler = () => handlerRef.current();
		mainButton.onClick(handler);
		// Native scheme flips (user OS change, or OUR setColorScheme from the
		// Settings theme changer) make the client reset the button to its own
		// themeParams — bump so the mirror effect re-applies OUR pair after the
		// reset. The next-frame pass covers clients that reset after dispatching.
		const bump = () => {
			setNativeSchemeTick((n) => n + 1);
			requestAnimationFrame(() => setNativeSchemeTick((n) => n + 1));
		};
		wa.onEvent('themeChanged', bump);
		return () => {
			wa.offEvent('themeChanged', bump);
			mainButton.offClick(handler);
			mainButton.hideProgress();
			mainButton.hide();
		};
	}, [wa]);

	// Mirror the declarative state onto the native button. An open overlay always
	// wins over `visible`: the sheet is what the user is looking at.
	const shown = visible && !overlayOpen;

	useEffect(() => {
		if (!supported) return;
		const mainButton = wa?.MainButton;
		if (!mainButton) return;
		mainButton.setParams({
			text,
			is_visible: shown,
			is_active: !disabled && !loading,
			// Theme-synced button/label colors (Telegram's default blue is NOT
			// our primary); undefined lets Telegram keep its own value.
			color: themeColors.color,
			text_color: themeColors.text_color,
		});
		if (!shown) {
			mainButton.hide();
			return;
		}
		mainButton.show();
		if (loading) mainButton.showProgress(false);
		else mainButton.hideProgress();
	}, [supported, text, shown, disabled, loading, themeColors, nativeSchemeTick, wa]);

	// The boolean the page's `{!isMainButton && …}` gate keys on must mean "the
	// native button is the submit affordance" — NOT merely "the platform
	// supports one". Returning bare `supported` told an in-sheet host or a
	// `nativeSubmit={false}` page that the native button was up while the hook
	// had actually hidden it (`visible: false`), so the page suppressed its
	// in-page fallback too and NO submit affordance rendered (the truck-page
	// licence / policy / incident renewal forms). The native button is only the
	// control when it was requested visible; while a caller keeps `visible:
	// false` the fallback MUST show.
	return supported && visible;
}

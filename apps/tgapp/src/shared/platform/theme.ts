import { applyTelegramChromeColors, isTelegram, tg } from './telegram';

export type Scheme = 'light' | 'dark';
/** User-selectable preference — `system` follows the client (Telegram colorScheme / OS). */
export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_STORAGE_KEY = 'mmbix-theme';
const SYSTEM_SCHEME_QUERY = '(prefers-color-scheme: dark)';
/** Browser-chrome tints (meta theme-color) — must match the index.html head script. */
const THEME_COLOR: Record<Scheme, string> = { light: '#EDF0F4', dark: '#111213' };

/** The client's own scheme — Telegram's `colorScheme`, else the OS preference. */
export function systemScheme(): Scheme {
	if (isTelegram) return tg.colorScheme === 'light' ? 'light' : 'dark';
	if (typeof window !== 'undefined' && window.matchMedia(SYSTEM_SCHEME_QUERY).matches) {
		return 'dark';
	}
	// Plain browser (dev/preview): LIGHT is the app's default scheme.
	return 'light';
}

/** Collapse a preference to a concrete scheme — `system` follows the client. */
export function resolveScheme(preference: ThemePreference): Scheme {
	return preference === 'system' ? systemScheme() : preference;
}

/** Read the persisted preference; invalid/absent → `system` (never throws). */
export function loadThemePreference(): ThemePreference {
	try {
		const stored = localStorage.getItem(THEME_STORAGE_KEY);
		if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
	} catch {
		/* storage unavailable (private mode) — fall through to the default */
	}
	return 'system';
}

/** Subscribe to OS scheme flips so `system` followers update live. Returns unlisten. */
export function onSystemSchemeChange(callback: (scheme: Scheme) => void): () => void {
	if (typeof window === 'undefined') return () => {};
	const media = window.matchMedia(SYSTEM_SCHEME_QUERY);
	const handler = () => callback(media.matches ? 'dark' : 'light');
	media.addEventListener('change', handler);
	return () => media.removeEventListener('change', handler);
}

/** Tag <html> so CSS `[data-theme]` applies, set `color-scheme`, sync browser chrome. */
export function applyScheme(scheme: Scheme): void {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	root.dataset.theme = scheme;
	root.style.colorScheme = scheme;
	// Keep the design-system's class-based theme (`.dark` / `.light`, driven by
	// its ThemeProvider) in lock-step with the app's `data-theme`, so DS
	// components and the app content always share one theme instead of diverging.
	root.classList.toggle('dark', scheme === 'dark');
	root.classList.toggle('light', scheme === 'light');
	// Browser chrome (address bar / status bar) follows the scheme too.
	const meta = document.querySelector('meta[name="theme-color"]');
	if (meta) meta.setAttribute('content', THEME_COLOR[scheme]);
	// Paint the Telegram WebView's OWN canvas to the same color. It defaults to the
	// CLIENT's background (often a different color from this app's palette), and
	// shows through as a hard flash whenever the page does not fully cover the
	// viewport — most visibly while the on-screen keyboard animates. Kept here (not
	// just at init) so an in-app theme switch repaints it live.
	applyTelegramChromeColors(THEME_COLOR[scheme]);
}

/**
 * Persist the user's theme preference and apply it everywhere at once: the
 * app tokens (`data-theme`), the design-system classes, the meta theme-color
 * and — inside Telegram (Bot API 7.10+, where the bot allows it) — the NATIVE
 * client scheme. Every step is individually guarded so older clients just
 * keep the app-level theme.
 */
export function applyThemePreference(preference: ThemePreference): Scheme {
	try {
		localStorage.setItem(THEME_STORAGE_KEY, preference);
	} catch {
		/* no-op */
	}
	const scheme = resolveScheme(preference);
	applyScheme(scheme);
	try {
		if (isTelegram) tg.setColorScheme?.(scheme);
	} catch {
		/* pre-7.10 client — the app-level theme still applies */
	}
	return scheme;
}

/** Call before first render (also mirrored in index.html <head>) — avoids a theme
 * flash. Honors the user's persisted preference (explicit light/dark wins). */
export function applyInitialTheme(): void {
	applyScheme(resolveScheme(loadThemePreference()));
}

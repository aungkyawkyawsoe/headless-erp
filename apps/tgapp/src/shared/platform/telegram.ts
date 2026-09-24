/**
 * Minimal Telegram WebApp bridge — no SDK dependency.
 *
 * `window.Telegram.WebApp` is injected by the Telegram client when the app
 * opens inside Telegram; it is absent in a plain browser (dev), so we fall
 * back to a neutral stub and the app renders a "not in Telegram" state.
 *
 * The session arrives THREE ways (all covered by `getLiveInitData()` /
 * `hasLiveTelegramSession()`):
 *  - the native WebView bridge → `window.Telegram.WebApp.initData` (mobile apps)
 *  - URL query params → `?tgWebAppData=<initData>` (Telegram Desktop / tablet
 *    open the Mini App in a separate window and pass launch params this way)
 *  - the t.me deep-link fallback → `#tgWebAppData=<initData>` hash fragment
 *    (in-app/external browser launches)
 */
/** `LocationData` from `WebApp.LocationManager.getLocation()` (Bot API 8.0+). */
export interface TelegramLocationData {
	latitude: number;
	longitude: number;
	altitude: number | null;
	course: number | null;
	speed: number | null;
	horizontal_accuracy: number | null;
	vertical_accuracy: number | null;
	course_accuracy: number | null;
	speed_accuracy: number | null;
}

export interface TelegramWebApp {
	initData: string;
	initDataUnsafe: {
		user?: { id: number; first_name?: string; last_name?: string; username?: string };
		start_param?: string;
	};
	colorScheme: 'light' | 'dark';
	themeParams: Record<string, string>;
	version?: string;
	/** Client platform identifier ('android' | 'iphone' | 'tdesktop' | 'web' | 'unknown'). */
	platform?: string;
	ready(): void;
	expand(): void;
	close(): void;
	/** Prevent swipe-down to minimize (Mini Apps 7.7+). */
	disableVerticalSwipes?(): void;
	/** Enter true fullscreen mode (Bot API 8.0+) — content extends under the native header. */
	requestFullscreen?(): void;
	/** Whether the client is currently in true fullscreen (Bot API 8.0+). */
	isFullscreen?: boolean;
	/** Color behind the status bar / native controls in fullscreen (Bot API 6.1+). */
	setHeaderColor?(color: string): void;
	/** The WebView's OWN background canvas (Bot API 6.1+) — what shows through
	 *  wherever the page does not fully cover the viewport. */
	setBackgroundColor?(color: string): void;
	/** The native bottom bar / Android navigation-bar color (Bot API 7.10+). */
	setBottomBarColor?(color: string): void;
	/** Force the native client's light/dark scheme (Bot API 7.10+, bot must opt in). */
	setColorScheme?(colorScheme: 'light' | 'dark'): void;
	/** Device safe-area insets (notch, home indicator) — Bot API 8.0+. */
	safeAreaInset?: { top: number; right: number; bottom: number; left: number };
	/** Insets to avoid overlapping Telegram UI (native back chevron, ⋮ menu) — Bot API 8.0+. */
	contentSafeAreaInset?: { top: number; right: number; bottom: number; left: number };
	/** Native back button (Bot API 6.1+, fullscreen Mini Apps) — the top-left
	 *  chevron. Older clients expose a stub whose methods log "… not supported in
	 *  version X" on every call — version-gate (6.1+) before touching it. */
	BackButton?: {
		isVisible: boolean;
		show(): void;
		hide(): void;
		onClick(callback: () => void): void;
		offClick(callback: () => void): void;
	};
	/**
	 * Native bottom main button (Bot API 6.1+) — the one button Telegram pins to
	 * the bottom of the Mini App. Used for primary actions (e.g. submitting the
	 * စောပြန်ခွင့် form); plain browsers get an in-page fallback instead.
	 */
	MainButton?: {
		text: string;
		color: string;
		textColor: string;
		isVisible: boolean;
		isActive: boolean;
		isProgressVisible: boolean;
		setText(text: string): unknown;
		onClick(callback: () => void): void;
		offClick(callback: () => void): void;
		show(): void;
		hide(): void;
		enable(): void;
		disable(): void;
		/** `leaveActive = false` also disables the button while the spinner shows. */
		showProgress(leaveActive?: boolean): void;
		hideProgress(): void;
		setParams(params: { text?: string; color?: string; text_color?: string; is_visible?: boolean; is_active?: boolean }): unknown;
	};
	/** Native location manager (Bot API 8.0+). Flow: `init()` → `getLocation(cb)`;
	 * the client shows its own permission prompt. Mobile platforms only — on
	 * desktop/web `isLocationAvailable` stays false. */
	LocationManager?: {
		isInited: boolean;
		isLocationAvailable: boolean;
		isAccessRequested: boolean;
		isAccessGranted: boolean;
		init(callback?: () => void): void;
		getLocation(callback: (data: TelegramLocationData | null) => void): void;
		openSettings(): void;
	};
	onEvent(eventType: string, eventHandler: (payload?: unknown) => void): void;
	offEvent(eventType: string, eventHandler: (payload?: unknown) => void): void;
	HapticFeedback?: {
		notificationOccurred(type: 'error' | 'success' | 'warning'): void;
		impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
		selectionChanged(): void;
	};
}

declare global {
	interface Window {
		Telegram?: { WebApp?: TelegramWebApp };
	}
}

const native = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

export const tg: TelegramWebApp = native ?? {
	initData: '',
	initDataUnsafe: {},
	themeParams: {},
	colorScheme: 'dark',
	ready: () => {},
	expand: () => {},
	close: () => {},
	onEvent: () => {},
	offEvent: () => {},
};

/**
 * True when the live WebApp client version meets `required` ("7.7", "8.0", …).
 *
 * The official SDK ships a stub for EVERY API regardless of client version, and
 * each stub logs a "… is not supported in version X" warning when invoked below
 * its minimum version — so callers must version-gate BEFORE calling, not just
 * check method presence (e.g. `disableVerticalSwipes` warns on < 7.7).
 */
export function versionAtLeast(wa: Pick<TelegramWebApp, 'version'>, required: string): boolean {
	if (!wa.version) return false;
	const have = wa.version.split('.').map((n) => Number(n) || 0);
	const need = required.split('.').map((n) => Number(n) || 0);
	const len = Math.max(have.length, need.length);
	for (let i = 0; i < len; i++) {
		const a = have[i] ?? 0;
		const b = need[i] ?? 0;
		if (a !== b) return a > b;
	}
	return true;
}

/** The full init handshake — ready/expand/swipe-lock + fullscreen/safe-area + chrome colors. */
function applyInit(wa: TelegramWebApp): () => void {
	wa.ready();
	wa.expand();
	// Prevent swipe-down to minimize (Mini Apps 7.7+) — version-gated so the
	// SDK stub doesn't log "Changing swipes behavior is not supported" on
	// older clients.
	if (versionAtLeast(wa, '7.7')) wa.disableVerticalSwipes?.();
	// Paint the WebView canvas to the app's resolved background — the head script
	// and `applyScheme` keep the meta theme-color in sync, so this covers the
	// late-arriving-bridge case (where `applyScheme` ran before the bridge existed).
	applyTelegramChromeColors();
	return setupFullscreenSafeArea(wa);
}

/**
 * The app's current chrome color, read from the `meta[name=theme-color]` tag the
 * index.html head script and `shared/platform/theme.ts#applyScheme` keep in sync
 * with the resolved theme. Falls back to Telegram's own `bg_color` keyword (the
 * tag is written before first paint, so this is effectively unreachable).
 */
function currentThemeColor(): string {
	const meta = typeof document !== 'undefined' ? document.querySelector('meta[name="theme-color"]')?.getAttribute('content') : null;
	return meta || 'bg_color';
}

/**
 * Paint the Telegram WebView's OWN chrome (canvas background + header + bottom
 * bar) to match the app theme.
 *
 * The WebView canvas defaults to the CLIENT's background, which is frequently a
 * DIFFERENT color from this app's palette (e.g. a user on a dark Telegram theme
 * running this light app). Any moment the page does not fully cover the WebView —
 * most visibly the few frames while the on-screen keyboard animates/resizes the
 * viewport — that canvas shows through as a hard flash (the "black screen blink").
 * Setting it to the app's background makes the reveal seamless.
 *
 * Best-effort and version-gated: older clients simply keep their default.
 */
export function applyTelegramChromeColors(color: string = currentThemeColor()): void {
	const wa = getLiveWebApp();
	if (!wa) return;
	try {
		if (versionAtLeast(wa, '6.1')) wa.setBackgroundColor?.(color);
		if (versionAtLeast(wa, '7.10')) wa.setBottomBarColor?.(color);
		// Also tints the status-bar controls: in fullscreen the header is transparent,
		// and this color decides contrasting icon colors — so it must be the app's
		// background, not Telegram's (`bg_color`), when the two diverge (e.g. the user
		// forces light mode in-app while their Telegram client is dark).
		if (versionAtLeast(wa, '6.1')) wa.setHeaderColor?.(color);
	} catch {
		/* chrome coloring is cosmetic — never break init on an old/stub client */
	}
}

/**
 * Tell Telegram the app is ready, expand, and lock the vertical swipe.
 *
 * Returns a dispose function: cancels a still-pending late-bridge retry and
 * unsubscribes the fullscreen/safe-area listeners. StrictMode/HMR double
 * mounts must never double-subscribe — the App effect calls the dispose.
 */
export function initTelegramApp(): () => void {
	markTelegramRoot();
	let disposed = false;
	let retryTimer: ReturnType<typeof setTimeout> | undefined;
	let teardown: (() => void) | undefined;

	const wa = getLiveWebApp();
	if (wa) {
		teardown = applyInit(wa);
	} else {
		// The SDK script is async and the native bridge can land a tick after our
		// module evaluates — retry with the FULL handshake (ready/expand/swipe
		// lock included, not just the safe-area mirror) once it lands.
		let tries = 0;
		const retry = () => {
			if (disposed) return;
			const live = getLiveWebApp();
			if (live) {
				markTelegramRoot();
				teardown = applyInit(live);
			} else if (++tries < 10) retryTimer = setTimeout(retry, 150);
		};
		retryTimer = setTimeout(retry, 150);
	}

	return () => {
		disposed = true;
		if (retryTimer) clearTimeout(retryTimer);
		teardown?.();
	};
}

/**
 * Tag <html data-tg-app="true"> when the launch context is Telegram — the CSS
 * 92px native-header floor (`pt-tg`) is scoped to this attribute, so a plain
 * browser never reserves space for a header it doesn't have. The index.html
 * head script tags it before first paint (UA + URL launch params); this
 * confirms it once the live bridge/session is available.
 */
function markTelegramRoot(): void {
	if (typeof document === 'undefined') return;
	if (isTelegramApp()) document.documentElement.dataset.tgApp = 'true';
}

/**
 * May a `viewportChanged` payload re-apply the safe-area insets?
 *
 * The event fires on EVERY visible-section change, including each frame of the
 * on-screen keyboard's open/close animation (`isStateStable: false`). Writing CSS
 * vars mid-animation forces the WebView to repaint while it is resizing — the
 * "black screen blink" on focus. The stable event (`isStateStable: true`) always
 * follows, and the insets themselves only change on orientation/fullscreen (which
 * have their own events), so unstable frames can be skipped safely.
 */
export function shouldReapplyInsets(payload?: unknown): boolean {
	return (payload as { isStateStable?: boolean } | undefined)?.isStateStable !== false;
}

/** True fullscreen + native-chrome safe-area handling (Bot API 8.0+; best-effort).
 *  Returns an unsubscribe — StrictMode/HMR double mounts must release the
 *  listeners instead of stacking a second set on the same bridge. */
function setupFullscreenSafeArea(wa: TelegramWebApp): () => void {
	try {
		// True fullscreen (Bot API 8.0+): content extends under the native
		// header, so the layout must reserve the back-chevron + ⋮ menu areas.
		if (versionAtLeast(wa, '8.0')) {
			wa.requestFullscreen?.();
			// Optimistic: once the request resolves, content WILL extend under
			// the native header and the `pt-tg` 92px strip floor applies. The
			// flag is scoped to fullscreen in CSS, so non-fullscreen clients
			// (older Telegram versions, or a refused request → `fullscreenFailed`)
			// never get the phantom 92px gap that made top padding vary by
			// device. `fullscreenChanged` keeps it honest with the live state.
			markFullscreen(true);
		}
		// Header/status-bar + WebView-canvas colors are owned by
		// `applyTelegramChromeColors` (called from `applyInit` and on every theme
		// change) so the native chrome follows the APP's palette, not Telegram's.
		applySafeAreaInsets();
		const onFullscreenChanged = () => {
			markFullscreen(wa.isFullscreen === true);
			applySafeAreaInsets();
		};
		const onFullscreenFailed = () => markFullscreen(false);
		const onInsetChanged = () => applySafeAreaInsets();
		// Insets do not change with the on-screen keyboard — only while the viewport
		// itself is animating. Re-writing the CSS vars on every UNSTABLE frame makes
		// the WebView repaint mid-animation (the keyboard-open flash/blink); the
		// stable event always follows, so skipping unstable frames loses nothing.
		const onViewportChanged = (payload?: unknown) => {
			if (!shouldReapplyInsets(payload)) return;
			applySafeAreaInsets();
		};
		const events: Array<[string, (payload?: unknown) => void]> = [
			['fullscreenChanged', onFullscreenChanged],
			['fullscreenFailed', onFullscreenFailed],
			['contentSafeAreaChanged', onInsetChanged],
			['safeAreaChanged', onInsetChanged],
			['viewportChanged', onViewportChanged],
		];
		for (const [event, handler] of events) wa.onEvent(event, handler);
		return () => {
			for (const [event, handler] of events) wa.offEvent(event, handler);
		};
	} catch {
		// fullscreen/safe-area support is best-effort — never break init
		return () => {};
	}
}

/**
 * Tag <html data-tg-fullscreen> — the CSS 92px native-header floor (`pt-tg`)
 * is scoped to this attribute, so only true-fullscreen sessions reserve the
 * native header strip. Re-applied on every fullscreen event.
 */
function markFullscreen(on: boolean): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.tgFullscreen = on ? 'true' : 'false';
}

/**
 * Mirror Telegram's safe-area insets onto :root CSS variables. The SDK usually
 * injects these itself, but setting them explicitly (and re-applying on every
 * inset/viewport/fullscreen change) guarantees the layout is correct even on
 * SDK versions that lag the client, and removes any ordering dependency.
 * ContentSafeAreaInset.top is the native header strip height (status bar +
 * back-chevron row) — pt-tg uses it directly.
 */
function applySafeAreaInsets(): void {
	const wa = getLiveWebApp();
	if (!wa || typeof document === 'undefined') return;
	const root = document.documentElement;
	const set = (name: string, v: number | undefined) => {
		// The API reports px as bare numbers — always write the unit. A unitless
		// custom property (e.g. `--tg-content-safe-area-inset-top: 59`) makes
		// max()/calc() invalid and silently zeroes the padding declaration.
		// An ABSENT/0 inset REMOVES the property instead of writing '' — an empty
		// custom property is still "defined" for var(), so the pt-tg / pb-safe
		// max() would resolve var() to '' and invalidate the whole declaration
		// (padding drops to 0 — confirm buttons sit flush at the sheet edge).
		// Removing it lets the CSS fallbacks take over instead.
		if (v != null) root.style.setProperty(name, `${v}px`);
		else root.style.removeProperty(name);
	};
	const content = wa.contentSafeAreaInset;
	// Only write a reported inset when it's actually non-zero — a 0/absent
	// value lets the CSS fallbacks (92px strip / 44px status bar) take over
	// everywhere instead of zeroing the padding/backdrop heights.
	set('--tg-content-safe-area-inset-top', content?.top || undefined);
	set('--tg-content-safe-area-inset-right', content?.right || undefined);
	set('--tg-content-safe-area-inset-bottom', content?.bottom || undefined);
	set('--tg-safe-area-inset-top', wa.safeAreaInset?.top || undefined);
	set('--tg-safe-area-inset-right', wa.safeAreaInset?.right || undefined);
	set('--tg-safe-area-inset-bottom', wa.safeAreaInset?.bottom || undefined);
}

export const isTelegram = Boolean(native);

// ─── Live access (auth gate must never trust the load-time snapshot) ─────────

/**
 * The WebApp SDK can land a tick after our module evaluates (native clients
 * inject it through the WebView bridge, async on slow networks). Auth code
 * therefore polls `getLiveWebApp()` instead of trusting the load snapshot.
 */
export function getLiveWebApp(): TelegramWebApp | undefined {
	return typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;
}

/**
 * The last non-empty initData seen this page-load, plus a reload-survivable
 * sessionStorage cache: a RELOAD (Telegram Desktop/tablet/web pass the session
 * ONLY via URL) would otherwise lose the session entirely — login threw
 * "session unavailable" and the gate wrongly fell to the pending screen with no
 * tg id. sessionStorage is per-tab WebView scope and is restored (fresh
 * auth_date ≤ 24h only) whenever no live source is available.
 */
let lastKnownInitData = '';
/** The last session string written to sessionStorage — getters skip re-writes
 *  when nothing changed (storage churn on every read otherwise). */
let lastPersistedInitData: string | null = null;
const INITDATA_STORE_KEY = 'mmbix:tg:initData';

function isFreshInitData(initData: string): boolean {
	const m = initData.match(/(?:^|&)auth_date=(\d+)/);
	const authDate = m ? Number(m[1]) : NaN;
	return Number.isFinite(authDate) && Date.now() / 1000 - authDate <= 24 * 60 * 60;
}

/** The Telegram user id embedded in an initData string (`user={"id":…}`) —
 *  null when absent/unparsable. */
function tgUserIdOf(initData: string): number | null {
	if (!initData) return null;
	try {
		const raw = new URLSearchParams(initData).get('user');
		if (!raw) return null;
		const user = JSON.parse(raw) as { id?: unknown };
		return typeof user.id === 'number' ? user.id : null;
	} catch {
		return null;
	}
}

/** The current session's user id as best we know it — live/URL initData first,
 *  then the injected bridge's `initDataUnsafe` (present even when `initData`
 *  itself is empty on some clients). Null when no identity is knowable. */
function currentTgUserId(): number | null {
	const live = getLiveWebApp()?.initData || tg.initData || initDataFromUrl() || '';
	const fromData = tgUserIdOf(live);
	if (fromData != null) return fromData;
	return getLiveWebApp()?.initDataUnsafe?.user?.id ?? tg.initDataUnsafe.user?.id ?? null;
}

/** Persist a session for reload-survival, scoped to its user id — a stale
 *  session (auth_date > 24h) is never resurrected, and an unchanged value skips
 *  the storage write entirely (these getters run on every auth-gate read). */
function persistInitData(initData: string): void {
	if (initData === lastPersistedInitData) return;
	if (!isFreshInitData(initData)) return;
	lastPersistedInitData = initData;
	try {
		sessionStorage.setItem(INITDATA_STORE_KEY, JSON.stringify({ user_id: tgUserIdOf(initData), initData }));
	} catch {
		// storage unavailable — the in-memory cache still covers this page-load
	}
}

/** The stored session for the CURRENT user — restored only when the persisted
 *  user id matches the caller's: a WebView context reused across accounts must
 *  never replay the previous user's session. A `null` identity (the reload
 *  case — no live/URL source at all) cannot be verified and restores as before. */
function restoreInitData(currentUserId: number | null): string {
	try {
		const raw = sessionStorage.getItem(INITDATA_STORE_KEY);
		if (!raw) return '';
		const stored = JSON.parse(raw) as { user_id?: number | null; initData?: string };
		const initData = stored.initData;
		if (!initData || typeof initData !== 'string') return ''; // legacy/unparsable payload
		if (!isFreshInitData(initData)) return '';
		if (currentUserId != null && stored.user_id != null && stored.user_id !== currentUserId) return '';
		return initData;
	} catch {
		return '';
	}
}

/**
 * Drop every cached initData source (in-memory + sessionStorage) — used after a
 * signature-rejection 401: the string the server saw doesn't verify, so a Retry
 * must re-read only a freshly acquired LIVE Telegram session instead of
 * replaying any cached/restored copy. (A cached string carries its ORIGINAL
 * signature, so replaying it can never turn a failure into a success — clearing
 * it guarantees the retry reflects the launch the client actually sees now.)
 */
export function clearPersistedInitData(): void {
	lastKnownInitData = '';
	lastPersistedInitData = null;
	try {
		sessionStorage.removeItem(INITDATA_STORE_KEY);
	} catch {
		// storage unavailable — the in-memory reset above still applies
	}
}

/** Live initData — '' outside Telegram or before the SDK is ready. */
export function getLiveInitData(): string {
	// `||` (not `??`): the stub/browser snapshot carries an EMPTY initData string,
	// which must fall through to the URL launch params instead of short-circuiting.
	const live = getLiveWebApp()?.initData || tg.initData || initDataFromUrl() || '';
	if (live) {
		lastKnownInitData = live;
		persistInitData(live); // survives a reload (see INITDATA_STORE_KEY)
	}
	if (!lastKnownInitData) lastKnownInitData = restoreInitData(currentTgUserId());
	return live || lastKnownInitData;
}

/**
 * URL fallback for when the native bridge is NOT injected (no WebView):
 * Telegram passes the session as `tgWebAppData=<urlencoded initData>` either
 * in the query string (`?tgWebAppData=…` — Desktop/tablet launch in a separate
 * window with launch params) or in the hash (`#tgWebAppData=…` — t.me
 * deep-link / in-app browser). The official SDK script parses both too — this
 * covers the window before that script has executed (or if it fails to load).
 */
export function initDataFromUrl(): string {
	try {
		const loc = typeof window !== 'undefined' ? window.location : undefined;
		if (!loc) return '';
		// Parse the fragment as standard form-encoded params and read ONLY the
		// `tgWebAppData` value — never slice + decodeURIComponent the raw string.
		// Telegram appends its own launch params (`tgWebAppVersion`,
		// `tgWebAppPlatform`, `tgWebAppThemeParams`, …) AFTER `tgWebAppData` in the
		// same fragment, so a raw slice pulls those into the initData. They are not
		// part of the signed data-check-string, so the server's HMAC never matches
		// and the launch fails with "Invalid Telegram initData signature" — the
		// first-launch report, since the async SDK's own (correct) parse lands a
		// moment later and the retry then succeeds. URLSearchParams is the exact
		// parser the server verifies with, so client and server can never drift.
		const fromHash = new URLSearchParams(loc.hash.replace(/^#/, '')).get('tgWebAppData');
		if (fromHash) return fromHash;
		return new URLSearchParams(loc.search).get('tgWebAppData') ?? '';
	} catch {
		return '';
	}
}

/**
 * Live `initDataUnsafe` — the `user`/`start_param` fields parsed from the LIVE
 * initData string. The module-load `tg` snapshot is captured before the async
 * SDK script parses the URL launch params, so consumers that need the user id
 * (auth gate, pending screen) must read live, not the snapshot.
 */
export function getLiveInitDataUnsafe(): TelegramWebApp['initDataUnsafe'] {
	const initData = getLiveInitData();
	if (!initData) return {};
	try {
		const params = new URLSearchParams(initData);
		const unsafe: TelegramWebApp['initDataUnsafe'] = {};
		const userRaw = params.get('user');
		if (userRaw) unsafe.user = JSON.parse(userRaw) as TelegramWebApp['initDataUnsafe']['user'];
		const startParam = params.get('start_param');
		if (startParam) unsafe.start_param = startParam;
		return unsafe;
	} catch {
		return {};
	}
}

/**
 * Is a Telegram session currently LIVE? Bridge initData always counts; URL
 * launch params (`?tgWebAppData=` query — Desktop/tablet — or the
 * `#tgWebAppData=` fragment — t.me deep-link) count ONLY while fresh
 * (auth_date ≤ 24h) — a stale leftover in a plain browser (copy-pasted Mini App
 * URL) must fall through to the browser login screen, not the Telegram path.
 */
export function hasLiveTelegramSession(): boolean {
	const live = getLiveWebApp()?.initData;
	if (live) return true;
	const urlData = initDataFromUrl();
	// sessionStorage restore — a RELOAD of a URL-session tab (Desktop/tablet/web)
	// has neither bridge initData nor launch params, but the persisted session
	// is still valid. Fresh-only (≤ 24h) and same-user-only (a URL session for a
	// different account never adopts the stored one).
	const data = urlData || restoreInitData(tgUserIdOf(urlData));
	if (!data) return false;
	const m = data.match(/(?:^|&)auth_date=(\d+)/);
	const authDate = m ? Number(m[1]) : NaN;
	return Number.isFinite(authDate) && Date.now() / 1000 - authDate <= 24 * 60 * 60;
}

/**
 * Telegram's native clients stamp the WebView user-agent (`Telegram-Android/…`,
 * `Telegram-iOS/…`, `TelegramDesktop/…`, `TelegramBot/…`). A UA hit proves the
 * app is running INSIDE a Telegram client even before the async SDK script has
 * injected the bridge — the auth gate uses it so a slow/failed SDK can never
 * fall through to the browser login screen.
 */
export function isTelegramUserAgent(): boolean {
	try {
		return /Telegram/.test(navigator.userAgent);
	} catch {
		return false;
	}
}

/**
 * Layout-level Telegram detection — synchronous and true from the very first
 * render, no SDK wait needed. Native clients match on the UA; the bridge
 * initData or URL launch params (`?tgWebAppData=` / `#tgWebAppData=`) cover the
 * rest. Staleness is deliberately NOT checked here — that is the auth gate's
 * job (`hasLiveTelegramSession`); layout should follow the launch context.
 */
export function isTelegramApp(): boolean {
	if (isTelegramUserAgent()) return true;
	if (typeof window === 'undefined') return false;
	if (getLiveWebApp()?.initData) return true;
	return Boolean(initDataFromUrl());
}

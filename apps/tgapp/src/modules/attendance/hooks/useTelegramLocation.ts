import { useCallback, useEffect, useRef, useState } from 'react';

import { getLiveWebApp, versionAtLeast } from '@/shared/platform/telegram';

/** Normalized fix, regardless of which channel delivered it. */
export interface TelegramLocation {
	lat: number;
	lng: number;
	/** Horizontal accuracy in meters (0 when the platform doesn't report one). */
	accuracy: number;
}

type LocationState =
	| { status: 'idle' }
	| { status: 'requesting' }
	| { status: 'available'; location: TelegramLocation }
	| { status: 'denied'; reason: string }
	| { status: 'unavailable'; reason: string };

export type { LocationState };

/** Where the current fix came from — 'web' = WebView/browser geolocation (the
 *  PRIMARY channel), 'native' = the Telegram LocationManager fallback. */
export type LocationSource = 'web' | 'native' | null;

/** Overall budget for the PRIMARY browser acquisition. A GPS lock usually
 *  converges in a few seconds; this is the ceiling before the best fix seen so
 *  far is used (mirrors the mex-hr attendance app: 15s). */
const BROWSER_TIMEOUT_MS = 15000;
/** A fix at/below this accuracy is trusted immediately — the GPS has converged. */
const CONVERGED_ACCURACY_M = 30;
/** A KNOWN accuracy above this ceiling means the fix is too coarse to trust. */
const ACCEPTABLE_ACCURACY_M = 100;
/** Fallback (native LocationManager) init()/getLocation() deadline. */
const NATIVE_TIMEOUT_MS = 12000;
/** Gap before re-asking the native manager when it answered from its cache. */
const NATIVE_RECHECK_GAP_MS = 2000;
/** Max times the native fallback re-asks after a cached-echo answer. */
const MAX_NATIVE_RECHECKS = 1;
/** (0,0)-ish "null island" fixes are never a real position. */
const NULL_ISLAND_TOLERANCE = 1e-4;

/* ── Session memory of the last ACCEPTED fix ────────────────────────────────
 * Only the NATIVE fallback consults this. The Telegram client answers
 * `LocationManager.getLocation()` from its OWN location cache — instantly
 * serving the SAME position it returned earlier instead of acquiring a fresh
 * GPS lock — so when the fallback hands back a bit-identical position (the
 * cache-echo signature) we refuse to trust it and re-ask once (see
 * `beginNative` below).
 *
 * Persisted in sessionStorage (the repo's per-tab convention, same as the
 * initData restore in shared/platform/telegram.ts) because the client's cache
 * also survives a Mini App reload. The PRIMARY browser channel never does echo
 * detection: with `maximumAge: 0` every watchPosition answer is a fresh
 * acquisition, and an identical coordinate simply means the user hasn't moved.
 * ─────────────────────────────────────────────────────────────────────────── */
const LAST_FIX_KEY = 'tgapp-attendance-last-fix';

function readLastFix(): TelegramLocation | null {
	try {
		const raw = sessionStorage.getItem(LAST_FIX_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { lat?: unknown; lng?: unknown; accuracy?: unknown };
		if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number' && typeof parsed.accuracy === 'number') {
			return { lat: parsed.lat, lng: parsed.lng, accuracy: parsed.accuracy };
		}
	} catch {
		// Storage unavailable/blocked — the echo guard just starts cold.
	}
	return null;
}

function writeLastFix(fix: TelegramLocation): void {
	try {
		sessionStorage.setItem(LAST_FIX_KEY, JSON.stringify(fix));
	} catch {
		// Non-fatal — the fix still applies for this page's lifetime.
	}
}

let lastAcceptedFix = readLastFix();

/** Whether two fixes are the same to ~1 cm — the signature of the Telegram
 *  client serving its CACHED copy of the previous fix instead of re-locking
 *  GPS. A real re-acquisition at the same spot always differs in the trailing
 *  decimals and/or the accuracy. */
function isCachedEcho(fix: TelegramLocation, previous: TelegramLocation): boolean {
	return Math.abs(fix.lat - previous.lat) < 1e-7 && Math.abs(fix.lng - previous.lng) < 1e-7 && fix.accuracy === previous.accuracy;
}

function accuracyKnown(accuracy: number): boolean {
	return Number.isFinite(accuracy) && accuracy > 0;
}

/** A fix is usable when it is not the (0,0) null island and, when the platform
 *  reports a horizontal accuracy, it is within the acceptable ceiling. Unknown
 *  accuracy is ACCEPTED — some clients never report one, and the primary
 *  channel's `maximumAge: 0` acquisition is fresh by construction, so there is
 *  no stale-position risk to guard against there. */
function isUsable(fix: TelegramLocation): boolean {
	if (Math.abs(fix.lat) < NULL_ISLAND_TOLERANCE && Math.abs(fix.lng) < NULL_ISLAND_TOLERANCE) return false;
	return !accuracyKnown(fix.accuracy) || fix.accuracy <= ACCEPTABLE_ACCURACY_M;
}

/** Keeps the most precise known-accuracy fix seen by the browser watcher. */
function betterFix(current: TelegramLocation | null, candidate: TelegramLocation): TelegramLocation {
	return current !== null && current.accuracy <= candidate.accuracy ? current : candidate;
}

/** Why the PRIMARY browser channel failed (kept so the fallback / final state
 *  can surface the actionable reason when the native manager can't help). */
type BrowserFailure =
	{ kind: 'denied'; message: string } | { kind: 'unavailable'; message: string } | { kind: 'imprecise'; message: string };

/**
 * Precise location for the punch dialog + early-leave form.
 *
 * Acquisition strategy (verified in the field on the mex-hr attendance app):
 *
 *   1. BROWSER geolocation is the PRIMARY channel. `watchPosition` with
 *      `enableHighAccuracy: true` + `maximumAge: 0` forces the OS to produce a
 *      brand-new GPS fix on EVERY open — the Telegram mobile WebView inherits
 *      the location permission the user already granted the Telegram app, so
 *      this works inside the Mini App. Fixes converge: a fix at/below
 *      CONVERGED_ACCURACY_M is accepted immediately; otherwise the most precise
 *      fix seen by the BROWSER_TIMEOUT_MS ceiling is used.
 *   2. The Telegram NATIVE `LocationManager` is the FALLBACK, only when the
 *      browser channel is missing/denied/timed-out/too coarse. Its
 *      `getLocation()` answers from the client's own location cache — repeated
 *      calls return the same value — which is exactly the "showing the old
 *      requested location" bug. The fallback therefore refuses a bit-identical
 *      answer (cache echo), re-asks once after a short gap, and hard-blocks if
 *      the client still cannot produce a different fix.
 *
 * The user must NEVER proceed on a stale or unverifiable position: the callers
 * keep confirm/submit disabled until `status === 'available'`, and a fresh fix
 * that is (0,0) or reports an accuracy above ACCEPTABLE_ACCURACY_M is rejected.
 *
 * `retry()` restarts the whole chain from the browser channel; after a NATIVE
 * denial it first opens Telegram's settings sheet (`openSettings()`), since a
 * re-prompt alone can't recover a refused access.
 */
export function usePreciseLocation(): {
	state: LocationState;
	retry: () => void;
	source: LocationSource;
} {
	const [state, setState] = useState<LocationState>({ status: 'idle' });
	const [source, setSource] = useState<LocationSource>(null);
	const disposedRef = useRef(false);
	// Monotonic acquisition id: every begin() bumps it, and a callback from an
	// older round (watchPosition / native callbacks cannot be cancelled) is
	// dropped instead of double-settling the state.
	const chainRef = useRef(0);
	const watchIdRef = useRef<number | null>(null);
	const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const bestRef = useRef<TelegramLocation | null>(null);
	const nativeRechecksRef = useRef(0);
	const openSettingsOnRetryRef = useRef(false);

	const teardown = useCallback(() => {
		if (watchIdRef.current !== null) {
			navigator.geolocation.clearWatch(watchIdRef.current);
			watchIdRef.current = null;
		}
		if (timerRef.current !== null) {
			clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const accept = useCallback(
		(fix: TelegramLocation) => {
			lastAcceptedFix = fix;
			writeLastFix(fix);
			teardown();
			chainRef.current += 1; // orphan any still-pending callback of this round
			setState({ status: 'available', location: fix });
		},
		[teardown],
	);

	const fail = useCallback(
		(status: 'denied' | 'unavailable', reason: string) => {
			teardown();
			chainRef.current += 1; // orphan a late answer that can still arrive after a timeout
			setState(status === 'denied' ? { status: 'denied', reason } : { status: 'unavailable', reason });
		},
		[teardown],
	);

	const beginNativeRef = useRef<(failure: BrowserFailure | null) => void>(() => {});
	const beginBrowserRef = useRef<() => void>(() => {});

	// 2 ── NATIVE fallback: only entered when the browser channel above failed.
	beginNativeRef.current = (webFailure) => {
		const wa = getLiveWebApp();
		const lm = wa?.LocationManager;
		const chain = ++chainRef.current;
		teardown();

		// No native manager (client too old / desktop / plain browser) — there is
		// nothing left to try. Surface the browser failure if we have one, since
		// that is what the user can act on.
		if (!wa || !lm || !versionAtLeast(wa, '8.0')) {
			if (webFailure) fail(webFailure.kind === 'denied' ? 'denied' : 'unavailable', webFailure.message);
			else fail('unavailable', 'This Telegram client does not provide precise location');
			return;
		}

		setSource('native');
		setState({ status: 'requesting' });

		// One round of init()/getLocation(), each with its own deadline. The
		// deadline covers a client that never invokes the init/getLocation
		// callback (observed on some clients), so the UI can never hang on
		// "Finding your location…" forever.
		const fetchFix = () => {
			if (disposedRef.current || chain !== chainRef.current) return;
			teardown();
			if (lm.isLocationAvailable === false) {
				fail('unavailable', 'Location services are disabled — enable GPS and try again');
				return;
			}
			timerRef.current = setTimeout(() => {
				if (disposedRef.current || chain !== chainRef.current) return;
				fail('unavailable', 'Could not get a precise location in time — enable GPS and try again');
			}, NATIVE_TIMEOUT_MS);
			try {
				lm.getLocation((data) => {
					if (disposedRef.current || chain !== chainRef.current) return;
					teardown(); // the answer arrived — cancel this round's deadline
					if (!data || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
						if (lm.isAccessRequested && !lm.isAccessGranted) {
							openSettingsOnRetryRef.current = true;
							fail('denied', 'Location access denied — enable it in the Telegram settings sheet');
						} else if (lm.isLocationAvailable === false) {
							fail('unavailable', 'Location services are disabled — enable GPS and try again');
						} else {
							fail('unavailable', 'Could not determine the current position — try again');
						}
						return;
					}
					const fix: TelegramLocation = {
						lat: data.latitude,
						lng: data.longitude,
						accuracy: typeof data.horizontal_accuracy === 'number' ? data.horizontal_accuracy : 0,
					};
					// A bit-identical repeat of the last accepted fix is the client
					// answering from ITS location cache, not a fresh acquisition.
					// Re-ask once after a short gap (the OS may re-lock in between);
					// if it still echoes, hard-block — the user must never proceed
					// on a position we cannot verify is current.
					if (lastAcceptedFix && isCachedEcho(fix, lastAcceptedFix)) {
						if (nativeRechecksRef.current < MAX_NATIVE_RECHECKS) {
							nativeRechecksRef.current += 1;
							setState({ status: 'requesting' });
							timerRef.current = setTimeout(() => {
								if (disposedRef.current || chain !== chainRef.current) return;
								fetchFix();
							}, NATIVE_RECHECK_GAP_MS);
							return;
						}
						fail(
							'unavailable',
							'The Telegram client keeps returning the previous position — could not get a fresh one. Try again in a moment.',
						);
						return;
					}
					if (!isUsable(fix)) {
						fail('unavailable', 'The reported position is not precise enough — move to open sky and try again');
						return;
					}
					accept(fix);
				});
			} catch {
				fail('unavailable', 'The Telegram client could not provide a location — try again');
			}
		};

		// The init callback is also covered: if init() itself never answers, the
		// deadline fires and the attempt ends (never a hang).
		try {
			if (lm.isInited) fetchFix();
			else {
				timerRef.current = setTimeout(() => {
					if (disposedRef.current || chain !== chainRef.current) return;
					fail('unavailable', 'Could not get a precise location in time — enable GPS and try again');
				}, NATIVE_TIMEOUT_MS);
				lm.init(() => {
					if (disposedRef.current || chain !== chainRef.current) return;
					fetchFix();
				});
			}
		} catch {
			fail('unavailable', 'The Telegram client could not provide a location — try again');
		}
	};

	// 1 ── BROWSER (primary). A fresh fix per open, GPS-converged.
	beginBrowserRef.current = () => {
		const chain = ++chainRef.current;
		teardown();
		bestRef.current = null;
		nativeRechecksRef.current = 0;
		openSettingsOnRetryRef.current = false;

		const webFail = (failure: BrowserFailure) => {
			beginNativeRef.current(failure);
		};

		if (!('geolocation' in navigator)) {
			webFail({ kind: 'unavailable', message: 'Geolocation is not supported in this WebView' });
			return;
		}

		setSource('web');
		setState({ status: 'requesting' });

		// No valid fix inside the budget — accept the best usable one seen, or
		// hand over to the native fallback when there is none / it is too coarse.
		timerRef.current = setTimeout(() => {
			if (disposedRef.current || chain !== chainRef.current) return;
			const best = bestRef.current;
			if (best) {
				if (isUsable(best)) {
					accept(best);
				} else {
					webFail({ kind: 'imprecise', message: 'The location fix is not precise enough — enable GPS / move to open sky and try again' });
				}
				return;
			}
			webFail({ kind: 'unavailable', message: 'Could not get a location fix in time — enable GPS and try again' });
		}, BROWSER_TIMEOUT_MS);

		try {
			const watchId = navigator.geolocation.watchPosition(
				(position) => {
					if (disposedRef.current || chain !== chainRef.current) return;
					const coords = position.coords;
					if (
						typeof coords.latitude !== 'number' ||
						typeof coords.longitude !== 'number' ||
						!Number.isFinite(coords.latitude) ||
						!Number.isFinite(coords.longitude)
					) {
						return;
					}
					const fix: TelegramLocation = {
						lat: coords.latitude,
						lng: coords.longitude,
						accuracy: typeof coords.accuracy === 'number' ? coords.accuracy : 0,
					};
					// (0,0)-ish "null island" — keep watching for a real fix.
					if (Math.abs(fix.lat) < NULL_ISLAND_TOLERANCE && Math.abs(fix.lng) < NULL_ISLAND_TOLERANCE) return;
					// Unknown accuracy or a converged fix is trusted immediately;
					// coarser fixes keep the GPS streaming so it can improve.
					if (!accuracyKnown(fix.accuracy) || fix.accuracy <= CONVERGED_ACCURACY_M) {
						accept(fix);
						return;
					}
					bestRef.current = betterFix(bestRef.current, fix);
				},
				(error) => {
					if (disposedRef.current || chain !== chainRef.current) return;
					const denied = error.code === error.PERMISSION_DENIED;
					webFail(
						denied
							? { kind: 'denied', message: 'Location permission denied — allow location for Telegram and try again' }
							: { kind: 'unavailable', message: 'GPS signal unavailable — enable location services and try again' },
					);
				},
				{ enableHighAccuracy: true, timeout: BROWSER_TIMEOUT_MS, maximumAge: 0 },
			);
			watchIdRef.current = watchId;
		} catch {
			webFail({ kind: 'unavailable', message: 'The WebView refused the location request' });
		}
	};

	// Auto-request when the owning dialog/page mounts (both surfaces mount per
	// open, so every open is a fresh acquisition). The cleanup disposes the
	// mount: StrictMode double-mounts simply bump the chain and restart, and a
	// late callback from the first mount is dropped via `disposedRef`/chain.
	useEffect(() => {
		disposedRef.current = false;
		beginBrowserRef.current();
		return () => {
			disposedRef.current = true;
			teardown();
			chainRef.current += 1;
		};
	}, [teardown]);

	const retry = useCallback(() => {
		const lm = getLiveWebApp()?.LocationManager;
		// A denied NATIVE request can't re-prompt — open the settings sheet.
		if (openSettingsOnRetryRef.current && lm?.isAccessRequested && !lm.isAccessGranted) {
			try {
				lm.openSettings();
			} catch {
				// Non-fatal — the browser re-acquisition below still runs.
			}
		}
		beginBrowserRef.current();
	}, []);

	return { state, retry, source };
}

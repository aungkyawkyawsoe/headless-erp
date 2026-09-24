import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@mmbix/design-system/button';
import { HttpError } from '@mmbix/sdk';

import { clearToken, fetchMe, getToken, refreshMe, telegramLogin } from '@/shared/auth';
import { PageSpinner } from '@/shared/components/page-spinner';
import type { TelegramLoginResult } from '@/shared/auth';
import { clearPersistedInitData, getLiveInitDataUnsafe, hasLiveTelegramSession, isTelegramUserAgent } from '@/shared/platform/telegram';
import { DevLoginScreen } from './dev-login-screen';
import { LoginScreen } from './login-screen';
import { PendingScreen } from './pending-screen';

type GateState = 'loading' | 'ready' | 'pending' | 'error' | 'dev' | 'login';

/** The gate's decision (the screen + the data it needs to paint). */
interface GateOutcome {
	state: GateState;
	result: TelegramLoginResult | null;
	error: string | null;
}

/**
 * The auth decision resolved so far for THIS page load, memoized at module
 * scope (a reload re-evaluates the module, so the session is re-checked fresh).
 *
 * StrictMode's Suspense-triggered remounts and HMR can mount `<AuthGate>`
 * several times during one load; without this cache every mount re-runs the
 * session check, so a plain reload hits `/auth/me` once per mount (three in dev).
 * Each mount seeds from this cache, so only the first performs a boot.
 */
let settled: GateOutcome = { state: 'loading', result: null, error: null };

// The server's signature-rejection phrase — matched (not exact) because the
// API may append a parenthetical detail (e.g. "hash missing") after it.
const SIGNATURE_ERROR = 'Invalid Telegram initData signature';

/**
 * Auth gate — wraps every route.
 * - No stored token → exchange the Telegram session (or the dev fallback user)
 *   for a token.
 * - Stored token → validate it server-side on every load: the approval gate
 *   (hrm_employees.etg_id) can revoke a session at any time, so a stale token
 *   must never survive a reload. A 401 means the Telegram link was removed →
 *   drop the token and re-login (lands on the pending screen). Any other
 *   failure (network / 5xx) keeps the session — never lock out on a hiccup.
 * - approved → render children
 * - pending  → ဝင်ခွင့်မရှိပါ screen (the Telegram ID is not registered in the
 *              HR employees directory — the user copies their ID and contacts
 *              HR, then re-checks)
 * - login   → plain browser in production (no Telegram session): email +
 *              password sign-in (accounts with a real password — admins/HR).
 *              Real Telegram launches never land here (see decideBoot).
 * - error    → retry screen (in-Telegram session missing/stale / API unreachable)
 */
export function AuthGate({ children }: { children: ReactNode }) {
	const [outcome, setOutcome] = useState<GateOutcome>(settled);
	// True once this load's boot has started (the SAME page's later remounts —
	// StrictMode/HMR — must not re-run the session check).
	const started = useRef(settled.state !== 'loading');

	const commit = useCallback((next: GateOutcome) => {
		settled = next;
		setOutcome(next);
	}, []);

	const tryLogin = useCallback(async () => {
		// Re-point THIS gate at the spinner (and clear a prior error/pending) while
		// a manual retry / re-check runs — a fresh document load re-boots anyway.
		setOutcome({ state: 'loading', result: null, error: null });
		try {
			const res = await telegramLogin();
			// Warm `/auth/me` the instant the token lands, BEFORE the route mounts.
			// The login response carries no `employee_id`/`apps`, so without this the
			// dashboard starts a 3-hop serial chain (me → employee → summary) on the
			// first launch of the day; with it the memo is resolving as the route
			// paints, so the summary starts after ONE round trip. `fetchMe` coalesces
			// its in-flight call, so a screen that also asks for it pays nothing extra.
			if (res.status === 'approved') void fetchMe().catch(() => {});
			commit({ state: res.status === 'approved' ? 'ready' : 'pending', result: res, error: null });
		} catch (err) {
			console.error('[auth] login failed', err);
			// A signature rejection means the initData string the server verified
			// doesn't match the configured bot token. If this load replayed a
			// cached (sessionStorage-restored) session, drop it so a Retry re-reads
			// only the LIVE Telegram session — never a replay of the failed string.
			if (err instanceof HttpError && err.status === 401 && err.message.includes(SIGNATURE_ERROR)) {
				clearPersistedInitData();
			}
			commit({ state: 'error', result: null, error: err instanceof Error ? err.message : String(err) });
		}
	}, [commit]);

	/** Server-side session check for an existing token — see the class doc. */
	const validateSession = useCallback(async () => {
		// Paint the route IMMEDIATELY: a token exists and every request authorizes
		// itself, so `/auth/me` runs ALONGSIDE the route's own reads instead of
		// blocking them. Blocking here cost a full serial round trip before ANY
		// page data on every returning open (the fresh-login path already never
		// waits on `/auth/me`). A definitive 401 below still revokes + re-logs-in.
		commit({ state: 'ready', result: null, error: null });
		try {
			await fetchMe();
		} catch (err) {
			if (err instanceof HttpError && err.status === 401) {
				// Revoked (the employee's tg_id was removed from the directory) or no
				// longer verifiable — drop the stale token and re-run login so the
				// user lands on the pending screen with a fresh login answer.
				clearToken();
				if (hasLiveTelegramSession() || import.meta.env.DEV || isTelegramUserAgent()) {
					await tryLogin();
				} else {
					// Browser user whose session was revoked → the password screen.
					commit({ state: 'login', result: null, error: null });
				}
			}
			// Any other failure (a network hiccup) keeps the session — the route is
			// already painting and owns its own error states.
		}
	}, [commit, tryLogin]);

	/** Boot decision when there is no stored token.
	 *  - A live Telegram session (bridge initData / fresh URL launch params) logs
	 *    in automatically.
	 *  - Dev build without a session → the dev demo screen.
	 *  - A Telegram client whose bridge/SDK is still landing (UA hit, no session
	 *    yet) → try login; if it is genuinely empty the retry screen explains it
	 *    (re-open from Telegram) — never a browser password form inside Telegram.
	 *  - Anything else = a plain browser in production → the password login screen.
	 *    The official SDK script also bootstraps an empty WebApp stub in plain
	 *    browsers, so object presence alone must NOT count as "inside Telegram" —
	 *    the Telegram UA is the reliable signal. */
	const decideBoot = useCallback(() => {
		if (hasLiveTelegramSession()) {
			void tryLogin();
		} else if (import.meta.env.DEV) {
			// Plain-browser dev, no session yet — pause on a dev screen that shows THIS
			// browser's unique demo Telegram ID (copyable) so the developer can register
			// it as the employee's tg_id before signing in. Real Telegram sessions (dev
			// or prod) skip straight to login.
			commit({ state: 'dev', result: null, error: null });
		} else if (isTelegramUserAgent()) {
			void tryLogin();
		} else {
			commit({ state: 'login', result: null, error: null });
		}
	}, [commit, tryLogin]);

	useEffect(() => {
		if (started.current) return;
		started.current = true;
		if (getToken()) {
			void validateSession();
		} else {
			decideBoot();
		}
	}, [commit, tryLogin, validateSession, decideBoot]);

	// On resume, re-check the session server-side: `/auth/me` is memoized for the
	// page load, so a Telegram link revoked (etg_id removed) while the app stayed
	// open would otherwise never log the user out, and a role change would never
	// reach this gate. Only a definitive 401 acts — a network blip must not lock
	// the user out.
	// Boot that never settles (Telegram initData not injected / API unreachable)
	// must not spin forever — after a generous window, switch to the retry screen
	// so the user sees an actionable state instead of an indefinite spinner.
	useEffect(() => {
		if (outcome.state !== 'loading') return;
		const id = window.setTimeout(() => {
			commit({ state: 'error', result: null, error: 'Sign-in timed out. Please try again.' });
		}, 20_000);
		return () => window.clearTimeout(id);
	}, [outcome.state, commit]);

	useEffect(() => {
		if (outcome.state !== 'ready') return;
		let alive = true;
		const onVisible = () => {
			if (document.visibilityState !== 'visible') return;
			void refreshMe().catch((err) => {
				if (!alive) return;
				if (err instanceof HttpError && err.status === 401) {
					clearToken();
					if (hasLiveTelegramSession() || import.meta.env.DEV || isTelegramUserAgent()) {
						void tryLogin();
					} else {
						commit({ state: 'login', result: null, error: null });
					}
				}
			});
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			alive = false;
			document.removeEventListener('visibilitychange', onVisible);
		};
	}, [outcome.state, tryLogin, commit]);

	const { state, result, error } = outcome;

	if (state === 'dev') {
		// Sign-in re-runs the normal Telegram-login path (dev payload for THIS
		// browser's id); the directory gate then answers approved or pending.
		return <DevLoginScreen onSignIn={() => void tryLogin()} />;
	}

	if (state === 'login') {
		// Plain browser in production — email + password sign-in. Success lands
		// straight on the app (password accounts are never directory-gated).
		return <LoginScreen onSignedIn={() => commit({ state: 'ready', result: null, error: null })} />;
	}

	if (state === 'loading') {
		return <PageSpinner />;
	}

	if (state === 'pending') {
		// The login answer carries the failing tg_id (+ username when the user
		// has one); fall back to the live Telegram session identity (the same
		// source the login used) when the answer is missing either field.
		const unsafe = getLiveInitDataUnsafe();
		const pending = result && 'tg_id' in result ? result : null;
		const tgId = pending?.tg_id ?? (unsafe.user?.id != null ? String(unsafe.user.id) : null);
		const fullName = pending?.full_name ?? null;
		const username = pending?.username ?? unsafe.user?.username ?? null;
		return <PendingScreen tgId={tgId} fullName={fullName} username={username} onRetry={() => void tryLogin()} />;
	}

	if (state === 'error') {
		const isDev = import.meta.env.DEV;
		return (
			<div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
				<h1 className="text-xl font-bold">Could not sign in</h1>
				{error && <p className="max-w-sm wrap-break-word text-sm text-destructive">{error}</p>}
				<p className="text-sm text-muted-foreground">
					{isDev
						? 'Dev mode — the API must be running on :8788 with IS_DEV=true (apps/api/.dev.vars).'
						: 'Open this Mini App from Telegram.'}
				</p>
				{!isDev && error?.includes(SIGNATURE_ERROR) && (
					<p className="max-w-sm text-xs text-muted-foreground">
						This can happen when the app is opened from an old link or a different bot. Close this screen and reopen the Mini App from the
						bot&apos;s menu button, then try again.
					</p>
				)}
				<Button onClick={() => void tryLogin()}>{isDev ? 'Sign in as dev user' : 'Retry'}</Button>
			</div>
		);
	}

	return <>{children}</>;
}

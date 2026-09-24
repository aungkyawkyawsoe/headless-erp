import { sdk } from './api/sdk';
import { getLiveInitData } from './platform/telegram';
import { HttpError, NetworkError } from '@mmbix/sdk';

const TOKEN_KEY = 'tgapp-token';

// ── Per-browser dev identity ────────────────────────────────────────────────
// Plain-browser (no Telegram) dev logins need a DISTINCT identity per browser,
// so tests across two browsers/computers exercise different Telegram users
// (own-records reads, per-employee tasks/attendance, RBAC) instead of everyone
// sharing one fixed id. Each browser persists its OWN id in localStorage —
// stable across reloads/tabs on that browser, unique across browsers/machines.
const DEV_ID_STORE_KEY = 'mmbix:dev:device';

export interface DevDevice {
	/** The tg id this browser signs in as (a positive integer, telegram-style). */
	id: number;
	/** Display name sent to the API as the dev user's first_name. */
	name: string;
}

/** A fresh id — 9-digit positive integer in the telegram user-id range. */
function randomDevId(): number {
	return Math.floor(1e8 + Math.random() * 9e8);
}

function createDevDevice(): DevDevice {
	const id = randomDevId();
	return { id, name: `Dev ${id}` };
}

function persistDevDevice(device: DevDevice): void {
	try {
		localStorage.setItem(DEV_ID_STORE_KEY, JSON.stringify(device));
	} catch {
		// storage unavailable — the in-memory value returned by getDevDevice still
		// covers this page load (the caller falls back to it before re-persisting)
	}
}

/**
 * THIS browser's dev identity — read once, then stable until `resetDevDevice()`.
 * `window` / storage is guarded so a storage-disabled context still yields a
 * usable id for the current load.
 */
export function getDevDevice(): DevDevice {
	try {
		const raw = localStorage.getItem(DEV_ID_STORE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as { id?: unknown; name?: unknown };
			if (typeof parsed.id === 'number' && Number.isInteger(parsed.id) && typeof parsed.name === 'string') {
				return parsed as DevDevice;
			}
		}
	} catch {
		// fall through to a new identity below
	}
	const device = createDevDevice();
	persistDevDevice(device);
	return device;
}

/** Replace this browser's dev identity with a fresh one (for a second test user). */
export function resetDevDevice(): DevDevice {
	const device = createDevDevice();
	persistDevDevice(device);
	return device;
}

export function getToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function setToken(token: string): void {
	localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
	localStorage.removeItem(TOKEN_KEY);
}

// The login session types are defined by the SDK (single source of truth) —
// re-exported here so the app's auth surface keeps its own names.
import type { SessionUser, TelegramLoginResult } from '@mmbix/sdk';
export type { SessionUser, TelegramLoginResult };

/**
 * Exchange the Telegram session (or the dev fallback user) for API access —
 * through the SDK auth, which stores the minted JWT in the SAME token storage
 * this module owns (so every transport agrees on one session).
 * - inside Telegram → real initData (validated by the worker)
 * - plain browser (dev build) → the worker accepts a dev user payload when IS_DEV
 *
 * The worker answers `pending` with HTTP 200 + `{ status: 'pending', tg_id,
 * full_name }` — the SDK returns that object as-is (it only stores the token on
 * `approved`), so a pending user is resolved by the caller's status check, not
 * by catching an error.
 */
export async function telegramLogin(): Promise<TelegramLoginResult> {
	const initData = getLiveInitData();
	if (!initData && !import.meta.env.DEV) {
		throw new Error('Telegram session unavailable — re-open the Mini App');
	}
	if (initData) return sdk.auth.login(initData);
	// Plain browser (dev) — no Telegram session: exchange THIS browser's dev
	// identity (persisted per browser, see DEV_ID_STORE_KEY) for a token. The
	// API accepts it only when running with IS_DEV=true
	// (apps/api/.dev.vars) — surface an actionable hint when it doesn't.
	const dev = getDevDevice();
	try {
		return await sdk.auth.devLogin({ id: dev.id, first_name: dev.name });
	} catch (err) {
		throw new Error(devLoginHint(err), { cause: err });
	}
}

/** Turn a failed dev login into a message that tells the developer what to fix. */
function devLoginHint(err: unknown): string {
	if (err instanceof HttpError) {
		const detail = err.message ? `: ${err.message}` : '';
		if (err.status === 502) {
			// The Vite proxy couldn't reach the API target (connection refused).
			return 'Cannot reach the API through the dev proxy — is `pnpm --filter @mmbix/api dev` running on :8788?';
		}
		if (err.status >= 500) {
			return `Dev login rejected by the API (${err.status})${detail} — run the API with IS_DEV=true in apps/api/.dev.vars and restart it`;
		}
		return `Dev login failed (${err.status})${detail}`;
	}
	if (err instanceof NetworkError) {
		return 'Cannot reach the API — is `pnpm --filter @mmbix/api dev` running on :8788?';
	}
	return err instanceof Error ? err.message : String(err);
}

/** Browser (non-Telegram) login — email + password against the same _users table. */
export async function loginWithPassword(email: string, password: string): Promise<SessionUser> {
	return sdk.auth.loginPassword(email, password);
}

export interface MeUser {
	user_id: string;
	email: string;
	role_name?: string;
	is_admin?: boolean;
	/** Field whitelist for `collection` (null/absent = no field-level restrictions). */
	field_restrictions?: string[] | null;
	/** Collection slugs this role can read — the launcher's app-access source.
	 *  `'*'` = unrestricted (admin / no role bound); a list = read those; null/
	 *  absent = endpoint answered before this field existed (treat as unknown). */
	granted_collections?: string[] | '*' | null;
	/** Mini-app launcher app ids this role may open (Design-B role→app access, from
	 *  `_roles.app_access`). null/absent ⇒ the role may open every app. */
	apps?: string[] | null;
	/** The acting employee's `hrm_employees.id` — the signed session's answer to
	 *  "who am I acting as" — or null for a session that acts as nobody (the
	 *  bootstrap admin, an unlinked password account). A Telegram employee resolves
	 *  through its directory `etg_id`; a WEB employee through `_users.employee_id`,
	 *  which the server re-validates on every request. Lets a dashboard start
	 *  employee-scoped reads without a second directory lookup. */
	employee_id?: string | null;
}

/** Session check currently in flight — StrictMode/HMR double-mounts (and `fetchMe`
 * callers on the same screen) coalesce into ONE `/auth/me` instead of stacking
 * duplicate round-trips. Mirrors the SDK's `permInflight` coalescing. */
let meInflight: Promise<MeUser> | null = null;

/**
 * The authenticated user, memoized per token for the LIFE of this module load.
 * The AuthGate's boot `/auth/me` answers the session once; every page that only
 * needs identity afterwards — `fetchCurrentTgId` (the tg-id each page derives),
 * `sessionIsAdmin`, ... — reads this instead of re-hitting the endpoint (the
 * duplicate `/auth/me` the attendance route used to fire ~1s after the gate's).
 *
 * The memo is keyed to the token it was fetched under, so a re-login / 401
 * revocation that mints a NEW token never serves a stale `/auth/me`; a full
 * reload re-evaluates this module and re-checks the session fresh.
 */
let meCache: { token: string; user: MeUser } | null = null;

/**
 * Identity listeners — screens whose LAYOUT depends on `/auth/me` (the launcher's
 * role→tiles board) subscribe so a change lands WITHOUT a reload: an admin edits
 * the employee's role in the directory, the AuthGate's resume refresh re-reads
 * `/auth/me`, and the new grants repaint the gallery in place.
 */
type MeListener = (user: MeUser) => void;
const meListeners = new Set<MeListener>();

/** Subscribe to every successful `/auth/me` (memoized or fresh). */
export function subscribeMe(listener: MeListener): () => void {
	meListeners.add(listener);
	return () => {
		meListeners.delete(listener);
	};
}

function publishMe(user: MeUser): void {
	for (const listener of meListeners) listener(user);
}

/**
 * A SYNCHRONOUS peek at the memoized `/auth/me` for the CURRENT token, when it
 * has already been fetched. The AuthGate's boot awaits `fetchMe()` before every
 * route mounts, so an in-page gate (e.g. `useAppAccess`) can render its resolved
 * state on the FIRST paint instead of flashing a loading state for one tick.
 * `null` = not fetched yet (or the token changed since).
 */
export function getCachedMe(): MeUser | null {
	const token = getToken() ?? '';
	return meCache && meCache.token === token ? meCache.user : null;
}

/**
 * Drop the memoized `/auth/me` and read it AGAIN. The memo is keyed to the token
 * and lives for the whole module load — correct for boot (one session check per
 * page) but wrong for an explicit refresh: an admin changing this user's role or
 * permissions, or the Telegram client re-showing a long-lived WebView, must be
 * able to pick up the new grants without a full page reload.
 */
export function refreshMe(collection?: string): Promise<MeUser> {
	meCache = null;
	meInflight = null;
	return fetchMe(collection);
}

/** Current user + (optionally) the role's field whitelist for a collection. */
export function fetchMe(collection?: string): Promise<MeUser> {
	const query = collection ? { collection } : undefined;
	// A call carrying a collection scope is a distinct (already-coalesced upstream)
	// request and never merged with the plain session read.
	if (query) return sdk.request<MeUser>('/auth/me', { query });

	const token = getToken() ?? '';
	// A successfully memoized `/auth/me` for the SAME token is returned directly —
	// don't pay a second network round-trip for what the sender already fetched.
	if (meCache && meCache.token === token) return Promise.resolve(meCache.user);

	if (!meInflight) {
		meInflight = sdk
			.request<MeUser>('/auth/me')
			.then((user) => {
				// Only successes are memoized — a transient failure must not poison the
				// load (later callers fall through and retry the network).
				meCache = { token, user };
				publishMe(user);
				return user;
			})
			.finally(() => {
				meInflight = null;
			});
	}
	return meInflight;
}

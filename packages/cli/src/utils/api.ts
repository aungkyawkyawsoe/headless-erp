/**
 * Single source of truth for talking to the Headless API.
 *
 * Every command file previously rolled its own `getApiUrl` / `apiLogin` /
 * `apiFetch` / `resolveToken` / `getApiUrl` with subtly different shapes.
 * That duplication drifted (different auth fallbacks, different error shapes,
 * one used `Content-Type: application/json` on GETs). This module is the ONE
 * place the base URL, token resolution, request encoding, and error mapping
 * live. Command files import `api`, `token`, or `request`.
 *
 * Resolution order (single, documented):
 *   1. explicit token:  MMBIX_TOKEN | HEADLESS_TOKEN | config.authToken
 *   2. admin login:     MMBIX_ADMIN_EMAIL + MMBIX_ADMIN_PASSWORD (from .env.local)
 *   3. dev fallback:    "dev-token" (only meaningful when IS_DEV=true)
 *
 * Base URL order (matches utils/config.ts):
 *   HEADLESS_API_URL | MMBIX_API_URL env  >  .headlessrc active profile  >  8788
 */
import { getCurrentProfile, loadConfig } from './config.js';
import { resolveAdminCredentials } from './auth.js';

/** Hosts where plain http is acceptable (the CLI sends credentials over the wire). */
function isLocalHost(host: string): boolean {
	return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/** Whether the API host is a local dev server (the only place dev-token works). */
function isLocalApiHost(): boolean {
	try {
		return isLocalHost(new URL(API_BASE).hostname);
	} catch {
		return false;
	}
}

/**
 * The CLI transmits admin credentials and bearer tokens — a remote API must
 * never be reached in clear text. Refuse http:// for anything but localhost.
 */
function assertAllowedApiUrl(url: string): string {
	let host = '';
	try {
		host = new URL(url).hostname;
	} catch {
		return url; // unparseable — fetch will surface the real error later
	}
	if (!isLocalHost(host) && url.startsWith('http://')) {
		throw new Error(
			`Refusing insecure API URL "${url}": the CLI sends credentials and tokens over the wire — use https:// for remote hosts (or set HEADLESS_API_URL/MMBIX_API_URL)`,
		);
	}
	return url;
}

/** Resolved at startup; stable for the process lifetime (stateless callers). */
const _cfg = getCurrentProfile(loadConfig());
const API_BASE = assertAllowedApiUrl(process.env.MMBIX_API_URL || process.env.HEADLESS_API_URL || _cfg.apiUrl || 'http://localhost:8788');

let _resolvedToken: string | null = null;
let _tokenResolving: Promise<string> | null = null;

/** Resolve a bearer token once, cached for the process (idempotent). */
export async function token(): Promise<string> {
	if (_resolvedToken) return _resolvedToken;
	if (!_tokenResolving) {
		_tokenResolving = (async () => {
			const explicit = process.env.MMBIX_TOKEN || process.env.HEADLESS_TOKEN || _cfg.authToken;
			if (explicit) return (_resolvedToken = explicit);

			try {
				const { email, password } = await resolveAdminCredentials();
				const res = await fetch(`${API_BASE}/api/auth/login`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email, password }),
				});
				const body = (await res.json().catch(() => null)) as { success?: boolean; data?: { token?: string } } | null;
				if (res.ok && body?.success && body.data?.token) return (_resolvedToken = body.data.token);
			} catch {
				/* fall through to dev-token */
			}
			// Dev convenience — only valid when the API runs with IS_DEV=true, and
			// NEVER against a remote host: the well-known dev-token would authenticate
			// as that server's admin on any IS_DEV deployment.
			if (isLocalApiHost()) return (_resolvedToken = 'dev-token');
			console.warn(`dev-token fallback is disabled for remote API "${API_BASE}" — set MMBIX_TOKEN (or HEADLESS_TOKEN) instead.`);
			throw new Error(
				`No API token available for ${API_BASE} and the dev-token fallback only works against localhost — set MMBIX_TOKEN (or HEADLESS_TOKEN) to continue`,
			);
		})();
	}
	return _tokenResolving;
}

/** The runtime API base URL (exported so callers don't re-derive it). */
export function baseUrl(): string {
	return API_BASE;
}

/** Whether the error is a connectivity failure (used to print a helpful hint). */
export function isConnectionError(err: unknown): boolean {
	if (!(err instanceof Error)) return false;
	const msg = err.message.toLowerCase();
	return (
		msg.includes('fetch failed') ||
		msg.includes('econnrefused') ||
		msg.includes('enotfound') ||
		msg.includes('connect') ||
		msg.includes('network')
	);
}

/** The standard hint printed when an API call cannot reach the server. */
export function connectionHint(): string {
	return ['  Make sure the dev server is running:', '    npx headless dev', `  Or set MMBIX_API_URL env (default: ${API_BASE})`].join('\n');
}

/**
 * Perform an authenticated API request. Always sends the resolved bearer
 * token; only sets `Content-Type: application/json` when there is a body.
 * Throws a descriptive Error on non-2xx — never returns a partial object, so
 * callers have exactly one success shape to trust.
 */
export async function api<T = unknown>(
	path: string,
	init?: { body?: unknown; headers?: Record<string, string>; method?: string },
): Promise<T> {
	const bearer = await token();
	const resp = await fetch(`${API_BASE}${path}`, {
		method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
		headers: {
			Authorization: `Bearer ${bearer}`,
			...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
			...(init?.headers ?? {}),
		},
		...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
	});
	const body = (await resp.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string };
	if (!resp.ok || body.success === false) {
		throw new Error(body?.error ?? `API error ${resp.status}: ${resp.statusText}`);
	}
	return body.data as T;
}

/** Convenience: read GET (kept for call-sites that previously used apiGet). */
export async function get<T = unknown>(path: string): Promise<T> {
	return api<T>(path);
}

/** Perform a raw (unauthenticated or ad-hoc) request — used by login flows. */
export async function raw(path: string, init?: RequestInit): Promise<Response> {
	return fetch(`${API_BASE}${path}`, init);
}

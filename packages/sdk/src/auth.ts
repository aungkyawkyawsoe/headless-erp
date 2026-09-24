/**
 * Token storage adapters + expiry helpers.
 *
 * The SDK core never touches `localStorage`/`window` at module level — token
 * persistence is injected, so the same client runs in the browser, a
 * Cloudflare Worker (BFF), or Node.
 *
 * Expiry awareness: the server issues 24h JWTs (`exp` claim). The client
 * treats an already-expired token as absent — it re-authenticates up front
 * instead of paying a doomed request + 401 + retry.
 */

export interface TokenStorage {
	get(): string | null;
	set(token: string): void;
	clear(): void;
}

/** In-memory storage — the default; survives SPA navigation, dies on reload. */
export function memoryTokenStorage(): TokenStorage {
	let token: string | null = null;
	return {
		get: () => token,
		set: (t) => {
			token = t;
		},
		clear: () => {
			token = null;
		},
	};
}

/**
 * localStorage-backed storage — survives full reloads (every Telegram launch
 * is a fresh isolate). Accessed via globalThis so the module never crashes in
 * runtimes without a DOM (worker/node).
 */
export function localStorageTokenStorage(key = 'mmbix-sdk-token'): TokenStorage {
	const store = () =>
		(
			globalThis as {
				localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
			}
		).localStorage;
	return {
		get() {
			try {
				return store()?.getItem(key) ?? null;
			} catch {
				return null;
			}
		},
		set(t) {
			try {
				store()?.setItem(key, t);
			} catch {
				/* storage unavailable — memory-only session */
			}
		},
		clear() {
			try {
				store()?.removeItem(key);
			} catch {
				/* ignore */
			}
		},
	};
}

/**
 * Decode the JSON payload of a stored token (custom base64 "payload.sig" JWT —
 * see AuthService.generateToken). Returns null for anything malformed: callers
 * treat that as "cannot tell", never as a verdict.
 */
function decodeTokenPayload(token: string): Record<string, unknown> | null {
	try {
		const decoded = atob(token);
		const lastDot = decoded.lastIndexOf('.');
		if (lastDot === -1) return null;
		const parsed = JSON.parse(decoded.slice(0, lastDot)) as unknown;
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * Decode the `exp` claim from a stored token. Returns null for malformed tokens;
 * callers treat that as "cannot verify → not expired" (never force-discard an
 * unparseable token).
 */
export function tokenExpiryMs(token: string): number | null {
	const exp = decodeTokenPayload(token)?.exp;
	return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
}

/**
 * The STABLE account a token speaks for — the signed `user_id` claim, falling
 * back to `sub`, and finally to the token itself.
 *
 * Why this exists: the server MINTS A FRESH TOKEN on every login/refresh (a new
 * `jti` + `iat` + `exp`), so two tokens for the SAME human never share a byte.
 * Anything that scopes device-local state per account must key on this subject,
 * not on the token string — hashing the token would read one user's re-login as
 * a different account and strand (or discard) their pending work.
 *
 * NOT a security boundary: it decodes an unverified payload, exactly like
 * `tokenExpiryMs`. The authority on identity is always the server, which
 * re-verifies the signature on every request; this only answers the local
 * "is this the same account as before?" question, and an opaque/legacy token is
 * returned as-is so it degrades to per-token scoping rather than to "everyone".
 */
export function tokenSubjectOf(token: string): string {
	const payload = decodeTokenPayload(token);
	const subject = payload?.user_id ?? payload?.sub;
	return typeof subject === 'string' && subject ? subject : token;
}

/**
 * True when the token's exp claim has passed (with skew tolerance). Considered
 * expired `skewMs` BEFORE the server rejects it so the app re-authenticates up
 * front — a small early login is harmless; a late one re-triggers the 401
 * self-heal.
 */
export function isTokenExpired(token: string, skewMs = 30_000): boolean {
	const exp = tokenExpiryMs(token);
	if (exp === null) return false;
	return Date.now() > exp - skewMs;
}

/**
 * Client-side session-token expiry peek — a request SKIP, not an authority.
 *
 * The Studio's bearer token is `base64(payload + "." + hmacHex)` where `payload`
 * is JSON carrying `exp` (see `AuthService.generateToken`). The SERVER is the one
 * authority on whether a token is valid: it re-verifies the HMAC signature AND
 * re-checks `exp` on every request, and a 401 is what drops the session
 * (`setUnauthorizedHandler`). This module deliberately does NOT duplicate that
 * authority — it only answers a narrower, purely local question the client can
 * already answer: "is this token's own `exp` already in the past?".
 *
 * Why it exists: on boot the app used to adopt whatever was in localStorage and
 * render the authed shell, so a session that expired overnight paid one doomed
 * `GET /api/modules` (and its console 401) before the handler swapped in the login
 * screen. Skipping a request we already know the server will reject makes that
 * path cost ZERO round trips.
 *
 * Fail-open by design: anything this cannot parse (`dev-token`, a provider token,
 * a future format) is treated as FRESH, because a skip is only ever allowed when
 * expiry is PROVABLE. A signature-invalid token whose `exp` is still in the future
 * remains the server's call and still costs exactly one 401 — the floor, since no
 * client can adjudicate a signature.
 */

/** Epoch-ms at which the token expires, or `null` when undeterminable. */
export function sessionTokenExpiry(token: string | null | undefined): number | null {
	if (!token) return null;
	try {
		const decoded = atob(token);
		const lastDot = decoded.lastIndexOf('.');
		if (lastDot === -1) return null;
		const payload = JSON.parse(decoded.slice(0, lastDot)) as { exp?: unknown };
		const exp = payload?.exp;
		if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
		// Our tokens carry `exp` in MILLISECONDS (the server compares it against
		// `Date.now()` directly). A value below the ms epoch threshold can only be a
		// seconds-based token, so normalize it — without this, a switch to seconds
		// would read every token as long-expired and force a needless re-login.
		return exp < 1e12 ? exp * 1000 : exp;
	} catch {
		return null;
	}
}

/**
 * `true` unless the token provably expired. Unparseable or `exp`-less tokens are
 * fresh (see the fail-open note above), so this can never lock out a token the
 * server would accept.
 */
export function isSessionTokenFresh(token: string | null | undefined, now: number = Date.now()): boolean {
	const exp = sessionTokenExpiry(token);
	return exp === null || exp > now;
}

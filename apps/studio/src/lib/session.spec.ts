import { describe, expect, it } from 'vitest';
import { isSessionTokenFresh, sessionTokenExpiry } from './session';

/** Mint a token exactly as `AuthService.generateToken` does: b64(payload + "." + hmacHex). */
function mintToken(payload: Record<string, unknown> | string): string {
	const json = typeof payload === 'string' ? payload : JSON.stringify(payload);
	return btoa(`${json}.deadbeefdeadbeef`);
}

const NOW = 1_700_000_000_000;

describe('sessionTokenExpiry', () => {
	it('reads the millisecond `exp` claim out of a real-shaped token', () => {
		const token = mintToken({ jti: 'a', user_id: 'u1', iat: NOW - 1000, exp: NOW + 60_000 });
		expect(sessionTokenExpiry(token)).toBe(NOW + 60_000);
	});

	it('normalizes a seconds-based `exp` instead of reading it as long-expired', () => {
		// 1_700_000_000 seconds → 1_700_000_000_000 ms.
		expect(sessionTokenExpiry(mintToken({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
	});

	it('returns null when expiry cannot be determined — never a guess', () => {
		expect(sessionTokenExpiry(null)).toBeNull();
		expect(sessionTokenExpiry(undefined)).toBeNull();
		expect(sessionTokenExpiry('')).toBeNull();
		// The local `dev-token` and provider tokens have no payload/signature split.
		expect(sessionTokenExpiry('dev-token')).toBeNull();
		// Structural surprises inside an otherwise base64 blob.
		expect(sessionTokenExpiry(btoa('not-json.sig'))).toBeNull();
		expect(sessionTokenExpiry(mintToken({ user_id: 'u1' }))).toBeNull();
		expect(sessionTokenExpiry(mintToken({ exp: 'soon' }))).toBeNull();
		expect(sessionTokenExpiry('!!!not base64!!!')).toBeNull();
	});
});

describe('isSessionTokenFresh', () => {
	it('rejects a provably expired token — the boot-time 401 we used to pay for', () => {
		expect(isSessionTokenFresh(mintToken({ exp: NOW - 1 }), NOW)).toBe(false);
	});

	it('accepts a token whose expiry is still in the future', () => {
		expect(isSessionTokenFresh(mintToken({ exp: NOW + 1 }), NOW)).toBe(true);
	});

	it('treats the exact expiry instant as expired — mirrors the server’s `now > exp`', () => {
		// Server: `Date.now() > parsed.exp` → invalid at exp. So fresh requires exp > now.
		expect(isSessionTokenFresh(mintToken({ exp: NOW }), NOW)).toBe(false);
	});

	it('fails open: a token it cannot adjudicate is fresh, so nothing the server would accept is dropped', () => {
		expect(isSessionTokenFresh('dev-token', NOW)).toBe(true);
		expect(isSessionTokenFresh(null, NOW)).toBe(true);
		expect(isSessionTokenFresh(undefined, NOW)).toBe(true);
		expect(isSessionTokenFresh('', NOW)).toBe(true);
	});
});

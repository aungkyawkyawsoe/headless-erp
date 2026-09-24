import { describe, expect, it } from 'vitest';
import { isTokenExpired, memoryTokenStorage, tokenExpiryMs, tokenSubjectOf } from '../src/auth';

/** Build a token in the server's exact format: btoa(payload + '.' + sig). */
function makeToken(exp: number): string {
	const payload = JSON.stringify({ jti: 'x', user_id: 'u', iat: exp - 86_400_000, exp });
	return btoa(payload + '.deadbeef');
}

describe('tokenExpiryMs / isTokenExpired', () => {
	it('decodes the exp claim from a server-shaped token', () => {
		const exp = Date.now() + 3_600_000;
		const token = makeToken(exp);
		expect(tokenExpiryMs(token)).toBe(exp);
	});

	it('treats an unparseable token as NOT expired (conservative)', () => {
		expect(tokenExpiryMs('garbage')).toBeNull();
		expect(isTokenExpired('garbage')).toBe(false);
	});

	it('flags expired tokens (with skew tolerance)', () => {
		expect(isTokenExpired(makeToken(Date.now() - 3_600_000))).toBe(true);
		expect(isTokenExpired(makeToken(Date.now() + 3_600_000))).toBe(false);
	});

	it('flags tokens expiring within the skew window (re-auth up front)', () => {
		// exp in 10s < 30s skew → treat as expired so login happens first.
		expect(isTokenExpired(makeToken(Date.now() + 10_000))).toBe(true);
	});
});

describe('tokenSubjectOf', () => {
	/** A re-mint of the SAME account — identical claims except jti/iat/exp. */
	function minted(userId: string, jti: string): string {
		return btoa(JSON.stringify({ jti, user_id: userId, iat: 1, exp: 2 }) + '.deadbeef');
	}

	it('reads the SAME account from two re-minted tokens (never one human per token)', () => {
		const first = minted('u-1', 'jti-1');
		const second = minted('u-1', 'jti-2');
		expect(first).not.toBe(second); // the bytes differ on every login/refresh
		expect(tokenSubjectOf(first)).toBe('u-1');
		expect(tokenSubjectOf(second)).toBe('u-1');
	});

	it('separates two accounts', () => {
		expect(tokenSubjectOf(minted('u-1', 'a'))).not.toBe(tokenSubjectOf(minted('u-2', 'b')));
	});

	it('falls back to sub, then to the token itself (an opaque token stays per-token)', () => {
		expect(tokenSubjectOf(btoa(JSON.stringify({ sub: 's-1' }) + '.sig'))).toBe('s-1');
		expect(tokenSubjectOf('dev-token')).toBe('dev-token');
		expect(tokenSubjectOf('')).toBe('');
	});
});

describe('memoryTokenStorage', () => {
	it('stores, reads and clears the token', () => {
		const storage = memoryTokenStorage();
		expect(storage.get()).toBeNull();
		storage.set('tok');
		expect(storage.get()).toBe('tok');
		storage.clear();
		expect(storage.get()).toBeNull();
	});
});

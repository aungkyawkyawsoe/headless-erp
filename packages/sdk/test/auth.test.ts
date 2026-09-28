import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTokenExpired, localStorageTokenStorage, memoryTokenStorage, tokenExpiryMs, tokenSubjectOf } from '../src/auth';

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

	it('keeps the refresh token in its own slot — clear() ends the whole session', () => {
		const storage = memoryTokenStorage();
		storage.set('tok');
		storage.setRefresh?.('refresh-1');
		expect(storage.getRefresh?.()).toBe('refresh-1');
		storage.clear();
		expect(storage.get()).toBeNull();
		expect(storage.getRefresh?.()).toBeNull();
	});
});

describe('localStorageTokenStorage', () => {
	/** Minimal localStorage stub — the module only touches get/set/removeItem. */
	function stubLocalStorage(): Map<string, string> {
		const values = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => values.get(k) ?? null,
			setItem: (k: string, v: string) => void values.set(k, v),
			removeItem: (k: string) => void values.delete(k),
		});
		return values;
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('persists the token and the refresh token under separate keys', () => {
		const values = stubLocalStorage();
		const storage = localStorageTokenStorage('mmbix-token');
		storage.set('tok');
		storage.setRefresh?.('refresh-1');
		expect(values.get('mmbix-token')).toBe('tok');
		expect(values.get('mmbix-token:refresh')).toBe('refresh-1');
		expect(storage.get()).toBe('tok');
		expect(storage.getRefresh?.()).toBe('refresh-1');
	});

	it('setRefresh(null) removes the refresh key; clear() drops both slots', () => {
		const values = stubLocalStorage();
		const storage = localStorageTokenStorage('mmbix-token');
		storage.set('tok');
		storage.setRefresh?.('refresh-1');
		storage.setRefresh?.(null);
		expect(values.has('mmbix-token:refresh')).toBe(false);
		expect(storage.getRefresh?.()).toBeNull();
		storage.setRefresh?.('refresh-2');
		storage.clear();
		expect(values.has('mmbix-token')).toBe(false);
		expect(values.has('mmbix-token:refresh')).toBe(false);
	});
});

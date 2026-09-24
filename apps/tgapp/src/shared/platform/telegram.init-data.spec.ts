// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { initDataFromUrl } from './telegram';

/**
 * The URL launch-params fallback (used before the async SDK bridge lands).
 *
 * Telegram appends its own launch params (`tgWebAppVersion`, `tgWebAppPlatform`,
 * …) AFTER `tgWebAppData` in the SAME fragment, so the fallback must read only
 * the `tgWebAppData` value. A raw slice + decodeURIComponent pulls those extras
 * into the initData, the server's HMAC then covers params Telegram never signed,
 * and the first launch fails with "Invalid Telegram initData signature" until
 * the SDK's own parse takes over. These pin the boundary.
 */

const INIT_DATA = 'user%3D%7B%22id%22%3A123%7D%26auth_date%3D1700000000%26hash%3Dabc';
const DECODED = 'user={"id":123}&auth_date=1700000000&hash=abc';

function at(url: string): void {
	window.history.replaceState({}, '', url);
}

afterEach(() => {
	window.history.replaceState({}, '', '/');
});

describe('initDataFromUrl', () => {
	it('reads only tgWebAppData from the fragment, dropping trailing launch params', () => {
		at(`/#tgWebAppData=${INIT_DATA}&tgWebAppVersion=7.2&tgWebAppPlatform=web`);
		expect(initDataFromUrl()).toBe(DECODED);
	});

	it('reads tgWebAppData from the query string (Desktop/tablet)', () => {
		at(`/?tgWebAppData=${INIT_DATA}&tgWebAppVersion=7.2`);
		expect(initDataFromUrl()).toBe(DECODED);
	});

	it('returns empty when there is no launch session', () => {
		at('/');
		expect(initDataFromUrl()).toBe('');
	});
});

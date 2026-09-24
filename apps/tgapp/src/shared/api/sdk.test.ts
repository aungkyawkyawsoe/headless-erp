import { describe, expect, it } from 'vitest';

import { sdk } from './sdk';

/**
 * Minimal wiring smoke test — proves the app-wide SDK client constructs and is
 * pointed at the same-origin API prefix. Real logic tests arrive with the
 * first screens; this keeps the root `pnpm test` (turbo) green for the app.
 */
describe('app SDK client', () => {
	it('targets the same-origin /api prefix', () => {
		expect(sdk.baseUrl).toBe('/api');
	});

	it('exposes the auth surface', () => {
		expect(typeof sdk.auth.login).toBe('function');
		expect(typeof sdk.auth.devLogin).toBe('function');
		expect(typeof sdk.auth.loginPassword).toBe('function');
	});
});

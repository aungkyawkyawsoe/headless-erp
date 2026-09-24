/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { API_ERROR_CODES, ERROR_CODES, errorCodeForStatus } from '@mmbix/types';
import { MAX_AGGREGATE_GROUPS } from '@mmbix/config';

/**
 * Pins the platform contract served at GET /api/meta to the canonical catalog
 * in @mmbix/types (single source of truth) — the API can never silently drift
 * from what SDK/UI tooling is prepared to match.
 */
describe('platform contract (GET /api/meta)', () => {
	it('advertises exactly the canonical API error codes', async () => {
		const res = await SELF.fetch('http://localhost/api/meta');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: { error_codes: string[] } };
		expect(body.data.error_codes).toEqual([...API_ERROR_CODES]);
	});

	it('never exposes SDK-only codes on the wire', async () => {
		const res = await SELF.fetch('http://localhost/api/meta');
		const body = (await res.json()) as { data: { error_codes: string[] } };
		for (const sdkOnly of ['NETWORK_ERROR', 'SDK_ERROR', 'API_ERROR', 'BAD_ENVELOPE']) {
			expect(body.data.error_codes).not.toContain(sdkOnly);
		}
	});

	it('pins the canonical error-code catalog', () => {
		// API_ERROR_CODES is the API surface: every entry is a real ERROR_CODES member…
		for (const code of API_ERROR_CODES) expect(ERROR_CODES).toContain(code);
		// …and the four SDK-only codes are excluded.
		for (const sdkOnly of ['NETWORK_ERROR', 'SDK_ERROR', 'API_ERROR', 'BAD_ENVELOPE']) {
			expect(API_ERROR_CODES).not.toContain(sdkOnly);
		}
	});

	it('pins the canonical status → code mapping', () => {
		expect(errorCodeForStatus(400)).toBe('VALIDATION_ERROR');
		expect(errorCodeForStatus(401)).toBe('UNAUTHORIZED');
		expect(errorCodeForStatus(403)).toBe('FORBIDDEN');
		expect(errorCodeForStatus(404)).toBe('NOT_FOUND');
		expect(errorCodeForStatus(409)).toBe('CONFLICT');
		expect(errorCodeForStatus(429)).toBe('RATE_LIMIT_EXCEEDED');
		expect(errorCodeForStatus(500)).toBe('INTERNAL_ERROR');
	});

	it('advertises the SAME aggregate bucket ceiling the engine enforces', async () => {
		// A grouped read is not page-limited, so its bound is its own advertised
		// contract — pinned to the shared constant so meta can never drift from
		// what runAggregate actually applies.
		const res = await SELF.fetch('http://localhost/api/meta');
		const body = (await res.json()) as { data: { aggregate: { max_groups: number } } };
		expect(body.data.aggregate.max_groups).toBe(MAX_AGGREGATE_GROUPS);
	});
});

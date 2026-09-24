/**
 * @mmbix/sdk typed-error contract.
 *
 * The SDK's error hierarchy is built FROM the canonical `@mmbix/types`
 * `ERROR_CODES` catalog — the SAME source the API validates `fail()` against —
 * so a backend code can never silently drift from what clients match on.
 * These tests pin:
 *   - `.code` preserves the raw server code (backward compat, incl. legacy).
 *   - `.apiCode` narrows to the canonical code (or 'API_ERROR').
 *   - `apiErrorCodeOf()` returns a typed canonical code (null for unknown).
 *   - `KNOWN_ERROR_CODES` mirrors the catalog (no drift).
 */
import { describe, expect, it } from 'vitest';
import { HttpError, apiErrorCodeOf, KNOWN_ERROR_CODES } from '../src/errors';
import { ERROR_CODES } from '@mmbix/types';

describe('typed error contract (canonical codes)', () => {
	it('KNOWN_ERROR_CODES mirrors the canonical catalog exactly', () => {
		expect(KNOWN_ERROR_CODES).toEqual(ERROR_CODES);
	});

	it('HttpError.fromResponse preserves the raw top-level code AND narrows apiCode', () => {
		const body = { success: false, error: 'Row changed', code: 'CONFLICT', request_id: 'req-123' };
		const e = HttpError.fromResponse({ status: 409, statusText: 'Conflict' }, body);
		expect(e.code).toBe('CONFLICT');
		expect(e.apiCode).toBe('CONFLICT');
		expect(e.requestId).toBe('req-123');
		expect(apiErrorCodeOf(e)).toBe('CONFLICT');
	});

	it('a legacy/unknown code is preserved in .code but apiCodeOf returns null', () => {
		const e = HttpError.fromResponse({ status: 409, statusText: 'Conflict' }, { error: { message: 'v', code: 'VERSION_CONFLICT' } });
		expect(e.code).toBe('VERSION_CONFLICT');
		expect(e.apiCode).toBe('API_ERROR');
		expect(apiErrorCodeOf(e)).toBeNull();
	});

	it('a 429 with RATE_LIMIT_EXCEEDED narrows to the canonical code', () => {
		const e = HttpError.fromResponse(
			{ status: 429, statusText: 'Too Many Requests' },
			{ success: false, error: 'slow down', code: 'RATE_LIMIT_EXCEEDED' },
		);
		expect(apiErrorCodeOf(e)).toBe('RATE_LIMIT_EXCEEDED');
	});

	it('a well-formed HttpError re-emits its apiCode even when constructed directly', () => {
		const e = new HttpError('forbidden', 403, 'FORBIDDEN');
		expect(e.apiCode).toBe('FORBIDDEN');
		expect(apiErrorCodeOf(e)).toBe('FORBIDDEN');
	});
});

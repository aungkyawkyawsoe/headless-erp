/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Per-request D1 statement count on `Server-Timing`.
 *
 * `app;dur` only advances on I/O (Workers freezes the clock between I/O), so it
 * IS the request's I/O time — but it cannot distinguish ONE slow D1 round trip
 * from an N+1 of forty. The `db` metric makes the round-trip count readable
 * straight off the wire, which is what turns "this call is slow" into "this call
 * issues N statements".
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function stmts(res: Response): number {
	const match = /db;desc="(\d+) stmts"/.exec(res.headers.get('Server-Timing') ?? '');
	expect(match, `Server-Timing carries the db metric: ${res.headers.get('Server-Timing')}`).toBeTruthy();
	return Number(match![1]);
}

describe('Server-Timing: per-request D1 statement count', () => {
	it('reports zero for an I/O-free read', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/meta`);
		expect(res.status).toBe(200);
		expect(stmts(res)).toBe(0);
	});

	it('counts the statements an entity read actually issues', async () => {
		const created = await SELF.fetch(`${BASE_URL}/api/collections`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({ name: 'Obs Probe', slug: 'obs_probe', fields: [{ name: 'name', type: 'text', required: false }] }),
		});
		expect([201, 409]).toContain(created.status);

		const res = await SELF.fetch(`${BASE_URL}/api/entities/obs_probe?limit=5`, { headers: ADMIN });
		expect(res.status).toBe(200);
		// At minimum the schema/authz reads and the page query — never zero.
		expect(stmts(res)).toBeGreaterThan(0);
	});
});

/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Naming-series patterns — custom counter width via trailing `#` placeholders.
 *
 * Grammar (see naming.service.ts): `<prefix>-` + optional trailing `#` run (0–10)
 * declares the zero-padded width. No `#`s → legacy default width 5.
 *
 *   "INB-####" → INB-0001, INB-0002 …
 *   "TST-"     → TST-00001 (unchanged legacy behaviour)
 *
 * Every scenario runs through the SAME validated API the app uses (POST
 * /api/collections, POST /api/entities, PUT /api/collections/:slug) — never raw
 * SQL — so route validation, NamingService parsing and the claim table are all
 * exercised together.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> & { data?: any } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	const parsed = (await res.json().catch(() => null)) as (Record<string, unknown> & { data?: any }) | null;
	return { status: res.status, body: parsed ?? {} };
}

async function createCollection(slug: string, name: string, namingSeries?: string) {
	const res = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({
			name,
			slug,
			description: null,
			naming_series: namingSeries ?? null,
			fields: [{ name: 'title', type: 'text', label: 'Title', required: false }],
		}),
	});
	expect(res.status, `create ${slug}`).toBe(201);
}

async function createItem(slug: string): Promise<Record<string, unknown>> {
	const res = await api(`/api/entities/${slug}`, { method: 'POST', body: JSON.stringify({ title: 'x' }) });
	expect(res.status, `create item in ${slug}`).toBe(201);
	const data = res.body.data;
	expect(data).toBeTruthy();
	return data as Record<string, unknown>;
}

// Local storage in the vitest cloudflare pool is isolated per spec file, so
// plain incremental slugs stay collision-free within this file.
let created = 0;

describe('naming series — custom width (# placeholders)', () => {
	it('numbers drafts with a custom 4-digit width: INB-#### → INB-0001, INB-0002', async () => {
		const slug = `ns_custom_width_${++created}`;
		await createCollection(slug, 'Custom Width Docs', 'INB-####');

		const first = await createItem(slug);
		expect(first.display_number).toBe('INB-0001');
		const second = await createItem(slug);
		expect(second.display_number).toBe('INB-0002');
	});

	it('keeps the legacy 5-digit default for a plain prefix: TST- → TST-00001', async () => {
		const slug = `ns_legacy_width_${++created}`;
		await createCollection(slug, 'Legacy Width Docs', 'TST-');

		const first = await createItem(slug);
		expect(first.display_number).toBe('TST-00001');
		const second = await createItem(slug);
		expect(second.display_number).toBe('TST-00002');
	});

	it('continues the sequence seamlessly when a table switches width (SEQ- → SEQ-####)', async () => {
		const slug = `ns_width_change_${++created}`;
		await createCollection(slug, 'Width Change Docs', 'SEQ-');

		expect((await createItem(slug)).display_number).toBe('SEQ-00001');
		expect((await createItem(slug)).display_number).toBe('SEQ-00002');

		// Widen the counter to 4 digits on the live table. naming_series is a
		// TOP-LEVEL body key on PUT (the route spreads `{ fields, actions, ...meta }`).
		const put = await api(`/api/collections/${slug}`, {
			method: 'PUT',
			body: JSON.stringify({ naming_series: 'SEQ-####' }),
		});
		expect(put.status).toBe(200);

		// 3 rendered with the new 4-digit width — the counter never restarts.
		expect((await createItem(slug)).display_number).toBe('SEQ-0003');
	});

	it('rejects invalid patterns at create (POST /api/collections)', async () => {
		for (const bad of ['NOPE', 'INV-##-##', 'INV-####-', 'OUT-#######x', '####']) {
			const res = await api('/api/collections', {
				method: 'POST',
				body: JSON.stringify({
					name: `Bad ${bad}`,
					slug: `ns_bad_create_${bad.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
					description: null,
					naming_series: bad,
					fields: [],
				}),
			});
			expect(res.status, `expected 400 for "${bad}"`).toBe(400);
		}
	});

	it('rejects invalid patterns and accepts valid/null on PUT meta', async () => {
		const slug = `ns_put_validate_${++created}`;
		await createCollection(slug, 'Put Validate Docs', 'PUT-####');

		const bad = await api(`/api/collections/${slug}`, {
			method: 'PUT',
			body: JSON.stringify({ naming_series: 'BAD' }),
		});
		expect(bad.status).toBe(400);

		const ok = await api(`/api/collections/${slug}`, {
			method: 'PUT',
			body: JSON.stringify({ naming_series: 'NEW-#######' }),
		});
		expect(ok.status).toBe(200);

		// 7-digit width takes effect on the next record.
		expect((await createItem(slug)).display_number).toBe('NEW-0000001');

		// null clears the series — the next record carries no display_number.
		const clear = await api(`/api/collections/${slug}`, {
			method: 'PUT',
			body: JSON.stringify({ naming_series: null }),
		});
		expect(clear.status).toBe(200);
		const next = await createItem(slug);
		expect(next.display_number ?? null).toBeNull();
	});
});

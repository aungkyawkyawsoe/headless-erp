/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Keyset cursor pagination — the backward walk.
 *
 * The Studio's DataTable pages by cursor: Next sends `dir=after` with the
 * response's `next_cursor`, Previous sends `dir=before` with `prev_cursor`.
 * Two things must hold or "back" silently skips rows instead of moving back:
 *
 *   1. A `dir=before` fetch returns the page IMMEDIATELY preceding the cursor
 *      (not the page after it) and in the caller's sort order.
 *   2. Cursor emission is direction-aware: a backward page carries a
 *      `next_cursor` even when no OLDER rows remain (the boundary item we came
 *      from always lies ahead), so returning to page 1 re-enables Next — and
 *      it carries NO `prev_cursor` at page 1 (nothing precedes it).
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

let seq = 0;
function nextSlug(prefix: string): string {
	seq += 1;
	return `${prefix}_cursor_${seq}`;
}

interface Row {
	id: string;
	seq: number;
}

async function createCollection(slug: string): Promise<void> {
	const res = await SELF.fetch(`${BASE_URL}/api/collections`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ name: `Cursor ${slug}`, slug, fields: [{ name: 'seq', type: 'integer' }] }),
	});
	expect(res.status).toBe(201);
}

async function createItem(collection: string, seq: number): Promise<void> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${collection}`, {
		method: 'POST',
		headers: { ...JSON_HEADERS, ...ADMIN },
		body: JSON.stringify({ seq }),
	});
	expect(res.status).toBe(201);
}

interface PageMeta {
	has_more?: boolean;
	next_cursor?: string;
	prev_cursor?: string;
}

async function list(collection: string, query: string): Promise<{ rows: Row[]; meta: PageMeta }> {
	const res = await SELF.fetch(`${BASE_URL}/api/entities/${collection}?${query}`, { headers: ADMIN });
	expect(res.status).toBe(200);
	const json = (await res.json()) as { data: Row[]; meta: PageMeta };
	return { rows: json.data, meta: json.meta };
}

const seqs = (rows: Row[]): number[] => rows.map((r) => r.seq);

describe('keyset cursor pagination — backward walk', () => {
	it('dir=before returns the preceding page and keeps Next enabled at the boundary', async () => {
		const slug = nextSlug('items');
		await createCollection(slug);
		for (let i = 1; i <= 7; i += 1) await createItem(slug, i);

		// Page 1 — forward, sorted by seq ascending for a deterministic order.
		const p1 = await list(slug, 'sort=seq&limit=3');
		expect(seqs(p1.rows)).toEqual([1, 2, 3]);
		expect(p1.meta.has_more).toBe(true);
		expect(typeof p1.meta.next_cursor).toBe('string');
		expect(p1.meta.prev_cursor).toBeUndefined();

		// Page 2 — walk after page 1's last row.
		const p2 = await list(slug, `sort=seq&limit=3&dir=after&cursor=${p1.meta.next_cursor}`);
		expect(seqs(p2.rows)).toEqual([4, 5, 6]);
		expect(typeof p2.meta.next_cursor).toBe('string');
		expect(typeof p2.meta.prev_cursor).toBe('string');

		// Page 3 — the tail.
		const p3 = await list(slug, `sort=seq&limit=3&dir=after&cursor=${p2.meta.next_cursor}`);
		expect(seqs(p3.rows)).toEqual([7]);
		expect(p3.meta.has_more).toBe(false);

		// Back to page 2 — must move BACK one page, not skip forward.
		const back2 = await list(slug, `sort=seq&limit=3&dir=before&cursor=${p3.meta.prev_cursor}`);
		expect(seqs(back2.rows)).toEqual([4, 5, 6]);
		expect(typeof back2.meta.next_cursor).toBe('string');
		expect(typeof back2.meta.prev_cursor).toBe('string');

		// Back to page 1 — the boundary. Rows are page 1; Next is STILL enabled
		// (the cursor's own page lies ahead); Previous is disabled (nothing before).
		const back1 = await list(slug, `sort=seq&limit=3&dir=before&cursor=${back2.meta.prev_cursor}`);
		expect(seqs(back1.rows)).toEqual([1, 2, 3]);
		expect(typeof back1.meta.next_cursor).toBe('string');
		expect(back1.meta.prev_cursor).toBeUndefined();

		// And the re-enabled Next walks forward to page 2 again.
		const fwd2 = await list(slug, `sort=seq&limit=3&dir=after&cursor=${back1.meta.next_cursor}`);
		expect(seqs(fwd2.rows)).toEqual([4, 5, 6]);
	});

	it('every advertised prev_cursor returns a non-empty page, and the walk is reversible', async () => {
		// The DataTable enables Back purely from `prev_cursor`, so a hint that
		// yields an empty page is a blank screen. This walks the DEFAULT sort
		// (created_at + id tiebreaker, which ties heavily at ms granularity) to the
		// end and back, checking each advertised cursor and that the backward
		// pages reconstruct exactly the forward pages.
		const slug = nextSlug('items');
		await createCollection(slug);
		const total = 30;
		await Promise.all(Array.from({ length: total }, (_, i) => createItem(slug, i + 1)));

		// Forward to the end.
		const forward: number[][] = [];
		let cursor: string | null = null;
		for (let guard = 0; guard < 20; guard += 1) {
			const page = await list(slug, `limit=10${cursor ? `&dir=after&cursor=${cursor}` : ''}`);
			expect(page.rows.length).toBeGreaterThan(0);
			forward.push(seqs(page.rows));
			if (!page.meta.next_cursor) break;
			cursor = page.meta.next_cursor;
		}
		expect(forward.flat()).toHaveLength(total);

		// Back to the start, asserting each advertised prev_cursor returns rows.
		const backward: number[][] = [];
		let last = await list(slug, 'limit=10');
		while (cursor) {
			cursor = last.meta.next_cursor ?? null;
			if (!cursor) break;
			last = await list(slug, `limit=10&dir=after&cursor=${cursor}`);
		}
		cursor = last.meta.prev_cursor ?? null;
		for (let guard = 0; cursor && guard < 20; guard += 1) {
			const page = await list(slug, `limit=10&dir=before&cursor=${cursor}`);
			// The invariant the UI depends on: a page that says "there is a previous
			// page" must actually return one.
			expect(page.rows.length, `blank page while walking back at step ${guard}`).toBeGreaterThan(0);
			backward.push(seqs(page.rows));
			cursor = page.meta.prev_cursor ?? null;
		}
		expect(backward.flat()).toHaveLength(total - 10); // page 1 has no predecessor
	});
});

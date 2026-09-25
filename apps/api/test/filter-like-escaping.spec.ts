/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `filter[field][_contains|_startswith|_endswith]` must match the term LITERALLY.
 *
 * These operators built `%${value}%` with no `ESCAPE` clause, so a term
 * containing a literal `%` (or `_`) acted as a WILDCARD: `_contains=%` matched
 * every row instead of the rows that actually contain a percent sign. That is a
 * silently-wrong result — a report or a scoped list would include rows the
 * operator never asked for — not just noise. The `?search=` path already escaped
 * and emitted `ESCAPE '\'`; the filter operators now share the same rule
 * (`escapeLikeTerm` + `likePattern`) so the two cannot drift.
 *
 * Pinned here because nothing else covers LIKE-metacharacter handling, and a
 * regression is invisible (a superset of rows still returns 200 OK).
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Envelope {
	data?: Array<{ id: string; name: string }> | { id: string };
	meta?: { total?: number };
	error?: string;
	code?: string;
}

async function call(path: string, init: RequestInit = {}): Promise<{ status: number; body: Envelope }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init.headers ?? {}) },
	});
	return { status: res.status, body: ((await res.json().catch(() => null)) ?? {}) as Envelope };
}

/** URL-encode a filter value so a literal `%`/`_` reaches the parser verbatim. */
function enc(v: string): string {
	return encodeURIComponent(v);
}

async function names(slug: string, query: string): Promise<string[]> {
	const res = await call(`/api/entities/${slug}?${query}`);
	expect(res.status).toBe(200);
	return (res.body.data as Array<{ name: string }>).map((r) => r.name).sort();
}

describe('filter LIKE operators treat % and _ literally', () => {
	const SLUG = 't_like_escape_probe';

	beforeAll(async () => {
		const create = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({ name: SLUG, slug: SLUG, fields: [{ name: 'name', type: 'text', required: false, label: 'Name' }] }),
		});
		if (create.status !== 201) {
			const read = await call(`/api/collections/${SLUG}`);
			expect(read.status).toBe(200);
		}
		for (const name of ['plain', '50% off', 'a_b', 'aXb']) {
			const res = await call(`/api/entities/${SLUG}`, { method: 'POST', body: JSON.stringify({ name }) });
			expect(res.status).toBe(201);
		}
	});

	it('_contains=% matches only rows with a literal percent sign', async () => {
		// Before the fix this returned every row (the bare `%` was a wildcard).
		expect(await names(SLUG, `filter[name][_contains]=${enc('%')}`)).toEqual(['50% off']);
	});

	it('_ncontains=% excludes only rows with a literal percent sign', async () => {
		expect(await names(SLUG, `filter[name][_ncontains]=${enc('%')}`)).toEqual(['aXb', 'a_b', 'plain']);
	});

	it('_contains with a literal percent excludes unrelated rows', async () => {
		expect(await names(SLUG, `filter[name][_contains]=${enc('% off')}`)).toEqual(['50% off']);
	});

	it('_contains=_ matches only rows with a literal underscore', async () => {
		expect(await names(SLUG, `filter[name][_contains]=${enc('_')}`)).toEqual(['a_b']);
	});

	it('_startswith treats an underscore as literal, not a single-char wildcard', async () => {
		// `a_` as a wildcard would also match `aXb`; literal, it matches only `a_b`.
		expect(await names(SLUG, `filter[name][_startswith]=${enc('a_')}`)).toEqual(['a_b']);
	});

	it('a plain term still matches as a substring', async () => {
		expect(await names(SLUG, `filter[name][_contains]=${enc('lai')}`)).toEqual(['plain']);
	});
});

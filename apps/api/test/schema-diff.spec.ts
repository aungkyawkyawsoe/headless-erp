/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Schema-change review — the Studio exports the LIVE snapshot, swaps in the
 * proposed fields for ONE collection, and posts it to `/api/snapshot/diff-v2`
 * (breaking-change detection). This mirrors `reviewSchemaChange` and pins the
 * "review" half of draft → review → apply.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const AUTH_JSON = { ...JSON_HEADERS, ...ADMIN };
const SLUG = 'sd_docs';

const field = (name: string) => ({ name, type: 'text', required: false });

interface Snapshot {
	collections: Array<{ slug: string; name: string; fields: Array<{ name: string; type: string }> } & Record<string, unknown>>;
}
interface Diff {
	summary: { totalChanges: number; breakingChanges: string[]; safeToApply: boolean };
}

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: { data?: T; error?: string } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { ...init, headers: { ...AUTH_JSON, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
	return { status: res.status, body: body ?? {} };
}

async function review(
	mutate: (fields: Array<{ name: string; type: string; required?: boolean }>) => Array<{ name: string; type: string; required?: boolean }>,
): Promise<Diff['summary']> {
	const exported = await call<Snapshot>('/api/snapshot/export');
	const snap = exported.body.data!;
	// Mirror the Studio: start from the LIVE fields (system fields included) and
	// apply only the proposed change — otherwise the diff reports the system
	// fields as removed.
	const patched = {
		...snap,
		collections: snap.collections.map((c) => (c.slug === SLUG ? { ...c, fields: mutate(c.fields) } : c)),
	};
	const diff = await call<Diff>('/api/snapshot/diff-v2', { method: 'POST', body: JSON.stringify({ snapshot: patched }) });
	expect(diff.status).toBe(200);
	return diff.body.data!.summary;
}

describe('schema-change review (snapshot diff-v2)', () => {
	beforeAll(async () => {
		const res = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({ name: 'SD Docs', slug: SLUG, fields: [field('title'), field('note')] }),
		});
		expect([201, 409]).toContain(res.status);
	});

	it('flags a REMOVED field as a breaking change', async () => {
		const summary = await review((fields) => fields.filter((f) => f.name !== 'note'));
		expect(summary.safeToApply).toBe(false);
		expect(summary.breakingChanges.length).toBeGreaterThan(0);
	});

	it('an ADDED field is safe', async () => {
		const summary = await review((fields) => [...fields, field('extra')]);
		expect(summary.safeToApply).toBe(true);
		expect(summary.breakingChanges).toEqual([]);
	});
});

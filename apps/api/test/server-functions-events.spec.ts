/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { DECLARATIVE_TRIGGER_EVENTS, LIFECYCLE_EVENTS } from '@mmbix/types';
import { DECLARATIVE_TRIGGER_SQL_LIST } from '@/plugins/server-functions/types';

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * Pins the declarative server-function trigger set to the canonical lifecycle
 * catalog in `@mmbix/types` (`hooks.ts`) — the same source the `_server_functions`
 * CHECK constraint and the route validation are generated from. Before this was
 * centralised the list was spelled out in five places and could silently drift.
 */
describe('server-function trigger events (SSOT)', () => {
	it('is a strict subset of the pipeline lifecycle events', () => {
		for (const event of DECLARATIVE_TRIGGER_EVENTS) {
			expect(LIFECYCLE_EVENTS).toContain(event);
		}
		expect(DECLARATIVE_TRIGGER_EVENTS.length).toBeLessThan(LIFECYCLE_EVENTS.length);
	});

	it('keeps after_delete / after_restore code-hook-only', () => {
		// They fire after the row left (or re-entered) the live set, so a rule —
		// which can only abort or mutate the document — has nothing to act on.
		expect(LIFECYCLE_EVENTS).toContain('after_delete');
		expect(LIFECYCLE_EVENTS).toContain('after_restore');
		expect(DECLARATIVE_TRIGGER_EVENTS).not.toContain('after_delete');
		expect(DECLARATIVE_TRIGGER_EVENTS).not.toContain('after_restore');
	});

	it('builds the CHECK constraint list from the catalog, single-line', () => {
		expect(DECLARATIVE_TRIGGER_SQL_LIST).not.toContain('\n');
		expect(DECLARATIVE_TRIGGER_SQL_LIST.split(',')).toEqual(DECLARATIVE_TRIGGER_EVENTS.map((e) => `'${e}'`));
	});
});

describe('POST /api/server-functions trigger validation', () => {
	it('rejects a trigger the catalog does not offer (after_delete)', async () => {
		const res = await SELF.fetch(`${BASE_URL}/api/server-functions`, {
			method: 'POST',
			headers: { ...JSON_HEADERS, ...ADMIN },
			body: JSON.stringify({
				name: 'should be rejected',
				collection_slug: 'products',
				trigger_event: 'after_delete',
				rules: [{ action: 'clear', target: 'x' }],
			}),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error?: string };
		expect(body.error).toContain('Invalid trigger_event');
	});

	it('accepts every catalog member at the validation gate', async () => {
		for (const event of DECLARATIVE_TRIGGER_EVENTS) {
			const res = await SELF.fetch(`${BASE_URL}/api/server-functions`, {
				method: 'POST',
				headers: { ...JSON_HEADERS, ...ADMIN },
				body: JSON.stringify({
					name: `pin-${event}`,
					collection_slug: 'products',
					trigger_event: event,
					rules: [{ action: 'clear', target: 'x' }],
					enabled: false,
				}),
			});
			// A valid event reaches the service and inserts; an invalid one never
			// leaves the route. Either way it must NOT be the validation error.
			const body = (await res.json().catch(() => null)) as { error?: string; data?: { id?: string } } | null;
			expect(body?.error ?? '').not.toContain('Invalid trigger_event');
			expect([200, 201]).toContain(res.status);
			if (body?.data?.id) {
				await SELF.fetch(`${BASE_URL}/api/server-functions/${body.data.id}`, { method: 'DELETE', headers: ADMIN });
			}
		}
	});
});

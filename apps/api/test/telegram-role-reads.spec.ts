/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { D1Client } from '@mmbix/core';
import { initConfig } from '@mmbix/config';
import { SchemaService } from '@/lib/services/collection-schema.service';
import { ensureProvisionedTelegramRole } from '@/lib/services/telegram-role.service';

/**
 * `/auth/me` runs the Telegram role provisioning on EVERY app load/resume, so its
 * D1 cost is on the boot-critical path. The role's permission rows are already
 * read in ONE bulk query — the row-filter healer must reuse that read instead of
 * issuing one `SELECT` per scoped collection (five on the live config), which is
 * what it used to do.
 */

/** A D1Database proxy that counts `prepare()` calls (i.e. statements issued). */
function countingDb(): { db: D1Database; reads: () => number; reset: () => void } {
	let reads = 0;
	const proxy = new Proxy(env.DB, {
		get(target, prop, receiver) {
			if (prop === 'prepare') {
				return (sql: string) => {
					reads += 1;
					return target.prepare(sql);
				};
			}
			const value = Reflect.get(target, prop, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
	return {
		db: proxy as D1Database,
		reads: () => reads,
		reset: () => {
			reads = 0;
		},
	};
}

describe('telegram role provisioning read cost', () => {
	it('a repeat pass reads the permission set ONCE, not once per scoped collection', async () => {
		const counter = countingDb();
		await new SchemaService(new D1Client(counter.db), () => null).ensureMigrations();

		const db = new D1Client(counter.db);
		const cfg = initConfig(env as unknown as Record<string, unknown>);

		// First pass provisions the role + every scoped grant (may write).
		await ensureProvisionedTelegramRole(db, cfg);

		counter.reset();
		await ensureProvisionedTelegramRole(db, cfg);

		// ONE role lookup + ONE bulk permission read. The row-filter healer reuses
		// that read; a regression to per-collection SELECTs would show up here.
		expect(counter.reads()).toBeLessThanOrEqual(2);
	});
});

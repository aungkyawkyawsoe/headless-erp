/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { D1Client } from '@mmbix/core';
import { SchemaService } from '@/lib/services/collection-schema.service';
import { runScheduledBackup } from '@/scheduled/backup';

/**
 * The nightly backup used to scan EVERY table TWICE — once to build the SQL dump
 * and again to build the JSON snapshot — which doubled the night's `rows_read`
 * for no extra fidelity. The JSON snapshot now reuses the rows already read.
 *
 * This counts `SELECT * FROM <table>` statements per table through a proxy, so a
 * regression to the double read fails here instead of quietly costing money.
 */

/** A minimal R2 stub that records the keys written. */
function stubBucket(): { bucket: R2Bucket; keys: string[] } {
	const keys: string[] = [];
	return {
		keys,
		bucket: {
			put: async (key: string) => {
				keys.push(key);
				return {} as unknown as R2Object;
			},
		} as unknown as R2Bucket,
	};
}

describe('nightly backup', () => {
	it('reads each table exactly once (SQL dump + JSON snapshot share the rows)', async () => {
		// The export needs the core tables to exist.
		await new SchemaService(new D1Client(env.DB), () => null).ensureMigrations();

		const scansPerTable = new Map<string, number>();
		const proxy = new Proxy(env.DB, {
			get(target, prop, receiver) {
				if (prop === 'prepare') {
					return (sql: string) => {
						const trimmed = sql.trim();
						const table = /^SELECT \* FROM "?([A-Za-z0-9_]+)"?/i.exec(trimmed)?.[1];
						if (table) scansPerTable.set(table, (scansPerTable.get(table) ?? 0) + 1);
						return target.prepare(sql);
					};
				}
				const value = Reflect.get(target, prop, receiver);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});

		const { bucket, keys } = stubBucket();
		// IS_DEV=true → the dev plaintext path (no BACKUP_ENCRYPTION_KEY needed).
		const res = await runScheduledBackup({ DB: proxy, BUCKET: bucket, IS_DEV: 'true' });
		expect(res.ok, `backup ok (${JSON.stringify(res)})`).toBe(true);
		expect(keys.length, 'both artifacts written').toBeGreaterThan(0);
		expect(scansPerTable.size, 'the export actually scanned tables').toBeGreaterThan(0);

		for (const [table, scans] of scansPerTable) {
			expect(scans, `${table} was scanned ${scans}x`).toBeLessThanOrEqual(1);
		}
	});
});

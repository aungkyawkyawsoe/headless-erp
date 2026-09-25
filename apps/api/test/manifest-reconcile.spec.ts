/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * MANIFEST RECONCILIATION — a manifest may REMOVE only what it itself created.
 *
 * `apply_manifest` is additive by default, so a dropped declaration used to leave
 * the row LIVE (a job kept firing, a key stayed valid, a hook kept running). It now
 * reconciles: after upserting the declared set, it removes rows it created
 * (`source = 'manifest'`) that the current declaration no longer names — and ONLY
 * those. The safety property is pinned by the NEGATIVE CONTROL below: a hand-created
 * row (`source IS NULL`) is invisible to reconciliation and always survives.
 *
 * Deletion follows presence semantics: a domain key that is ABSENT is "not managed
 * by this manifest" (skipped), so a partial manifest cannot nuke another domain. A
 * PRESENT key (even `[]`) is a full declaration of that domain's manifest-owned set.
 */

const BASE = 'http://localhost';
const JSON_HEADERS = { 'Content-Type': 'application/json', Authorization: 'Bearer dev-token' };

async function tool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
	const res = await SELF.fetch(`${BASE}/api/mcp`, {
		method: 'POST',
		headers: JSON_HEADERS,
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
	});
	const body = (await res.json().catch(() => ({}))) as {
		error?: { message: string };
		result?: { content: Array<{ text: string }>; isError?: boolean };
	};
	if (body.error) throw new Error(`RPC: ${body.error.message}`);
	const result = body.result!;
	const text = result.content?.[0]?.text;
	if (result.isError) throw new Error(text ?? `${name} failed`);
	return (text ? JSON.parse(text) : result) as T;
}

interface PlanShape {
	actions: Array<{ kind: string; target: string; detail: string }>;
	summary: { create: number; update: number; skip: number; remove: number };
	warnings: string[];
}
interface ApplyResult {
	plan: PlanShape;
	results: Array<{ target: string; ok: boolean; error?: string; secret?: string }>;
}

const KEY_USER = '00000000-0000-4000-8000-00000000face';

/** Remove every manifest-owned row (test-only cleanup) so count assertions are exact. */
async function clearManifestOwned(): Promise<void> {
	for (const table of ['_scheduler_tasks', '_api_keys', '_server_functions', '_report_schedules']) {
		try {
			await env.DB.prepare(`DELETE FROM ${table} WHERE source = 'manifest'`).run();
		} catch {
			/* table/column not migrated yet in this isolate — nothing to clear */
		}
	}
}

async function taskSource(name: string): Promise<{ id: string; source: string | null } | null> {
	return env.DB.prepare('SELECT id, source FROM _scheduler_tasks WHERE name = ?').bind(name).first<{ id: string; source: string | null }>();
}

/** Read the scheduler DO's alarm for a task (`/ping` is the DO's debug surface). */
async function doAlarm(id: string): Promise<number | null> {
	const ns = (env as unknown as { SCHEDULER: DurableObjectNamespace }).SCHEDULER;
	const stub = ns.get(ns.idFromName(`task:${id}`));
	const ping = (await (await stub.fetch('https://scheduler/ping')).json()) as { alarm: number | null };
	return ping.alarm;
}

describe('manifest reconciliation — removes only what the manifest created', () => {
	it('(a) rows apply_manifest creates are marked source="manifest"', async () => {
		const manifest = {
			version: 1,
			schedules: [{ name: 'rec_mark_job', type: 'query.rollup', cron: '0 3 * * *', payload: { collection: 'rec_sale' } }],
			apiKeys: [{ name: 'rec_mark_key', user_id: KEY_USER, scope: 'read' }],
			serverFunctions: [
				{
					name: 'rec_mark_hook',
					collection: 'rec_sale',
					trigger_event: 'after_insert',
					rules: [{ action: 'set', target: 'amount', value: 0 }],
				},
			],
			reports: [{ name: 'rec_mark_report', collection: 'rec_sale', format: 'csv' }],
		};
		const applied = await tool<ApplyResult>('apply_manifest', { manifest });
		for (const target of ['schedule:rec_mark_job', 'apiKey:rec_mark_key', 'serverFunction:rec_mark_hook', 'report:rec_mark_report']) {
			expect(applied.results.find((r) => r.target === target)?.ok, `${target} should apply`).toBe(true);
		}

		expect((await taskSource('rec_mark_job'))?.source).toBe('manifest');
		expect(
			(await env.DB.prepare('SELECT source FROM _api_keys WHERE name = ?').bind('rec_mark_key').first<{ source: string | null }>())?.source,
		).toBe('manifest');
		expect(
			(await env.DB.prepare('SELECT source FROM _server_functions WHERE name = ?').bind('rec_mark_hook').first<{ source: string | null }>())
				?.source,
		).toBe('manifest');
		expect(
			(
				await env.DB.prepare('SELECT source FROM _report_schedules WHERE name = ?')
					.bind('rec_mark_report')
					.first<{ source: string | null }>()
			)?.source,
		).toBe('manifest');
	});

	it('(b) replaying the SAME manifest deletes nothing (no remove action)', async () => {
		await clearManifestOwned();
		const manifest = {
			version: 1,
			schedules: [{ name: 'rec_replay_job', type: 'query.rollup', cron: '0 5 * * *', payload: { collection: 'rec_sale' } }],
		};
		await tool<ApplyResult>('apply_manifest', { manifest });

		const replay = await tool<ApplyResult>('apply_manifest', { manifest });
		expect(replay.plan.summary.remove).toBe(0);
		expect(replay.plan.actions.some((a) => a.kind === 'remove')).toBe(false);
		// The declared job is still there, still owned, and re-armed (upsert, not skip).
		const row = await taskSource('rec_replay_job');
		expect(row?.source).toBe('manifest');
	});

	it('(c) dropping a declared schedule removes its row and disarms its alarm', async () => {
		await clearManifestOwned();
		const withS = {
			version: 1,
			schedules: [{ name: 'rec_drop_job', type: 'query.rollup', cron: '0 4 * * *', payload: { collection: 'rec_sale' } }],
		};
		await tool<ApplyResult>('apply_manifest', { manifest: withS });
		const row = await taskSource('rec_drop_job');
		expect(row).toBeTruthy();
		// Armed while declared.
		expect(await doAlarm(row!.id)).not.toBeNull();

		// Re-apply with the `schedules` key PRESENT but S omitted.
		const dropped = await tool<ApplyResult>('apply_manifest', { manifest: { version: 1, schedules: [] } });
		expect(dropped.plan.summary.remove).toBe(1);
		expect(dropped.results.find((r) => r.target === 'schedule:rec_drop_job')?.ok).toBe(true);

		// The row is GONE and its alarm is disarmed.
		expect(await taskSource('rec_drop_job')).toBeNull();
		expect(await doAlarm(row!.id)).toBeNull();
	});

	it('(d) NEGATIVE CONTROL: a hand-created row (source NULL) is never removed', async () => {
		await clearManifestOwned();
		const now = new Date().toISOString();
		const runAt = new Date(Date.now() + 86_400_000).toISOString();

		// A hand-created, unmarked schedule and key — exactly what the Studio/CLI writes.
		await env.DB.prepare(
			`INSERT INTO _scheduler_tasks (id, type, name, payload_json, status, run_at, max_attempts, attempts, run_count, created_at, updated_at)
			 VALUES (?, 'query.rollup', ?, '{}', 'pending', ?, 5, 0, 0, ?, ?)`,
		)
			.bind('hand_sched_1', 'hand-made job', runAt, now, now)
			.run();
		await env.DB.prepare(
			`INSERT INTO _api_keys (id, name, key_hash, user_id, scope, is_active, created_at, last_used_at, revoked_at)
			 VALUES (?, ?, 'not-a-real-hash', ?, 'read', 1, ?, NULL, NULL)`,
		)
			.bind('hand_key_1', 'hand-made key', KEY_USER, now)
			.run();

		// A manifest that declares both domains as EMPTY — the harshest possible shape.
		const applied = await tool<ApplyResult>('apply_manifest', { manifest: { version: 1, schedules: [], apiKeys: [] } });

		// Nothing was removed, and the unmarked rows survive untouched.
		expect(applied.plan.summary.remove).toBe(0);
		expect(applied.plan.actions.some((a) => a.kind === 'remove')).toBe(false);
		expect((await taskSource('hand-made job'))?.source).toBeNull();
		expect(
			(await env.DB.prepare('SELECT source FROM _api_keys WHERE id = ?').bind('hand_key_1').first<{ source: string | null }>())?.source,
		).toBeNull();
	});

	it('(e) plan_manifest reports the pending remove and writes nothing', async () => {
		await clearManifestOwned();
		const withS = {
			version: 1,
			schedules: [{ name: 'rec_plan_job', type: 'query.rollup', cron: '0 6 * * *', payload: { collection: 'rec_sale' } }],
		};
		await tool<ApplyResult>('apply_manifest', { manifest: withS });

		const plan = await tool<PlanShape>('plan_manifest', { manifest: { version: 1, schedules: [] } });
		const remove = plan.actions.find((a) => a.kind === 'remove' && a.target === 'schedule:rec_plan_job');
		expect(remove).toBeTruthy();
		expect(plan.summary.remove).toBeGreaterThanOrEqual(1);

		// plan_manifest NEVER writes — the row is still live.
		expect((await taskSource('rec_plan_job'))?.source).toBe('manifest');
	});
});

describe('manifest reconciliation — domain scoping and coverage', () => {
	it('a partial manifest (one domain) never touches another domain', async () => {
		const full = {
			version: 1,
			schedules: [{ name: 'rec_scope_job', type: 'query.rollup', cron: '0 7 * * *', payload: { collection: 'rec_sale' } }],
			serverFunctions: [
				{
					name: 'rec_scope_hook',
					collection: 'rec_sale',
					trigger_event: 'after_insert',
					rules: [{ action: 'set', target: 'amount', value: 1 }],
				},
			],
			reports: [{ name: 'rec_scope_report', collection: 'rec_sale', format: 'json' }],
		};
		await tool<ApplyResult>('apply_manifest', { manifest: full });

		// A PARTIAL manifest that only manages `apiKeys` (its other keys are absent).
		await tool<ApplyResult>('apply_manifest', {
			manifest: { version: 1, apiKeys: [{ name: 'rec_scope_key', user_id: KEY_USER, scope: 'read' }] },
		});

		// The unrelated domains are untouched — this is the "never nuke unrelated jobs" rule.
		expect((await taskSource('rec_scope_job'))?.source).toBe('manifest');
		expect(await env.DB.prepare('SELECT id FROM _server_functions WHERE name = ?').bind('rec_scope_hook').first()).toBeTruthy();
		expect(await env.DB.prepare('SELECT id FROM _report_schedules WHERE name = ?').bind('rec_scope_report').first()).toBeTruthy();
	});

	it('reconciles api keys and server functions and reports too (not just schedules)', async () => {
		await clearManifestOwned();
		const first = {
			version: 1,
			apiKeys: [
				{ name: 'rec_keep_key', user_id: KEY_USER, scope: 'read' },
				{ name: 'rec_drop_key', user_id: KEY_USER, scope: 'read' },
			],
			serverFunctions: [
				{
					name: 'rec_keep_hook',
					collection: 'rec_sale',
					trigger_event: 'after_insert',
					rules: [{ action: 'set', target: 'amount', value: 1 }],
				},
				{
					name: 'rec_drop_hook',
					collection: 'rec_sale',
					trigger_event: 'after_insert',
					rules: [{ action: 'set', target: 'amount', value: 2 }],
				},
			],
			reports: [
				{ name: 'rec_keep_report', collection: 'rec_sale', format: 'json' },
				{ name: 'rec_drop_report', collection: 'rec_sale', format: 'csv' },
			],
		};
		await tool<ApplyResult>('apply_manifest', { manifest: first });

		// Drop one of each; keep the other.
		const applied = await tool<ApplyResult>('apply_manifest', {
			manifest: {
				version: 1,
				apiKeys: [{ name: 'rec_keep_key', user_id: KEY_USER, scope: 'read' }],
				serverFunctions: [
					{
						name: 'rec_keep_hook',
						collection: 'rec_sale',
						trigger_event: 'after_insert',
						rules: [{ action: 'set', target: 'amount', value: 1 }],
					},
				],
				reports: [{ name: 'rec_keep_report', collection: 'rec_sale', format: 'json' }],
			},
		});

		expect(applied.plan.summary.remove).toBe(3);
		for (const target of ['apiKey:rec_drop_key', 'serverFunction:rec_drop_hook', 'report:rec_drop_report']) {
			expect(applied.results.find((r) => r.target === target)?.ok, `${target} should be reconciled`).toBe(true);
		}

		// The dropped three are gone…
		expect(await env.DB.prepare('SELECT id FROM _api_keys WHERE name = ?').bind('rec_drop_key').first()).toBeNull();
		expect(await env.DB.prepare('SELECT id FROM _server_functions WHERE name = ?').bind('rec_drop_hook').first()).toBeNull();
		expect(await env.DB.prepare('SELECT id FROM _report_schedules WHERE name = ?').bind('rec_drop_report').first()).toBeNull();
		// …the kept three remain, still owned by the manifest.
		expect(
			(await env.DB.prepare('SELECT source FROM _api_keys WHERE name = ?').bind('rec_keep_key').first<{ source: string | null }>())?.source,
		).toBe('manifest');
		expect(
			(await env.DB.prepare('SELECT source FROM _server_functions WHERE name = ?').bind('rec_keep_hook').first<{ source: string | null }>())
				?.source,
		).toBe('manifest');
		expect(
			(
				await env.DB.prepare('SELECT source FROM _report_schedules WHERE name = ?')
					.bind('rec_keep_report')
					.first<{ source: string | null }>()
			)?.source,
		).toBe('manifest');
	});

	it('a hand-created key survives even when a manifest drops a same-named key it did not create', async () => {
		await clearManifestOwned();
		// The unmarked key is the only row named this — reconciliation must leave it be.
		const now = new Date().toISOString();
		await env.DB.prepare(
			`INSERT INTO _api_keys (id, name, key_hash, user_id, scope, is_active, created_at, last_used_at, revoked_at)
			 VALUES (?, ?, 'opaque', ?, 'read', 1, ?, NULL, NULL)`,
		)
			.bind('hand_keep_key', 'hand-kept key', KEY_USER, now)
			.run();

		const applied = await tool<ApplyResult>('apply_manifest', { manifest: { version: 1, apiKeys: [] } });
		expect(applied.plan.summary.remove).toBe(0);
		expect(await env.DB.prepare('SELECT id FROM _api_keys WHERE id = ?').bind('hand_keep_key').first()).toBeTruthy();
	});
});

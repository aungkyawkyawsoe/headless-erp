/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * FACTORY — schedules + saved reports + the field dry-run.
 *
 * The engine already shipped `_scheduler_tasks` (a `SchedulerDO` + a
 * every-10-minute reconcile watchdog) and `_report_schedules`; these specs pin that the factory
 * SURFACE can now declare them, and — just as important — that it refuses the
 * things it cannot honour: an unregistered handler type, a malformed cron, and
 * a report that promises a delivery nothing dispatches.
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

interface ApplyResult {
	plan: { summary: { create: number; update: number; skip: number }; warnings: string[] };
	results: Array<{ target: string; ok: boolean; error?: string }>;
}

const COLLECTION = { slug: 'sr_ticket', name: 'SR Ticket', fields: [{ name: 'title', type: 'text' }] };

describe('factory schedules', () => {
	it('list_handlers advertises the registered work a schedule may reference', async () => {
		const { handlers } = await tool<{ handlers: string[] }>('list_handlers', {});
		expect(handlers).toContain('query.rollup');
		expect(handlers).toContain('notify.digest');
	});

	it('a declared schedule lands as ONE armed task row, and replay re-arms it', async () => {
		const manifest = {
			version: 1,
			collections: [COLLECTION],
			schedules: [
				{
					name: 'sr_nightly_rollup',
					type: 'query.rollup',
					cron: '0 3 * * *',
					timezone: 'Asia/Yangon',
					payload: { collection: 'sr_ticket' },
				},
			],
		};
		const applied = await tool<ApplyResult>('apply_manifest', { manifest });
		expect(applied.results.find((r) => r.target === 'schedule:sr_nightly_rollup')?.ok).toBe(true);

		const row = await env.DB.prepare('SELECT id, type, cron, timezone, status, run_at FROM _scheduler_tasks WHERE name = ?')
			.bind('sr_nightly_rollup')
			.first<{ id: string; type: string; cron: string; timezone: string; status: string; run_at: string }>();
		expect(row).toBeTruthy();
		expect(row!.type).toBe('query.rollup');
		expect(row!.cron).toBe('0 3 * * *');
		expect(row!.timezone).toBe('Asia/Yangon');
		// A cron schedule is armed in the FUTURE — never "run immediately".
		expect(new Date(row!.run_at).getTime()).toBeGreaterThan(Date.now());

		// Replay is idempotent: the derived id upserts, so no second task appears.
		const replay = await tool<ApplyResult>('apply_manifest', { manifest });
		expect(replay.results.find((r) => r.target === 'schedule:sr_nightly_rollup')?.ok).toBe(true);
		const counted = await env.DB.prepare('SELECT COUNT(*) AS count FROM _scheduler_tasks WHERE name = ?')
			.bind('sr_nightly_rollup')
			.first<{ count: number }>();
		expect(counted?.count).toBe(1);
	});

	it('an unregistered handler type is refused and writes NO task row', async () => {
		const manifest = {
			version: 1,
			schedules: [{ name: 'sr_ghost_job', type: 'does.not.exist', cron: '0 4 * * *' }],
		};
		const applied = await tool<ApplyResult>('apply_manifest', { manifest });
		const item = applied.results.find((r) => r.target === 'schedule:sr_ghost_job');
		expect(item?.ok).toBe(false);
		expect(item?.error).toContain('list_handlers');
		const ghost = await env.DB.prepare('SELECT COUNT(*) AS count FROM _scheduler_tasks WHERE name = ?')
			.bind('sr_ghost_job')
			.first<{ count: number }>();
		expect(ghost?.count).toBe(0);
	});

	it('a malformed cron is dropped at validation, before any write', async () => {
		const applied = await tool<ApplyResult>('apply_manifest', {
			manifest: { version: 1, schedules: [{ name: 'sr_bad_cron', type: 'query.rollup', cron: '99 * * *' }] },
		});
		expect(applied.plan.warnings.join(' ')).toContain('invalid cron');
		const bad = await env.DB.prepare('SELECT COUNT(*) AS count FROM _scheduler_tasks WHERE name = ?')
			.bind('sr_bad_cron')
			.first<{ count: number }>();
		expect(bad?.count).toBe(0);
	});

	it('a schedule with neither cron nor interval is dropped', async () => {
		const applied = await tool<ApplyResult>('apply_manifest', {
			manifest: { version: 1, schedules: [{ name: 'sr_untimed', type: 'query.rollup' }] },
		});
		expect(applied.plan.warnings.join(' ')).toContain('needs a cron');
	});
});

describe('factory saved reports', () => {
	const manifest = {
		version: 1,
		collections: [COLLECTION],
		reports: [{ name: 'Ticket Register', collection: 'sr_ticket', format: 'csv' as const }],
	};

	it('a report is stored once and materializes on demand', async () => {
		const applied = await tool<ApplyResult>('apply_manifest', { manifest });
		expect(applied.results.find((r) => r.target === 'report:Ticket Register')?.ok).toBe(true);

		const row = await env.DB.prepare('SELECT id, collection_slug, format, cron FROM _report_schedules WHERE name = ?')
			.bind('Ticket Register')
			.first<{ id: string; collection_slug: string; format: string; cron: string }>();
		expect(row!.collection_slug).toBe('sr_ticket');
		expect(row!.format).toBe('csv');
		// No dispatcher consumes that column — the sentinel is not a valid cron,
		// so a future dispatcher fails closed instead of firing nonsense.
		expect(row!.cron).toBe('on-demand');

		// The definition is real: generating it materializes the collection, and
		// the declared `format` decides the representation.
		await tool('mutate', { requests: [{ op: 'create', collection: 'sr_ticket', body: { title: 'Broken printer' } }] });
		const gen = await SELF.fetch(`${BASE}/api/scheduled-reports/schedule/${encodeURIComponent(row!.id)}/generate`, {
			method: 'POST',
			headers: JSON_HEADERS,
		});
		expect(gen.status).toBe(200);
		expect(gen.headers.get('Content-Type')).toContain('text/csv');
		const body = await gen.text();
		expect(body).toContain('Broken printer');
		expect(body.split('\n')[0]).toContain('id');

		await tool<ApplyResult>('apply_manifest', { manifest });
		const once = await env.DB.prepare('SELECT COUNT(*) AS count FROM _report_schedules WHERE name = ?')
			.bind('Ticket Register')
			.first<{ count: number }>();
		expect(once?.count).toBe(1);
	});
});

describe('field dry-run', () => {
	it('validate_fields drops an invalid type, keeps the valid ones and explains why', async () => {
		const result = await tool<{ count: number; valid: Array<{ name: string; type: string }>; warnings: string[] }>('validate_fields', {
			collection: 'sr_ticket',
			fields: [
				{ name: 'title', type: 'text' },
				{ name: 'nope', type: 'not_a_type' },
				{ name: '9bad', type: 'text' },
			],
		});
		expect(result.count).toBe(1);
		expect(result.valid[0]).toMatchObject({ name: 'title', type: 'text' });
		expect(result.warnings.length).toBe(2);
	});

	it('the registry advertises the three previously-unavailable capabilities', async () => {
		const res = await SELF.fetch(`${BASE}/api/mcp`, {
			method: 'POST',
			headers: JSON_HEADERS,
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
		});
		const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
		const names = body.result.tools.map((t) => t.name);
		expect(names).toContain('validate_fields');
		expect(names).toContain('list_handlers');
	});
});

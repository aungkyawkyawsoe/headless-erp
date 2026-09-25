/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * FACTORY JOBS — a declared job must actually DO the work, and a failing one must
 * be visible.
 *
 * Writing a `_scheduler_tasks` row proves only that a row exists. These specs
 * close the loop: the handler runs, its result lands in the table it targets, a
 * broken payload surfaces `last_error` instead of vanishing, and a one-shot
 * trigger is never re-fired by a replay.
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
async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; data?: T }> {
	const res = await SELF.fetch(`${BASE}${path}`, { ...init, headers: { ...JSON_HEADERS, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => ({}))) as { data?: T };
	return { status: res.status, data: body.data };
}

interface ApplyResult {
	plan: { warnings: string[]; actions: Array<{ target: string; kind: string }> };
	results: Array<{ target: string; ok: boolean; error?: string }>;
}

const COLLECTION = { slug: 'job_sale', name: 'Job Sale', fields: [{ name: 'amount', type: 'currency' }] };

async function seedRows(): Promise<void> {
	await tool('mutate', {
		requests: [
			{ op: 'create', collection: 'job_sale', body: { amount: 100 } },
			{ op: 'create', collection: 'job_sale', body: { amount: 250 } },
		],
	});
}

describe('factory jobs execute', () => {
	it('a one-shot job declared by the manifest runs and materializes its rollup', async () => {
		// Collection + data FIRST. The job is due immediately, so the DO alarm and
		// our explicit run race each other — seeding first is what makes the
		// assertion deterministic whichever path wins (and the alarm path is the
		// production behaviour: a declared job runs with no operator).
		await tool('apply_manifest', { manifest: { version: 1, collections: [COLLECTION] } });
		await seedRows();

		const applied = await tool<ApplyResult>('apply_manifest', {
			manifest: {
				version: 1,
				schedules: [
					{
						name: 'job_sales_rollup',
						type: 'query.rollup',
						run_now: true,
						payload: { collection: 'job_sale', measures: [{ op: 'sum', field: 'amount' }] },
					},
				],
			},
		});
		expect(applied.results.find((r) => r.target === 'schedule:job_sales_rollup')?.ok).toBe(true);

		const declared = await env.DB.prepare('SELECT id FROM _scheduler_tasks WHERE name = ?')
			.bind('job_sales_rollup')
			.first<{ id: string }>();
		expect(declared).toBeTruthy();

		// Run it the way an operator does. This executes the HANDLER for real (and is
		// a no-op reporting `done` if the alarm already consumed the one-shot).
		const run = await api<{ status: string }>(`/api/scheduler/tasks/${encodeURIComponent(declared!.id)}/run`, { method: 'POST' });
		expect(run.status).toBe(200);
		expect(run.data?.status).toBe('done');

		// The work landed: a rollup row whose value is the sum of the seeded rows.
		const rollup = await env.DB.prepare('SELECT collection, metric, value FROM _rollup_values WHERE collection = ?')
			.bind('job_sale')
			.first<{ collection: string; metric: string; value: number }>();
		expect(rollup!.collection).toBe('job_sale');
		expect(rollup!.value).toBe(350);
	});

	it('a spent one-shot trigger is NOT re-fired by a manifest replay', async () => {
		const manifest = {
			version: 1,
			schedules: [
				{ name: 'job_once', type: 'query.rollup', run_now: true, payload: { collection: 'job_sale', measures: [{ op: 'count' }] } },
			],
		};
		await tool<ApplyResult>('apply_manifest', { manifest });

		// Replay: the planner must SKIP the spent trigger rather than re-arm it. The
		// assertion is the plan's own verdict, not a run_count comparison — an alarm
		// may legitimately run the one-shot between two reads.
		const replay = await tool<ApplyResult>('apply_manifest', { manifest });
		const action = replay.plan.actions.find((a) => a.target === 'schedule:job_once');
		expect(action?.kind).toBe('skip');
		const rows = await env.DB.prepare('SELECT COUNT(*) AS count FROM _scheduler_tasks WHERE name = ?')
			.bind('job_once')
			.first<{ count: number }>();
		expect(rows?.count).toBe(1);
	});

	it('run_now and a cron together are refused (one-shot or recurring, never both)', async () => {
		const applied = await tool<ApplyResult>('apply_manifest', {
			manifest: {
				version: 1,
				schedules: [{ name: 'job_confused', type: 'query.rollup', run_now: true, cron: '0 3 * * *' }],
			},
		});
		expect(applied.plan.warnings.join(' ')).toContain('one-shot');
		const row = await env.DB.prepare('SELECT id FROM _scheduler_tasks WHERE name = ?').bind('job_confused').first<{ id: string }>();
		expect(row).toBeNull();
	});
});

describe('factory job health is visible', () => {
	it('a failing job records last_error and get_operations surfaces it', async () => {
		await tool<ApplyResult>('apply_manifest', {
			manifest: {
				version: 1,
				collections: [COLLECTION],
				// `measures` is required by query.rollup — omitting it must fail LOUDLY.
				schedules: [{ name: 'job_broken', type: 'query.rollup', run_now: true, payload: { collection: 'job_sale' } }],
			},
		});
		const task = await env.DB.prepare('SELECT id FROM _scheduler_tasks WHERE name = ?').bind('job_broken').first<{ id: string }>();

		await api(`/api/scheduler/tasks/${encodeURIComponent(task!.id)}/run`, { method: 'POST' });

		const row = await env.DB.prepare('SELECT status, last_error, attempts FROM _scheduler_tasks WHERE name = ?')
			.bind('job_broken')
			.first<{ status: string; last_error: string | null; attempts: number }>();
		expect(row!.attempts).toBeGreaterThan(0);
		expect(row!.last_error).toContain('measures are required');

		// And the control plane can see it — the failure is not silent.
		const ops = await tool<{ domain: string; tasks: Array<{ name: string | null; last_error: string | null; status: string }> }>(
			'get_operations',
			{ domain: 'jobs' },
		);
		expect(ops.domain).toBe('jobs');
		const broken = ops.tasks.find((t) => t.name === 'job_broken');
		expect(broken?.last_error).toContain('measures are required');
		expect(broken?.status).not.toBe('done');
	});

	it('get_operations still serves index telemetry by default', async () => {
		const ops = await tool<{ domain: string; mode?: string }>('get_operations', {});
		expect(ops.domain).toBe('indexes');
		expect(ops.mode).toBeTruthy();
	});
});

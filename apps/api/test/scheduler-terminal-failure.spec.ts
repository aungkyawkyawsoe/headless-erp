/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * SCHEDULER TERMINAL FAILURE — a job that STOPS must be visible.
 *
 * Exhausting a task's retry budget disarms its Durable Object, so the job will
 * never run again. `status = 'failed'` alone is ambiguous (a backing-off job
 * reads `failed` too), so the row also carries a durable `disarmed_at` marker,
 * and `get_operations { domain: 'jobs' }` surfaces it as `disarmed: true`. This
 * spec drives the real REST scheduler + MCP health read against D1; a control
 * case proves a task that still has retries is NOT marked disarmed.
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

interface TaskRow {
	status: string;
	attempts: number;
	last_error: string | null;
	disarmed_at: string | null;
}
interface OpsJobs {
	domain: string;
	tasks: Array<{
		id: string;
		name: string | null;
		status: string;
		last_error: string | null;
		disarmed: boolean;
		disarmed_at: string | null;
	}>;
}

/** Schedule a deliberately-broken `query.rollup` (no `measures`) well in the
 *  future, so the DO alarm cannot pre-empt the explicit run and the assertions
 *  are deterministic. */
async function scheduleBroken(maxAttempts: number, name: string): Promise<string> {
	const created = await api<{ id: string }>('/api/scheduler/tasks', {
		method: 'POST',
		body: JSON.stringify({
			type: 'query.rollup',
			name,
			payload: { collection: 'not_a_real_collection' },
			maxAttempts,
			delayMs: 3_600_000,
		}),
	});
	expect(created.status).toBe(201);
	return created.data!.id;
}

describe('scheduler retry exhaustion is durably visible', () => {
	it('disarms an exhausted task and surfaces disarmed_at through get_operations', async () => {
		const id = await scheduleBroken(1, 'job_terminal_probe');

		const run = await api<{ status: string; disarmed?: boolean; error?: string }>(`/api/scheduler/tasks/${encodeURIComponent(id)}/run`, {
			method: 'POST',
		});
		expect(run.status).toBe(200);
		expect(run.data?.status).toBe('failed');
		expect(run.data?.disarmed).toBe(true);

		// The row itself is the durable evidence.
		const row = await env.DB.prepare('SELECT status, attempts, last_error, disarmed_at FROM _scheduler_tasks WHERE id = ?')
			.bind(id)
			.first<TaskRow>();
		expect(row!.status).toBe('failed');
		expect(row!.attempts).toBe(1);
		expect(row!.last_error).toContain('measures are required');
		expect(row!.disarmed_at).toBeTruthy();

		// …and the operator health read exposes it as a STOPPED job.
		const ops = await tool<OpsJobs>('get_operations', { domain: 'jobs' });
		expect(ops.domain).toBe('jobs');
		const job = ops.tasks.find((t) => t.id === id);
		expect(job?.disarmed).toBe(true);
		expect(job?.disarmed_at).toBeTruthy();
		expect(job?.last_error).toContain('measures are required');
	});

	it('does not mark a task disarmed while retries remain (control)', async () => {
		const id = await scheduleBroken(3, 'job_backing_off_probe');

		const run = await api<{ status: string; disarmed?: boolean }>(`/api/scheduler/tasks/${encodeURIComponent(id)}/run`, { method: 'POST' });
		expect(run.status).toBe(200);
		expect(run.data?.status).toBe('failed');
		expect(run.data?.disarmed).toBe(false);

		const row = await env.DB.prepare('SELECT status, attempts, disarmed_at FROM _scheduler_tasks WHERE id = ?').bind(id).first<TaskRow>();
		expect(row!.attempts).toBe(1);
		expect(row!.disarmed_at).toBeNull();

		const ops = await tool<OpsJobs>('get_operations', { domain: 'jobs' });
		expect(ops.tasks.find((t) => t.id === id)?.disarmed).toBe(false);
	});
});

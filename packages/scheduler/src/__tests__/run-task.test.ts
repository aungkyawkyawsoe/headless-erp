/**
 * runTask — retry exhaustion must leave DURABLE, queryable evidence.
 *
 * A job that stops (budget exhausted) and a job that is merely backing off both
 * carry `status = 'failed'`, so `status` alone cannot tell an operator that the
 * DO was disarmed and the job will never run again. These specs drive the real
 * `runTask()` execution path and assert the row is left with the terminal
 * `disarmed_at` marker — and, as a control, that a backing-off task is NOT
 * marked disarmed. A minimal in-memory D1 stands in for the platform.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { runTask } from '../service';
import { clearHandlers, registerHandler } from '../registry';
import type { SchedulerEnv } from '../types';

// ─── A minimal D1 double ───────────────────────────────
//
// Only the two statements `runTask` issues are interpreted: the task SELECT and
// the failure UPDATE. The UPDATE's `SET a = ?, b = NULL` clause is applied to the
// in-memory row so the assertions read the row that WOULD have been persisted.

class FakeD1 {
	row: Record<string, unknown>;

	constructor(row: Record<string, unknown>) {
		this.row = { ...row };
	}

	prepare(sql: string) {
		const self = this;
		return {
			bind(...bindings: unknown[]) {
				return {
					async first(): Promise<unknown> {
						return /FROM _scheduler_tasks\s+WHERE id = \?/i.test(sql) ? self.row : null;
					},
					async all(): Promise<{ results: unknown[] }> {
						return { results: [] };
					},
					async run(): Promise<{ success: boolean; meta: { changes: number }; results: never[] }> {
						self.#applyUpdate(sql, bindings);
						return { success: true, meta: { changes: 1 }, results: [] };
					},
				};
			},
		};
	}

	/** Apply `UPDATE … SET col = ?|NULL|'literal' …` to the in-memory row. */
	#applyUpdate(sql: string, bindings: unknown[]): void {
		const set = /SET ([\s\S]*?) WHERE /i.exec(sql)?.[1];
		if (!set) return;
		let i = 0;
		for (const assignment of set.split(',')) {
			const m = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(assignment);
			if (!m) continue;
			const [, column, value] = m;
			if (value === '?') this.row[column] = bindings[i++];
			else if (/^NULL$/i.test(value)) this.row[column] = null;
			else if (/^'[^']*'$/.test(value)) this.row[column] = value.slice(1, -1);
			// Anything else (e.g. `run_count + 1`) is an expression — left untouched.
		}
	}
}

function taskRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const now = new Date().toISOString();
	return {
		id: 't1',
		type: 'test.boom',
		name: 'probe',
		payload_json: '{}',
		status: 'pending',
		run_at: now,
		repeat_ms: null,
		cron: null,
		timezone: 'UTC',
		max_attempts: 1,
		attempts: 0,
		run_count: 0,
		last_error: null,
		last_result: null,
		last_run_at: null,
		disarmed_at: null,
		completed_at: null,
		created_at: now,
		updated_at: now,
		...overrides,
	};
}

const noopOps = { arm: async () => {}, disarm: async () => {} };

describe('runTask — retry exhaustion leaves a durable disarmed marker', () => {
	beforeEach(() => {
		clearHandlers();
		registerHandler('test.boom', () => {
			throw new Error('boom');
		});
	});

	it('disarms the task and stamps disarmed_at when the budget is spent', async () => {
		const fake = new FakeD1(taskRow({ max_attempts: 1 }));
		const env = { DB: fake } as unknown as SchedulerEnv;

		const outcome = await runTask(env, 't1', 'manual', noopOps);

		expect(outcome.status).toBe('failed');
		expect(outcome.disarmed).toBe(true);
		expect(outcome.error).toContain('boom');
		// Durable evidence: the row carries the terminal marker + the error.
		expect(fake.row.status).toBe('failed');
		expect(fake.row.attempts).toBe(1);
		expect(fake.row.last_error).toContain('boom');
		expect(typeof fake.row.disarmed_at).toBe('string');
		expect(fake.row.disarmed_at).not.toBeNull();
	});

	it('does NOT mark a task disarmed while it still has retries left', async () => {
		const fake = new FakeD1(taskRow({ max_attempts: 3 }));
		const env = { DB: fake } as unknown as SchedulerEnv;

		const outcome = await runTask(env, 't1', 'manual', noopOps);

		expect(outcome.status).toBe('failed');
		expect(outcome.disarmed).toBe(false);
		expect(fake.row.attempts).toBe(1);
		// Backing off, not stopped — the marker stays clear.
		expect(fake.row.disarmed_at).toBeNull();
	});
});

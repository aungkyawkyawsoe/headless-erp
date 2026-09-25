/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { D1Client } from '@mmbix/core';
import { OUTBOX_MAX_ATTEMPTS, OutboxService } from '@/plugins/outbox/service';

/**
 * OUTBOX DEAD LETTERS — the terminal state must be reachable AND queryable.
 *
 * `markFailed` moves a row to `status = 'failed'` with a backoff `next_attempt_at`
 * — that is a RETRYING row, not a terminal one. The flush used to select only
 * `pending`, so a row was orphaned by its first failure: the backoff and the
 * dead-letter path were unreachable and a poison message sat silently forever.
 * These specs prove the retry now happens, that exhaustion reaches `_outbox_dlq`,
 * and that the DLQ is readable through the operator route.
 */

const BASE = 'http://localhost';
const AUTH = { Authorization: 'Bearer dev-token' };

const svc = () => new OutboxService(new D1Client(env.DB));

/** Trigger plugin migrations so `_outbox` / `_outbox_dlq` exist. */
async function warmup(): Promise<void> {
	const res = await SELF.fetch(`${BASE}/api/outbox`, { headers: AUTH });
	expect(res.status).toBe(200);
}

/** Seed a due row directly — its type is unhandled, so `execute` always throws. */
async function seed(status: string, attempts: number): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date();
	const nextAttemptAt = new Date(now.getTime() - 1000).toISOString();
	await env.DB.prepare(
		`INSERT INTO _outbox (id, type, dedupe_key, payload_json, status, attempts, next_attempt_at, error, created_at, updated_at)
			VALUES (?, 'does.not.exist', NULL, '{}', ?, ?, ?, NULL, ?, ?)`,
	)
		.bind(id, status, attempts, nextAttemptAt, now.toISOString(), now.toISOString())
		.run();
	return id;
}

describe('outbox dead-letter path', () => {
	it('retries a failed row instead of orphaning it', async () => {
		await warmup();
		const id = await seed('failed', 1);

		const result = await svc().flushDue(50);
		expect(result.processed).toBeGreaterThanOrEqual(1);

		const row = await env.DB.prepare('SELECT status, attempts FROM _outbox WHERE id = ?')
			.bind(id)
			.first<{ status: string; attempts: number }>();
		expect(row).toBeTruthy();
		expect(row!.attempts).toBe(2); // retried — not stuck at its first failure
	});

	it('moves an exhausted row to the DLQ, durably and queryably', async () => {
		await warmup();
		const id = await seed('pending', OUTBOX_MAX_ATTEMPTS - 1);

		const result = await svc().flushDue(50);
		expect(result.dead_lettered).toBeGreaterThanOrEqual(1);

		// Gone from the live queue…
		const live = await env.DB.prepare('SELECT id FROM _outbox WHERE id = ?').bind(id).first();
		expect(live).toBeNull();

		// …and present in the DLQ with the terminal evidence.
		const dlq = await env.DB.prepare('SELECT id, attempts, error FROM _outbox_dlq WHERE id = ?')
			.bind(id)
			.first<{ id: string; attempts: number; error: string }>();
		expect(dlq).toBeTruthy();
		expect(dlq!.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
		expect(dlq!.error).toContain('unknown outbox type');

		// Queryable through the operator surface — the failure is not silent.
		const res = await SELF.fetch(`${BASE}/api/outbox/dlq?limit=100`, { headers: AUTH });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: Array<{ id: string }> };
		expect(body.data.some((r) => r.id === id)).toBe(true);
	});
});

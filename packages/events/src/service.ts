/**
 * Event bus — pub/sub on Cloudflare Queues.
 *
 *   EventService.publish(topic, payload)        → queue send (at-least-once)
 *   EventSubscriberService.subscribe(topic, action) → D1 subscriber rows
 *   consumeEventBatch(batch, env, dispatch?)    → worker queue() handler
 *
 * Delivery model:
 *   - One envelope per message: { id, topic, payload, created_at }.
 *   - Subscribers (D1) match by topic; actions are 'webhook' | 'handler' | 'log'.
 *   - Dedupe table `_event_deliveries` (event_id, subscriber_id) → redeliveries
 *     (queue retry) never double-deliver. A FAILED delivery deletes its dedupe
 *     row and rethrows → Queues retries with backoff, then dead-letters.
 *
 * Retry/DLQ policy lives in the worker config (queues.consumers) — the package
 * stays transport-agnostic.
 */

import { D1Client } from '@mmbix/core';

export interface EventEnvelope {
	id: string;
	topic: string;
	payload: Record<string, unknown>;
	created_at: string;
}

export type SubscriberAction =
	| { type: 'webhook'; url: string; method?: string; headers?: Record<string, string> }
	| { type: 'handler'; handler_type: string }
	| { type: 'log' };

export interface EventSubscriber {
	id: string;
	topic: string;
	name: string | null;
	action_json: string;
	enabled: number;
	created_at: string;
	updated_at: string;
}

// ─── Publish ───────────────────────────────────────────

export class EventService {
	constructor(private readonly queue: Queue | undefined) {}

	/** Send one event to the bus. Returns the envelope (id = dedupe key). */
	async publish(topic: string, payload: Record<string, unknown>): Promise<EventEnvelope> {
		if (!this.queue) throw new Error('EVENTS queue binding is not configured');
		const t = topic.trim();
		if (!t) throw new Error('event topic is required');
		const envelope: EventEnvelope = {
			id: crypto.randomUUID(),
			topic: t,
			payload: payload ?? {},
			created_at: new Date().toISOString(),
		};
		await this.queue.send(envelope);
		return envelope;
	}
}

// ─── Subscribers (D1) ──────────────────────────────────

const SUBSCRIBER_TABLE = `CREATE TABLE IF NOT EXISTS _event_subscribers (id TEXT PRIMARY KEY, topic TEXT NOT NULL, name TEXT, action_json TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
const DELIVERY_TABLE = `CREATE TABLE IF NOT EXISTS _event_deliveries (event_id TEXT NOT NULL, subscriber_id TEXT NOT NULL, status TEXT NOT NULL, processed_at TEXT NOT NULL, PRIMARY KEY (event_id, subscriber_id))`;
const SUBSCRIBER_INDEX = `CREATE INDEX IF NOT EXISTS idx_event_subs_topic ON _event_subscribers (topic)`;

export class EventSubscriberService {
	constructor(private readonly db: D1Client) {}

	/** Subscribe an action to a topic. Returns the subscriber row. */
	async subscribe(topic: string, action: SubscriberAction, name?: string): Promise<EventSubscriber> {
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		await this.ensureTables();
		await this.db.run({
			sql: `INSERT INTO _event_subscribers (id, topic, name, action_json, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)`,
			bindings: [id, topic.trim(), name?.trim() ?? null, JSON.stringify(action), now, now],
		});
		return (await this.get(id)) as EventSubscriber;
	}

	async get(id: string): Promise<EventSubscriber | null> {
		await this.ensureTables();
		return this.db.first<EventSubscriber>({
			sql: `SELECT * FROM _event_subscribers WHERE id = ?`,
			bindings: [id],
		});
	}

	async list(topic?: string): Promise<EventSubscriber[]> {
		await this.ensureTables();
		return this.db.all<EventSubscriber>({
			sql: topic?.trim()
				? `SELECT * FROM _event_subscribers WHERE topic = ? ORDER BY created_at DESC`
				: `SELECT * FROM _event_subscribers ORDER BY created_at DESC`,
			bindings: topic?.trim() ? [topic.trim()] : [],
		});
	}

	async unsubscribe(id: string): Promise<boolean> {
		const result = await this.db.run({ sql: `DELETE FROM _event_subscribers WHERE id = ?`, bindings: [id] });
		return (result.meta?.changes ?? 0) > 0;
	}

	private async ensureTables(): Promise<void> {
		const g = globalThis as unknown as Record<string, boolean>;
		if (g.__EVENT_TABLES__) return;
		await this.db.exec(SUBSCRIBER_TABLE);
		await this.db.exec(DELIVERY_TABLE);
		await this.db.exec(SUBSCRIBER_INDEX);
		g.__EVENT_TABLES__ = true;
	}
}

// ─── Consumer ──────────────────────────────────────────

export interface ConsumeResult {
	processed: number;
	delivered: number;
	skipped: number;
}

/**
 * Worker queue() handler for the event bus. `dispatch` is injected by the
 * host worker for 'handler' actions (e.g. wired to the scheduler registry).
 * Throws on any failed delivery → Queues retries the batch with backoff.
 */
export async function consumeEventBatch(
	batch: MessageBatch<EventEnvelope>,
	env: { DB: D1Database },
	dispatch?: (handlerType: string, envelope: EventEnvelope) => Promise<unknown>,
): Promise<ConsumeResult> {
	const db = new D1Client(env.DB);
	await ensureConsumerTables(db);

	let processed = 0;
	let delivered = 0;
	let skipped = 0;

	for (const message of batch.messages) {
		const envelope = message.body as EventEnvelope;
		if (!envelope || typeof envelope.topic !== 'string') continue; // poison → dropped
		processed++;

		const subscribers = await db.all<EventSubscriber>({
			sql: `SELECT * FROM _event_subscribers WHERE topic = ? AND enabled = 1`,
			bindings: [envelope.topic],
		});

		for (const sub of subscribers) {
			const action = safeParse(sub.action_json) as SubscriberAction | null;
			if (!action) {
				console.error(`[events] invalid action_json on subscriber ${sub.id}`);
				continue;
			}

			// Dedupe: mark the delivery BEFORE running it; a failed delivery
			// deletes the row so the queue retry can re-attempt.
			const now = new Date().toISOString();
			const claimed = await db.run({
				sql: `INSERT OR IGNORE INTO _event_deliveries (event_id, subscriber_id, status, processed_at) VALUES (?, ?, 'pending', ?)`,
				bindings: [envelope.id, sub.id, now],
			});
			if ((claimed.meta?.changes ?? 0) === 0) {
				skipped++; // already delivered
				continue;
			}

			try {
				await deliver(action, envelope, dispatch);
				await db.run({
					sql: `UPDATE _event_deliveries SET status = 'done', processed_at = ? WHERE event_id = ? AND subscriber_id = ?`,
					bindings: [new Date().toISOString(), envelope.id, sub.id],
				});
				delivered++;
			} catch (err) {
				// Free the dedupe slot and let Queues retry the message.
				await db.run({
					sql: `DELETE FROM _event_deliveries WHERE event_id = ? AND subscriber_id = ?`,
					bindings: [envelope.id, sub.id],
				});
				throw err;
			}
		}
	}

	return { processed, delivered, skipped };
}

async function deliver(
	action: SubscriberAction,
	envelope: EventEnvelope,
	dispatch: ((handlerType: string, envelope: EventEnvelope) => Promise<unknown>) | undefined,
): Promise<void> {
	switch (action.type) {
		case 'webhook': {
			const res = await fetch(String(action.url), {
				method: String(action.method ?? 'POST').toUpperCase(),
				headers: action.headers ?? {},
				body: JSON.stringify(envelope),
				// Never follow redirects (the target was validated at subscription time)
				// and cap each attempt — a hanging endpoint must not stall the queue.
				redirect: 'error',
				signal: AbortSignal.timeout(10_000),
			});
			if (!res.ok) throw new Error(`event webhook ${action.url} responded ${res.status}`);
			await res.text(); // consume
			return;
		}
		case 'handler': {
			if (!dispatch) throw new Error(`no dispatch provided for handler action "${action.handler_type}"`);
			await dispatch(action.handler_type, envelope);
			return;
		}
		case 'log':
			console.info(`[events] ${envelope.topic}:`, JSON.stringify(envelope.payload));
			return;
	}
}

function safeParse(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}

async function ensureConsumerTables(db: D1Client): Promise<void> {
	const g = globalThis as unknown as Record<string, boolean>;
	if (g.__EVENT_TABLES__) return;
	await db.exec(SUBSCRIBER_TABLE);
	await db.exec(DELIVERY_TABLE);
	await db.exec(SUBSCRIBER_INDEX);
	g.__EVENT_TABLES__ = true;
}

/** Housekeeping — drop delivery records older than `days` (default 7). */
export async function pruneEventDeliveries(db: D1Client, days = 7): Promise<number> {
	const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
	const result = await db.run({
		sql: `DELETE FROM _event_deliveries WHERE processed_at < ?`,
		bindings: [cutoff],
	});
	return result.meta?.changes ?? 0;
}

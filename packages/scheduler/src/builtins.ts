/**
 * Built-in handler parts — the "factory" ships generic, use-case-agnostic
 * handlers so any app can compose them without writing code:
 *
 *   http.request        → scheduled/cron HTTP call (webhook, ping, provider API)
 *   http.retry-until    → poll/call until a response condition holds (SLA checks)
 *   entity.transition   → scheduled state change on one record (publish/expire…)
 *   entity.expire       → scan records with a due date field → transition them
 *   query.rollup        → aggregation snapshot over a table → `_rollup_values`
 *   aggregate.delta     → incremental aggregation since the last run (accumulate)
 *   notify.digest       → collect records in a window → format → deliver (webhook)
 *   escalation.ladder   → deadline-based SLA levels with per-level actions
 *   lake.export         → keyset-paginated JSONL export of a table to R2
 *
 * Register them once at startup with registerBuiltinHandlers() (the scheduler
 * plugin does this). All parts fail loudly → the scheduler's backoff/retry and
 * `failed` state handle the rest. Parts are idempotent by design so the
 * at-least-once watchdog can never double-apply them.
 *
 * Security: SQL identifiers from payloads pass an allow-list (`assertIdentifier`)
 * and values are always bound — no raw SQL injection surface.
 */

import { registerHandler, hasHandler } from './registry';
import type { HandlerContext } from './types';

// ─── Shared helpers ────────────────────────────────────

/** Allow-list for SQL identifiers coming from payloads (no raw SQL injection). */
const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

function assertIdentifier(value: unknown, label: string): string {
	const v = String(value ?? '');
	if (!IDENTIFIER.test(v)) throw new Error(`${label} "${v}" is not a safe identifier`);
	return v;
}

function truncate(value: string, max = 4096): string {
	return value.length <= max ? value : `${value.slice(0, max)}… (truncated)`;
}

/** Resolve `table` from a payload — direct override or via `_entity_schemas`. */
async function resolveTable(ctx: HandlerContext, p: { collection?: string; table?: string }, label: string): Promise<string> {
	if (p.table) return assertIdentifier(p.table, `${label}: table`);
	const slug = String(p.collection ?? '').trim();
	if (!slug) throw new Error(`${label}: collection (or table) is required`);
	const row = await ctx.env.DB.prepare('SELECT table_name FROM _entity_schemas WHERE slug = ?').bind(slug).first<{ table_name: string }>();
	if (!row) throw new Error(`${label}: unknown collection "${slug}"`);
	return assertIdentifier(row.table_name, `${label}: table`);
}

const WHERE_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte']);
const WHERE_SQL: Record<string, string> = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

export interface RollupWhere {
	field: string;
	op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte';
	value: string | number;
}

/** Build a bound WHERE clause from one or more field comparisons. */
function buildWhereClause(where: RollupWhere | RollupWhere[] | undefined, label: string): { sql: string; bindings: unknown[] } {
	if (!where) return { sql: '', bindings: [] };
	const list = Array.isArray(where) ? where : [where];
	const parts: string[] = [];
	const bindings: unknown[] = [];
	for (const w of list) {
		const field = assertIdentifier(w.field, `${label}: where.field`);
		if (!WHERE_OPS.has(w.op)) throw new Error(`${label}: unsupported where op "${w.op}"`);
		parts.push(`${field} ${WHERE_SQL[w.op]} ?`);
		bindings.push(w.value);
	}
	return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', bindings };
}

/** Idempotent schema for the generic precomputed-metrics table. */
async function ensureRollupTable(ctx: HandlerContext): Promise<void> {
	await ctx.env.DB.prepare(
		`CREATE TABLE IF NOT EXISTS _rollup_values (id TEXT PRIMARY KEY, collection TEXT NOT NULL, group_key TEXT NOT NULL DEFAULT '', metric TEXT NOT NULL, value REAL NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, computed_at TEXT NOT NULL)`,
	).run();
	await ctx.env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_rollup_accum ON _rollup_values (collection, group_key, metric)').run();
}

/** Shared fetch for the HTTP parts — validated URL, JSON body support. */
async function doHttpRequest(p: HttpRequestPayload): Promise<{ status: number; ok: boolean; text: string }> {
	const url = String(p.url ?? '');
	if (!/^https?:\/\//.test(url)) throw new Error(`http: url must be http(s), got "${url}"`);
	const headers: Record<string, string> = { ...(p.headers ?? {}) };
	let body: string | undefined;
	if (p.body !== undefined) {
		if (typeof p.body === 'string') {
			body = p.body;
		} else {
			body = JSON.stringify(p.body);
			if (!headers['content-type']) headers['content-type'] = 'application/json';
		}
	}
	const res = await fetch(url, {
		method: String(p.method ?? 'POST').toUpperCase(),
		headers,
		body,
	});
	const text = await res.text();
	return { status: res.status, ok: res.ok, text };
}

// ─── http.request ──────────────────────────────────────

export interface HttpRequestPayload {
	/** Absolute http(s) URL. Required. */
	url: string;
	method?: string;
	headers?: Record<string, string>;
	/** Object → JSON body; string → raw. */
	body?: Record<string, unknown> | string;
	/** Non-2xx responses throw → scheduler backoff retries. Default false. */
	throwOnError?: boolean;
}

/** Scheduled HTTP call — webhooks, pings, 3rd-party sync triggers, provider APIs. */
async function httpRequest(payload: Record<string, unknown>, _ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as HttpRequestPayload;
	const { status, ok, text } = await doHttpRequest(p);
	if (!ok && p.throwOnError !== false) {
		throw new Error(`http.request: ${status} ${truncate(text, 512)}`);
	}
	return { status, ok, body: truncate(text) };
}

// ─── http.retry-until ──────────────────────────────────

export interface RetryUntilPayload extends HttpRequestPayload {
	/** Condition that must hold before the task completes. */
	until: {
		/** Response status(es) considered successful. */
		status?: number | number[];
		/** Substring that must appear in the response body. */
		bodyIncludes?: string;
		/** JSON response field checked against `jsonEquals`. */
		jsonField?: string;
		jsonEquals?: string | number;
	};
}

/**
 * Call an endpoint and only succeed when the response meets the condition —
 * otherwise throw → the scheduler's backoff re-runs it (cap with maxAttempts).
 * SLA checks: "keep polling until the job reports ready".
 */
async function httpRetryUntil(payload: Record<string, unknown>, ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as RetryUntilPayload;
	const until = p.until ?? {};
	const { status, text } = await doHttpRequest(p);

	const failures: string[] = [];
	if (until.status !== undefined) {
		const okStatuses = Array.isArray(until.status) ? until.status : [until.status];
		if (!okStatuses.includes(status)) failures.push(`status ${status} not in [${okStatuses.join(', ')}]`);
	}
	if (until.bodyIncludes !== undefined && !text.includes(until.bodyIncludes)) {
		failures.push(`body missing "${until.bodyIncludes}"`);
	}
	if (until.jsonField !== undefined) {
		let parsed: Record<string, unknown> | null = null;
		try {
			parsed = JSON.parse(text) as Record<string, unknown>;
		} catch {
			parsed = null;
		}
		const actual = parsed?.[until.jsonField];
		if (until.jsonEquals !== undefined && String(actual) !== String(until.jsonEquals)) {
			failures.push(`json.${until.jsonField} = ${JSON.stringify(actual)} ≠ ${JSON.stringify(until.jsonEquals)}`);
		}
	}
	if (failures.length > 0) {
		throw new Error(`http.retry-until: condition not met (attempt ${ctx.attempts}): ${failures.join('; ')}`);
	}
	return { status, ok: true, body: truncate(text) };
}

// ─── entity.transition ─────────────────────────────────

export interface EntityTransitionPayload {
	/** Collection slug — resolved to its table via `_entity_schemas`. */
	collection?: string;
	/** Direct table override (must be a safe identifier) — skips the lookup. */
	table?: string;
	/** Record id. Required. */
	id: string;
	/** New status value (e.g. published, expired, archived, cancelled). Required. */
	status: string;
}

/** Scheduled state change on a single entity record. */
async function entityTransition(payload: Record<string, unknown>, ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as EntityTransitionPayload;
	const id = String(p.id ?? '');
	const status = String(p.status ?? '').trim();
	if (!id) throw new Error('entity.transition: id is required');
	if (!status || status.length > 64) throw new Error('entity.transition: status is required (≤64 chars)');

	const table = await resolveTable(ctx, p, 'entity.transition');
	const now = new Date().toISOString();
	await ctx.env.DB.prepare(`UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ?`).bind(status, now, id).run();
	return { table, id, status, applied_at: now };
}

// ─── entity.expire ─────────────────────────────────────

export interface ExpirePayload {
	collection?: string;
	table?: string;
	/** Date/time field driving the transition (e.g. publish_at, expire_at). */
	dateField: string;
	/** Status applied to due records (e.g. published, expired, archived). */
	toStatus: string;
	/** Only transition records currently in this status (idempotency guard). */
	fromStatus?: string;
	/** Max records per run. Default 100. */
	batch?: number;
}

/**
 * Scheduled expiry/publish engine — scan records whose `dateField` is due and
 * transition them. Run it on a cron (e.g. every 5 minutes). Idempotent: the
 * `fromStatus` guard + the due-date check mean a record transitions once.
 */
async function entityExpire(payload: Record<string, unknown>, ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as ExpirePayload;
	const table = await resolveTable(ctx, p, 'entity.expire');
	const dateField = assertIdentifier(p.dateField ?? '', 'entity.expire: dateField');
	const toStatus = String(p.toStatus ?? '').trim();
	if (!toStatus || toStatus.length > 64) throw new Error('entity.expire: toStatus is required (≤64 chars)');
	const fromStatus = p.fromStatus ? String(p.fromStatus).trim() : null;
	const batch = Math.min(Math.max(1, p.batch ?? 100), 500);

	const now = new Date().toISOString();
	const bindings: unknown[] = [now, ...(fromStatus ? [fromStatus] : [])];
	const fromClause = fromStatus ? ' AND status = ?' : '';
	const result = await ctx.env.DB.prepare(
		`SELECT id FROM ${table} WHERE ${dateField} IS NOT NULL AND ${dateField} <= ?${fromClause} LIMIT ?`,
	)
		.bind(...bindings, batch)
		.all<{ id: string }>();
	const ids = (result.results ?? []).map((r) => r.id);

	for (const id of ids) {
		await ctx.env.DB.prepare(`UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ?`).bind(toStatus, now, id).run();
	}
	return { transitioned: ids.length, ids, to_status: toStatus, checked_at: now };
}

// ─── query.rollup ──────────────────────────────────────

export interface RollupMeasure {
	op: 'count' | 'sum' | 'avg' | 'min' | 'max';
	/** Field for sum/avg/min/max (count ignores it). */
	field?: string;
	/** Metric name stored in `_rollup_values` (defaults to `${op}_${field}`). */
	as?: string;
}

export interface RollupPayload {
	collection?: string;
	table?: string;
	/** Optional group-by column. */
	groupBy?: string;
	measures: RollupMeasure[];
	/** Optional row filter (field comparisons only — bound, never raw SQL). */
	where?: RollupWhere | RollupWhere[];
}

const ROLLUP_OPS = new Set(['count', 'sum', 'avg', 'min', 'max']);

function buildMeasureExpr(m: RollupMeasure, label: string): { name: string; expr: string } {
	const name = m.as || (m.op === 'count' ? 'count' : `${m.op}_${assertIdentifier(m.field ?? '', `${label}: field`)}`);
	const expr = m.op === 'count' ? 'COUNT(*)' : `${m.op.toUpperCase()}(${assertIdentifier(m.field ?? '', `${label}: field`)})`;
	return { name, expr };
}

/**
 * Aggregation snapshot over a table → `_rollup_values` (replace-per-collection,
 * keeping the latest window). Period = [last run, now].
 */
async function queryRollup(payload: Record<string, unknown>, ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as RollupPayload;
	const measures: RollupMeasure[] = Array.isArray(p.measures) ? p.measures : [];
	if (measures.length === 0) throw new Error('query.rollup: measures are required');
	const parts = measures.map((m) => {
		if (!ROLLUP_OPS.has(m.op)) throw new Error(`query.rollup: unsupported op "${m.op}"`);
		return buildMeasureExpr(m, 'query.rollup');
	});

	const table = await resolveTable(ctx, p, 'query.rollup');
	const groupBy = p.groupBy ? assertIdentifier(p.groupBy, 'query.rollup: groupBy') : null;
	const where = buildWhereClause(p.where, 'query.rollup');
	const select = parts.map((x) => `${x.expr} AS ${x.name}`).join(', ');
	const groupSql = groupBy ? ` GROUP BY ${groupBy}` : '';
	const result = await ctx.env.DB.prepare(`SELECT ${groupBy ? `${groupBy} AS g, ` : ''}${select} FROM ${table}${where.sql}${groupSql}`)
		.bind(...where.bindings)
		.all<Record<string, unknown>>();
	const rows = result.results ?? [];

	// Replace-per-collection — keep only the latest window.
	const periodStart = ctx.task.last_run_at ?? new Date(Date.now() - 86_400_000).toISOString();
	const periodEnd = new Date().toISOString();
	const collection = p.collection ?? table;

	await ensureRollupTable(ctx);
	await ctx.env.DB.prepare('DELETE FROM _rollup_values WHERE collection = ?').bind(collection).run();

	const inserted: Array<Record<string, unknown>> = [];
	for (const row of rows) {
		for (const part of parts) {
			const value = Number(row[part.name] ?? 0);
			await ctx.env.DB.prepare(
				'INSERT INTO _rollup_values (id, collection, group_key, metric, value, period_start, period_end, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
			)
				.bind(crypto.randomUUID(), collection, String(row.g ?? ''), part.name, value, periodStart, periodEnd, periodEnd)
				.run();
			inserted.push({ group_key: String(row.g ?? ''), metric: part.name, value });
		}
	}

	return { collection, table, period_start: periodStart, period_end: periodEnd, rows: inserted };
}

// ─── aggregate.delta ───────────────────────────────────

export interface DeltaMeasure {
	op: 'count' | 'sum' | 'min' | 'max';
	field?: string;
	as?: string;
}

export interface DeltaPayload {
	collection?: string;
	table?: string;
	/** Window column (default created_at). */
	sinceField?: string;
	/** First-run window in ms (default 24h) — later runs use [last_run, now]. */
	windowMs?: number;
	groupBy?: string;
	where?: RollupWhere | RollupWhere[];
	measures: DeltaMeasure[];
}

const DELTA_OPS = new Set(['count', 'sum', 'min', 'max']);

/**
 * Incremental aggregation — only rows since the last run are counted, and
 * results ACCUMULATE into `_rollup_values` (sum/count add, min/max keep the
 * extreme). avg is intentionally unsupported: compose sum + count instead.
 * Mixing with query.rollup on the same collection would conflict (replace vs
 * accumulate) — use one or the other per collection.
 */
async function aggregateDelta(payload: Record<string, unknown>, ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as DeltaPayload;
	const measures: DeltaMeasure[] = Array.isArray(p.measures) ? p.measures : [];
	if (measures.length === 0) throw new Error('aggregate.delta: measures are required');
	const parts = measures.map((m) => {
		if (!DELTA_OPS.has(m.op)) throw new Error(`aggregate.delta: op "${m.op}" not supported (use count|sum|min|max — avg = sum+count)`);
		const { name, expr } = buildMeasureExpr(m, 'aggregate.delta');
		return { op: m.op, name, expr };
	});

	const table = await resolveTable(ctx, p, 'aggregate.delta');
	const sinceField = assertIdentifier(p.sinceField ?? 'created_at', 'aggregate.delta: sinceField');
	const groupBy = p.groupBy ? assertIdentifier(p.groupBy, 'aggregate.delta: groupBy') : null;
	const where = buildWhereClause(p.where, 'aggregate.delta');

	const periodStart = ctx.task.last_run_at ?? new Date(Date.now() - (p.windowMs ?? 86_400_000)).toISOString();
	const periodEnd = new Date().toISOString();
	const collection = p.collection ?? table;

	const select = parts.map((x) => `${x.expr} AS ${x.name}`).join(', ');
	const groupSql = groupBy ? ` GROUP BY ${groupBy}` : '';
	const result = await ctx.env.DB.prepare(
		`SELECT ${groupBy ? `${groupBy} AS g, ` : ''}${select} FROM ${table} WHERE ${sinceField} >= ?${where.sql}${groupSql}`,
	)
		.bind(periodStart, ...where.bindings)
		.all<Record<string, unknown>>();
	const rows = result.results ?? [];

	await ensureRollupTable(ctx);
	for (const row of rows) {
		for (const part of parts) {
			const value = Number(row[part.name] ?? 0);
			const accum =
				part.op === 'min' ? 'MIN(value, excluded.value)' : part.op === 'max' ? 'MAX(value, excluded.value)' : 'value + excluded.value';
			await ctx.env.DB.prepare(
				`INSERT INTO _rollup_values (id, collection, group_key, metric, value, period_start, period_end, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(collection, group_key, metric) DO UPDATE SET value = ${accum}, period_end = excluded.period_end, computed_at = excluded.computed_at`,
			)
				.bind(crypto.randomUUID(), collection, String(row.g ?? ''), part.name, value, periodStart, periodEnd, periodEnd)
				.run();
		}
	}

	return { collection, table, period_start: periodStart, period_end: periodEnd, delta_rows: rows.length };
}

// ─── notify.digest ─────────────────────────────────────

export interface DigestChannel {
	type: 'webhook';
	url: string;
	method?: string;
	headers?: Record<string, string>;
	/** Extra JSON fields merged into the delivered body (e.g. Telegram chat_id). */
	body?: Record<string, unknown>;
}

export interface DigestPayload {
	collection?: string;
	table?: string;
	/** Window column (default created_at). */
	sinceField?: string;
	/** First-run window in ms (default 24h) — later runs use [last_run, now]. */
	windowMs?: number;
	/** Fields rendered per row (default ["id"]). */
	fields?: string[];
	title?: string;
	limit?: number;
	/** Optional delivery channel. Without it the digest is just computed. */
	channel?: DigestChannel;
}

/**
 * Window digest — collect records since the last run, format a human-readable
 * summary, and deliver it (webhook/Telegram/email provider). Idempotent: the
 * window advances with `last_run_at`, so the same records are never re-sent.
 */
async function notifyDigest(payload: Record<string, unknown>, ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as DigestPayload;
	const table = await resolveTable(ctx, p, 'notify.digest');
	const sinceField = assertIdentifier(p.sinceField ?? 'created_at', 'notify.digest: sinceField');
	const fields = (p.fields ?? ['id']).map((f) => assertIdentifier(f, 'notify.digest: fields'));
	const limit = Math.min(Math.max(1, p.limit ?? 50), 200);

	const periodStart = ctx.task.last_run_at ?? new Date(Date.now() - (p.windowMs ?? 86_400_000)).toISOString();
	const periodEnd = new Date().toISOString();
	const collection = p.collection ?? table;

	const select = ['id', ...fields.filter((f) => f !== 'id')].join(', ');
	const result = await ctx.env.DB.prepare(`SELECT ${select} FROM ${table} WHERE ${sinceField} >= ? ORDER BY ${sinceField} DESC LIMIT ?`)
		.bind(periodStart, limit)
		.all<Record<string, unknown>>();
	const rows = result.results ?? [];

	const lines = rows.map((r) => fields.map((f) => `${f}=${String(r[f] ?? '')}`).join(' '));
	const text =
		`${p.title ?? `Digest: ${collection}`} (${periodStart} → ${periodEnd}) — ${rows.length} item(s)\n` +
		lines.map((l) => `• ${l}`).join('\n');

	let delivered = false;
	if (p.channel?.type === 'webhook') {
		const ch = p.channel;
		const {
			status,
			ok,
			text: respText,
		} = await doHttpRequest({
			url: ch.url,
			method: ch.method,
			headers: ch.headers,
			body: { ...(ch.body ?? {}), text, count: rows.length, period_start: periodStart, period_end: periodEnd, rows },
		});
		if (!ok) throw new Error(`notify.digest: delivery failed ${status} — ${truncate(respText, 512)}`);
		delivered = true;
	}

	return { collection, table, count: rows.length, period_start: periodStart, period_end: periodEnd, delivered, text: truncate(text) };
}

// ─── escalation.ladder ────────────────────────────────

export interface EscalationLevel {
	/** Escalate records whose deadline is older than `afterMs`. */
	afterMs: number;
	action:
		| { type: 'log'; message?: string }
		| { type: 'entity.transition'; collection?: string; table?: string; status: string }
		| { type: 'http.request'; url: string; method?: string; headers?: Record<string, string>; body?: Record<string, unknown> };
}

export interface EscalationPayload {
	collection?: string;
	table?: string;
	/** Deadline column (e.g. due_at, expires_at). */
	deadlineField: string;
	/** Levels run from lowest `afterMs` to highest. */
	levels: EscalationLevel[];
	/** Only escalate records currently in this status. */
	fromStatus?: string;
	/** Max records escalated per level per run. Default 100. */
	batch?: number;
}

const ESCALATION_TABLE = `CREATE TABLE IF NOT EXISTS _escalation_state (table_name TEXT NOT NULL, record_id TEXT NOT NULL, level INTEGER NOT NULL, escalated_at TEXT NOT NULL, PRIMARY KEY (table_name, record_id, level))`;

/**
 * SLA ladder — run on a cron: records past each level's deadline get the
 * level's action once (state-tracked, idempotent), then move up the ladder.
 * e.g. invoice due 1h → remind; 24h → escalate to manager; 72h → cancel.
 */
async function escalationLadder(payload: Record<string, unknown>, ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as EscalationPayload;
	const levels: EscalationLevel[] = Array.isArray(p.levels) ? [...p.levels].sort((a, b) => a.afterMs - b.afterMs) : [];
	if (levels.length === 0) throw new Error('escalation.ladder: levels are required');
	const deadlineField = assertIdentifier(p.deadlineField ?? '', 'escalation.ladder: deadlineField');
	const table = await resolveTable(ctx, p, 'escalation.ladder');
	const fromStatus = p.fromStatus ? String(p.fromStatus).trim() : null;
	const batch = Math.min(Math.max(1, p.batch ?? 100), 500);

	await ctx.env.DB.prepare(ESCALATION_TABLE).run();
	const now = new Date().toISOString();
	const fromClause = fromStatus ? ' AND status = ?' : '';
	const summary: Array<{ level: number; afterMs: number; action: string; escalated: number }> = [];

	for (let i = 0; i < levels.length; i++) {
		const level = levels[i]!;
		const cutoff = new Date(Date.now() - level.afterMs).toISOString();
		const bindings: unknown[] = [cutoff, ...(fromStatus ? [fromStatus] : [])];
		const result = await ctx.env.DB.prepare(
			`SELECT t.id FROM ${table} t
			 LEFT JOIN _escalation_state s ON s.table_name = ? AND s.record_id = t.id AND s.level = ?
			 WHERE t.${deadlineField} IS NOT NULL AND t.${deadlineField} <= ?${fromClause} AND s.record_id IS NULL
			 LIMIT ?`,
		)
			.bind(table, i, ...bindings, batch)
			.all<{ id: string }>();
		const ids = (result.results ?? []).map((r) => r.id);

		for (const id of ids) {
			await runEscalationAction(level.action, { table, id, deadlineField }, ctx);
			await ctx.env.DB.prepare('INSERT OR IGNORE INTO _escalation_state (table_name, record_id, level, escalated_at) VALUES (?, ?, ?, ?)')
				.bind(table, id, i, now)
				.run();
		}
		summary.push({ level: i, afterMs: level.afterMs, action: level.action.type, escalated: ids.length });
	}

	return { table, checked_at: now, levels: summary };
}

async function runEscalationAction(
	action: EscalationLevel['action'],
	ctx: { table: string; id: string; deadlineField: string },
	handlerCtx: HandlerContext,
): Promise<void> {
	switch (action.type) {
		case 'log':
			handlerCtx.log(`escalated ${ctx.id} (${ctx.table})`, action.message ?? '');
			return;
		case 'entity.transition': {
			const status = String(action.status ?? '').trim();
			if (!status) throw new Error('escalation.ladder: entity.transition action requires status');
			const table = action.table ? assertIdentifier(action.table, 'escalation: table') : ctx.table;
			await handlerCtx.env.DB.prepare(`UPDATE ${table} SET status = ?, updated_at = ? WHERE id = ?`)
				.bind(status, new Date().toISOString(), ctx.id)
				.run();
			return;
		}
		case 'http.request': {
			const body = { ...(action.body ?? {}), record_id: ctx.id, table: ctx.table, deadline_field: ctx.deadlineField };
			const { status, ok, text } = await doHttpRequest({ url: action.url, method: action.method, headers: action.headers, body });
			if (!ok) throw new Error(`escalation.ladder: webhook ${status} — ${truncate(text, 256)}`);
			return;
		}
	}
}

// ─── lake.export ───────────────────────────────────────

export interface LakeExportPayload {
	collection?: string;
	table?: string;
	/** R2 key prefix (e.g. "lake/orders"). */
	prefix: string;
	/** Rows per chunk (default 1000). */
	batch?: number;
}

const LAKE_PREFIX = /^[a-zA-Z0-9_/-]{1,200}$/;

/**
 * Keyset-paginated JSONL export of a table to R2 — analytics-ready archives
 * (one row per line, chunked by id). Idempotent: keys include a run timestamp.
 */
async function lakeExport(payload: Record<string, unknown>, ctx: HandlerContext): Promise<unknown> {
	const p = payload as unknown as LakeExportPayload;
	const table = await resolveTable(ctx, p, 'lake.export');
	const prefix = String(p.prefix ?? '').trim();
	if (!LAKE_PREFIX.test(prefix)) throw new Error('lake.export: prefix must match [a-zA-Z0-9_/-]{1,200}');
	const batch = Math.min(Math.max(1, p.batch ?? 1000), 5000);

	const bucket = (ctx.env as unknown as { BUCKET?: R2Bucket }).BUCKET;
	if (!bucket) throw new Error('lake.export: BUCKET binding is not configured');

	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const baseKey = `${prefix.replace(/\/$/, '')}/${stamp}`;
	let rows = 0;
	let chunks = 0;
	let lastId = '';

	for (let guard = 0; guard < 1000; guard++) {
		const result = await ctx.env.DB.prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT ?`)
			.bind(lastId, batch)
			.all<Record<string, unknown>>();
		const page = result.results ?? [];
		if (page.length === 0) break;
		const jsonl = page.map((r) => JSON.stringify(r)).join('\n') + '\n';
		await bucket.put(`${baseKey}/${String(chunks).padStart(4, '0')}.jsonl`, jsonl);
		rows += page.length;
		chunks++;
		lastId = String(page[page.length - 1]!.id);
	}

	return { table, prefix: baseKey, rows, chunks };
}

// ─── Registration ──────────────────────────────────────

const BUILTIN_HANDLERS: Array<[string, (p: Record<string, unknown>, ctx: HandlerContext) => unknown | Promise<unknown>]> = [
	['http.request', httpRequest],
	['http.retry-until', httpRetryUntil],
	['entity.transition', entityTransition],
	['entity.expire', entityExpire],
	['query.rollup', queryRollup],
	['aggregate.delta', aggregateDelta],
	['notify.digest', notifyDigest],
	['escalation.ladder', escalationLadder],
	['lake.export', lakeExport],
];

/**
 * Register the built-in parts into the handler registry (idempotent).
 * Call once at worker startup — the scheduler plugin does this automatically.
 */
export function registerBuiltinHandlers(): void {
	for (const [type, handler] of BUILTIN_HANDLERS) {
		if (!hasHandler(type)) registerHandler(type, handler);
	}
}

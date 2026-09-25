/**
 * Server Functions — Service
 *
 * v0.7: **Rules only** — hooks are declared as JSON rules and executed by a
 * workerd-safe engine. The legacy `function_code` (JavaScript via new Function)
 * is NOT executed: the Workers runtime disallows eval/new Function for security.
 * The column is kept only to preserve legacy rows; new hooks must use `rules`.
 */

import { D1Client } from '@mmbix/core';
import { evaluateExpression } from '@mmbix/core';
import { LinkageEngine } from '@mmbix/core';
import { ValidationError } from '@mmbix/utils';
import type {
	ServerFunctionRecord,
	ServerFunctionInput,
	TriggerEvent,
	ServerFunctionResult,
	ServerFunctionTestInput,
	ServerHookRule,
	ServerHookCondition,
} from './types';
import { DECLARATIVE_TRIGGER_SQL_LIST } from './types';

/** Table name for storing server functions */
const TABLE = '_server_functions';

/**
 * Per-isolate guard: the CREATE TABLE + ALTER TABLE setup is idempotent and
 * only needs to run once per isolate. CollectionService calls executeHooks
 * 4-5× per write — without this guard that was 8-10 DDL round-trips per item
 * write. The flag is self-healing: if storage was reset while the isolate
 * stayed alive (dev/test storage resets, manual DROP), the next query fails
 * and _queryWithSelfHeal re-runs setup once and retries.
 */
let tableReady = false;

export class ServerFunctionService {
	private db: D1Client;

	constructor(db: D1Client) {
		this.db = db;
	}

	/** Ensure the _server_functions table exists (v0.7: adds rules column) — once per isolate. */
	private async ensureTable(): Promise<void> {
		if (tableReady) return;
		await this._setupTable();
		tableReady = true;
	}

	private async _setupTable(): Promise<void> {
		await this.db.run({
			sql: `CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY, name TEXT NOT NULL, collection_slug TEXT NOT NULL, trigger_event TEXT NOT NULL CHECK(trigger_event IN (${DECLARATIVE_TRIGGER_SQL_LIST})), function_code TEXT NOT NULL DEFAULT '', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, source TEXT DEFAULT NULL)`,
			bindings: [],
		});
		// v0.7: add rules column if missing (idempotent migration)
		await this.db
			.run({
				sql: `ALTER TABLE ${TABLE} ADD COLUMN rules TEXT`,
				bindings: [],
			})
			.catch(() => {
				/* column already exists */
			});
		// Ownership marker (`'manifest'`) — hand/Studio hooks stay NULL and are
		// therefore INVISIBLE to reconciliation. Idempotent (plugin migration 043
		// adds the same column; whichever runs first wins).
		await this.db
			.run({
				sql: `ALTER TABLE ${TABLE} ADD COLUMN source TEXT DEFAULT NULL`,
				bindings: [],
			})
			.catch(() => {
				/* column already exists */
			});
	}

	/**
	 * Run a DB query, re-establishing the table when the once-per-isolate flag
	 * is stale (storage reset while the isolate stayed alive). Retries exactly
	 * once; production steady-state never enters the catch.
	 */
	private async _queryWithSelfHeal<T>(fn: () => Promise<T>): Promise<T> {
		try {
			return await fn();
		} catch (err) {
			if (!tableReady) throw err; // setup itself failed — surface it
			tableReady = false;
			await this.ensureTable();
			return fn();
		}
	}

	// ─── CRUD ──────────────────────────────────────────────

	/** List all server functions, optionally filtered by collection */
	async list(collectionSlug?: string): Promise<ServerFunctionRecord[]> {
		await this.ensureTable();
		const sql = collectionSlug
			? `SELECT *, rules AS rules_text FROM ${TABLE} WHERE collection_slug = ? ORDER BY name ASC`
			: `SELECT *, rules AS rules_text FROM ${TABLE} ORDER BY name ASC`;
		const bindings = collectionSlug ? [collectionSlug] : [];
		return this._queryWithSelfHeal(() => this.db.all<ServerFunctionRecord>({ sql, bindings }));
	}

	/** Get a single server function by id */
	async get(id: string): Promise<ServerFunctionRecord | null> {
		await this.ensureTable();
		return this._queryWithSelfHeal(() =>
			this.db.first<ServerFunctionRecord>({
				sql: `SELECT *, rules AS rules_text FROM ${TABLE} WHERE id = ?`,
				bindings: [id],
			}),
		);
	}

	/** Create a new server function (rules only — function_code is rejected) */
	async create(input: ServerFunctionInput): Promise<ServerFunctionRecord> {
		if (input.function_code) {
			throw new ValidationError(
				'Legacy function_code (JavaScript) is not supported — the Workers runtime disallows eval/new Function. Use declarative "rules" instead.',
			);
		}
		await this.ensureTable();
		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const rulesText = input.rules ? JSON.stringify(input.rules) : null;
		await this._queryWithSelfHeal(() =>
			this.db.run({
				sql: `INSERT INTO ${TABLE} (id, name, collection_slug, trigger_event, function_code, rules, enabled, created_at, updated_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				bindings: [
					id,
					input.name,
					input.collection_slug,
					input.trigger_event,
					input.function_code || '',
					rulesText,
					input.enabled !== false ? 1 : 0,
					now,
					now,
					input.source ?? null,
				],
			}),
		);
		return {
			id,
			name: input.name,
			collection_slug: input.collection_slug,
			trigger_event: input.trigger_event,
			function_code: input.function_code || '',
			rules_text: rulesText,
			enabled: input.enabled !== false,
			created_at: now,
			updated_at: now,
		};
	}

	/** Update an existing server function (rules only — function_code is rejected) */
	async update(id: string, input: Partial<ServerFunctionInput>): Promise<ServerFunctionRecord | null> {
		if (input.function_code) {
			throw new ValidationError(
				'Legacy function_code (JavaScript) is not supported — the Workers runtime disallows eval/new Function. Use declarative "rules" instead.',
			);
		}
		await this.ensureTable();
		const existing = await this.get(id);
		if (!existing) return null;
		const now = new Date().toISOString();
		const name = input.name ?? existing.name;
		const collection_slug = input.collection_slug ?? existing.collection_slug;
		const trigger_event = input.trigger_event ?? existing.trigger_event;
		const function_code = input.function_code ?? existing.function_code;
		const rules =
			input.rules !== undefined ? input.rules : existing.rules_text ? (JSON.parse(existing.rules_text) as ServerHookRule[]) : undefined;
		const rulesText = rules !== undefined ? JSON.stringify(rules) : existing.rules_text;
		const enabled = input.enabled !== undefined ? input.enabled : existing.enabled;

		await this._queryWithSelfHeal(() =>
			this.db.run({
				sql: `UPDATE ${TABLE} SET name = ?, collection_slug = ?, trigger_event = ?, function_code = ?, rules = ?, enabled = ?, updated_at = ? WHERE id = ?`,
				bindings: [name, collection_slug, trigger_event, function_code, rulesText, enabled ? 1 : 0, now, id],
			}),
		);

		return { ...existing, name, collection_slug, trigger_event, function_code, rules_text: rulesText, enabled, updated_at: now };
	}

	/** Delete a server function */
	async delete(id: string): Promise<boolean> {
		await this.ensureTable();
		const result = await this._queryWithSelfHeal(() => this.db.run({ sql: `DELETE FROM ${TABLE} WHERE id = ?`, bindings: [id] }));
		return (result as unknown as { meta?: { changes: number } })?.meta?.changes !== undefined
			? (result as unknown as { meta: { changes: number } }).meta.changes > 0
			: true;
	}

	// ─── Execution ─────────────────────────────────────────

	/** Execute all enabled hooks for a given trigger and collection (rules only) */
	async execute(
		trigger: TriggerEvent,
		collectionSlug: string,
		doc: Record<string, unknown>,
		oldDoc?: Record<string, unknown>,
	): Promise<ServerFunctionResult[]> {
		await this.ensureTable();
		const functions = await this._queryWithSelfHeal(() =>
			this.db.all<ServerFunctionRecord>({
				sql: `SELECT *, rules AS rules_text FROM ${TABLE} WHERE collection_slug = ? AND trigger_event = ? AND enabled = 1 ORDER BY name ASC`,
				bindings: [collectionSlug, trigger],
			}),
		);

		if (functions.length === 0) return [];

		const results: ServerFunctionResult[] = [];

		for (const fn of functions) {
			// Only declarative rules execute — legacy function_code is never run
			// (Workers disallows eval/new Function; see class docs)
			const rules = ServerFunctionService.parseRules(fn.rules_text);
			if (rules.length > 0) {
				results.push(...ServerFunctionService.executeRules(rules, doc, oldDoc, collectionSlug));
			}
		}

		return results;
	}

	/** Convenience: query DB and execute hooks for a trigger. Returns first abort error if any. */
	static async executeHooks(
		db: D1Client,
		trigger: TriggerEvent,
		collectionSlug: string,
		doc: Record<string, unknown>,
		oldDoc?: Record<string, unknown>,
	): Promise<{ abort: boolean; error?: string; title?: string; message?: string; field?: string } | null> {
		const svc = new ServerFunctionService(db);
		const results = await svc.execute(trigger, collectionSlug, doc, oldDoc);
		for (const r of results) {
			if (r.abort) {
				return {
					abort: true,
					error: r.message || r.error || 'Operation aborted by server hook',
					title: r.title,
					message: r.message,
					field: r.field,
				};
			}
		}
		return null;
	}

	/** Test-run rules with sample data */
	async test(input: ServerFunctionTestInput): Promise<{ success: boolean; result?: unknown; error?: string }> {
		try {
			if (!input.rules || input.rules.length === 0) {
				return {
					success: false,
					error:
						'Only declarative "rules" are supported (function_code / new Function is disallowed on the Workers runtime). Provide a rules array.',
				};
			}
			const results = ServerFunctionService.executeRules(input.rules, input.doc, input.oldDoc, input.collection_slug);
			return { success: true, result: results };
		} catch (err) {
			const rawMessage = err instanceof Error ? err.message : String(err);
			const sanitized = /D1_ERROR|SQLITE/i.test(rawMessage) ? 'Hook execution error' : rawMessage;
			return { success: false, error: sanitized };
		}
	}

	// ─── v0.7: Declarative Rule Engine (workerd-safe) ───────

	static parseRules(rulesText: string | null | undefined): ServerHookRule[] {
		if (!rulesText) return [];
		try {
			const parsed = JSON.parse(rulesText);
			return Array.isArray(parsed) ? parsed : [];
		} catch {
			return [];
		}
	}

	/**
	 * Execute declarative rules against a document.
	 * Rules can mutate `doc` (set/clear/calculate) and/or abort the operation.
	 */
	static executeRules(
		rules: ServerHookRule[],
		doc: Record<string, unknown>,
		_oldDoc?: Record<string, unknown>,
		_collectionSlug?: string,
	): ServerFunctionResult[] {
		const results: ServerFunctionResult[] = [];

		for (const rule of rules) {
			// Gate on condition
			if (rule.when && !ServerFunctionService.checkCondition(rule.when, doc)) continue;

			switch (rule.action) {
				case 'abort': {
					results.push({
						abort: true,
						title: rule.title,
						message: rule.message || 'Operation aborted by server hook',
						error: rule.message,
						field: rule.field,
						rule_id: rule.id,
					});
					break;
				}

				case 'set': {
					if (rule.target) {
						doc[rule.target] = ServerFunctionService.resolveValue(rule.value, doc);
					}
					break;
				}

				case 'clear': {
					if (rule.target) delete doc[rule.target];
					break;
				}

				case 'calculate': {
					if (rule.target && rule.expression) {
						try {
							doc[rule.target] = evaluateExpression(rule.expression, doc);
						} catch (err) {
							results.push({
								abort: true,
								message: `Hook "${rule.id || rule.action}" expression error: ${err instanceof Error ? err.message : String(err)}`,
								error: 'HOOK_EXPRESSION_ERROR',
							});
						}
					}
					break;
				}
			}
		}

		return results;
	}

	/** Evaluate a condition object against document data */
	static checkCondition(cond: ServerHookCondition, doc: Record<string, unknown>): boolean {
		return LinkageEngine._checkCondition({ field: cond.field, op: cond.op, value: cond.value }, doc);
	}

	/** Resolve a set value: $NOW/$TODAY/$UUID/$TIMESTAMP, =expr, or literal */
	static resolveValue(value: unknown, doc: Record<string, unknown>): unknown {
		return LinkageEngine._resolveValue(value, doc);
	}
}

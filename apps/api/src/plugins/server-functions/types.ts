/**
 * Server Functions — Types
 *
 * Declarative JSON hook rules (workerd-safe) that run server-side
 * on collection lifecycle events (insert, update, delete, validate, change).
 *
 * The trigger-event catalog is NOT defined here — it lives in `@mmbix/types`
 * (`hooks.ts`) and is re-exported below, so this plugin and the manifest
 * contract can never drift apart.
 */

import { DECLARATIVE_TRIGGER_EVENTS } from '@mmbix/types';
import type { TriggerEvent } from '@mmbix/types';

/**
 * Event triggers for declarative server functions — the canonical catalog lives
 * in `@mmbix/types` (see `hooks.ts`) and is re-exported so every consumer in
 * this plugin (types, routes, DDL) references the SAME list. `after_delete` /
 * `after_restore` are code-hook-only: their result cannot be acted on after the
 * row has left the live set, so a rule is never offered them.
 */
export type { TriggerEvent };

/**
 * Single-line SQL `IN (…)` list of the declarative triggers, built from the
 * canonical catalog. MUST stay single-line: `db.exec()` splits statements on
 * newlines, so a multi-line fragment would corrupt the DDL.
 */
export const DECLARATIVE_TRIGGER_SQL_LIST = DECLARATIVE_TRIGGER_EVENTS.map((e) => `'${e}'`).join(',');

/** A persisted server function record from D1 */
export interface ServerFunctionRecord {
	id: string;
	name: string;
	collection_slug: string;
	trigger_event: TriggerEvent;
	function_code: string;
	/** v0.7: Declarative rules (JSON string in DB, parsed at execution) — workerd-safe alternative to function_code */
	rules_text?: string | null;
	enabled: boolean;
	created_at: string;
	updated_at: string;
}

/** Input for creating or updating a server function (v0.7: rules only) */
export interface ServerFunctionInput {
	name: string;
	collection_slug: string;
	trigger_event: TriggerEvent;
	/** Declarative hook rules — the only supported execution model */
	rules?: ServerHookRule[];
	/** Legacy JS (kept for display of pre-v0.7 rows; never executed) */
	function_code?: string;
	enabled?: boolean;
}

// ─── v0.7: Declarative Hook Rules ───────────────────────

/** Condition that gates a rule */
export interface ServerHookCondition {
	field: string;
	op: 'eq' | 'neq' | 'in' | 'nin' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'is_empty' | 'is_not_empty';
	value?: unknown;
}

/**
 * A declarative rule — the workerd-safe replacement for function_code.
 *
 * Examples:
 *   { action: 'abort', when: { field: 'price', op: 'lt', value: 0 }, message: 'Price cannot be negative' }
 *   { action: 'set', target: 'approved_by', value: '$CURRENT_USER' }
 *   { action: 'calculate', target: 'total', expression: 'qty * rate' }
 *   { action: 'clear', target: 'rejection_reason' }
 */
export interface ServerHookRule {
	/** Optional rule id (auto-generated if omitted) */
	id?: string;
	/** Condition — rule only fires when met. Omit for always-run. */
	when?: ServerHookCondition;
	/** Action to perform */
	action: 'abort' | 'set' | 'clear' | 'calculate';
	/** abort: error message (supports title/message pair) */
	message?: string;
	/** abort: error title */
	title?: string;
	/** abort: field to highlight in the UI */
	field?: string;
	/** set: value (literal, $NOW/$UUID/$TODAY, or =expression) */
	value?: unknown;
	/** calculate / set-with-expression: safe expression (e.g. "qty * rate") */
	expression?: string;
	/** set / clear / calculate: target field */
	target?: string;
}

/** Restricted DB access available within server functions */
export interface ServerFunctionDb {
	getValue(table: string, field: string, filters: Record<string, string>): Promise<unknown>;
	first(table: string, filters: Record<string, string>): Promise<Record<string, unknown> | null>;
}

/** Context passed to the sandboxed function */
export interface ServerFunctionContext {
	/** Current document data */
	doc: Record<string, unknown>;
	/** Previous state (for updates) */
	oldDoc?: Record<string, unknown>;
	/** Helper utilities */
	utils: Record<string, unknown>;
	/** Execution context */
	ctx: {
		user?: string;
		timestamp: string;
		collection: string;
		db?: ServerFunctionDb;
	};
}

/** Return value from a server function */
export interface ServerFunctionResult {
	abort?: boolean;
	error?: string;
	/** Error title (e.g. "ရက်စွဲမှားယွင်းနေပါသည်") */
	title?: string;
	/** Detailed error message (e.g. "ပစ္စည်းပို့ရမည့်ရက်စွဲသည် ယနေ့ သို့မဟုတ် နောက်ပိုင်းရက် ဖြစ်ရပါမည်။") */
	message?: string;
	/** Field name to highlight in UI on validation failure */
	field?: string;
	/** Allow arbitrary extra properties from user code */
	[key: string]: unknown;
}

/** Test-run input (rules only) */
export interface ServerFunctionTestInput {
	/** Declarative rules to test */
	rules: ServerHookRule[];
	doc: Record<string, unknown>;
	oldDoc?: Record<string, unknown>;
	collection_slug: string;
}

/** Structured validation error from a server function */
export interface ServerFunctionValidationError {
	title: string;
	message: string;
	field?: string;
}

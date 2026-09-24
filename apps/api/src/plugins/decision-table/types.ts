/**
 * Decision Tables — Drools-style, data-driven business rules.
 *
 * A decision table is a JSON list of rules. Rules are evaluated against a
 * document in priority order; the first matching rule (mode 'first_match',
 * the default — Drools salience style) applies its actions and stops, or every
 * matching rule applies (mode 'all'). Conditions support a declarative op set;
 * compute actions run through the safe expression evaluator (no eval).
 *
 * Decision tables are data — install/enable/disable via REST, hot-reloadable,
 * no deploy. They integrate with the entity pipeline (before insert/update)
 * and with workflow guards (a guard can reference a field a table sets).
 */

import type { EvalFunction } from '@mmbix/core';

/** Condition operators — declarative, no code. */
export type DecisionOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'not_in' | 'contains' | 'matches' | 'empty' | 'not_empty';

export interface DecisionCondition {
	/** Field to test — "status" or "doc.status" (doc. prefix is normalized away). */
	field: string;
	op: DecisionOp;
	/** Comparison value. For in/not_in: an array. */
	value?: unknown;
}

export interface DecisionComputeAction {
	field: string;
	/** Safe evaluator expression, scope { doc } — e.g. "doc.qty * doc.price". */
	expression: string;
}

export interface DecisionActions {
	/** Static field assignments, e.g. { "approval_level": "manager" }. */
	set?: Record<string, unknown>;
	/** Computed assignments via the safe expression evaluator. */
	compute?: DecisionComputeAction[];
	/** When present, matching this rule rejects the operation with this message. */
	abort?: string;
}

export interface DecisionRuleRow {
	id: string;
	name: string;
	/** Lower runs first (Drools salience). Default 100. */
	priority?: number;
	/** ALL conditions must match for the rule to fire. */
	conditions: DecisionCondition[];
	actions: DecisionActions;
}

export interface DecisionTableDefinition {
	name: string;
	collection: string;
	description?: string;
	enabled?: boolean;
	/** 'first_match' (default — first matching rule wins) | 'all' (every match applies). */
	mode?: 'first_match' | 'all';
	rules: DecisionRuleRow[];
}

/** Result of running the tables for a collection against one doc. */
export interface DecisionEvaluation {
	applied: Array<{ table: string; rule: string; actions: DecisionActions }>;
	doc: Record<string, unknown>;
}

/** Result of running the tables for a collection against one doc. */
export interface DecisionEvaluationResult extends DecisionEvaluation {}

export type { EvalFunction };

/**
 * Factory Manifest — the universal write primitive.
 *
 * One declarative document describes what to build (collections, pages, and —
 * in later phases — roles, menus, workflows). `planManifest` diffs it against the
 * live factory without writing; `applyManifest` is the only write and is
 * human-gated. This is how the control plane offers unbounded capability with a
 * bounded tool surface: new power is a new manifest key, not a new MCP tool.
 */

import type { FieldType } from './entity';

export interface FactoryFieldSpec {
	name: string;
	type: FieldType;
	required?: boolean;
	/** For relation types (`m2o`): the related collection slug. */
	related_collection?: string;
	/** For `select`: the allowed options. */
	options?: string[];
	unique?: boolean;
}

export interface FactoryCollectionSpec {
	slug: string;
	name?: string;
	naming_series?: string;
	fields: FactoryFieldSpec[];
	/** Runtime feature policies (stored in schema_json.policies). */
	policies?: Record<string, unknown>;
}

export interface FactoryPageSpec {
	/** Module slug to attach the page to (optional — a global page when absent). */
	module?: string;
	path: string;
	title: string;
	blocks?: Array<Record<string, unknown>>;
}

/** A role to create. Creation is skipped when the role name already exists. */
export interface FactoryRoleSpec {
	name: string;
	description?: string;
	app_access?: string[];
}

/** A permission grant on a role. Idempotent (setPermission replaces the row). */
export interface FactoryPermissionSpec {
	role: string;
	collection: string;
	can_read?: boolean;
	can_write?: boolean;
	can_create?: boolean;
	can_delete?: boolean;
	can_approve?: boolean;
	can_submit?: boolean;
}

/** A declarative workflow definition (data, never code). */
export interface FactoryWorkflowSpec {
	name: string;
	collection: string;
	initial: string;
	states: string[];
	transitions: Array<{ id: string; from: string; to: string; guard?: string; roles?: string[] }>;
	doc_status_map?: Record<string, string>;
	enabled?: boolean;
}

/** A menu item to create under an EXISTING module. */
export interface FactoryMenuSpec {
	module: string;
	label: string;
	type?: string;
	target?: string;
	icon?: string;
	sort_order?: number;
	roles?: string[];
	template?: string;
}

/** A KPI definition (an aggregate over a collection — data, not code). */
export interface FactoryKpiSpec {
	name: string;
	collection: string;
	agg: string;
	description?: string;
	field?: string;
	filter?: Array<Record<string, unknown>>;
	group_by?: string;
	period?: string;
	schedule?: string;
	enabled?: boolean;
}

/** A declarative server function / hook (rules, never code). */
export interface FactoryServerFunctionSpec {
	name: string;
	collection: string;
	trigger_event: string;
	rules?: Array<Record<string, unknown>>;
	enabled?: boolean;
}

/**
 * A scoped machine key to provision. The plaintext is returned ONCE in the
 * apply result — the only place a secret is ever surfaced.
 */
export interface FactoryApiKeySpec {
	name: string;
	/** The user the key acts as (its permissions follow them). */
	user_id: string;
	role_id?: string;
	scope?: 'read' | 'write' | 'admin';
}

export interface FactoryManifest {
	version: 1;
	collections?: FactoryCollectionSpec[];
	pages?: FactoryPageSpec[];
	roles?: FactoryRoleSpec[];
	permissions?: FactoryPermissionSpec[];
	workflows?: FactoryWorkflowSpec[];
	menus?: FactoryMenuSpec[];
	kpis?: FactoryKpiSpec[];
	serverFunctions?: FactoryServerFunctionSpec[];
	apiKeys?: FactoryApiKeySpec[];
}

export type ManifestActionKind = 'create' | 'update' | 'skip';

export interface ManifestAction {
	kind: ManifestActionKind;
	/** `collection:<slug>` | `page:<module>/<path>`. */
	target: string;
	detail: string;
}

export interface ManifestPlan {
	actions: ManifestAction[];
	summary: { create: number; update: number; skip: number };
	warnings: string[];
}

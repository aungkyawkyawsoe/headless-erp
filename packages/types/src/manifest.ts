/**
 * Plugin Manifest — Single Source of Truth
 *
 * Every plugin declares its identity, dependencies, owned resources,
 * hooks, routes, and worker placement in a single manifest file.
 * Used by CLI generation, build-time validation, and runtime routing.
 */

import type { LifecycleEvent } from './hooks';

// ─── Hook Manifest ─────────────────────────────────────

export interface HookManifest {
	/** Collection slug (e.g. "invoices") */
	collection: string;

	/** Lifecycle event — from the canonical catalog in `./hooks`. */
	event: LifecycleEvent;

	/** Execution priority (1-99, lower = first). Server functions always run at 100. */
	priority: number;

	/** Max execution time in ms. Default 5_000. */
	timeoutMs: number;

	/** Human-readable description — used in CLI/UI */
	description?: string;
}

// ─── Route Manifest ────────────────────────────────────

export interface RouteManifest {
	/** Route path, e.g. "/api/orders/*" */
	path: string;

	/** HTTP methods */
	methods: ('GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH')[];

	/** Human-readable description */
	description?: string;
}

// ─── Migration Manifest ────────────────────────────────

export interface MigrationManifest {
	/** Migration version (semver or sequential) */
	version: string;

	/** Human-readable name */
	name: string;

	/** Whether this migration is reversible */
	reversible: boolean;
}

// ─── Service Manifest (what this plugin provides/consumes) ──

export interface ServiceManifest {
	/** Service key for dependency injection (e.g. "AccountingService") */
	key: string;

	/** TypeScript interface type name */
	typeName: string;

	/** Human-readable description */
	description?: string;
}

// ─── Plugin Dependencies ───────────────────────────────

export interface PluginDependency {
	/** Plugin ID */
	id: string;

	/** Semver range (e.g. "^1.0.0", ">=2.1.0 <3.0.0") */
	version: string;
}

// ─── Full Manifest ─────────────────────────────────────

export interface PluginManifest {
	/** Unique plugin ID */
	id: string;

	/** Human-readable display name */
	name: string;

	/** Semver version */
	version: string;

	/** Short description — shown in CLI/UI */
	description?: string;

	/** Author or organization */
	author?: string;

	/** License identifier (MIT, Apache-2.0, etc.) */
	license?: string;

	/**
	 * Which worker group this plugin runs in.
	 * "gateway" = inline in main API worker.
	 * "finance" | "sales" | "hr" | etc. = domain worker.
	 */
	workerGroup: string;

	/** Plugins this plugin depends on */
	dependsOn?: PluginDependency[];

	/** Services this plugin provides (for DI) */
	provides?: ServiceManifest[];

	/** Services this plugin consumes */
	consumes?: ServiceManifest[];

	/** Database tables owned by this plugin */
	ownsTables?: string[];

	/** Lifecycle hooks registered by this plugin */
	hooks?: HookManifest[];

	/** Routes exposed by this plugin */
	routes?: RouteManifest[];

	/** Migrations defined by this plugin */
	migrations?: MigrationManifest[];

	/** Environment variables required by this plugin */
	envVars?: string[];

	/** D1 database bindings required */
	d1Bindings?: string[];
}

// ─── Worker Group Manifest ─────────────────────────────

export interface WorkerGroupManifest {
	/** Worker group name (e.g. "finance") */
	name: string;

	/** Display name */
	displayName: string;

	/** Description */
	description?: string;

	/** Plugin IDs assigned to this worker */
	plugins: string[];

	/** D1 database bindings for this worker */
	d1Bindings?: string[];

	/** Environment variables for this worker */
	envVars?: string[];
}

// ─── Build-Time Validation Result ──────────────────────

export interface ManifestValidationResult {
	valid: boolean;
	errors: ManifestValidationError[];
	warnings: ManifestValidationWarning[];
}

export interface ManifestValidationError {
	pluginId: string;
	message: string;
	code: 'missing_dependency' | 'version_mismatch' | 'table_conflict' | 'route_conflict' | 'hook_conflict';
}

export interface ManifestValidationWarning {
	pluginId: string;
	message: string;
	code: 'no_hooks' | 'no_routes' | 'no_description';
}

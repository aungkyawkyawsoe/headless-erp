/**
 * Plugin Interface
 *
 * Every feature is a plugin that can be enabled/disabled.
 * Plugins are self-contained: they own their routes, services,
 * middleware, and database migrations.
 *
 * Bundle impact: 0KB if disabled, ~1-5KB if enabled.
 * Single responsibility: one domain per plugin, ~50-200 lines per file.
 */

import type { Hono, MiddlewareHandler } from 'hono';
import type { SqlStatement } from './entity';

// ─── Plugin Hook Types ─────────────────────────────────

/** A lifecycle hook handler — receives the document, D1Client, and auth context. */
export type PluginHookHandler = (
	doc: Record<string, unknown>,
	db: D1Database,
	auth?: { user_id?: string; email?: string } | null,
) => Promise<void | { abort: true; error: string; field?: string }>;

/** Options for hook registration (priority and timeout). */
export interface HookRegistrationOptions {
	collection: string;
	event: string;
	handler: PluginHookHandler;
	/** Execution priority (lower = first). Default 50. */
	priority?: number;
	/** Max execution time in ms. Default 5000. */
	timeoutMs?: number;
}

/** Hook registration API exposed to plugins via ctx.hooks */
export interface PluginHookAPI {
	/**
	 * Register a lifecycle hook on a collection (legacy signature).
	 * @param collection - Collection slug (e.g. "invoices")
	 * @param event - Lifecycle event — a member of the canonical `LIFECYCLE_EVENTS`
	 *   catalog in `@mmbix/types` (`hooks.ts`): "validate" | "before_insert" |
	 *   "after_insert" | "before_update" | "after_update" | "before_delete" |
	 *   "after_delete" | "after_restore" | "on_change"
	 * @param handler - Async function. Return void on success,
	 *   or { abort: true, error: "..." } to reject the operation.
	 */
	on(collection: string, event: string, handler: PluginHookHandler): void;
	/**
	 * Register a lifecycle hook on a collection (options-based).
	 * Supports priority ordering and per-hook timeout.
	 */
	on(opts: HookRegistrationOptions): void;
}

// ─── Plugin Contract ──────────────────────────────────

export interface Plugin {
	/** Unique plugin ID (e.g. "entities", "auth", "search") */
	readonly id: string;

	/** Human-readable name */
	readonly name: string;

	/** Plugin version */
	readonly version: string;

	/** D1 migrations required by this plugin */
	readonly migrations?: PluginMigration[];

	/**
	 * Register the plugin.
	 * Returns the Hono router to mount at /api/:id (or custom path).
	 * Called during app initialization (cold start).
	 */
	register(ctx: PluginContext): PluginRegistration;
}

export interface PluginMigration {
	name: string;
	up: SqlStatement[];
}

export interface PluginContext {
	/** The Hono app instance (for middleware registration) */
	app: Hono;

	/** Cloudflare bindings */
	env: Record<string, unknown>;

	/** Database bindings */
	d1: D1Database;
	r2?: R2Bucket;

	/** Configuration */
	config: { isDev: boolean };

	/**
	 * Lifecycle hook registration — register handlers that fire on
	 * entity create/update/delete events with full TypeScript power.
	 * Handlers have access to the document, D1Client, and auth context.
	 */
	hooks: PluginHookAPI;
}

export interface PluginRegistration {
	/** Route prefix (e.g. "/api/entities") */
	routes?: Array<{ path: string; handler: Hono }>;

	/** Middleware to apply globally */
	middleware?: Array<{ path: string; handler: MiddlewareHandler }>;
}

/**
 * Marketplace Registry — plugin installation & event resolution.
 *
 * The marketplace is a database of installable plugins. A plugin declares the
 * lifecycle events it wants (`manifest.hooks`: ["invoices.before_insert", "*"])
 * and how it should execute:
 *
 *   native   — a handler registered in-process (trusted, compiled TS)
 *   binding  — a separate worker reached through a service binding (env.<NAME>)
 *
 * `getActivePluginsForEvent(collection, event)` is the "plugin resolution"
 * step — what Odoo-style interceptors do at runtime, here from the database
 * (hot-reloadable: install/enable/disable via REST, no deploy).
 */

import { D1Client } from '@mmbix/core';
import { ValidationError } from '@mmbix/utils';

export type MarketplaceExecutionMode = 'native' | 'binding';

export interface MarketplaceManifest {
	/** Lifecycle events this plugin wants, e.g. ["invoices.before_insert", "*"]. */
	hooks: string[];
	/** Where the plugin's code executes. */
	execution_mode: MarketplaceExecutionMode;
	/** env binding name when execution_mode = 'binding' (a Fetcher). */
	binding_name?: string;
	/**
	 * Failure policy when the plugin throws / times out / the binding worker
	 * errors: 'skip' (default — log, doc unchanged, write proceeds) or 'abort'
	 * (fail-closed — the write is rejected with the plugin error).
	 */
	on_error?: 'skip' | 'abort';
	/** Max time a binding-mode call may run (ms). Default 5000. Real cancellation. */
	fetch_timeout_ms?: number;
	/** Optional metadata (author, license, description…). */
	[key: string]: unknown;
}

export interface MarketplacePluginInput {
	id?: string;
	name: string;
	version: string;
	description?: string;
	manifest: MarketplaceManifest;
	enabled?: boolean;
	tenant_scope?: string;
}

export interface MarketplacePluginRow {
	id: string;
	name: string;
	version: string;
	description: string;
	manifest_json: string;
	hooks_json: string;
	execution_mode: MarketplaceExecutionMode;
	/** Legacy column (sandbox mode removed) — always null; kept for DB compat. */
	bundle_key: string | null;
	enabled: number;
	tenant_scope: string;
	created_at: string;
	updated_at: string;
	/** Parsed convenience fields. */
	manifest: MarketplaceManifest;
	hooks: string[];
}

/** Minimal hook-key matcher — "coll.event" exact or "*" wildcard. */
export function hookMatches(hooks: string[], collection: string, event: string): boolean {
	return hooks.includes('*') || hooks.includes(`${collection}.${event}`);
}

export class MarketplaceRegistry {
	constructor(private readonly db: D1Client) {}

	async list(event?: string): Promise<MarketplacePluginRow[]> {
		const rows = await this.db.all<MarketplacePluginRow>({
			sql: 'SELECT * FROM _marketplace_plugins ORDER BY created_at DESC',
			bindings: [],
		});
		let parsed = rows.map((r) => this.decorate(r));
		if (event) {
			const [collection, ev] = event.split('.');
			parsed = parsed.filter((p) => p.enabled === 1 && collection && ev && hookMatches(p.hooks, collection, ev));
		}
		return parsed;
	}

	async get(id: string): Promise<MarketplacePluginRow | null> {
		const row = await this.db.first<MarketplacePluginRow>({
			sql: 'SELECT * FROM _marketplace_plugins WHERE id = ?',
			bindings: [id],
		});
		return row ? this.decorate(row) : null;
	}

	/** The Odoo-style resolution: which enabled plugins want this event? */
	async getActivePluginsForEvent(collection: string, event: string): Promise<MarketplacePluginRow[]> {
		// LIKE on hooks_json avoids pulling every row: match "*" or "coll.event".
		const rows = await this.db.all<MarketplacePluginRow>({
			sql: `SELECT * FROM _marketplace_plugins
				WHERE enabled = 1 AND (hooks_json LIKE '%"*"%' OR hooks_json LIKE ?)
				ORDER BY created_at ASC`,
			bindings: [`%${collection}.${event}%`],
		});
		return rows.map((r) => this.decorate(r)).filter((p) => hookMatches(p.hooks, collection, event));
	}

	async install(input: MarketplacePluginInput): Promise<MarketplacePluginRow> {
		this.validate(input);
		const now = new Date().toISOString();
		const id = input.id ?? crypto.randomUUID();
		await this.db.run({
			sql: `INSERT INTO _marketplace_plugins (id, name, version, description, manifest_json, hooks_json, execution_mode, bundle_key, enabled, tenant_scope, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					name = excluded.name, version = excluded.version, description = excluded.description,
					manifest_json = excluded.manifest_json, hooks_json = excluded.hooks_json,
					execution_mode = excluded.execution_mode, bundle_key = excluded.bundle_key,
					enabled = excluded.enabled, tenant_scope = excluded.tenant_scope, updated_at = excluded.updated_at`,
			bindings: [
				id,
				input.name,
				input.version,
				input.description ?? '',
				JSON.stringify(input.manifest),
				JSON.stringify(input.manifest.hooks ?? []),
				input.manifest.execution_mode ?? 'native',
				null, // legacy bundle_key column — always null (sandbox mode removed)
				input.enabled === false ? 0 : 1,
				input.tenant_scope ?? '',
				now,
				now,
			],
		});
		const row = await this.get(id);
		if (!row) throw new Error('Failed to install marketplace plugin');
		return row;
	}

	async update(id: string, input: Partial<MarketplacePluginInput>): Promise<MarketplacePluginRow> {
		const existing = await this.get(id);
		if (!existing) throw new ValidationError('Marketplace plugin not found');
		const merged: MarketplacePluginInput = {
			id,
			name: input.name ?? existing.name,
			version: input.version ?? existing.version,
			description: input.description ?? existing.description,
			manifest: input.manifest ?? existing.manifest,
			enabled: input.enabled ?? existing.enabled === 1,
			tenant_scope: input.tenant_scope ?? existing.tenant_scope,
		};
		if (input.manifest || input.name || input.version) this.validate(merged);
		return this.install(merged);
	}

	async setEnabled(id: string, enabled: boolean): Promise<void> {
		await this.db.run({
			sql: 'UPDATE _marketplace_plugins SET enabled = ?, updated_at = ? WHERE id = ?',
			bindings: [enabled ? 1 : 0, new Date().toISOString(), id],
		});
	}

	async remove(id: string): Promise<void> {
		await this.db.run({ sql: 'DELETE FROM _marketplace_plugins WHERE id = ?', bindings: [id] });
	}

	private validate(input: MarketplacePluginInput): void {
		if (!input.name?.trim()) throw new ValidationError('name is required');
		if (!input.version?.trim()) throw new ValidationError('version is required');
		if (!input.manifest || !Array.isArray(input.manifest.hooks)) {
			throw new ValidationError('manifest.hooks must be an array (e.g. ["invoices.before_insert"])');
		}
		if (!['native', 'binding'].includes(input.manifest.execution_mode)) {
			throw new ValidationError(
				'manifest.execution_mode must be native | binding (sandbox mode was removed — no worker platform dependency)',
			);
		}
	}

	private decorate(row: MarketplacePluginRow): MarketplacePluginRow {
		let manifest: MarketplaceManifest = { hooks: [], execution_mode: 'native' };
		let hooks: string[] = [];
		try {
			manifest = JSON.parse(row.manifest_json) as MarketplaceManifest;
			hooks = Array.isArray(row.hooks_json) ? row.hooks_json : (JSON.parse(row.hooks_json) as string[]);
		} catch {
			/* corrupted row — keep safe defaults */
		}
		return { ...row, manifest, hooks };
	}
}

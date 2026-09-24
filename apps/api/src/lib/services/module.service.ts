/**
 * Module Service
 *
 * Manages modules — the application-level containers that wrap collections
 * with menus, views, dashboards, and business logic.
 */

import type { SqlStatement } from '@mmbix/types';
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import type { AuthContext } from './auth.service';
import { ModuleMenuService, type MenuItemRecord } from './module-menu.service';
import { PageService, type PageData } from './page.service';
import { CustomBlockService, type CustomBlock } from './custom-block.service';

export interface ModuleRecord {
	id: string;
	name: string;
	slug: string;
	icon: string;
	icon_color: string | null;
	bg_color: string | null;
	description: string | null;
	version: string;
	is_active: number;
	sort_order: number;
	created_at: string;
	updated_at: string;
	collection_count?: number;
	collections?: Array<{ id: string; name: string; slug: string }>;
	/** Bumped on every Studio publish (module/menu/page/view mutation) — the
	 *  frontend uses it for cheap conditional freshness checks. */
	config_version?: number;
}

/** Single-round-trip shape for the frontend shell: module + collections + menus + pages. */
export interface AppManifest extends ModuleRecord {
	menus: MenuItemRecord[];
	pages: PageData[];
	custom_blocks: CustomBlock[];
	config_version: number;
}

export class ModuleService {
	constructor(
		private db: D1Client,
		private auth?: AuthContext,
	) {}

	/** List all modules, optionally including inactive ones */
	async getModules(all = false): Promise<ModuleRecord[]> {
		const q = QueryBuilder.from('_modules').select('*').orderBy('sort_order', 'asc').orderBy('name', 'asc');

		if (!all) {
			q.where('is_active', 1);
		}

		const modules = await this.db.all<ModuleRecord>(q.toSelect());

		// Attach collection count for each module
		const countQ = QueryBuilder.from('_module_collections').selectRaw('module_id, COUNT(*) as cnt').groupBy('module_id');
		const counts = await this.db.all<{ module_id: string; cnt: number }>(countQ.toSelect());

		const countMap = new Map(counts.map((c) => [c.module_id, c.cnt]));
		return modules.map((m) => ({ ...m, collection_count: countMap.get(m.id) ?? 0 }));
	}

	/** Get a single module with its attached collections */
	async getModule(slug: string): Promise<ModuleRecord | null> {
		const q = QueryBuilder.from('_modules').select('*').where('slug', slug);
		const rows = await this.db.all<ModuleRecord>(q.toSelect());
		if (rows.length === 0) return null;

		const module = rows[0];

		// Get attached collections — use raw SQL for qualified column names
		const collSql: SqlStatement = {
			sql: `SELECT _module_collections.collection_id, _module_collections.sort_order, _entity_schemas.name, _entity_schemas.slug
        FROM _module_collections
        JOIN _entity_schemas ON _entity_schemas.id = _module_collections.collection_id
        WHERE _module_collections.module_id = ?
        ORDER BY _module_collections.sort_order ASC`,
			bindings: [module.id],
		};
		const colls = await this.db.all<{ collection_id: string; sort_order: number; name: string; slug: string }>(collSql);
		module.collections = colls.map((c) => ({
			id: c.collection_id,
			name: c.name,
			slug: c.slug,
		}));

		return module;
	}

	/**
	 * Get an app manifest — module + collections + full menu tree + published
	 * pages + config_version in ONE round trip. This is the single shape the
	 * frontend shell renders its dock/sidebar/routes from (Studio writes it,
	 * frontend renders it — no reassembly client-side).
	 */
	async getAppManifest(slug: string): Promise<AppManifest | null> {
		// Fetch the module (+ its collections) first, then load menus and pages in
		// parallel — one round of latency instead of three sequential query chains.
		const module = await this.getModule(slug);
		if (!module) return null;

		const [menus, allPages, customBlocks] = await Promise.all([
			new ModuleMenuService(this.db, this.auth).getMenuTree(slug, true),
			new PageService(this.db, this.auth).list(slug),
			new CustomBlockService(this.db, this.auth).list(),
		]);
		return {
			...module,
			menus,
			pages: allPages.filter((p) => p.isPublished),
			custom_blocks: customBlocks,
			config_version: module.config_version ?? 0,
		};
	}

	/** Bump a module's config version — call after any Studio mutation (menu/page/view). */
	async bumpConfigVersion(moduleId: string): Promise<void> {
		const stmt = QueryBuilder.raw('UPDATE _modules SET config_version = config_version + 1, updated_at = ? WHERE id = ?', [
			new Date().toISOString(),
			moduleId,
		]);
		await this.db.run(stmt);
	}

	/** Create a new module */
	async createModule(data: {
		name: string;
		slug: string;
		icon?: string;
		icon_color?: string;
		bg_color?: string;
		description?: string;
		version?: string;
	}): Promise<ModuleRecord> {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		const stmt = QueryBuilder.from('_modules').toInsert({
			id,
			name: data.name,
			slug: data.slug,
			icon: data.icon ?? 'lucide:box',
			icon_color: data.icon_color ?? null,
			bg_color: data.bg_color ?? null,
			description: data.description ?? null,
			version: data.version ?? '1.0.0',
			is_active: 1,
			sort_order: 0,
			created_at: now,
			updated_at: now,
		});

		await this.db.run(stmt);
		return (await this.getModule(data.slug))!;
	}

	/** Update module metadata */
	async updateModule(
		slug: string,
		data: {
			name?: string;
			icon?: string;
			icon_color?: string;
			bg_color?: string;
			description?: string;
			version?: string;
			is_active?: boolean;
			sort_order?: number;
		},
	): Promise<ModuleRecord> {
		const existing = await this.getModule(slug);
		if (!existing) throw new Error(`Module "${slug}" not found`);

		const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
		if (data.name !== undefined) updates.name = data.name;
		if (data.icon !== undefined) updates.icon = data.icon;
		if (data.icon_color !== undefined) updates.icon_color = data.icon_color;
		if (data.bg_color !== undefined) updates.bg_color = data.bg_color;
		if (data.description !== undefined) updates.description = data.description;
		if (data.version !== undefined) updates.version = data.version;
		if (data.is_active !== undefined) updates.is_active = data.is_active ? 1 : 0;
		if (data.sort_order !== undefined) updates.sort_order = data.sort_order;

		const stmt = QueryBuilder.from('_modules').where('slug', slug).toUpdate(updates);

		await this.db.run(stmt);
		return (await this.getModule(slug))!;
	}

	/** Delete a module — cascades to junction records, menus, and views */
	/** Delete a module — cascades to junction records, menus, and views */
	async deleteModule(slug: string): Promise<void> {
		const existing = await this.getModule(slug);
		if (!existing) throw new Error(`Module "${slug}" not found`);

		const moduleId = existing.id;

		// Delete views
		await this.db.run(QueryBuilder.from('_module_views').where('module_id', moduleId).toDelete());
		// Delete menus (cascade children separately since parent_id is self-referential)
		await this._deleteModuleMenus(moduleId);
		// Delete junction records
		await this.db.run(QueryBuilder.from('_module_collections').where('module_id', moduleId).toDelete());
		// Delete the module
		await this.db.run(QueryBuilder.from('_modules').where('id', moduleId).toDelete());
	}

	/** Delete all menu items for a module (children first to respect FK-like constraints) */
	private async _deleteModuleMenus(moduleId: string): Promise<void> {
		// Delete child items first (those with a parent_id pointing to another menu item in this module)
		await this.db.run(QueryBuilder.raw('DELETE FROM _module_menus WHERE module_id = ? AND parent_id IS NOT NULL', [moduleId]));
		// Then delete root items
		await this.db.run(QueryBuilder.raw('DELETE FROM _module_menus WHERE module_id = ? AND parent_id IS NULL', [moduleId]));
	}

	/** Get collections attached to a module */
	async getModuleCollections(slug: string): Promise<Array<{ id: string; name: string; slug: string; sort_order: number }>> {
		const module = await this.getModule(slug);
		if (!module) throw new Error(`Module "${slug}" not found`);

		const qSql: SqlStatement = {
			sql: `SELECT _entity_schemas.id, _entity_schemas.name, _entity_schemas.slug, _module_collections.sort_order
        FROM _module_collections
        JOIN _entity_schemas ON _entity_schemas.id = _module_collections.collection_id
        WHERE _module_collections.module_id = ?
        ORDER BY _module_collections.sort_order ASC`,
			bindings: [module.id],
		};
		return this.db.all(qSql);
	}

	/** Attach a collection to a module */
	async attachCollection(moduleSlug: string, collectionSlug: string): Promise<void> {
		const module = await this.getModule(moduleSlug);
		if (!module) throw new Error(`Module "${moduleSlug}" not found`);

		// Look up the collection
		const collQ = QueryBuilder.from('_entity_schemas').select('id').where('slug', collectionSlug);
		const colls = await this.db.all<{ id: string }>(collQ.toSelect());
		if (colls.length === 0) throw new Error(`Collection "${collectionSlug}" not found`);

		// Check if already attached
		const dupQ = QueryBuilder.from('_module_collections').select('id').where('module_id', module.id).where('collection_id', colls[0].id);
		const existing = await this.db.all<{ id: string }>(dupQ.toSelect());
		if (existing.length > 0) return; // Already attached, no-op

		const id = crypto.randomUUID();
		const now = new Date().toISOString();
		const stmt = QueryBuilder.from('_module_collections').toInsert({
			id,
			module_id: module.id,
			collection_id: colls[0].id,
			sort_order: 0,
			created_at: now,
		});

		await this.db.run(stmt);
	}

	/** Detach a collection from a module */
	async detachCollection(moduleSlug: string, collectionSlug: string): Promise<void> {
		const module = await this.getModule(moduleSlug);
		if (!module) throw new Error(`Module "${moduleSlug}" not found`);

		const collQ = QueryBuilder.from('_entity_schemas').select('id').where('slug', collectionSlug);
		const colls = await this.db.all<{ id: string }>(collQ.toSelect());
		if (colls.length === 0) throw new Error(`Collection "${collectionSlug}" not found`);

		const stmt = QueryBuilder.from('_module_collections').where('module_id', module.id).where('collection_id', colls[0].id).toDelete();
		await this.db.run(stmt);
	}
}

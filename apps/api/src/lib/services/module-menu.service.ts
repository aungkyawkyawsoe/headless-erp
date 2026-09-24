/**
 * Module Menu Service
 *
 * Manages hierarchical menu trees for modules.
 * Each module has its own menu tree: Module → Group → Item.
 * Menu items can link to collections, URLs, or act as group headers.
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import type { AuthContext } from './auth.service';

export interface MenuItemRecord {
	id: string;
	module_id: string;
	parent_id: string | null;
	label: string;
	label_my: string | null;
	icon: string | null;
	type: string;
	target: string | null;
	action_config: string | null;
	roles: string | null;
	sort_order: number;
	is_active: number;
	created_at: string;
	updated_at: string;
	/** Per-menu designer template (e.g. 'table-card-form') — NULL = not set. */
	template: string | null;
	children?: MenuItemRecord[];
}

/** Resolved action from a menu item's action_config */
export interface ActionConfig {
	action_type: 'window' | 'server_function' | 'report' | 'url' | 'redirect';
	collection_slug?: string;
	view_id?: string;
	url?: string;
	function_id?: string;
	report_id?: string;
	context?: Record<string, unknown>;
	domain?: string; // serialized filter JSON for URL-safe context
	route?: string; // for redirect actions
}

export class ModuleMenuService {
	constructor(
		private db: D1Client,
		private auth?: AuthContext,
	) {}

	/** Get the flat list of menu items for a module */
	async getMenuItems(moduleSlug: string, all = false): Promise<MenuItemRecord[]> {
		// First get module ID
		const modQ = QueryBuilder.from('_modules').select('id').where('slug', moduleSlug);
		const mods = await this.db.all<{ id: string }>(modQ.toSelect());
		if (mods.length === 0) return [];

		const q = QueryBuilder.from('_module_menus').select('*').where('module_id', mods[0].id).orderBy('sort_order', 'asc');

		if (!all) {
			q.where('is_active', 1);
		}

		return this.db.all<MenuItemRecord>(q.toSelect());
	}

	/** Get hierarchical menu tree for a module */
	async getMenuTree(moduleSlug: string, all = false): Promise<MenuItemRecord[]> {
		const items = await this.getMenuItems(moduleSlug, all);
		return this._buildTree(items, null);
	}

	/** Build a nested tree from flat list — single pass O(n) via a parent index (was O(n²) filter-per-node). */
	private _buildTree(items: MenuItemRecord[], parentId: string | null): MenuItemRecord[] {
		const byParent = new Map<string | null, MenuItemRecord[]>();
		for (const item of items) {
			const list = byParent.get(item.parent_id);
			if (list) list.push(item);
			else byParent.set(item.parent_id, [item]);
		}
		const build = (pid: string | null): MenuItemRecord[] =>
			(byParent.get(pid) ?? []).sort((a, b) => a.sort_order - b.sort_order).map((item) => ({ ...item, children: build(item.id) }));
		return build(parentId);
	}

	/** Create a menu item */
	async createMenuItem(data: {
		module_slug: string;
		parent_id?: string | null;
		label: string;
		label_my?: string;
		icon?: string;
		type: string;
		target?: string;
		action_config?: ActionConfig;
		sort_order?: number;
		roles?: string[];
		template?: string | null;
	}): Promise<MenuItemRecord> {
		// Get module ID
		const modQ = QueryBuilder.from('_modules').select('id').where('slug', data.module_slug);
		const mods = await this.db.all<{ id: string }>(modQ.toSelect());
		if (mods.length === 0) throw new Error(`Module "${data.module_slug}" not found`);

		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		const stmt = QueryBuilder.from('_module_menus').toInsert({
			id,
			module_id: mods[0].id,
			parent_id: data.parent_id ?? null,
			label: data.label,
			label_my: data.label_my ?? null,
			icon: data.icon ?? null,
			type: data.type ?? 'action',
			target: data.target ?? null,
			action_config: data.action_config ? JSON.stringify(data.action_config) : null,
			roles: data.roles ? JSON.stringify(data.roles) : null,
			template: data.template ?? null,
			sort_order: data.sort_order ?? 0,
			is_active: 1,
			created_at: now,
			updated_at: now,
		});

		await this.db.run(stmt);

		const getQ = QueryBuilder.from('_module_menus').select('*').where('id', id);
		const rows = await this.db.all<MenuItemRecord>(getQ.toSelect());
		return rows[0];
	}

	/** Update a menu item */
	async updateMenuItem(
		id: string,
		data: {
			label?: string;
			label_my?: string;
			icon?: string;
			type?: string;
			target?: string;
			action_config?: ActionConfig | null;
			parent_id?: string | null;
			sort_order?: number;
			is_active?: boolean;
			roles?: string[] | null;
			template?: string | null;
		},
	): Promise<MenuItemRecord> {
		const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
		if (data.label !== undefined) updates.label = data.label;
		if (data.label_my !== undefined) updates.label_my = data.label_my;
		if (data.icon !== undefined) updates.icon = data.icon;
		if (data.type !== undefined) updates.type = data.type;
		if (data.target !== undefined) updates.target = data.target;
		if (data.action_config !== undefined) updates.action_config = data.action_config ? JSON.stringify(data.action_config) : null;
		if (data.parent_id !== undefined) updates.parent_id = data.parent_id;
		if (data.sort_order !== undefined) updates.sort_order = data.sort_order;
		if (data.is_active !== undefined) updates.is_active = data.is_active ? 1 : 0;
		if (data.roles !== undefined) updates.roles = data.roles && data.roles.length > 0 ? JSON.stringify(data.roles) : null;
		if (data.template !== undefined) updates.template = data.template || null;

		const stmt = QueryBuilder.from('_module_menus').where('id', id).toUpdate(updates);
		await this.db.run(stmt);

		const getQ = QueryBuilder.from('_module_menus').select('*').where('id', id);
		const rows = await this.db.all<MenuItemRecord>(getQ.toSelect());
		return rows[0];
	}

	/** Delete a menu item (cascade deletes children) */
	async deleteMenuItem(id: string): Promise<void> {
		// Cascade delete: resolve the full descendant closure from ONE flat read of
		// the module's menus (O(n)), then delete them all in a single statement —
		// the old recursive delete issued one query per node (N+1).
		const mod = await this.db.first<{ module_id: string }>(
			QueryBuilder.from('_module_menus').select('module_id').where('id', id).toSelect(),
		);
		if (!mod) {
			// Item already gone — delete is a no-op (preserve legacy behavior).
			await this.db.run(QueryBuilder.from('_module_menus').where('id', id).toDelete());
			return;
		}

		const all = await this.db.all<{ id: string; parent_id: string | null }>(
			QueryBuilder.from('_module_menus').select('id', 'parent_id').where('module_id', mod.module_id).toSelect(),
		);

		// BFS over the flat rows to collect every descendant of `id`.
		// Pointer-based queue (index instead of shift()) keeps dequeue O(1).
		const byParent = new Map<string | null, string[]>();
		for (const row of all) {
			const list = byParent.get(row.parent_id);
			if (list) list.push(row.id);
			else byParent.set(row.parent_id, [row.id]);
		}
		const doomed = new Set<string>([id]);
		const queue = [id];
		let qi = 0;
		while (qi < queue.length) {
			const pid = queue[qi++];
			for (const child of byParent.get(pid) ?? []) {
				if (!doomed.has(child)) {
					doomed.add(child);
					queue.push(child);
				}
			}
		}

		await this.db.run(
			QueryBuilder.from('_module_menus')
				.whereIn('id', [...doomed])
				.toDelete(),
		);
	}
}

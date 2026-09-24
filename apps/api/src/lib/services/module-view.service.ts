/**
 * Module View Service
 *
 * Manages configurable views for collections within a module.
 * Views define how data is displayed: columns, filters, sort, layout type.
 */

import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import type { AuthContext } from './auth.service';

export interface ViewRecord {
	id: string;
	module_id: string;
	collection_slug: string;
	name: string;
	type: string;
	config_json: string;
	is_default: number;
	sort_order: number;
	created_at: string;
	updated_at: string;
	config?: ViewConfig;
}

export interface ViewConfig {
	columns?: Array<{ field: string; header: string; width?: number; visible?: boolean }>;
	filters?: Array<{ field: string; op: string; value: unknown }>;
	sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
	page_size?: number;
}

export class ModuleViewService {
	constructor(
		private db: D1Client,
		private auth?: AuthContext,
	) {}

	/** Get module ID from slug */
	private async _getModuleId(moduleSlug: string): Promise<string> {
		const q = QueryBuilder.from('_modules').select('id').where('slug', moduleSlug);
		const mods = await this.db.all<{ id: string }>(q.toSelect());
		if (mods.length === 0) throw new Error(`Module "${moduleSlug}" not found`);
		return mods[0].id;
	}

	/** List views for a module, optionally filtered by collection */
	async getViews(moduleSlug: string, collectionSlug?: string): Promise<ViewRecord[]> {
		const modQ = QueryBuilder.from('_modules').select('id').where('slug', moduleSlug);
		const mods = await this.db.all<{ id: string }>(modQ.toSelect());
		if (mods.length === 0) return [];
		const moduleId = mods[0].id;
		const q = QueryBuilder.from('_module_views').select('*').where('module_id', moduleId).orderBy('sort_order', 'asc');

		if (collectionSlug) {
			q.where('collection_slug', collectionSlug);
		}

		const rows = await this.db.all<ViewRecord>(q.toSelect());
		return rows.map((r) => ({
			...r,
			config: JSON.parse(r.config_json || '{}') as ViewConfig,
		}));
	}

	/** Create a view */
	async createView(data: {
		module_slug: string;
		collection_slug: string;
		name: string;
		type?: string;
		config?: ViewConfig;
	}): Promise<ViewRecord> {
		const moduleId = await this._getModuleId(data.module_slug);
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		// If this is the first view for this collection, make it default
		const countQ = QueryBuilder.from('_module_views').where('module_id', moduleId).where('collection_slug', data.collection_slug).toCount();
		const counts = await this.db.all<{ count: number }>(countQ);
		const isDefault = counts[0]?.count === 0 ? 1 : 0;

		const stmt = QueryBuilder.from('_module_views').toInsert({
			id,
			module_id: moduleId,
			collection_slug: data.collection_slug,
			name: data.name,
			type: data.type ?? 'table',
			config_json: JSON.stringify(data.config ?? {}),
			is_default: isDefault,
			sort_order: 0,
			created_at: now,
			updated_at: now,
		});

		await this.db.run(stmt);

		const getQ = QueryBuilder.from('_module_views').select('*').where('id', id);
		const rows = await this.db.all<ViewRecord>(getQ.toSelect());
		return { ...rows[0], config: JSON.parse(rows[0].config_json || '{}') as ViewConfig };
	}

	/** Update a view */
	async updateView(
		id: string,
		data: {
			name?: string;
			type?: string;
			config?: ViewConfig;
			is_default?: boolean;
		},
	): Promise<ViewRecord> {
		const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
		if (data.name !== undefined) updates.name = data.name;
		if (data.type !== undefined) updates.type = data.type;
		if (data.config !== undefined) updates.config_json = JSON.stringify(data.config);
		if (data.is_default !== undefined) {
			// Unset any existing default for this module/collection before setting new one
			if (data.is_default) {
				const view = await this.getViewById(id);
				if (view) {
					await this.db.run(
						QueryBuilder.from('_module_views')
							.where('module_id', view.module_id)
							.where('collection_slug', view.collection_slug)
							.where('is_default', 1)
							.toUpdate({ is_default: 0, updated_at: new Date().toISOString() }),
					);
				}
			}
			updates.is_default = data.is_default ? 1 : 0;
		}

		const stmt = QueryBuilder.from('_module_views').where('id', id).toUpdate(updates);
		await this.db.run(stmt);

		const updated = await this.getViewById(id);
		if (!updated) throw new Error(`View "${id}" not found after update`);
		return updated;
	}

	private async getViewById(id: string): Promise<ViewRecord | null> {
		const q = QueryBuilder.from('_module_views').select('*').where('id', id);
		const rows = await this.db.all<ViewRecord>(q.toSelect());
		if (rows.length === 0) throw new Error(`View "${id}" not found`);
		return { ...rows[0], config: JSON.parse(rows[0].config_json || '{}') as ViewConfig };
	}

	/** Delete a view */
	async deleteView(id: string): Promise<void> {
		const stmt = QueryBuilder.from('_module_views').where('id', id).toDelete();
		await this.db.run(stmt);
	}
}

/**
 * Saved Views Service — User Presets for Filters, Sorts, Columns
 *
 * Users can save their preferred filter/sort/column configurations
 * as named views. Views can be private or shared with roles/public.
 *
 * Bundle: ~2KB for service + routes
 */

import { D1Client, QueryBuilder } from '@mmbix/core';
import type { CollectionView, ViewConfig } from '@mmbix/types';

export class SavedViewService {
	constructor(private db: D1Client) {}

	/** Ensure the _collection_views table exists */
	static async ensureTable(db: D1Client): Promise<void> {
		await db.exec(
			'CREATE TABLE IF NOT EXISTS _collection_views (id TEXT PRIMARY KEY, collection_slug TEXT NOT NULL, name TEXT NOT NULL, user_id TEXT, visibility TEXT DEFAULT "private", config TEXT NOT NULL, created_at TEXT NOT NULL)',
		);
		await db.exec('CREATE INDEX IF NOT EXISTS idx_cv_collection ON _collection_views(collection_slug)');
		await db.exec('CREATE INDEX IF NOT EXISTS idx_cv_user ON _collection_views(user_id)');
	}

	/** Create a new view */
	async create(params: {
		collection_slug: string;
		name: string;
		user_id: string;
		config: ViewConfig;
		visibility?: string;
	}): Promise<CollectionView> {
		const id = crypto.randomUUID();
		const now = new Date().toISOString();

		// If this is marked as default, unset other defaults for this user+collection
		if (params.config.isDefault) {
			await this.db.run({
				sql: `UPDATE _collection_views SET config = json_set(config, '$.isDefault', false) WHERE collection_slug = ? AND user_id = ?`,
				bindings: [params.collection_slug, params.user_id],
			});
		}

		await this.db.run({
			sql: `INSERT INTO _collection_views (id, collection_slug, name, user_id, visibility, config, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			bindings: [
				id,
				params.collection_slug,
				params.name,
				params.user_id,
				params.visibility || 'private',
				JSON.stringify(params.config),
				now,
			],
		});

		return {
			id,
			collection_slug: params.collection_slug,
			name: params.name,
			user_id: params.user_id,
			visibility: params.visibility || 'private',
			config: params.config,
			created_at: now,
		};
	}

	/** List views for a collection (user's own + shared) */
	async listForCollection(collectionSlug: string, userId: string): Promise<CollectionView[]> {
		const rows = await this.db.all<{
			id: string;
			collection_slug: string;
			name: string;
			user_id: string;
			visibility: string;
			config: string;
			created_at: string;
		}>(
			QueryBuilder.from('_collection_views')
				.select('*')
				.where('collection_slug', collectionSlug)
				.whereGroup(
					[
						{ column: 'user_id', op: '=', value: userId, type: 'or' },
						{ column: 'visibility', op: '=', value: 'public', type: 'or' },
					],
					'or',
				)
				.orderBy('created_at', 'desc')
				.toSelect(),
		);

		return rows.map((r) => ({
			...r,
			config: JSON.parse(r.config) as ViewConfig,
		}));
	}

	/** Get a single view by ID */
	async getById(viewId: string): Promise<CollectionView | null> {
		const row = await this.db.first<{
			id: string;
			collection_slug: string;
			name: string;
			user_id: string;
			visibility: string;
			config: string;
			created_at: string;
		}>(QueryBuilder.from('_collection_views').select('*').where('id', viewId).toSelect());

		if (!row) return null;
		return { ...row, config: JSON.parse(row.config) as ViewConfig };
	}

	/** Delete a view */
	async delete(viewId: string, userId: string): Promise<boolean> {
		const result = await this.db.run({
			sql: `DELETE FROM _collection_views WHERE id = ? AND user_id = ?`,
			bindings: [viewId, userId],
		});
		const meta = (result as unknown as { meta?: { changes?: number; changes_written?: number } }).meta ?? {};
		return (meta.changes ?? meta.changes_written ?? 0) > 0;
	}

	/** Update a view */
	async update(
		viewId: string,
		userId: string,
		updates: { name?: string; config?: ViewConfig; visibility?: string },
	): Promise<CollectionView | null> {
		const existing = await this.getById(viewId);
		if (!existing || existing.user_id !== userId) return null;

		const name = updates.name || existing.name;
		const config = updates.config || existing.config;
		const visibility = updates.visibility || existing.visibility;

		// If setting as default, unset others
		if (config.isDefault) {
			await this.db.run({
				sql: `UPDATE _collection_views SET config = json_set(config, '$.isDefault', false) WHERE collection_slug = ? AND user_id = ? AND id != ?`,
				bindings: [existing.collection_slug, userId, viewId],
			});
		}

		await this.db.run({
			sql: `UPDATE _collection_views SET name = ?, config = ?, visibility = ? WHERE id = ?`,
			bindings: [name, JSON.stringify(config), visibility, viewId],
		});

		return { ...existing, name, config, visibility };
	}
}

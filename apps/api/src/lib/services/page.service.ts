/**
 * Page Service — Persists block-based page configurations to D1.
 *
 * Each module can have multiple pages identified by path.
 * Pages store their block composition as JSON (blocks_json).
 * The admin's Design Mode creates/updates pages via this service.
 */
import { D1Client, QueryBuilder } from '@mmbix/core';
import type { AuthContext } from './auth.service';

export interface PageRecord {
	id: string;
	module_id: string | null;
	path: string;
	title: string;
	blocks_json: string;
	global_filter: string | null;
	is_published: number;
	created_at: string;
	updated_at: string;
}

export interface PageBlocks {
	id: string;
	type: string;
	label?: string;
	layout: { order: number; colSpan?: number; colStart?: number; alignY?: 'start' | 'end'; rowSpan?: number };
	config: Record<string, unknown>;
}

export interface PageData {
	id: string;
	module_id: string | null;
	path: string;
	title: string;
	blocks: PageBlocks[];
	globalFilter?: Record<string, unknown> | null;
	isPublished: boolean;
	createdAt: string;
	updatedAt: string;
}

export interface PageVersion {
	id: string;
	page_id: string;
	version: number;
	blocks: PageBlocks[];
	title: string;
	meta?: Record<string, unknown> | null;
	createdAt: string;
}

export class PageService {
	constructor(
		private db: D1Client,
		private auth?: AuthContext,
	) {}

	/** List all pages, optionally filtered by module */
	async list(moduleSlug?: string): Promise<PageData[]> {
		const q = QueryBuilder.from('_pages').select('*').orderBy('path', 'asc');

		if (moduleSlug) {
			// Look up module id from slug
			const modQ = QueryBuilder.from('_modules').select('id').where('slug', moduleSlug);
			const mods = await this.db.all<{ id: string }>(modQ.toSelect());
			if (mods.length === 0) return [];
			q.where('module_id', mods[0].id);
		}

		const rows = await this.db.all<PageRecord>(q.toSelect());
		return rows.map((r) => this._toData(r));
	}

	/** Get page by module slug and path */
	async getByPath(moduleSlug: string, path: string): Promise<PageData | null> {
		const modQ = QueryBuilder.from('_modules').select('id').where('slug', moduleSlug);
		const mods = await this.db.all<{ id: string }>(modQ.toSelect());
		if (mods.length === 0) return null;

		const q = QueryBuilder.from('_pages').select('*').where('module_id', mods[0].id).where('path', path);
		const rows = await this.db.all<PageRecord>(q.toSelect());
		return rows.length > 0 ? this._toData(rows[0]) : null;
	}

	/** Get page by ID */
	async getById(id: string): Promise<PageData | null> {
		const q = QueryBuilder.from('_pages').select('*').where('id', id);
		const rows = await this.db.all<PageRecord>(q.toSelect());
		return rows.length > 0 ? this._toData(rows[0]) : null;
	}

	/** Create or update a page (upsert by module_id + path) */
	async save(data: {
		module_id?: string | null;
		path: string;
		title: string;
		blocks?: PageBlocks[];
		globalFilter?: Record<string, unknown> | null;
		is_published?: boolean;
	}): Promise<PageData> {
		const moduleId = data.module_id || null;
		const now = new Date().toISOString();
		const blocksJson = JSON.stringify(data.blocks ?? []);
		const globalFilterJson = data.globalFilter ? JSON.stringify(data.globalFilter) : null;

		// Check if page exists
		const existingQ = QueryBuilder.from('_pages').select('id').where('path', data.path);
		if (moduleId) {
			existingQ.where('module_id', moduleId);
		}
		const existing = await this.db.all<{ id: string }>(existingQ.toSelect());

		if (existing.length > 0) {
			// Update
			const updates: Record<string, unknown> = {
				title: data.title,
				blocks_json: blocksJson,
				global_filter: globalFilterJson,
				is_published: data.is_published ? 1 : 0,
				updated_at: now,
			};
			const stmt = QueryBuilder.from('_pages').where('id', existing[0].id).toUpdate(updates);
			await this.db.run(stmt);
			const updated = await this.getById(existing[0].id);
			if (updated) await this.snapshot(updated, { reason: 'save' });
			return updated!;
		}

		// Insert
		const id = crypto.randomUUID();
		const stmt = QueryBuilder.from('_pages').toInsert({
			id,
			module_id: moduleId,
			path: data.path,
			title: data.title,
			blocks_json: blocksJson,
			global_filter: globalFilterJson,
			is_published: data.is_published ? 1 : 0,
			created_at: now,
			updated_at: now,
		});
		await this.db.run(stmt);
		return (await this.getById(id))!;
	}

	/** Delete a page */
	async delete(id: string): Promise<boolean> {
		const stmt = QueryBuilder.from('_pages').where('id', id).toDelete();
		await this.db.run(stmt);
		return true;
	}

	/** Delete all pages for a module */
	async deleteByModule(moduleId: string): Promise<void> {
		const stmt = QueryBuilder.from('_pages').where('module_id', moduleId).toDelete();
		await this.db.run(stmt);
	}

	// ── Version history ─────────────────────────────────

	/** Snapshot the current page state as a new version (after every save). */
	async snapshot(page: PageData, meta?: Record<string, unknown>): Promise<void> {
		const last = await this.db.first<{ version: number }>(
			QueryBuilder.from('_page_versions').select('version').where('page_id', page.id).orderBy('version', 'desc').toSelect(),
		);
		const version = (last?.version ?? 0) + 1;
		const stmt = QueryBuilder.from('_page_versions').toInsert({
			id: crypto.randomUUID(),
			page_id: page.id,
			version,
			blocks_json: JSON.stringify(page.blocks),
			title: page.title,
			meta_json: meta ? JSON.stringify(meta) : null,
			created_at: new Date().toISOString(),
		});
		await this.db.run(stmt);
	}

	/** List version history for a page (newest first). */
	async versions(pageId: string): Promise<PageVersion[]> {
		const rows = await this.db.all<{
			id: string;
			page_id: string;
			version: number;
			blocks_json: string;
			title: string;
			meta_json: string | null;
			created_at: string;
		}>(QueryBuilder.from('_page_versions').select('*').where('page_id', pageId).orderBy('version', 'desc').toSelect());
		return rows.map((r) => {
			let blocks: PageBlocks[] = [];
			try {
				blocks = JSON.parse(r.blocks_json || '[]');
			} catch {
				/* keep empty */
			}
			let meta: Record<string, unknown> | null = null;
			try {
				meta = JSON.parse(r.meta_json || 'null');
			} catch {
				/* keep null */
			}
			return { id: r.id, page_id: r.page_id, version: r.version, blocks, title: r.title, meta, createdAt: r.created_at };
		});
	}

	/** Restore a page to a version's block state — returns the restored page. */
	async restore(pageId: string, versionId: string): Promise<PageData | null> {
		const v = await this.db.first<{
			id: string;
			version: number;
			blocks_json: string;
			title: string;
		}>(
			QueryBuilder.from('_page_versions')
				.select('id', 'version', 'blocks_json', 'title')
				.where('id', versionId)
				.where('page_id', pageId)
				.toSelect(),
		);
		if (!v) return null;
		const page = await this.getById(pageId);
		if (!page) return null;
		let blocks: PageBlocks[] = [];
		try {
			blocks = JSON.parse(v.blocks_json || '[]');
		} catch {
			/* keep empty */
		}
		const now = new Date().toISOString();
		const stmt = QueryBuilder.from('_pages')
			.where('id', pageId)
			.toUpdate({ blocks_json: JSON.stringify(blocks), title: v.title, updated_at: now });
		await this.db.run(stmt);
		const restored = await this.getById(pageId);
		if (restored) await this.snapshot(restored, { restored_from: versionId, restored_version: v.version });
		return restored;
	}

	// ── Helpers ───────────────────────────────────────────

	private _toData(r: PageRecord): PageData {
		let blocks: PageBlocks[] = [];
		try {
			blocks = JSON.parse(r.blocks_json || '[]');
		} catch {
			/* keep empty */
		}
		let globalFilter: Record<string, unknown> | null = null;
		try {
			globalFilter = JSON.parse(r.global_filter || 'null');
		} catch {
			/* keep null */
		}

		return {
			id: r.id,
			module_id: r.module_id,
			path: r.path,
			title: r.title,
			blocks,
			globalFilter,
			isPublished: r.is_published === 1,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		};
	}
}

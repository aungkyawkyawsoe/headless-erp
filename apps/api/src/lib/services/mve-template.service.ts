import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import type { MveTemplate, MveTemplateRecord } from '@mmbix/types';

/**
 * MVE Template Service — CRUD for MiniApp module templates (`_mve_templates`).
 *
 * One row per miniapp module key (slug = 'vehicle/trips', …).
 * `config_json` holds the JSON-serializable template bundle (list / form /
 * editForm / dashboard). `version` bumps on every write so clients revalidate
 * with If-None-Match instead of guessing TTLs — same freshness contract as
 * the app manifest (`_modules.config_version`).
 */
export class MveTemplateService {
	constructor(private db: D1Client) {}

	/** Full template for a module slug, or null when none is published. */
	async getTemplate(slug: string): Promise<MveTemplate | null> {
		const rows = await this.db.all<MveTemplateRecord>(QueryBuilder.from('_mve_templates').select('*').where('slug', slug).toSelect());
		if (rows.length === 0) return null;
		const row = rows[0];
		const config = JSON.parse(row.config_json || '{}') as Partial<Pick<MveTemplate, 'list' | 'form' | 'editForm' | 'dashboard'>>;
		return {
			slug: row.slug,
			title: row.title,
			accent: row.accent,
			collection: row.collection ?? undefined,
			...config,
			version: row.version,
			updatedAt: row.updated_at,
		};
	}

	/**
	 * Create or replace a template (idempotent upsert keyed by slug). Every
	 * write bumps `version` — conditional GETs (If-None-Match) stay correct
	 * whether the edit changed one field or the whole bundle.
	 */
	async upsertTemplate(
		slug: string,
		data: {
			title: string;
			accent: string;
			collection?: string;
			list?: unknown;
			form?: unknown;
			editForm?: unknown;
			dashboard?: unknown;
		},
	): Promise<MveTemplate> {
		const existing = await this.db.first<{ version: number; created_at: string }>(
			QueryBuilder.from('_mve_templates').select('version', 'created_at').where('slug', slug).toSelect(),
		);
		const now = new Date().toISOString();
		const version = (existing?.version ?? 0) + 1;
		const row: MveTemplateRecord = {
			slug,
			title: data.title,
			accent: data.accent,
			collection: data.collection ?? null,
			config_json: JSON.stringify({ list: data.list, form: data.form, editForm: data.editForm, dashboard: data.dashboard }),
			version,
			// Keep the original created_at across upserts (ON CONFLICT updates every column).
			created_at: existing?.created_at ?? now,
			updated_at: now,
		};
		await this.db.run(
			QueryBuilder.from('_mve_templates')
				.onConflict(['slug'], 'update')
				.toInsert(row as unknown as Record<string, unknown>),
		);
		return this.getTemplate(slug) as Promise<MveTemplate>;
	}

	/** Remove a template (no-op when absent). */
	async deleteTemplate(slug: string): Promise<void> {
		await this.db.run(QueryBuilder.from('_mve_templates').where('slug', slug).toDelete());
	}

	/** All published template slugs + versions (for admin dashboards / bulk checks). */
	async listTemplates(): Promise<{ slug: string; version: number; updated_at: string }[]> {
		return this.db.all<{ slug: string; version: number; updated_at: string }>(
			QueryBuilder.from('_mve_templates').select('slug', 'version', 'updated_at').orderBy('slug', 'asc').toSelect(),
		);
	}
}

/**
 * DesignTokens Service — per-app theme token sets (the design-system swap layer).
 *
 * Each set is a JSON object of CSS-variable key/value pairs (--primary, --radius-3,
 * --font-sans, ...). The Studio's token picker reads these; the runtime applies
 * them as CSS variables on the app shell (rebrand = swap the token set).
 */
import { D1Client, QueryBuilder } from '@mmbix/core';
import type { AuthContext } from './auth.service';

export interface DesignTokenSet {
	id: string;
	app_id: string | null;
	set_name: string;
	is_default: number;
	tokens_json: string;
	created_at: string;
	updated_at: string;
}

export class DesignTokenService {
	constructor(
		private db: D1Client,
		private auth?: AuthContext,
	) {}

	/** List token sets — filtered by app (null = global default set). */
	async list(appId?: string | null): Promise<DesignTokenSet[]> {
		const q = QueryBuilder.from('_design_tokens').select('*').orderBy('app_id', 'asc').orderBy('set_name', 'asc');
		if (appId) q.where('app_id', appId);
		return this.db.all<DesignTokenSet>(q.toSelect());
	}

	/** Get one set by id. */
	async getById(id: string): Promise<DesignTokenSet | null> {
		const q = QueryBuilder.from('_design_tokens').select('*').where('id', id);
		return this.db.first<DesignTokenSet>(q.toSelect());
	}

	/** Get the effective set for an app — app-specific default, else global default, else null. */
	async effective(appId?: string | null): Promise<DesignTokenSet | null> {
		if (appId) {
			const appDefault = await this.db.first<DesignTokenSet>(
				QueryBuilder.from('_design_tokens').select('*').where('app_id', appId).where('is_default', 1).toSelect(),
			);
			if (appDefault) return appDefault;
		}
		const globalDefault = await this.db.first<DesignTokenSet>(
			QueryBuilder.from('_design_tokens').select('*').where('app_id', null).where('is_default', 1).toSelect(),
		);
		return globalDefault;
	}

	/** Upsert a token set. */
	async save(data: {
		id?: string;
		app_id?: string | null;
		set_name: string;
		is_default?: boolean;
		tokens_json: string;
	}): Promise<DesignTokenSet> {
		const now = new Date().toISOString();
		const tokensJson = data.tokens_json;

		// When this set becomes the app default, clear others.
		if (data.is_default) {
			await this.db.run(
				QueryBuilder.from('_design_tokens')
					.where('app_id', data.app_id ?? null)
					.toUpdate({ is_default: 0 }),
			);
		}

		const existing = data.id ? await this.getById(data.id) : null;
		if (existing) {
			const updates: Record<string, unknown> = {
				app_id: data.app_id ?? null,
				set_name: data.set_name,
				is_default: data.is_default ? 1 : 0,
				tokens_json: tokensJson,
				updated_at: now,
			};
			const stmt = QueryBuilder.from('_design_tokens').where('id', existing.id).toUpdate(updates);
			await this.db.run(stmt);
			return (await this.getById(existing.id))!;
		}

		const id = data.id ?? crypto.randomUUID();
		const stmt = QueryBuilder.from('_design_tokens').toInsert({
			id,
			app_id: data.app_id ?? null,
			set_name: data.set_name,
			is_default: data.is_default ? 1 : 0,
			tokens_json: tokensJson,
			created_at: now,
			updated_at: now,
		});
		await this.db.run(stmt);
		return (await this.getById(id))!;
	}

	/** Delete a token set. */
	async delete(id: string): Promise<boolean> {
		const stmt = QueryBuilder.from('_design_tokens').where('id', id).toDelete();
		await this.db.run(stmt);
		return true;
	}

	/** Parse the tokens_json into a CSS-variable record (invalid → {}). */
	static parseTokens(set: DesignTokenSet | null): Record<string, string> {
		if (!set) return {};
		try {
			const obj = JSON.parse(set.tokens_json);
			return obj && typeof obj === 'object' ? (obj as Record<string, string>) : {};
		} catch {
			return {};
		}
	}
}

/**
 * CustomBlock Service — extension API for runtime-registered block types.
 *
 * Each custom block maps a NEW type name to an existing design-system component
 * (resolve) plus a props schema + defaults. The Studio palette and the runtime
 * renderer pick these up automatically — adding a block type needs no code.
 */
import { D1Client, QueryBuilder } from '@mmbix/core';
import type { AuthContext } from './auth.service';

export interface CustomBlockRecord {
	id: string;
	type: string;
	label: string;
	group_name: string;
	resolve: string;
	icon: string | null;
	props_schema_json: string | null;
	defaults_json: string | null;
	created_at: string;
	updated_at: string;
}

export interface CustomBlock {
	id: string;
	type: string;
	label: string;
	group: string;
	resolve: string;
	icon?: string | null;
	props_schema?: Record<string, unknown> | null;
	defaults?: Record<string, unknown> | null;
}

export class CustomBlockService {
	constructor(
		private db: D1Client,
		private auth?: AuthContext,
	) {}

	/** List all custom blocks. */
	async list(): Promise<CustomBlock[]> {
		const rows = await this.db.all<CustomBlockRecord>(QueryBuilder.from('_custom_blocks').select('*').orderBy('label', 'asc').toSelect());
		return rows.map((r) => this._toData(r));
	}

	async getById(id: string): Promise<CustomBlock | null> {
		const row = await this.db.first<CustomBlockRecord>(QueryBuilder.from('_custom_blocks').select('*').where('id', id).toSelect());
		return row ? this._toData(row) : null;
	}

	async getByType(type: string): Promise<CustomBlock | null> {
		const row = await this.db.first<CustomBlockRecord>(QueryBuilder.from('_custom_blocks').select('*').where('type', type).toSelect());
		return row ? this._toData(row) : null;
	}

	/** Create or update a custom block (upsert by type). */
	async save(data: {
		type: string;
		label: string;
		group?: string;
		resolve: string;
		icon?: string | null;
		props_schema?: Record<string, unknown> | null;
		defaults?: Record<string, unknown> | null;
	}): Promise<CustomBlock> {
		const now = new Date().toISOString();
		const existing = await this.getByType(data.type);

		const record = {
			label: data.label,
			group_name: data.group ?? 'Custom',
			resolve: data.resolve,
			icon: data.icon ?? null,
			props_schema_json: data.props_schema ? JSON.stringify(data.props_schema) : null,
			defaults_json: data.defaults ? JSON.stringify(data.defaults) : null,
			updated_at: now,
		};

		if (existing) {
			const stmt = QueryBuilder.from('_custom_blocks').where('id', existing.id).toUpdate(record);
			await this.db.run(stmt);
			return (await this.getById(existing.id))!;
		}

		const id = crypto.randomUUID();
		const stmt = QueryBuilder.from('_custom_blocks').toInsert({
			id,
			type: data.type,
			...record,
			created_at: now,
		});
		await this.db.run(stmt);
		return (await this.getById(id))!;
	}

	/** Delete a custom block. */
	async delete(id: string): Promise<boolean> {
		const stmt = QueryBuilder.from('_custom_blocks').where('id', id).toDelete();
		await this.db.run(stmt);
		return true;
	}

	private _toData(r: CustomBlockRecord): CustomBlock {
		let props_schema: Record<string, unknown> | null = null;
		let defaults: Record<string, unknown> | null = null;
		try {
			props_schema = r.props_schema_json ? JSON.parse(r.props_schema_json) : null;
		} catch {
			/* keep null */
		}
		try {
			defaults = r.defaults_json ? JSON.parse(r.defaults_json) : null;
		} catch {
			/* keep null */
		}
		return {
			id: r.id,
			type: r.type,
			label: r.label,
			group: r.group_name,
			resolve: r.resolve,
			icon: r.icon,
			props_schema,
			defaults,
		};
	}
}

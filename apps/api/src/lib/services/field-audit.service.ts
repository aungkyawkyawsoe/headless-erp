/**
 * FieldAuditService — per-field change log (data lineage).
 *
 * Every create/update writes one row per changed field into `_field_audit`,
 * tagged with `source` (which pipeline stage wrote it: 'create' | 'update' |
 * 'workflow' | 'decision_table' | 'hook' | 'plugin'). Combined with the
 * workflow history + decision-rule audit, this gives full field-level lineage:
 * "where did this value come from, who set it, when?"
 *
 * Opt-in: the collection must set audit_enabled=true (same flag as the
 * snapshot audit log) so collections that don't need it pay nothing.
 */

import { D1Client } from '@mmbix/core';
import type { AuthContext } from '@/lib/services/auth.service';

export type FieldAuditSource = 'create' | 'update' | 'workflow' | 'decision_table' | 'hook' | 'plugin' | 'delete' | 'restore';

/** System columns never logged as field changes (they have their own audit trails). */
const SYSTEM_FIELDS = new Set([
	'id',
	'_meta',
	'created_at',
	'updated_at',
	'deleted_at',
	'deleted_by',
	'_owner',
	'created_by',
	'updated_by',
	'display_number',
	'doc_status',
	'_transition',
]);

export class FieldAuditService {
	constructor(private readonly db: D1Client) {}

	/** Log the full field set of a freshly created document. */
	async logCreate(collectionSlug: string, documentId: string, item: Record<string, unknown>, auth?: AuthContext | null): Promise<void> {
		const rows: Array<[string, string, string, string, string | null, string | null, string | null, string]> = [];
		for (const [field, value] of Object.entries(item)) {
			if (SYSTEM_FIELDS.has(field)) continue;
			if (value === undefined || value === null) continue;
			rows.push([crypto.randomUUID(), collectionSlug, documentId, field, null, this.stringify(value), auth?.user_id ?? null, 'create']);
		}
		await this.insertMany(rows);
	}

	/** Log only the fields that actually changed on an update. */
	async logUpdate(
		collectionSlug: string,
		documentId: string,
		before: Record<string, unknown>,
		after: Record<string, unknown>,
		auth?: AuthContext | null,
		source: FieldAuditSource = 'update',
	): Promise<void> {
		const rows: Array<[string, string, string, string, string | null, string | null, string | null, string]> = [];
		for (const [field, value] of Object.entries(after)) {
			if (SYSTEM_FIELDS.has(field)) continue;
			const prev = before[field];
			if (this.stringify(prev) === this.stringify(value)) continue;
			rows.push([
				crypto.randomUUID(),
				collectionSlug,
				documentId,
				field,
				this.stringify(prev),
				this.stringify(value),
				auth?.user_id ?? null,
				source,
			]);
		}
		await this.insertMany(rows);
	}

	/** Lineage for one document — every field change, oldest first. */
	async getLineage(collectionSlug: string, documentId: string, field?: string): Promise<Array<Record<string, unknown>>> {
		const sql = `SELECT field, value_from, value_to, by_user, source, created_at FROM _field_audit
			WHERE collection_slug = ? AND document_id = ?${field ? ' AND field = ?' : ''}
			ORDER BY created_at ASC`;
		const bindings: unknown[] = [collectionSlug, documentId];
		if (field) bindings.push(field);
		return this.db.all<Record<string, unknown>>({ sql, bindings });
	}

	// ─── Internals ───────────────────────────────────────

	private stringify(v: unknown): string | null {
		if (v === undefined || v === null) return null;
		if (typeof v === 'object') return JSON.stringify(v);
		return String(v);
	}

	/** One batched insert for many rows (single round-trip). */
	private async insertMany(
		rows: Array<[string, string, string, string, string | null, string | null, string | null, string]>,
	): Promise<void> {
		if (rows.length === 0) return;
		// Chunk to stay under D1's 100-bound-param limit (8 params/row → 12 rows).
		for (let i = 0; i < rows.length; i += 12) {
			const chunk = rows.slice(i, i + 12);
			const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
			const bindings = chunk.flat();
			await this.db.run({
				sql: `INSERT INTO _field_audit (id, collection_slug, document_id, field, value_from, value_to, by_user, source) VALUES ${placeholders}`,
				bindings,
			});
		}
	}
}

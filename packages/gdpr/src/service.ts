/**
 * GdpRService — data-subject erasure with an audit trail.
 *
 *   gdpr.erase({ subject: 'user@example.com', piiField: 'email', mode: 'anonymize' })
 *     → matches every collection with an `email` field and redacts the value
 *
 * Modes: 'anonymize' (PII → "[redacted]") | 'delete' (row removed). Every run
 * is recorded in `_gdpr_requests` (subject, collections, matched counts) for
 * compliance. `dryRun` reports matches without touching data.
 */

import { D1Client } from '@mmbix/core';

export interface ErasureInput {
	/** The PII value to find (email, phone, national id…). */
	subject: string;
	/** The PII field to match on (e.g. "email"). */
	piiField: string;
	/** Collection slugs to scan — default: every schema collection. */
	collections?: string[];
	/** anonymize (default) | delete */
	mode?: 'anonymize' | 'delete';
	/** Report matches without modifying anything. */
	dryRun?: boolean;
}

export interface ErasureAction {
	collection: string;
	table: string;
	action: 'matched' | 'anonymized' | 'deleted' | 'error';
	count: number;
	error?: string;
}

export interface ErasureResult {
	requestId: string;
	matched: number;
	actions: ErasureAction[];
}

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

const REQUESTS_TABLE = `CREATE TABLE IF NOT EXISTS _gdpr_requests (id TEXT PRIMARY KEY, subject TEXT NOT NULL, pii_field TEXT NOT NULL, mode TEXT NOT NULL, collections_json TEXT, dry_run INTEGER NOT NULL DEFAULT 0, matched_total INTEGER NOT NULL DEFAULT 0, actions_json TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL)`;

export class GdpRService {
	constructor(private readonly db: D1Client) {}

	async erase(input: ErasureInput): Promise<ErasureResult> {
		const subject = String(input.subject ?? '').trim();
		const piiField = String(input.piiField ?? '').trim();
		const mode = input.mode === 'delete' ? 'delete' : 'anonymize';
		const dryRun = input.dryRun === true;
		if (!subject) throw new Error('gdpr: subject is required');
		if (!IDENTIFIER.test(piiField)) throw new Error(`gdpr: piiField "${piiField}" is not a safe identifier`);

		await this.ensure();
		const actions: ErasureAction[] = [];
		let matchedTotal = 0;

		// Resolve collections → tables.
		let targets: Array<{ slug: string; table: string }>;
		if (input.collections?.length) {
			targets = [];
			for (const slug of input.collections) {
				const row = await this.db.first<{ table_name: string }>({
					sql: 'SELECT table_name FROM _entity_schemas WHERE slug = ?',
					bindings: [slug.trim()],
				});
				if (!row) throw new Error(`gdpr: unknown collection "${slug}"`);
				if (!IDENTIFIER.test(row.table_name)) throw new Error(`gdpr: unsafe table "${row.table_name}"`);
				targets.push({ slug: slug.trim(), table: row.table_name });
			}
		} else {
			const rows = await this.db.all<{ slug: string; table_name: string }>({
				sql: 'SELECT slug, table_name FROM _entity_schemas',
				bindings: [],
			});
			targets = rows.filter((r) => IDENTIFIER.test(r.table_name)).map((r) => ({ slug: r.slug, table: r.table_name }));
		}

		for (const { slug, table } of targets) {
			try {
				const countRow = await this.db.first<{ n: number }>({
					sql: `SELECT COUNT(*) AS n FROM ${table} WHERE ${piiField} = ?`,
					bindings: [subject],
				});
				const count = Number(countRow?.n ?? 0);
				if (count === 0) continue;

				if (dryRun) {
					actions.push({ collection: slug, table, action: 'matched', count });
					matchedTotal += count;
					continue;
				}
				if (mode === 'delete') {
					// Capture the matched ids FIRST — the audit trail cascade below needs
					// them after the rows are gone.
					const idRows = await this.db.all<{ id: string }>({
						sql: `SELECT id FROM ${table} WHERE ${piiField} = ? LIMIT 5000`,
						bindings: [subject],
					});
					const ids = idRows.map((r) => String(r.id));
					const result = await this.db.run({ sql: `DELETE FROM ${table} WHERE ${piiField} = ?`, bindings: [subject] });
					const deleted = Number(result.meta?.changes ?? 0);
					// 🔒 Cascade: audit `changes` snapshots hold full document copies (PII) —
					// erase the audit entries for every deleted row.
					await this.purgeAuditRows(slug, ids);
					actions.push({ collection: slug, table, action: 'deleted', count: deleted });
					matchedTotal += deleted;
				} else {
					await this.db.run({
						sql: `UPDATE ${table} SET ${piiField} = '[redacted]' WHERE ${piiField} = ?`,
						bindings: [subject],
					});
					// 🔒 Cascade: redact the subject value out of this collection's audit
					// snapshots too (REPLACE inside the JSON string keeps it valid).
					await this.redactAuditSnapshots(slug, subject);
					actions.push({ collection: slug, table, action: 'anonymized', count });
					matchedTotal += count;
				}
			} catch (err) {
				actions.push({ collection: slug, table, action: 'error', count: 0, error: err instanceof Error ? err.message : String(err) });
			}
		}

		// 🔒 Cascade: when erasing by email, purge audit rows whose actor was the
		// erased user (the _users row itself is not an entity collection, so the
		// sweep above never touches it).
		if (!dryRun && piiField === 'email') {
			try {
				const userRows = await this.db.all<{ id: string }>({ sql: 'SELECT id FROM _users WHERE email = ?', bindings: [subject] });
				for (const u of userRows) {
					await this.db.run({ sql: 'DELETE FROM _audit_log WHERE user_id = ?', bindings: [u.id] });
				}
			} catch {
				/* best-effort: _users/_audit_log may not exist in a pure-factory deployment */
			}
		}

		const requestId = crypto.randomUUID();
		const now = new Date().toISOString();
		await this.db.run({
			sql: `INSERT INTO _gdpr_requests (id, subject, pii_field, mode, collections_json, dry_run, matched_total, actions_json, status, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)`,
			bindings: [
				requestId,
				subject,
				piiField,
				mode,
				JSON.stringify(targets.map((t) => t.slug)),
				dryRun ? 1 : 0,
				matchedTotal,
				JSON.stringify(actions),
				now,
			],
		});

		return { requestId, matched: matchedTotal, actions };
	}

	async listRequests(limit = 50): Promise<Array<Record<string, unknown>>> {
		await this.ensure();
		return this.db.all<Record<string, unknown>>({
			sql: `SELECT * FROM _gdpr_requests ORDER BY created_at DESC LIMIT ?`,
			bindings: [Math.min(Math.max(1, limit), 500)],
		});
	}

	private async ensure(): Promise<void> {
		const g = globalThis as unknown as Record<string, boolean>;
		if (g.__GDPR_TABLE__) return;
		await this.db.exec(REQUESTS_TABLE);
		g.__GDPR_TABLE__ = true;
	}

	/**
	 * Delete the audit-trail entries for erased rows (chunked IN lists — SQLite
	 * caps bound variables). Best-effort: the audit table may not exist.
	 */
	private async purgeAuditRows(collectionSlug: string, ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		try {
			const CHUNK = 100;
			for (let i = 0; i < ids.length; i += CHUNK) {
				const chunk = ids.slice(i, i + CHUNK);
				const placeholders = chunk.map(() => '?').join(',');
				await this.db.run({
					sql: `DELETE FROM _audit_log WHERE collection_slug = ? AND document_id IN (${placeholders})`,
					bindings: [collectionSlug, ...chunk],
				});
			}
		} catch {
			/* audit trail is best-effort (pure-factory deployments may not have _audit_log) */
		}
	}

	/**
	 * Redact the subject value out of this collection's audit `changes` JSON
	 * snapshots. REPLACE inside the JSON string keeps the document valid.
	 */
	private async redactAuditSnapshots(collectionSlug: string, subject: string): Promise<void> {
		try {
			// Escape LIKE wildcards so a subject containing % or _ matches literally.
			const escaped = subject.replace(/[\\%_]/g, (m) => `\\${m}`);
			await this.db.run({
				sql: `UPDATE _audit_log SET changes = REPLACE(changes, ?1, '[redacted]') WHERE collection_slug = ?2 AND changes LIKE ?3 ESCAPE '\\'`,
				bindings: [subject, collectionSlug, `%${escaped}%`],
			});
		} catch {
			/* audit trail is best-effort */
		}
	}
}

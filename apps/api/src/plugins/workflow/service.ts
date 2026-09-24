/**
 * WorkflowService — persistence for declarative workflows.
 *
 * Tables (created by plugin migration, once per isolate):
 *   _workflows          — one declarative workflow per collection (UNIQUE)
 *   _workflow_states    — current state per document (side table — no schema changes)
 *   _workflow_history   — every transition, append-only (audit trail)
 *
 * All state is data; the engine (engine.ts) interprets it. No eval anywhere.
 */

import { D1Client } from '@mmbix/core';
import type { WorkflowDefinition, WorkflowHistoryRow, WorkflowRow, WorkflowStateRow } from './types';

export class WorkflowService {
	constructor(private readonly db: D1Client) {}

	// ─── Workflow CRUD ────────────────────────────────────

	async list(collectionSlug?: string): Promise<Array<WorkflowRow & { definition: WorkflowDefinition }>> {
		const rows = await this.db.all<WorkflowRow>({
			sql: 'SELECT * FROM _workflows' + (collectionSlug ? ' WHERE collection_slug = ?' : '') + ' ORDER BY created_at DESC',
			bindings: collectionSlug ? [collectionSlug] : [],
		});
		return rows.map((r) => this.decorate(r));
	}

	async get(id: string): Promise<(WorkflowRow & { definition: WorkflowDefinition }) | null> {
		const row = await this.db.first<WorkflowRow>({
			sql: 'SELECT * FROM _workflows WHERE id = ?',
			bindings: [id],
		});
		return row ? this.decorate(row) : null;
	}

	async getByCollection(collectionSlug: string): Promise<(WorkflowRow & { definition: WorkflowDefinition }) | null> {
		const row = await this.db.first<WorkflowRow>({
			sql: 'SELECT * FROM _workflows WHERE collection_slug = ?',
			bindings: [collectionSlug],
		});
		return row ? this.decorate(row) : null;
	}

	/**
	 * Insert or replace the workflow for a collection (one per collection —
	 * upsert on the UNIQUE collection_slug). Bumps version on every replace so
	 * callers can cache by (collection, version).
	 */
	async upsert(definition: WorkflowDefinition, id?: string): Promise<{ id: string; version: number }> {
		const now = new Date().toISOString();
		const rowId = id ?? crypto.randomUUID();
		const result = await this.db.first<{ id: string; version: number }>({
			sql: `INSERT INTO _workflows (id, name, collection_slug, definition_json, enabled, version, created_at, updated_at)
				VALUES (?, ?, ?, ?, ?, 1, ?, ?)
				ON CONFLICT(collection_slug) DO UPDATE SET
					name = excluded.name,
					definition_json = excluded.definition_json,
					enabled = excluded.enabled,
					version = _workflows.version + 1,
					updated_at = excluded.updated_at
				RETURNING id, version`,
			bindings: [rowId, definition.name, definition.collection, JSON.stringify(definition), definition.enabled === false ? 0 : 1, now, now],
		});
		return { id: result?.id ?? rowId, version: result?.version ?? 1 };
	}

	async updateEnabled(id: string, enabled: boolean): Promise<void> {
		await this.db.run({
			sql: 'UPDATE _workflows SET enabled = ?, updated_at = ? WHERE id = ?',
			bindings: [enabled ? 1 : 0, new Date().toISOString(), id],
		});
	}

	async remove(id: string): Promise<void> {
		// Capture the collection BEFORE deleting the workflow row, then wipe its
		// states + history. (Order matters — the old subquery looked up the row
		// after it was gone and orphaned every state.)
		const row = await this.db.first<{ collection_slug: string }>({
			sql: 'SELECT collection_slug FROM _workflows WHERE id = ?',
			bindings: [id],
		});
		if (row) {
			await this.db.run({ sql: 'DELETE FROM _workflow_states WHERE collection_slug = ?', bindings: [row.collection_slug] });
		}
		await this.db.run({ sql: 'DELETE FROM _workflow_history WHERE workflow_id = ?', bindings: [id] });
		await this.db.run({ sql: 'DELETE FROM _workflows WHERE id = ?', bindings: [id] });
	}

	// ─── Document state ───────────────────────────────────

	/** Current state of a document — or null when never transitioned. */
	async getState(collectionSlug: string, documentId: string): Promise<string | null> {
		const row = await this.db.first<WorkflowStateRow>({
			sql: 'SELECT state FROM _workflow_states WHERE collection_slug = ? AND document_id = ?',
			bindings: [collectionSlug, documentId],
		});
		return row?.state ?? null;
	}

	/**
	 * Concurrency-safe state commit (optimistic lock on the side table).
	 * The UPDATE only applies when the row is still in `expectedFrom` — a
	 * concurrent transition that already moved the doc makes this a no-op,
	 * returning false so the caller can 409 instead of silently overwriting.
	 * First transitions (no row yet) always insert.
	 */
	async transitionState(collectionSlug: string, documentId: string, expectedFrom: string, to: string): Promise<boolean> {
		const now = new Date().toISOString();
		const result = await this.db.run({
			sql: `INSERT INTO _workflow_states (collection_slug, document_id, state, updated_at) VALUES (?, ?, ?, ?)
				ON CONFLICT(collection_slug, document_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
				WHERE _workflow_states.state = ?`,
			bindings: [collectionSlug, documentId, to, now, expectedFrom],
		});
		return (result.meta?.changes ?? 0) > 0;
	}

	async logHistory(entry: Omit<WorkflowHistoryRow, 'id' | 'created_at'>): Promise<void> {
		await this.db.run({
			sql: `INSERT INTO _workflow_history (id, workflow_id, collection_slug, document_id, from_state, to_state, by_user, by_email, comment, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			bindings: [
				crypto.randomUUID(),
				entry.workflow_id,
				entry.collection_slug,
				entry.document_id,
				entry.from_state,
				entry.to_state,
				entry.by_user,
				entry.by_email,
				entry.comment,
				new Date().toISOString(),
			],
		});
	}

	async getHistory(collectionSlug: string, documentId: string): Promise<WorkflowHistoryRow[]> {
		return this.db.all<WorkflowHistoryRow>({
			sql: 'SELECT * FROM _workflow_history WHERE collection_slug = ? AND document_id = ? ORDER BY created_at ASC',
			bindings: [collectionSlug, documentId],
		});
	}

	// ─── Helpers ──────────────────────────────────────────

	private decorate(row: WorkflowRow): WorkflowRow & { definition: WorkflowDefinition } {
		let definition: WorkflowDefinition;
		try {
			definition = JSON.parse(row.definition_json) as WorkflowDefinition;
		} catch {
			// Never serve a corrupted definition — an empty machine is safer.
			definition = { name: row.name, collection: row.collection_slug, initial: '', states: [], transitions: [] };
		}
		return { ...row, definition };
	}
}

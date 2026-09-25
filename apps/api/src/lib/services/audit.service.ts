/**
 * Audit Trail Service — v2 with snapshot diffing
 *
 * Tracks who changed what and when. Every create/update/delete
 * operation optionally records an audit log entry with full
 * document snapshots for diff computation.
 *
 * Table: _audit_log (created by migration 004)
 *
 * The `changes` column stores a JSON string with the shape:
 *   {
 *     "snapshot_before": { ... } | null,
 *     "snapshot_after":  { ... } | null,
 *     "fields":          { "field": "new_value", ... }
 *   }
 */

import { D1Client } from '@mmbix/core';
import { Repository } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';

export interface AuditEntry {
	id: string;
	collection_slug: string;
	document_id: string;
	// `create`…`restore` are entity (document) writes. The remaining actions are
	// NON-document security events (sign-ins, machine-key lifecycle, access-control
	// grants) recorded by `lib/services/security-audit.ts` under a pseudo collection
	// slug. The column is plain TEXT (no CHECK), so extending this union is additive
	// at the type level only.
	action:
		'create' | 'update' | 'delete' | 'submit' | 'approve' | 'reject' | 'restore' | 'login' | 'login_failed' | 'logout' | 'grant' | 'revoke';
	user_id: string | null;
	changes: string | null; // JSON — includes snapshots + changed fields
	timestamp: string;
}

/** Parsed changes with before/after snapshots */
export interface ParsedChanges {
	snapshot_before: Record<string, unknown> | null;
	snapshot_after: Record<string, unknown> | null;
	fields: Record<string, unknown> | null;
}

/** Enriched audit entry returned by getHistory */
export interface AuditEntryWithSnapshots extends Omit<AuditEntry, 'changes'> {
	changes: ParsedChanges | null;
}

/** Single field-level change in a diff */
export interface FieldDiff {
	field: string;
	from: unknown;
	to: unknown;
}

/** Structured diff result */
export interface DocumentDiff {
	from: Record<string, unknown>;
	to: Record<string, unknown>;
	changes: FieldDiff[];
}

function parseChanges(raw: string | null): ParsedChanges | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		return {
			snapshot_before: parsed.snapshot_before ?? null,
			snapshot_after: parsed.snapshot_after ?? null,
			fields: parsed.fields ?? null,
		};
	} catch {
		return null;
	}
}

/**
 * Field names whose values are never written to the audit trail.
 * Matching is case-insensitive; keys ending in `_secret` / `_token` / `_password`
 * are treated as sensitive too.
 */
const SENSITIVE_FIELDS = new Set(['password', 'password_hash', 'secret', 'token', 'api_key', 'jwt', 'client_secret']);

const MAX_MASK_DEPTH = 5;

function isSensitiveKey(key: string): boolean {
	const lower = key.toLowerCase();
	return SENSITIVE_FIELDS.has(lower) || lower.endsWith('_secret') || lower.endsWith('_token') || lower.endsWith('_password');
}

/**
 * Recursively replace sensitive values with '[REDACTED]' before persisting
 * audit snapshots. Descends into nested objects/arrays up to MAX_MASK_DEPTH.
 */
function _mask(value: unknown, depth = 0): unknown {
	if (depth > MAX_MASK_DEPTH) return value;
	if (Array.isArray(value)) {
		return value.map((item) => _mask(item, depth + 1));
	}
	if (value !== null && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			out[k] = isSensitiveKey(k) ? '[REDACTED]' : _mask(v, depth + 1);
		}
		return out;
	}
	return value;
}

function computeDiff(before: Record<string, unknown>, after: Record<string, unknown>): FieldDiff[] {
	const changes: FieldDiff[] = [];
	const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
	for (const key of allKeys) {
		// Skip system/internal fields
		if (key === 'id' || key === '_meta' || key === 'created_at' || key === 'updated_at' || key === 'deleted_at' || key === 'display_number')
			continue;
		const oldVal = before[key];
		const newVal = after[key];
		if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
			changes.push({ field: key, from: oldVal, to: newVal });
		}
	}
	return changes;
}

export class AuditService {
	private repo: Repository<AuditEntry>;
	private enabled = true;

	constructor(private db: D1Client) {
		this.repo = new Repository<AuditEntry>(db, '_audit_log');
	}

	/**
	 * Record an audit entry.
	 * Non-blocking — uses waitUntil if available.
	 *
	 * The `changes` field in the entry may include snapshot_before and
	 * snapshot_after for full document state capture.
	 */
	async log(
		execCtx: { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } } | null,
		entry: {
			collection_slug: string;
			document_id: string;
			action: AuditEntry['action'];
			user_id?: string | null;
			changes?: Record<string, unknown> | null;
			/** Full document snapshot before the change */
			snapshot_before?: Record<string, unknown> | null;
			/** Full document snapshot after the change */
			snapshot_after?: Record<string, unknown> | null;
		},
		/** Zero-waste snapshot strategy for this collection (default 'full').
		 *  'delta' packs ONLY the changed-fields payload (no full before/after
		 *  copies) except on 'create' where the single baseline snapshot is kept
		 *  for on-demand replay. 'none' packs neither. */
		snapshotMode: 'full' | 'delta' | 'none' = 'full',
	): Promise<void> {
		if (!this.enabled) return;

		// Pack snapshots + changed fields into the changes JSON. In 'delta' mode
		// only the create baseline keeps a full snapshot (cheap: once per doc) so
		// updates stop paying the 3× full-doc copy cost. Sensitive fields are
		// redacted before storage.
		const changesPayload: Record<string, unknown> = {};
		const storeSnap = snapshotMode === 'full' || (snapshotMode === 'delta' && entry.action === 'create');
		if (storeSnap && entry.snapshot_before) changesPayload.snapshot_before = _mask(entry.snapshot_before);
		if (storeSnap && entry.snapshot_after) changesPayload.snapshot_after = _mask(entry.snapshot_after);
		if (entry.changes) changesPayload.fields = _mask(entry.changes);

		const logEntry: Partial<AuditEntry> = {
			id: crypto.randomUUID(),
			collection_slug: entry.collection_slug,
			document_id: entry.document_id,
			action: entry.action,
			user_id: entry.user_id || null,
			changes: Object.keys(changesPayload).length > 0 ? JSON.stringify(changesPayload) : null,
			timestamp: new Date().toISOString(),
		};

		const task = this.db
			.run(QueryBuilder.from('_audit_log').toInsert(logEntry as Record<string, unknown>))
			.catch((err) => console.error('[audit] log entry failed:', err));
		if (execCtx?.executionCtx?.waitUntil) {
			execCtx.executionCtx.waitUntil(task);
		} else {
			task.catch((err) => console.error('[audit] fire-and-forget failed:', err));
		}
	}

	/**
	 * Query audit trail for a specific document.
	 */
	async getDocumentHistory(collectionSlug: string, documentId: string): Promise<AuditEntry[]> {
		return this.repo
			.findMany({
				where: { collection_slug: collectionSlug, document_id: documentId },
				orderBy: { timestamp: 'desc' },
				limit: 100,
			})
			.then((r) => r.data);
	}

	/**
	 * Query audit trail for a collection (recent changes).
	 */
	async getCollectionHistory(collectionSlug: string, limit = 50): Promise<AuditEntry[]> {
		return this.repo
			.findMany({
				where: { collection_slug: collectionSlug },
				orderBy: { timestamp: 'desc' },
				limit,
			})
			.then((r) => r.data);
	}

	/**
	 * Get full history for a document with parsed snapshot data.
	 * Returns entries in chronological order (oldest first).
	 */
	async getHistory(collectionSlug: string, documentId: string): Promise<AuditEntryWithSnapshots[]> {
		const entries = await this.repo
			.findMany({
				where: { collection_slug: collectionSlug, document_id: documentId },
				orderBy: { timestamp: 'asc' },
				limit: 500,
			})
			.then((r) => r.data);

		const parsed = entries.map((e) => {
			const changes = parseChanges(e.changes);
			return { entry: e, changes };
		});

		// Zero-waste mode: entries carry only a compact delta (no full snapshots) —
		// reconstruct snapshot_before/after on demand by replaying the _field_audit
		// lineage from the create baseline. This turns _field_audit into the single
		// source of truth so _audit_log stops duplicating it. Cheap and lazy: only
		// runs when at least one entry lacks snapshots.
		if (parsed.some((p) => !p.changes?.snapshot_after)) {
			const replay = await this._replayFields(collectionSlug, documentId);
			return parsed.map(({ entry, changes }) => {
				if (changes?.snapshot_after) return { ...entry, changes };
				const before = replay[entry.id]?.before ?? null;
				const after = replay[entry.id]?.after ?? changes?.fields ?? null;
				return { ...entry, changes: { snapshot_before: before, snapshot_after: after, fields: changes?.fields ?? null } };
			});
		}

		return entries.map((e) => ({ ...e, changes: parseChanges(e.changes) }));
	}

	/**
	 * Replay a document's field lineage (single source of truth for deltas) to
	 * reconstruct the snapshot at each delta-mode audit entry. Returns a map of
	 * audit-entry id → { before, after } document states, built by applying the
	 * create-row baseline then each later field change in chronological order.
	 */
	private async _replayFields(
		collectionSlug: string,
		documentId: string,
	): Promise<Record<string, { before: Record<string, unknown> | null; after: Record<string, unknown> | null }>> {
		const rows = await this.db.all<{
			field: string;
			value_to: string | null;
			source: string;
			created_at: string;
		}>({
			sql: `SELECT field, value_to, source, created_at FROM _field_audit
				WHERE collection_slug = ? AND document_id = ? ORDER BY created_at ASC`,
			bindings: [collectionSlug, documentId],
		});

		// Audit entries in insertion order (excluding the create baseline entry) —
		// each corresponds to exactly one later write (grouped field rows).
		const later = await this.db.all<{ id: string }>({
			sql: `SELECT id FROM _audit_log
				WHERE collection_slug = ? AND document_id = ? AND action != 'create' ORDER BY timestamp ASC`,
			bindings: [collectionSlug, documentId],
		});

		const out: Record<string, { before: Record<string, unknown> | null; after: Record<string, unknown> | null }> = {};
		const state: Record<string, unknown> = {};
		let writeIndex = 0;
		// Group rows by their write batch: create rows seed the baseline; each later
		// batch (a run of rows sharing the same created_at) maps to one audit entry.
		for (const group of this._groupByWrite(rows)) {
			const isCreate = group[0].source === 'create';
			if (isCreate) {
				for (const row of group) state[row.field] = this.parseValue(row.value_to);
				continue;
			}
			const target = later[writeIndex++];
			if (!target) break;
			const before = { ...state };
			for (const row of group) state[row.field] = this.parseValue(row.value_to);
			out[target.id] = { before, after: { ...state } };
		}
		return out;
	}

	/**
	 * Split sorted field-audit rows into write batches. All rows created in one
	 * mutation share the same insertMany timestamp, so a run of equal created_at
	 * is one write. Create rows form the baseline (first group) and are kept
	 * separate from change groups.
	 */
	private _groupByWrite(
		rows: Array<{ field: string; value_to: string | null; source: string; created_at: string }>,
	): Array<Array<{ field: string; value_to: string | null; source: string; created_at: string }>> {
		const groups: Array<Array<{ field: string; value_to: string | null; source: string; created_at: string }>> = [];
		for (const row of rows) {
			const last = groups[groups.length - 1];
			if (last && last[0].created_at === row.created_at && last[0].source === row.source) {
				last.push(row);
			} else {
				groups.push([row]);
			}
		}
		return groups;
	}

	private parseValue(raw: string | null): unknown {
		if (raw === null) return null;
		try {
			return JSON.parse(raw);
		} catch {
			return raw;
		}
	}

	/**
	 * Compute a structured diff between two audit entries for the same document.
	 *
	 * @param collectionSlug - The collection slug
	 * @param documentId     - The document ID
	 * @param fromEntryId    - Audit entry ID representing the "before" state
	 * @param toEntryId      - Audit entry ID representing the "after" state
	 * @returns A DocumentDiff with before/after snapshots and field-level changes
	 */
	async getDiff(collectionSlug: string, documentId: string, fromEntryId: string, toEntryId: string): Promise<DocumentDiff> {
		const [fromEntry, toEntry] = await Promise.all([this.repo.findById(fromEntryId), this.repo.findById(toEntryId)]);

		if (fromEntry.collection_slug !== collectionSlug || fromEntry.document_id !== documentId) {
			throw new Error('"from" entry does not belong to the specified document');
		}
		if (toEntry.collection_slug !== collectionSlug || toEntry.document_id !== documentId) {
			throw new Error('"to" entry does not belong to the specified document');
		}

		const fromChanges = parseChanges(fromEntry.changes);
		const toChanges = parseChanges(toEntry.changes);

		// Determine the actual document snapshots
		// - For the "from" state: use snapshot_after of the from-entry (the state after that change)
		// - For the "to" state: use snapshot_after of the to-entry
		// If snapshots aren't available (delta/none mode), reconstruct them lazily
		// from the _field_audit lineage instead of the legacy fields fallback.
		let fromSnapshot =
			fromChanges?.snapshot_after ?? fromChanges?.snapshot_before ?? (fromChanges?.fields as Record<string, unknown>) ?? {};
		let toSnapshot = toChanges?.snapshot_after ?? toChanges?.snapshot_before ?? (toChanges?.fields as Record<string, unknown>) ?? {};
		if (!fromChanges?.snapshot_after || !toChanges?.snapshot_after) {
			const replay = await this._replayFields(collectionSlug, documentId);
			if (!fromChanges?.snapshot_after) fromSnapshot = replay[fromEntry.id]?.after ?? fromSnapshot;
			if (!toChanges?.snapshot_after) toSnapshot = replay[toEntry.id]?.after ?? toSnapshot;
		}

		const changes = computeDiff(fromSnapshot, toSnapshot);

		return {
			from: fromSnapshot,
			to: toSnapshot,
			changes,
		};
	}
}

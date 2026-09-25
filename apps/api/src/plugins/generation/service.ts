/**
 * GenerationService — persistence + the human gate for schema proposals.
 *
 * A proposal is a STATE, not a prompt: `draft → review → promoted → live`, with
 * `rejected` as the terminal refusal. Persisted in `_generation_proposals`
 * (auditable, stateless — no isolate memory). `apply` is the ONLY method that
 * writes a real schema, and it only runs from `promoted` (or from `draft` when
 * the target collection opted into `generation.require_review = false`).
 *
 * Every state change is a compare-and-set (`WHERE status = ?`) so two operators
 * racing a promote cannot both apply — the loser gets a 409.
 */

import { D1Client, fnv1a, QueryBuilder } from '@mmbix/core';
import { ValidationError, VALID_FIELD_TYPES } from '@mmbix/utils';
import type { FieldDefinition, FieldProposal, ProposalStatus, SchemaProposal } from '@mmbix/types';
import type { AuthContext } from '@/lib/services/auth.service';
import { CollectionService } from '@/lib/services/collection.service';

export type GenerationAction = 'submit' | 'approve' | 'reject' | 'apply';

const TRANSITIONS: Record<Exclude<GenerationAction, 'apply'>, { from: ProposalStatus[]; to: ProposalStatus }> = {
	submit: { from: ['draft'], to: 'review' },
	approve: { from: ['review'], to: 'promoted' },
	reject: { from: ['draft', 'review'], to: 'rejected' },
};

export class GenerationError extends Error {
	constructor(
		message: string,
		public readonly status = 400,
		public readonly code = 'GENERATION_ERROR',
	) {
		super(message);
		this.name = 'GenerationError';
	}
}

export interface GenerationRecord {
	id: string;
	name: string;
	collection_slug: string;
	status: ProposalStatus;
	require_review: boolean;
	proposal: SchemaProposal;
	dna_source: string | null;
	applied_slug: string | null;
	created_at: string;
	updated_at: string;
}

interface Row {
	id: string;
	name: string;
	collection_slug: string;
	status: string;
	require_review: number;
	proposal_json: string;
	dna_source: string | null;
	applied_slug: string | null;
	created_at: string;
	updated_at: string;
}

function toRecord(row: Row): GenerationRecord {
	let proposal: SchemaProposal;
	try {
		proposal = JSON.parse(row.proposal_json) as SchemaProposal;
	} catch {
		proposal = { collection: { slug: row.collection_slug, name: row.name, fields: [] }, relations: [], warnings: [] };
	}
	return {
		id: row.id,
		name: row.name,
		collection_slug: row.collection_slug,
		status: row.status as ProposalStatus,
		require_review: row.require_review === 1,
		proposal,
		dna_source: row.dna_source,
		applied_slug: row.applied_slug,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

/**
 * Overlay learned type corrections on a fresh proposal (the feedback loop). A
 * correction always wins over a rule/declared guess for the same field name,
 * because it encodes a human's earlier decision. Only SSOT-member types apply.
 */
function applyLearned(proposal: SchemaProposal, learned: Map<string, string>): SchemaProposal {
	if (learned.size === 0) return proposal;
	const fields: FieldProposal[] = proposal.collection.fields.map((f) => {
		const next = learned.get(f.name);
		if (!next || next === f.type || !VALID_FIELD_TYPES.has(next)) return f;
		return {
			...f,
			type: next as FieldProposal['type'],
			inference: { confidence: 2, reason: 'learned from prior human corrections', source: 'rule' },
		};
	});
	return { ...proposal, collection: { ...proposal.collection, fields } };
}

export class GenerationService {
	constructor(
		private readonly db: D1Client,
		private readonly getAuth: () => AuthContext | null,
	) {}

	/**
	 * Persist a new proposal. Idempotent: re-submitting the same content while a
	 * non-terminal proposal exists returns that row instead of creating a twin.
	 */
	async create(
		proposal: SchemaProposal,
		meta: { requireReview: boolean; model?: string; actor?: string | null },
	): Promise<GenerationRecord> {
		// Feedback loop: a human's earlier type correction for a field name wins.
		proposal = applyLearned(proposal, await this.learnedTypes());
		const now = new Date().toISOString();
		const contentHash = fnv1a(JSON.stringify(proposal));
		const existing = await this.db.first<Row>({
			sql: `SELECT * FROM _generation_proposals WHERE content_hash = ? AND status NOT IN ('rejected','live') ORDER BY created_at LIMIT 1`,
			bindings: [contentHash],
		});
		if (existing) return toRecord(existing);

		const id = crypto.randomUUID();
		await this.db.run({
			sql: `INSERT INTO _generation_proposals
				(id, name, collection_slug, status, require_review, proposal_json, content_hash, dna_source, prompt_hash, model, actor, created_at, updated_at)
				VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
			bindings: [
				id,
				proposal.collection.name,
				proposal.collection.slug,
				meta.requireReview ? 1 : 0,
				JSON.stringify(proposal),
				contentHash,
				proposal.dna ? JSON.stringify(proposal.dna) : null,
				meta.model ?? null,
				meta.actor ?? null,
				now,
				now,
			],
		});
		return (await this.get(id))!;
	}

	async list(limit = 50): Promise<GenerationRecord[]> {
		const rows = await this.db.all<Row>({
			sql: `SELECT * FROM _generation_proposals ORDER BY created_at DESC LIMIT ?`,
			bindings: [Math.min(Math.max(limit, 1), 200)],
		});
		return rows.map(toRecord);
	}

	async get(id: string): Promise<GenerationRecord | null> {
		const row = await this.db.first<Row>(QueryBuilder.from('_generation_proposals').select('*').where('id', id).toSelect());
		return row ? toRecord(row) : null;
	}

	/** Learned field-name → type corrections (the feedback loop read side). */
	async learnedTypes(): Promise<Map<string, string>> {
		const rows = await this.db.all<{ hint_key: string; field_type: string }>({
			sql: 'SELECT hint_key, field_type FROM _generation_corrections',
			bindings: [],
		});
		return new Map(rows.map((r) => [r.hint_key, r.field_type]));
	}

	/**
	 * Human edits during review. Only `draft`/`review` proposals are editable;
	 * a type change is recorded as a correction so the NEXT proposal learns it.
	 * Only existing fields may be edited (no arbitrary column injection).
	 */
	async updateFields(id: string, overrides: Array<{ name: string; type: string; required?: boolean }>): Promise<GenerationRecord> {
		const row = await this.db.first<Row>(QueryBuilder.from('_generation_proposals').select('*').where('id', id).toSelect());
		if (!row) throw new GenerationError('Proposal not found', 404, 'NOT_FOUND');
		const record = toRecord(row);
		if (record.status !== 'draft' && record.status !== 'review') {
			throw new GenerationError(`Cannot edit a proposal in state "${record.status}"`, 409, 'INVALID_TRANSITION');
		}
		const byName = new Map(overrides.map((o) => [o.name, o]));
		const corrections: Array<{ name: string; type: string }> = [];
		const fields = record.proposal.collection.fields.map((f) => {
			const o = byName.get(f.name);
			if (!o) return f;
			if (!VALID_FIELD_TYPES.has(o.type)) throw new GenerationError(`Unknown field type "${o.type}"`, 400, 'BAD_TYPE');
			if (o.type !== f.type) corrections.push({ name: f.name, type: o.type });
			return {
				...f,
				type: o.type as FieldProposal['type'],
				...(o.required !== undefined ? { required: o.required } : {}),
				inference: { confidence: 2 as const, reason: 'edited during review', source: 'declared' as const },
			};
		});
		const proposal: SchemaProposal = { ...record.proposal, collection: { ...record.proposal.collection, fields } };
		await this.db.run({
			sql: `UPDATE _generation_proposals SET proposal_json = ?, content_hash = ?, updated_at = ? WHERE id = ?`,
			bindings: [JSON.stringify(proposal), fnv1a(JSON.stringify(proposal)), new Date().toISOString(), id],
		});
		for (const c of corrections) await this.recordCorrection(c.name, c.type);
		return (await this.get(id))!;
	}

	private async recordCorrection(hintKey: string, fieldType: string): Promise<void> {
		await this.db.run({
			sql: `INSERT INTO _generation_corrections (id, hint_key, field_type, hits, updated_at)
				VALUES (?, ?, ?, 1, ?)
				ON CONFLICT(hint_key) DO UPDATE SET field_type = excluded.field_type, hits = hits + 1, updated_at = excluded.updated_at`,
			bindings: [crypto.randomUUID(), hintKey, fieldType, new Date().toISOString()],
		});
	}

	/**
	 * Advance a proposal. `apply` is the only write path to a real schema and is
	 * guarded by the review state (or the collection's `require_review = false`).
	 */
	async transition(id: string, action: GenerationAction): Promise<GenerationRecord> {
		const row = await this.db.first<Row>(QueryBuilder.from('_generation_proposals').select('*').where('id', id).toSelect());
		if (!row) throw new GenerationError('Proposal not found', 404, 'NOT_FOUND');
		if (action === 'apply') return this.apply(toRecord(row));

		const spec = TRANSITIONS[action];
		const current = row.status as ProposalStatus;
		if (!spec.from.includes(current)) {
			throw new GenerationError(`Cannot ${action} a proposal in state "${current}"`, 409, 'INVALID_TRANSITION');
		}
		const now = new Date().toISOString();
		const res = await this.db.run({
			sql: `UPDATE _generation_proposals SET status = ?, updated_at = ? WHERE id = ? AND status = ?`,
			bindings: [spec.to, now, id, current],
		});
		if (((res.meta?.changes ?? 1) as number) === 0) {
			throw new GenerationError('Proposal changed concurrently — reload and retry', 409, 'CONFLICT');
		}
		return (await this.get(id))!;
	}

	/** Materialize the proposal into a collection. CAS into `live` only after the write. */
	private async apply(record: GenerationRecord): Promise<GenerationRecord> {
		// Idempotent replay first: an already-applied proposal is a no-op, never a
		// state error — so a client retry after a network blip succeeds.
		if (record.applied_slug) return record;
		const autoOk = !record.require_review && (record.status === 'draft' || record.status === 'review');
		if (record.status !== 'promoted' && !autoOk) {
			throw new GenerationError(`Apply requires the "promoted" state (currently "${record.status}")`, 409, 'NOT_REVIEWED');
		}

		const svc = new CollectionService(this.db, this.getAuth() ?? undefined);
		// Relation fields are materialized only when their target collection
		// already exists; a not-yet-created parent is skipped rather than failing
		// the whole apply (the FK can be added later by re-proposing the child).
		const existing = new Set((await svc.getCollections()).map((c) => c.slug));
		const fields: FieldDefinition[] = record.proposal.collection.fields
			.filter((f) => f.type !== 'm2o' || !f.related_collection || existing.has(f.related_collection))
			.map((f) => ({
				name: f.name,
				type: f.type,
				required: f.required,
				...(f.related_collection ? { related_collection: f.related_collection } : {}),
			}));
		if (fields.length === 0) throw new GenerationError('Proposal has no fields to apply', 400, 'EMPTY_PROPOSAL');

		try {
			await svc.createCollection({
				name: record.proposal.collection.name,
				slug: record.proposal.collection.slug,
				fields,
			});
		} catch (err) {
			if (err instanceof ValidationError) throw new GenerationError(err.message, 409, 'CONFLICT');
			throw err;
		}

		const now = new Date().toISOString();
		await this.db.run({
			sql: `UPDATE _generation_proposals SET status = 'live', applied_slug = ?, updated_at = ? WHERE id = ? AND status = ?`,
			bindings: [record.proposal.collection.slug, now, record.id, record.status],
		});
		return (await this.get(record.id))!;
	}
}

export const GENERATION_PROPOSALS_DDL = [
	`CREATE TABLE IF NOT EXISTS _generation_proposals (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		collection_slug TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'draft',
		require_review INTEGER NOT NULL DEFAULT 1,
		proposal_json TEXT NOT NULL,
		content_hash TEXT NOT NULL,
		dna_source TEXT,
		prompt_hash TEXT,
		model TEXT,
		actor TEXT,
		applied_slug TEXT,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS idx_generation_status ON _generation_proposals (status, created_at)`,
	`CREATE INDEX IF NOT EXISTS idx_generation_hash ON _generation_proposals (content_hash)`,
];

/** The learning-loop store — one row per field name that a human corrected. */
export const GENERATION_CORRECTIONS_DDL = [
	`CREATE TABLE IF NOT EXISTS _generation_corrections (
		id TEXT PRIMARY KEY,
		hint_key TEXT NOT NULL,
		field_type TEXT NOT NULL,
		hits INTEGER NOT NULL DEFAULT 1,
		updated_at TEXT NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS uidx_generation_correction ON _generation_corrections (hint_key)`,
];

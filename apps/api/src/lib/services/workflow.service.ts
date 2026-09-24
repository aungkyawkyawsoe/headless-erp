/**
 * WorkflowService — multi-level approval workflows on top of doc_status.
 *
 * A collection can carry an approval workflow in `schema_json.workflow`:
 *   { enabled: true, name: "Purchase approval", levels: [{ label, role_name, amount_field?, threshold? }, …] }
 *
 * Lifecycle:
 *   submit(draft → …)   — routes the doc into `pending_review` and opens one
 *                         approval slot per effective level (threshold-aware).
 *                         A workflow with no effective levels falls through to a
 *                         plain `submitted`.
 *   approve(pending_review → …) — the NEXT pending level must be approved by a
 *                         user whose role matches the level's role (admin
 *                         bypasses). The last approval flips the doc to `approved`.
 *   reject(pending_review → rejected) — closes all open slots as rejected.
 *
 * Every decision is recorded in `_approvals` (one row per level per submit
 * round) and audited.
 */
import { D1Client, QueryBuilder, invalidateCollectionReads } from '@mmbix/core';
import { NotFoundError, ForbiddenError, ValidationError } from '@mmbix/utils';
import { AuditService } from './audit.service';
import { PermissionEvaluator } from './permission-evaluator';
import { findCollectionRow } from './schema-lookup';
import type { AuthContext } from './auth.service';
import type { ApprovalLevel, ApprovalRecord, ApprovalWorkflow } from '@mmbix/types';

/** Execution context compatible with Hono's executionCtx (for audit waitUntil). */
export type ExecutionCtx = null | undefined | { executionCtx?: { waitUntil: (p: Promise<unknown>) => void } };

interface CollectionInfo {
	tableName: string;
	workflow: ApprovalWorkflow | null;
}

export class WorkflowService {
	constructor(
		private db: D1Client,
		private auth?: AuthContext,
	) {}

	/** Load the collection's workflow definition (schema_json.workflow). */
	async getWorkflow(collectionSlug: string): Promise<ApprovalWorkflow | null> {
		const info = await this._getInfo(collectionSlug);
		return info.workflow;
	}

	/**
	 * Submit a draft document. With an active workflow this opens approval
	 * levels (doc_status → pending_review); otherwise a plain submit.
	 */
	async submit(collectionSlug: string, id: string, execCtx?: ExecutionCtx): Promise<Record<string, unknown>> {
		const info = await this._getInfo(collectionSlug);
		const row = await this.db.first<Record<string, unknown>>(QueryBuilder.from(info.tableName).select('*').where('id', id).toSelect());
		if (!row) throw new NotFoundError('Item', id);

		const current = (row.doc_status as string) || 'draft';
		if (current !== 'draft') throw new ValidationError(`Only draft documents can be submitted (current: "${current}")`);

		if (this.auth && !this.auth.is_admin) {
			const canSubmit = await PermissionEvaluator.checkBusiness(this.db, this.auth, collectionSlug, 'submit');
			if (!canSubmit) throw new ForbiddenError(`You do not have permission to submit documents in "${collectionSlug}"`);
		}

		const levels = info.workflow ? effectiveLevels(info.workflow, row) : [];

		if (levels.length === 0) {
			// No approvals needed — plain submit.
			await this._setStatus(collectionSlug, info.tableName, id, 'submitted');
			return this._after(collectionSlug, id, row, 'submitted', execCtx);
		}

		// Open a fresh approval round: clear any stale pending slots, then insert
		// one row per effective level.
		await this.db.run(
			QueryBuilder.from('_approvals')
				.where('collection_slug', collectionSlug)
				.where('document_id', id)
				.where('status', 'pending')
				.toDelete(),
		);
		const now = new Date().toISOString();
		for (let i = 0; i < levels.length; i++) {
			const lv = levels[i];
			await this.db.run(
				QueryBuilder.from('_approvals').toInsert({
					id: crypto.randomUUID(),
					collection_slug: collectionSlug,
					document_id: id,
					level: i + 1,
					level_label: lv.label,
					role_name: lv.role_name,
					amount: this._amountValue(row, lv),
					// approved_by is NOT NULL (migration 006) — '' = pending; the
					// approve action replaces it with the acting user's id.
					approved_by: '',
					status: 'pending',
					created_at: now,
					updated_at: now,
				}),
			);
		}
		await this._setStatus(collectionSlug, info.tableName, id, 'pending_review');
		return this._after(collectionSlug, id, row, 'pending_review', execCtx);
	}

	/**
	 * Approve the next pending level. The caller's role must match the level's
	 * role (admin bypasses). The final approval marks the document approved.
	 */
	async approve(collectionSlug: string, id: string, comment?: string, execCtx?: ExecutionCtx): Promise<Record<string, unknown>> {
		const info = await this._getInfo(collectionSlug);
		const row = await this.db.first<Record<string, unknown>>(QueryBuilder.from(info.tableName).select('*').where('id', id).toSelect());
		if (!row) throw new NotFoundError('Item', id);
		if ((row.doc_status as string) !== 'pending_review')
			throw new ValidationError(`Only documents pending review can be approved (current: "${row.doc_status}")`);

		const next = await this.db.first<ApprovalRecord>(
			QueryBuilder.from('_approvals')
				.select('*')
				.where('collection_slug', collectionSlug)
				.where('document_id', id)
				.where('status', 'pending')
				.orderBy('level', 'asc')
				.limit(1)
				.toSelect(),
		);
		if (!next) throw new ValidationError('This document has no pending approval level');

		if (this.auth && !this.auth.is_admin && this.auth.role_name !== next.role_name) {
			throw new ForbiddenError(`Only users with the "${next.role_name}" role can approve this level`);
		}

		const now = new Date().toISOString();
		await this.db.run(
			QueryBuilder.from('_approvals')
				.where('id', next.id)
				.toUpdate({
					status: 'approved',
					approved_by: this.auth?.user_id ?? null,
					comment: comment?.trim() || null,
					approved_at: now,
					updated_at: now,
				}),
		);

		const pending = await this.db.first<{ n: number }>({
			sql: 'SELECT COUNT(*) AS n FROM _approvals WHERE collection_slug = ?1 AND document_id = ?2 AND status = ?3',
			bindings: [collectionSlug, id, 'pending'],
		});
		const nextStatus = (pending?.n ?? 0) === 0 ? 'approved' : 'pending_review';
		await this._setStatus(collectionSlug, info.tableName, id, nextStatus);
		return this._after(collectionSlug, id, row, nextStatus, execCtx);
	}

	/** Reject a pending document — closes all open approval slots as rejected. */
	async reject(collectionSlug: string, id: string, comment?: string, execCtx?: ExecutionCtx): Promise<Record<string, unknown>> {
		const info = await this._getInfo(collectionSlug);
		const row = await this.db.first<Record<string, unknown>>(QueryBuilder.from(info.tableName).select('*').where('id', id).toSelect());
		if (!row) throw new NotFoundError('Item', id);
		if ((row.doc_status as string) !== 'pending_review')
			throw new ValidationError(`Only documents pending review can be rejected (current: "${row.doc_status}")`);

		await this.db.run(
			QueryBuilder.from('_approvals')
				.where('collection_slug', collectionSlug)
				.where('document_id', id)
				.where('status', 'pending')
				.toUpdate({ status: 'rejected', comment: comment?.trim() || null, updated_at: new Date().toISOString() }),
		);
		await this._setStatus(collectionSlug, info.tableName, id, 'rejected');
		return this._after(collectionSlug, id, row, 'rejected', execCtx);
	}

	/** Full approval trail for a document, oldest level first. */
	async getApprovals(collectionSlug: string, id: string): Promise<ApprovalRecord[]> {
		await this._getInfo(collectionSlug);
		return this.db.all<ApprovalRecord>(
			QueryBuilder.from('_approvals')
				.select('*')
				.where('collection_slug', collectionSlug)
				.where('document_id', id)
				.orderBy('level', 'asc')
				.toSelect(),
		);
	}

	// ── Internals ────────────────────────────────────────

	private async _getInfo(collectionSlug: string): Promise<CollectionInfo> {
		// Cached raw schema row — a submit/approve/reject must not pay a fresh D1
		// round-trip for a row the schema plane already holds.
		const row = await findCollectionRow(this.db, collectionSlug);
		if (!row) throw new NotFoundError('Collection', collectionSlug);
		let workflow: ApprovalWorkflow | null = null;
		try {
			const parsed = JSON.parse(row.schema_json) as { workflow?: ApprovalWorkflow };
			if (parsed.workflow?.enabled) workflow = parsed.workflow;
		} catch {
			// Malformed schema_json → no workflow.
		}
		return { tableName: row.table_name, workflow };
	}

	private async _setStatus(collectionSlug: string, tableName: string, id: string, status: string): Promise<void> {
		await this.db.run(QueryBuilder.from(tableName).where('id', id).toUpdate({ doc_status: status, updated_at: new Date().toISOString() }));
		// A raw UPDATE bypasses ItemMutationService's invalidation seam, so a
		// submit/approve/reject would otherwise serve the pre-decision `doc_status`
		// from the response cache (and report no `meta.changed`). Invalidate the
		// collection the caller actually reads through the entity API.
		invalidateCollectionReads(collectionSlug, id);
	}

	private _after(
		collectionSlug: string,
		id: string,
		before: Record<string, unknown>,
		status: string,
		execCtx?: ExecutionCtx,
	): Promise<Record<string, unknown>> {
		const action = status === 'rejected' ? 'reject' : status === 'approved' ? 'approve' : 'submit';
		new AuditService(this.db)
			.log(execCtx ?? null, {
				collection_slug: collectionSlug,
				document_id: id,
				action,
				user_id: this.auth?.user_id ?? null,
				snapshot_before: before,
				snapshot_after: { ...before, doc_status: status },
			})
			.catch(() => undefined);
		return Promise.resolve({ ...before, doc_status: status });
	}

	private _amountValue(row: Record<string, unknown>, level: ApprovalLevel): number | null {
		if (!level.amount_field) return null;
		const v = Number(row[level.amount_field]);
		return Number.isFinite(v) ? v : null;
	}
}

/** Threshold-aware level filtering — a level only applies when its amount
 * field exceeds the configured threshold (or when no threshold is set). */
function effectiveLevels(workflow: ApprovalWorkflow, row: Record<string, unknown>): ApprovalLevel[] {
	return workflow.levels.filter((lv) => {
		if (lv.threshold === null || lv.threshold === undefined) return true;
		if (!lv.amount_field) return true;
		const v = Number(row[lv.amount_field]);
		return Number.isFinite(v) && v > lv.threshold;
	});
}

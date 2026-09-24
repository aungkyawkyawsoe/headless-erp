/**
 * Approval Hierarchy Service
 *
 * Multi-level document approval workflow.
 * Supports configurable approval levels per entity collection.
 *
 * States:
 *   draft → pending_review → approved_l1 → approved_l2 → ... → approved
 *   Any state → rejected (goes back to draft)
 *
 * Config on _entity_schemas:
 *   approval_config: JSON string
 *   [
 *     { "level": 1, "role": "Manager",     "can_approve_up_to": 50000 },
 *     { "level": 2, "role": "Director",    "can_approve_up_to": 500000 },
 *     { "level": 3, "role": "CEO",         "can_approve_up_to": null }
 *   ]
 *
 * Table: _approvals
 *   id, collection_slug, document_id, level, approved_by, amount, comment, created_at
 */

import { D1Client } from '@mmbix/core';
import { Repository } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { ForbiddenError, NotFoundError } from '@mmbix/utils';
import type { AuthContext } from '@/lib/services/auth.service';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';

// ─── Types ─────────────────────────────────────────────

export interface ApprovalLevel {
	level: number;
	role: string;
	can_approve_up_to: number | null; // null = unlimited
}

export interface ApprovalConfig {
	levels: ApprovalLevel[];
}

export interface ApprovalRecord {
	id: string;
	collection_slug: string;
	document_id: string;
	level: number;
	approved_by: string;
	role_name: string;
	amount: number | null;
	comment: string | null;
	created_at: string;
}

// ─── Approval Hierarchy Service ───────────────────────

export class ApprovalService {
	private approvals: Repository<ApprovalRecord>;

	constructor(private db: D1Client) {
		this.approvals = new Repository<ApprovalRecord>(db, '_approvals');
	}

	/**
	 * Parse approval config from entity schema.
	 */
	parseApprovalConfig(configJson: string | null): ApprovalConfig {
		if (!configJson) return { levels: [{ level: 1, role: 'Administrator', can_approve_up_to: null }] };
		try {
			return JSON.parse(configJson) as ApprovalConfig;
		} catch {
			return { levels: [] };
		}
	}

	/**
	 * Get the next required approval level for a document.
	 * Returns: level number, or null if fully approved.
	 */
	async getNextLevel(collectionSlug: string, documentId: string, config: ApprovalConfig): Promise<number | null> {
		if (!config.levels || config.levels.length === 0) return null;

		const existing = await this.approvals.findMany({
			where: { collection_slug: collectionSlug, document_id: documentId },
			orderBy: { level: 'desc' },
			limit: 1,
		});

		const highestApproved = existing.data.length > 0 ? existing.data[0].level : 0;
		const nextLevel = highestApproved + 1;
		const nextConfig = config.levels.find((l) => l.level === nextLevel);

		return nextConfig ? nextLevel : null;
	}

	/**
	 * Check if a user can approve a document at a given level.
	 */
	async canApprove(
		auth: AuthContext,
		collectionSlug: string,
		level: number,
		config: ApprovalConfig,
		amount?: number,
	): Promise<{ allowed: boolean; reason?: string }> {
		const levelConfig = config.levels.find((l) => l.level === level);
		if (!levelConfig) return { allowed: false, reason: `Approval level ${level} not configured` };

		// Check role
		const userRole = await this.db.first<{ name: string }>(QueryBuilder.from('_roles').select('name').where('id', auth.role_id).toSelect());
		if (!userRole) return { allowed: false, reason: 'User role not found' };

		if (!auth.is_admin && userRole.name !== levelConfig.role) {
			return { allowed: false, reason: `Only ${levelConfig.role} role can approve at level ${level}` };
		}

		// Check amount limit
		if (amount !== undefined && amount !== null && levelConfig.can_approve_up_to !== null) {
			if (amount > levelConfig.can_approve_up_to) {
				return {
					allowed: false,
					reason: `Amount ${amount} exceeds approval limit of ${levelConfig.can_approve_up_to} for ${levelConfig.role}`,
				};
			}
		}

		return { allowed: true };
	}

	/**
	 * Approve a document at a specific level.
	 */
	async approve(
		auth: AuthContext,
		collectionSlug: string,
		documentId: string,
		level: number,
		comment?: string,
		amount?: number,
	): Promise<{ newStatus: string; nextLevel: number | null }> {
		const config = await this.getCollectionConfig(collectionSlug);
		const check = await this.canApprove(auth, collectionSlug, level, config, amount);
		if (!check.allowed) throw new ForbiddenError(check.reason || 'Cannot approve');

		// Record approval
		const role = await this.db.first<{ name: string }>(QueryBuilder.from('_roles').select('name').where('id', auth.role_id).toSelect());
		await this.approvals.create({
			id: crypto.randomUUID(),
			collection_slug: collectionSlug,
			document_id: documentId,
			level,
			approved_by: auth.user_id,
			role_name: role?.name || 'Unknown',
			amount: amount ?? null,
			comment: comment ?? null,
			created_at: new Date().toISOString(),
		} as Partial<ApprovalRecord>);

		// Determine next status
		const nextLevel = await this.getNextLevel(collectionSlug, documentId, config);

		let newStatus: string;
		if (nextLevel === null) {
			newStatus = 'approved'; // Fully approved
		} else {
			newStatus = `approved_l${level}`;
		}

		return { newStatus, nextLevel };
	}

	/**
	 * Reject a document (any level → rejected).
	 */
	async reject(auth: AuthContext, collectionSlug: string, documentId: string, comment?: string): Promise<{ newStatus: string }> {
		// Check permission: user must have can_submit or can_approve to reject
		const canSubmit = await PermissionEvaluator.checkBusiness(this.db, auth, collectionSlug, 'submit');
		const canApprove = await PermissionEvaluator.checkBusiness(this.db, auth, collectionSlug, 'approve');
		if (!canSubmit && !canApprove) {
			throw new ForbiddenError('You do not have permission to reject documents in this collection');
		}

		// Record rejection as level 0
		const role = await this.db.first<{ name: string }>(QueryBuilder.from('_roles').select('name').where('id', auth.role_id).toSelect());
		await this.approvals.create({
			id: crypto.randomUUID(),
			collection_slug: collectionSlug,
			document_id: documentId,
			level: 0, // rejection
			approved_by: auth.user_id,
			role_name: role?.name || 'Unknown',
			amount: null,
			comment: comment ?? 'Rejected',
			created_at: new Date().toISOString(),
		} as Partial<ApprovalRecord>);

		return { newStatus: 'rejected' };
	}

	/**
	 * Get approval history for a document.
	 */
	async getHistory(collectionSlug: string, documentId: string): Promise<ApprovalRecord[]> {
		return this.approvals
			.findMany({
				where: { collection_slug: collectionSlug, document_id: documentId },
				orderBy: { level: 'asc' },
				limit: 100,
			})
			.then((r) => r.data);
	}

	private async getCollectionConfig(collectionSlug: string): Promise<ApprovalConfig> {
		const schema = await this.db.first<{ schema_json: string }>(
			QueryBuilder.from('_entity_schemas').select('schema_json').where('slug', collectionSlug).toSelect(),
		);
		if (!schema) throw new NotFoundError('Collection', collectionSlug);

		let configJson: string | null = null;
		try {
			const parsed = JSON.parse(schema.schema_json);
			configJson = parsed.approval_config || null;
		} catch {}
		return this.parseApprovalConfig(configJson);
	}
}

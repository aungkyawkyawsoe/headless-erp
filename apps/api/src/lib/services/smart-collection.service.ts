/**
 * Smart Collection Service — Pipeline-Enhanced Wrapper
 *
 * Wraps CollectionService with v0.7 engines:
 *   - DefaultResolver: $NOW, $UUID, $USER_ID, =expr
 *   - LinkageEngine: visible_when, readonly_when, auto-calc
 *   - FieldValidator: expression validation rules
 *
 * Backward-compatible: mirrors CollectionService API exactly.
 * Drop-in replacement — just change the import in routes.
 *
 * Bundle: ~1.5KB
 */
import { CollectionService } from '@/lib/services/collection.service';
import type { FieldSelection } from '@/lib/api/query-parser';
import { DefaultResolver } from '@mmbix/core';
import { FieldValidator } from '@mmbix/core';
import { LinkageEngine } from '@mmbix/core';
import type { FieldDefinition } from '@mmbix/types';
import { D1Client } from '@mmbix/core';
import type { ExecutionCtx } from '@/lib/services/collection.shared';

export class SmartCollectionService {
	private svc: CollectionService;

	constructor(db: D1Client, auth?: import('@/lib/services/auth.service').AuthContext) {
		this.svc = new CollectionService(db, auth);
	}

	// ── Delegate: Schema management ──────────────────────

	async ensureMigrations() {
		return this.svc.ensureMigrations();
	}
	async getCollections() {
		return this.svc.getCollections();
	}
	async getCollectionSummaries() {
		return this.svc.getCollectionSummaries();
	}
	async getCollection(slug: string) {
		return this.svc.getCollection(slug);
	}
	async getCollectionRows(slugs: string[]) {
		return this.svc.getCollectionRows(slugs);
	}
	async getCollectionRow(slug: string) {
		return this.svc.getCollectionRow(slug);
	}
	async createCollection(params: {
		name: string;
		slug?: string;
		description?: string;
		fields?: FieldDefinition[];
		naming_series?: string;
		is_singleton?: boolean;
		icon?: string;
		color?: string;
		hidden?: boolean;
		sort_field?: string;
		system_field_options?: import('@mmbix/types').SystemFieldOptions;
	}) {
		return this.svc.createCollection(params);
	}
	async deleteCollection(slug: string) {
		return this.svc.deleteCollection(slug);
	}
	async reconcileJunctionTables(tableName: string, oldFields: FieldDefinition[], newFields: FieldDefinition[]) {
		return this.svc.reconcileJunctionTables(tableName, oldFields, newFields);
	}
	async listItems(slug: string, url: URL, includeTrashed?: boolean) {
		return this.svc.listItems(slug, url, includeTrashed);
	}
	async getItem(slug: string, id: string, selection?: FieldSelection | null, fieldsKey = '') {
		return this.svc.getItem(slug, id, selection, fieldsKey);
	}
	async softDeleteItem(slug: string, id: string, ctx?: ExecutionCtx) {
		return this.svc.softDeleteItem(slug, id, ctx);
	}
	async restoreItem(slug: string, id: string, ctx?: ExecutionCtx) {
		return this.svc.restoreItem(slug, id, ctx);
	}
	async hardDeleteItem(slug: string, id: string, ctx?: ExecutionCtx) {
		return this.svc.hardDeleteItem(slug, id, ctx);
	}

	// ── Enhanced: createItem with pipeline ───────────────

	async createItem(collectionSlug: string, body: Record<string, unknown>, execCtx?: ExecutionCtx): Promise<Record<string, unknown>> {
		// 1. Resolve dynamic defaults ($NOW, $UUID, $USER_ID, =expr)
		const info = await this.svc.getCollection(collectionSlug);
		const auth = this.svc.getAuth();
		const ctx = {
			user_id: auth?.user_id,
			user_name: auth?.email,
			user_email: auth?.email,
			role_id: auth?.role_id,
			role_name: auth?.role_name,
		};
		const resolvedBody = DefaultResolver.resolveAll(info.schemaFields, body, ctx);

		// 2. Run linkage engine (auto-set, auto-calc, hints)
		const { data: linkedBody, hints } = LinkageEngine.evaluate(info.schemaFields, resolvedBody);
		// hints are returned in response for frontend to use

		// 3. Expression validation (in addition to CollectionService's built-in validation)
		const validationErrors = FieldValidator.validateAll(info.schemaFields, linkedBody);
		if (validationErrors.length > 0) {
			const { ValidationError } = await import('@mmbix/utils');
			throw new ValidationError(FieldValidator.formatErrors(validationErrors));
		}

		// 4. Delegate to base service
		const item = await this.svc.createItem(collectionSlug, linkedBody, execCtx);

		// 5. Return item with linkage hints
		return { ...item, _hints: hints };
	}

	// ── Enhanced: updateItem with pipeline ───────────────

	async updateItem(
		collectionSlug: string,
		id: string,
		body: Record<string, unknown>,
		execCtx?: ExecutionCtx,
		expectedUpdatedAt?: string | null,
	): Promise<Record<string, unknown>> {
		// 1. Get schema
		const info = await this.svc.getCollection(collectionSlug);

		// 2. Run linkage engine on the update data
		const { data: linkedBody, hints } = LinkageEngine.evaluate(info.schemaFields, body);

		// 3. Expression validation
		const validationErrors = FieldValidator.validateAll(info.schemaFields, linkedBody);
		if (validationErrors.length > 0) {
			const { ValidationError } = await import('@mmbix/utils');
			throw new ValidationError(FieldValidator.formatErrors(validationErrors));
		}

		// 4. Delegate
		const item = await this.svc.updateItem(collectionSlug, id, linkedBody, execCtx, expectedUpdatedAt);

		return { ...item, _hints: hints };
	}
}

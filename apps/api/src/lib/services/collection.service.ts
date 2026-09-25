/**
 * Collection Service — Enterprise Edition (facade)
 *
 * Public API surface for the headless entity engine. All behavior is owned by
 * focused collaborators — this class only wires them together:
 *
 *   SchemaService        → collection lifecycle (schemas, tables, schema cache)
 *   ItemQueryService     → reads (list/detail, keyset, aggregates, decrypt-on-read)
 *   ItemMutationService  → writes (create/update/delete, hooks, audit, webhooks)
 *   RelationResolver     → ?fields= projection + relation expansion + pruning
 *   CascadeService       → M2M junction statements + cascade delete traversal
 *
 * The public method signatures are unchanged (drop-in for every caller).
 */
import { D1Client } from '@mmbix/core';
import type { EntitySchema, FieldDefinition } from '@mmbix/types';
import { parseFieldSelection, type FieldSelection } from '@/lib/api/query-parser';
import type { AuthContext } from '@/lib/services/auth.service';
import type { WebhookService } from '@/lib/services/webhook.service';
import { SchemaService, type CreateCollectionInput } from '@/lib/services/collection-schema.service';
import { ItemQueryService } from '@/lib/services/collection-query.service';
import { ItemMutationService } from '@/lib/services/collection-mutation.service';
import { RelationResolver } from '@/lib/services/collection-relations.service';
import { CascadeService } from '@/lib/services/collection-cascade.service';
import { FULL_ROW_READ_KEY, type ExecutionCtx } from '@/lib/services/collection.shared';

// Backward-compatible re-exports (consumers import types from the facade).
export type { ExecutionCtx, CollectionInfo, CollectionPolicy, ItemListResult, StatusMachineConfig } from '@/lib/services/collection.shared';
export { SYSTEM_FIELD_NAMES } from '@/lib/services/collection.shared';

export class CollectionService {
	private schema: SchemaService;
	private query: ItemQueryService;
	private mutation: ItemMutationService;
	private relations: RelationResolver;
	private cascade: CascadeService;

	/** Optional auth context for permission-aware operations (read by collaborators via closure). */
	private _auth: AuthContext | null = null;

	constructor(db: D1Client, auth?: AuthContext) {
		this._auth = auth || null;
		// Collaborators read schema/auth through closures so setAuth()/cache
		// invalidation stay consistent without passing state around.
		this.schema = new SchemaService(db, () => this._auth);
		this.relations = new RelationResolver(
			db,
			() => this.schema.getCollections(),
			() => this._auth,
		);
		this.cascade = new CascadeService(
			db,
			(slug) => this.schema.getCollection(slug),
			() => this.schema.getCollections(),
		);
		this.query = new ItemQueryService(db, this.schema, this.relations, () => this._auth);
		this.mutation = new ItemMutationService(
			db,
			this.schema,
			this.cascade,
			// Replay: idempotent creates echo the existing live record with the SAME
			// shape as a fresh create (full row incl. relation FK columns). The
			// public default getItem is relation-lean, so project '*' + the internal
			// full-row key (distinct cache namespace, no wire shaping).
			(slug, id) => this.query.getItem(slug, id, parseFieldSelection(['*']), FULL_ROW_READ_KEY),
			() => this._auth,
		);
	}

	/** Set auth context for subsequent operations */
	setAuth(auth: AuthContext): this {
		this._auth = auth;
		return this;
	}

	/** Current auth context (read by collaborators and pipeline wrappers via closures). */
	getAuth(): AuthContext | null {
		return this._auth;
	}

	/** Webhook service (mutation pipeline) — kept public for API compatibility. */
	get webhooks(): WebhookService {
		return this.mutation.webhooks;
	}

	// Cache: delegates to centralized CacheLayer for cross-layer invalidation (FIX #7A, #7B, #7C)
	static invalidateCache(slug?: string): void {
		SchemaService.invalidateCache(slug);
	}

	// ── Schema management (delegated) ────────────────────

	async ensureMigrations(): Promise<void> {
		return this.schema.ensureMigrations();
	}

	async getCollections(): Promise<EntitySchema[]> {
		return this.schema.getCollections();
	}

	/** Lean registry rows (no schema_json) for the collections list endpoint. */
	async getCollectionSummaries(): Promise<Array<Record<string, unknown>>> {
		return this.schema.getCollectionSummaries();
	}

	async getCollection(slug: string) {
		return this.schema.getCollection(slug);
	}

	/**
	 * RAW `_entity_schemas` row(s) — the exact shape the schema-plane routes
	 * serialize. Batched so a relation-schema bundle is one read for N targets,
	 * and cache-warming so a later direct GET of any target is free.
	 */
	async getCollectionRows(slugs: string[]): Promise<Map<string, EntitySchema>> {
		return this.schema.getCollectionRows(slugs);
	}

	async getCollectionRow(slug: string): Promise<EntitySchema> {
		return this.schema.getCollectionRow(slug);
	}

	async createCollection(input: CreateCollectionInput): Promise<EntitySchema> {
		return this.schema.createCollection(input);
	}

	/** Add fields to an existing collection (declarative evolution via EntityMigrator). */
	async addCollectionFields(slug: string, fields: FieldDefinition[]): Promise<{ added: string[]; table_name: string }> {
		return this.schema.addFields(slug, fields);
	}

	async deleteCollection(slug: string): Promise<void> {
		return this.schema.deleteCollection(slug);
	}

	/**
	 * Reconcile a schema change's m2m junction surface (provision declared /
	 * drop removed junction tables). Schema updates must keep the physical
	 * `_jt_*` tables in sync with schema_json — EntityMigrator skips virtual m2m
	 * fields, so this is the only place junction DDL runs on update.
	 */
	async reconcileJunctionTables(
		tableName: string,
		oldFields: FieldDefinition[],
		newFields: FieldDefinition[],
	): Promise<{ provisioned: string[]; dropped: string[] }> {
		return this.schema.reconcileJunctionTables(tableName, oldFields, newFields);
	}

	// ── Item reads (delegated) ───────────────────────────

	async listItems(collectionSlug: string, url: URL, includeTrashed = false) {
		return this.query.listItems(collectionSlug, url, includeTrashed);
	}

	async getItem(collectionSlug: string, id: string, selection?: FieldSelection | null, fieldsKey = ''): Promise<Record<string, unknown>> {
		return this.query.getItem(collectionSlug, id, selection, fieldsKey);
	}

	// ── Item writes (delegated) ──────────────────────────

	async createItem(collectionSlug: string, body: Record<string, unknown>, execCtx?: ExecutionCtx): Promise<Record<string, unknown>> {
		return this.mutation.createItem(collectionSlug, body, execCtx);
	}

	async updateItem(
		collectionSlug: string,
		id: string,
		body: Record<string, unknown>,
		execCtx?: ExecutionCtx,
		expectedUpdatedAt?: string | null,
	): Promise<Record<string, unknown>> {
		return this.mutation.updateItem(collectionSlug, id, body, execCtx, expectedUpdatedAt);
	}

	async softDeleteItem(
		collectionSlug: string,
		id: string,
		execCtx?: ExecutionCtx,
	): Promise<{ id: string; deleted_at: string; deleted_by?: string | null }> {
		return this.mutation.softDeleteItem(collectionSlug, id, execCtx);
	}

	async restoreItem(collectionSlug: string, id: string, execCtx?: ExecutionCtx): Promise<{ id: string; restored: boolean }> {
		return this.mutation.restoreItem(collectionSlug, id, execCtx);
	}

	async hardDeleteItem(collectionSlug: string, id: string, execCtx?: ExecutionCtx): Promise<{ id: string; deleted: boolean }> {
		return this.mutation.hardDeleteItem(collectionSlug, id, execCtx);
	}
}

/**
 * ItemMutationService — entity writes (create / update / soft-delete / restore /
 * hard-delete) and every write-side engine.
 *
 * Extracted from CollectionService (enterprise decomposition): owns the write
 * pipeline — required-field + constraint validation (batched unique checks),
 * DocStatus workflow, the declarative status machine, server/plugin hooks,
 * field encryption on write, singleton enforcement, idempotent client-id
 * replay, atomic parent+M2M batches, child-table sync, audit + webhooks.
 */
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import {
	invalidateCollectionReads,
	splitRowData,
	mergeRowData,
	isValidDocStatus,
	isValidTransition,
	evaluateExpression,
	topoSortStoredFormulas,
	coerceComputedValue,
	formulaResultType,
	extractLookupRefs,
	coerceValue,
} from '@mmbix/core';
import { NamingService } from '@/lib/services/naming.service';
import { MediaRefService, extractMediaKeys } from '@/lib/services/media-ref.service';
import { WebhookService } from '@/lib/services/webhook.service';
import { AuditService } from '@/lib/services/audit.service';
import { ComputedFieldService } from '@/lib/services/computed-field.service';
import { validators, assertValid } from '@mmbix/utils';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '@mmbix/utils';
import { ServerFunctionService } from '@/plugins/server-functions/service';
import { M2AService } from '@/plugins/m2a/service';
import { ChildTableService } from '@/plugins/child-tables/service';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { DataFilterService } from '@/lib/services/data-filter.service';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import type { AuthContext } from '@/lib/services/auth.service';
import type { DocStatus, EntitySchema, FieldDefinition } from '@mmbix/types';
import { SchemaService } from '@/lib/services/collection-schema.service';
import { CascadeService } from '@/lib/services/collection-cascade.service';
import { checkRowFilterAccess, type ExecutionCtx, type CollectionInfo } from '@/lib/services/collection.shared';

export class ItemMutationService {
	private db: D1Client;
	private schema: SchemaService;
	private cascade: CascadeService;
	private getAuth: () => AuthContext | null;
	/** Per-schema-array memo — inbound RESTRICT refs (m2o targeting a collection
	 *  with an EXPLICIT `cascade_delete: false`). Auto-invalidates with the schema
	 *  cache (array identity), so a schema change is picked up on the next delete.
	 *  An ABSENT flag stays permissive (legacy): only an explicit `false` opts a
	 *  relation into RESTRICT. */
	private restrictMapCache = new WeakMap<EntitySchema[], Map<string, { childName: string; table: string; field: string }[]>>();
	/** Replay path for idempotent creates — wired by the facade to the query service. */
	private getItem: (collectionSlug: string, id: string) => Promise<Record<string, unknown>>;

	private naming: NamingService;
	private audit: AuditService;
	public webhooks: WebhookService;

	constructor(
		db: D1Client,
		schema: SchemaService,
		cascade: CascadeService,
		getItem: (collectionSlug: string, id: string) => Promise<Record<string, unknown>>,
		getAuth: () => AuthContext | null,
	) {
		this.db = db;
		this.schema = schema;
		this.cascade = cascade;
		this.getItem = getItem;
		this.getAuth = getAuth;
		this.naming = new NamingService(db);
		this.audit = new AuditService(db);
		this.webhooks = new WebhookService(db);
	}

	/** True when the collection has at least one media-bearing field.
	 *  Used to decide whether the write should maintain _media_refs (see below). */
	private static schemaHasMediaFields(fields: FieldDefinition[]): boolean {
		return fields.some((f) => f.type === 'image' || f.type === 'file');
	}

	/**
	 * Enforce the collection's write policy (schema_json.policies.writes) on the
	 * GENERIC entity path. The owning domain service writes through D1 directly and
	 * is intentionally unaffected — so 'service' means "not writable via REST",
	 * which is what stops a generic PUT from moving live stock (or forging a ledger
	 * row) without going through the writer that appends the matching event.
	 * Runs before any row read, on the already-cached schema — zero extra D1 cost.
	 */
	private assertGenericWrite(collectionSlug: string, info: CollectionInfo, action: 'create' | 'update' | 'delete'): void {
		const w = info.policies?.writes;
		if (!w) return;
		if (w.mode === 'service') {
			throw new ForbiddenError(
				`"${collectionSlug}" is maintained by its domain service and cannot be written through the generic entity API`,
			);
		}
		if (w.append_only && action !== 'create') {
			throw new ForbiddenError(`"${collectionSlug}" is an append-only ledger — its rows are immutable`);
		}
	}

	/**
	 * Bind the collection's `policies.actor_fields` (e.g. `reported_by`,
	 * `requested_by`) to the SESSION employee on create, and stop a non-admin from
	 * REASSIGNING them on update. This is what makes a two-person rule real: the
	 * reporter can never be forged, so `approver != reporter` cannot be defeated by
	 * naming a victim. A trusted-root admin (and the dev-token path) keeps explicit
	 * control; an identity with no directory row cannot file such a record at all.
	 */
	private bindActorFields(collectionSlug: string, info: CollectionInfo, data: Record<string, unknown>, mode: 'create' | 'update'): void {
		const fields = info.policies?.actor_fields;
		if (!fields || fields.length === 0) return;
		const owned = new Set(info.schemaFields.map((f) => f.name));
		const applied = fields.filter((f) => owned.has(f));
		if (applied.length === 0) return;
		const auth = this.getAuth();
		if (auth?.is_admin) return; // trusted root may name an actor explicitly
		if (mode === 'update') {
			// Editing a record must never rewrite WHO filed it.
			for (const f of applied) delete data[f];
			return;
		}
		const actor = auth?.employee_id ?? null;
		if (!actor) {
			throw new ForbiddenError(
				`"${collectionSlug}" records who filed it — this identity has no employee directory row, so it cannot file one`,
			);
		}
		for (const f of applied) data[f] = actor;
	}

	/**
	 * Strip the collection's `writes.frozen_fields` (workflow/state columns such as
	 * `status`, `approved_by`, `executed_at`) from a generic write — only the owning
	 * service may set them. Stripping rather than rejecting keeps a form that echoes
	 * a read-only field working, and the column keeps its default / server value.
	 */
	private stripFrozenFields(info: CollectionInfo, data: Record<string, unknown>): void {
		const frozen = info.policies?.writes?.frozen_fields;
		if (!frozen || frozen.length === 0) return;
		for (const f of frozen) delete data[f];
	}

	/**
	 * Least-privilege WRITE enforcement for `field_restrictions`.
	 *
	 * The same whitelist the read path redacts with (`DataFilterService.
	 * applyFieldFilter`) must also gate WRITES: a role that may `can_write` but may
	 * not READ a column could otherwise SET it — privilege escalation. Runs on the
	 * caller payload AFTER frozen fields are stripped and actor fields are bound,
	 * so an engine-managed column is never mistaken for a caller write, and
	 * REJECTS (403, naming the fields) rather than stripping silently — a field the
	 * caller believes saved but the engine dropped is the worse failure. Admins and
	 * unrestricted roles (`null`) pass.
	 */
	private async assertWritableFields(collectionSlug: string, info: CollectionInfo, data: Record<string, unknown>): Promise<void> {
		const auth = this.getAuth();
		if (!auth || auth.is_admin) return;
		const restrictions = await PermissionEvaluator.getFieldRestrictions(this.db, auth.role_id, collectionSlug);
		if (restrictions === null) return; // null = every field writable
		const allowed = new Set(restrictions);
		allowed.add('id');
		allowed.add('created_at');
		allowed.add('updated_at');
		// Engine-owned columns the service itself sets are never "the caller's write".
		for (const f of info.policies?.actor_fields ?? []) allowed.add(f);
		for (const f of info.policies?.writes?.frozen_fields ?? []) allowed.add(f);
		const writable = new Set(info.schemaFields.map((f) => f.name));
		const blocked = Object.keys(data).filter((key) => writable.has(key) && !allowed.has(key));
		if (blocked.length > 0) {
			throw new ForbiddenError(`Your role cannot write field(s) on "${collectionSlug}": ${blocked.join(', ')}`);
		}
	}

	/**
	 * Enforce `writes.freeze_when` — a row whose governing state is one of `values`
	 * is immutable through the generic entity API (only its domain service may touch
	 * it). Runs on the row ALREADY fetched for the update/delete, so it costs no
	 * extra D1 read, and it sits inside the service, so the RBAC admin bypass cannot
	 * reach a posted document either. This is what closes the "edit a confirmed
	 * receipt" hole — a posted doc must be reversed, never rewritten.
	 */
	private assertNotFrozen(collectionSlug: string, info: CollectionInfo, existing: Record<string, unknown>): void {
		const freeze = info.policies?.writes?.freeze_when;
		if (!freeze || typeof freeze.field !== 'string' || !Array.isArray(freeze.values) || freeze.values.length === 0) return;
		const state = existing[freeze.field];
		if (state != null && freeze.values.includes(String(state))) {
			throw new ForbiddenError(
				`"${collectionSlug}" rows in state "${String(state)}" are frozen — reverse or amend them through their domain service, not a generic write`,
			);
		}
	}

	/** Best-effort maintenance of _media_refs after a media-bearing write.
	 *  Registration lets guarded media delete / GC reclaim an asset only when no
	 *  document references it. A failure here NEVER fails the write — media GC is
	 *  housekeeping, not a correctness gate. */
	private async maintainMediaRefs(collectionSlug: string, docId: string, snapshot: unknown): Promise<void> {
		try {
			await new MediaRefService(this.db).syncDoc(collectionSlug, docId, snapshot);
		} catch (err) {
			console.error(`[media-refs] sync failed for ${collectionSlug}/${docId}:`, err instanceof Error ? err.message : err);
		}
	}

	async createItem(collectionSlug: string, body: Record<string, unknown>, execCtx?: ExecutionCtx): Promise<Record<string, unknown>> {
		const info = await this.schema.getCollection(collectionSlug);
		this.assertGenericWrite(collectionSlug, info, 'create');
		const { table_name: tableName, schemaFields, naming_series, is_singleton, systemFieldOptions } = info;
		if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Request body must be a JSON object');
		const { id: bodyId, ...userDataRest } = body;
		let userData = userDataRest;
		this.bindActorFields(collectionSlug, info, userData, 'create');
		this.stripFrozenFields(info, userData);
		await this.assertWritableFields(collectionSlug, info, userData);

		// Formula write-back (inverse): a payload carrying a computed field with
		// inverse_formula derives its source BEFORE required-field validation.
		await this.applyInverseFormulas(schemaFields, userData);

		// Idempotent create: a client-supplied UUID `id` makes POST replay-safe —
		// retrying with the same id returns the existing record instead of creating
		// a duplicate (the classic network-timeout → resubmit case). The insert
		// below uses that id, so a later retry always finds the same row.
		let clientId: string | null = null;
		if (bodyId !== undefined && bodyId !== null) {
			if (typeof bodyId !== 'string') throw new ValidationError('id must be a string when provided');
			assertValid(validators.uuid(bodyId, 'id'));
			clientId = bodyId;
			const existing = await this.db.first<Record<string, unknown>>(
				QueryBuilder.from(tableName).select('id', 'deleted_at').where('id', clientId).toSelect(),
			);
			if (existing) {
				if (existing.deleted_at) {
					throw new ValidationError(`Item with id "${clientId}" exists in trash — restore it or use a new id`);
				}
				// Replay: return the existing live record (same shape as a fresh create).
				return this.getItem(collectionSlug, clientId);
			}
		}

		// ── Validate required fields BEFORE DB insert ───────────
		const missingRequired: string[] = [];
		const autoGeneratedTypes = new Set(['uuid', 'slug', 'o2m', 'm2m', 'table', 'formula']);
		for (const field of schemaFields) {
			// Column is NOT NULL when required !== false (undefined defaults to NOT NULL)
			if (field.required === false) continue;
			// Fields with defaults are auto-filled by the DB — not required
			if (field.default !== undefined) continue;
			if (autoGeneratedTypes.has(field.type)) continue;
			if (field.type === 'slug' && field.source && userData[field.source]) continue;
			// M2A fields store their payload in {name}_type / {name}_id — validate those instead
			if (field.type === 'm2a') {
				const typeVal = userData[`${field.name}_type`];
				const idVal = userData[`${field.name}_id`];
				if (typeVal === undefined || typeVal === null || idVal === undefined || idVal === null) {
					missingRequired.push(field.name);
				}
				continue;
			}
			const val = userData[field.name];
			if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
				missingRequired.push(field.name);
			}
		}
		if (missingRequired.length > 0) {
			throw new ValidationError(`Missing required field(s): ${missingRequired.join(', ')}`);
		}

		// Field constraint validation (min, max, max_length, unique)
		await this.validateFieldConstraints(schemaFields, userData, tableName);

		// M2A validation
		const m2aFields = new M2AService(this.db).getFields(schemaFields);
		new M2AService(this.db).validate(m2aFields, userData);

		// Server functions: validate + before_insert
		const validateResult = await ServerFunctionService.executeHooks(this.db, 'validate', collectionSlug, userData);
		if (validateResult?.abort) {
			throw new ValidationError(validateResult.error || 'Validation failed', validateResult.message, validateResult.field);
		}
		// Plugin hooks: validate (full TypeScript power)
		const phValidate = await pluginHookRegistry.dispatch(collectionSlug, 'validate', userData, this.db, this.getAuth());
		if (phValidate) throw new ValidationError(phValidate.error);

		const beforeInsertResult = await ServerFunctionService.executeHooks(this.db, 'before_insert', collectionSlug, userData);
		if (beforeInsertResult?.abort) throw new ValidationError(beforeInsertResult.error || 'Operation aborted');
		// Plugin hooks: before_insert — transform chain (handlers may return a new
		// doc or abort; the threaded doc feeds the insert below)
		const beforeInsert = await pluginHookRegistry.dispatchTransform(collectionSlug, 'before_insert', userData, this.db, this.getAuth());
		if (beforeInsert.abort) throw new ValidationError(beforeInsert.abort.error);
		userData = beforeInsert.doc;
		// Marketplace plugins: before_insert interceptor chain (native/binding/sandbox)
		userData = await this.runMarketplaceChain(collectionSlug, 'before_insert', userData);
		// Decision tables: data-driven business rules (set / compute / abort) — run
		// before column extraction so computed values reach the INSERT.
		userData = await this.runDecisionTables(collectionSlug, userData, clientId ?? undefined);

		// Split data after server functions (before_insert may have modified userData)
		// Child-table (table type) payloads are extracted FIRST so they never leak
		// into the parent row — they become child records right after the insert.
		const childService = new ChildTableService(this.db);
		const { cleanBody, childData } = childService.extractChildData(userData, schemaFields);
		const { columns, meta } = splitRowData(cleanBody, schemaFields);

		// Stored computed fields — engine-owned columns: recompute (same-row
		// fields + lookups over already-existing o2m/m2m children + m2o targets)
		// and merge. Child-table payloads are NOT in the DB yet — pass 2 after
		// createChildren recomputes those.
		const computed = await this.computeStoredFormulas(collectionSlug, schemaFields, userData, tableName, null);
		Object.assign(columns, computed);

		// v0.7: Encrypt fields marked encrypted=true before insert
		const encryptedColumns = await this.encryptColumns(columns, schemaFields);

		const now = new Date().toISOString();

		let displayNumber: string | null = null;
		if (naming_series) {
			displayNumber = await this.naming.getNextNumber(tableName, naming_series);
		}

		// Singleton enforcement: check for an existing NON-deleted record (fast path).
		// A partial UNIQUE index on (1) WHERE deleted_at IS NULL is the hard guarantee
		// against concurrent double-inserts (see createCollection).
		if (is_singleton) {
			const existing = await this.db.first<{ id: string }>(
				QueryBuilder.from(tableName).select('id').whereNull('deleted_at').limit(1).toSelect(),
			);
			if (existing) {
				throw new ValidationError(`"${collectionSlug}" is a singleton collection. Only one record is allowed.`);
			}
		}

		const insertData: Record<string, unknown> = {
			id: clientId ?? crypto.randomUUID(),
			...encryptedColumns,
			_meta: JSON.stringify(meta),
			created_at: now,
			updated_at: now,
		};
		if (systemFieldOptions.doc_status) insertData.doc_status = 'draft';
		if (displayNumber) insertData.display_number = displayNumber;
		// Track owner and created_by / updated_by
		const auth = this.getAuth();
		if (auth?.user_id) {
			if (systemFieldOptions._owner) insertData._owner = auth.user_id;
			if (systemFieldOptions.created_by) insertData.created_by = auth.user_id;
		}

		const stmt = QueryBuilder.from(tableName).returning(true).toInsert(insertData);

		// Atomic: parent insert + any M2M junction rows commit in ONE D1 batch, so
		// a junction failure can never leave an orphaned parent row behind (the
		// old compensation-rollback path was best-effort and could strand rows).
		const m2mStmts = await this.cascade.buildM2MStatements(tableName, userData, schemaFields, insertData.id as string, 'create');
		let batchResults: D1Result<Record<string, unknown>>[];
		try {
			batchResults = await this.db.batch<Record<string, unknown>>([stmt, ...m2mStmts]);
		} catch (err) {
			// Legacy-table fallback: owner/created_by columns may not exist.
			// Only retry when the failure is genuinely a missing column — anything
			// else (constraint violations etc.) must surface as-is.
			const msg = err instanceof Error ? err.message : String(err);
			if ((insertData._owner || insertData.created_by) && /no such column/i.test(msg)) {
				delete insertData._owner;
				delete insertData.created_by;
				batchResults = await this.db.batch<Record<string, unknown>>([
					QueryBuilder.from(tableName).returning(true).toInsert(insertData),
					...m2mStmts,
				]);
			} else {
				throw err;
			}
		}
		const raw = (batchResults[0]?.results as Record<string, unknown>[] | undefined)?.[0] ?? null;
		if (!raw) throw new Error('Failed to create item');
		const item = mergeRowData(raw);

		// Child-table records (table type) — created after the parent insert so
		// parent_id is known. Best-effort: a child failure surfaces the error.
		if (Object.keys(childData).length > 0) {
			const childMap = await childService.getChildMap(schemaFields);
			await childService.createChildren(raw.id as string, childData, childMap);
			// Stored formulas referencing child-table children — recompute now that
			// the children exist and persist (one extra UPDATE; engine-owned
			// columns only, updated_at untouched).
			const computed2 = await this.computeStoredFormulas(collectionSlug, schemaFields, userData, tableName, raw.id as string);
			if (Object.keys(computed2).length > 0) {
				await this.db.run(
					QueryBuilder.from(tableName)
						.where('id', raw.id as string)
						.toUpdate(computed2),
				);
				Object.assign(item, computed2);
			}
		}

		// v0.7: Lifecycle hooks are handled by ServerFunctionService (declarative rules)
		// after_insert is already invoked via ServerFunctionService.executeHooks below

		// Plugin hooks: after_insert (fire-and-forget — full TypeScript power)
		pluginHookRegistry.dispatchFireAndForget(collectionSlug, 'after_insert', item, this.db, this.getAuth());
		// Marketplace plugins: after_insert interceptor chain (fire-and-forget)
		this.runMarketplaceChainAsync(collectionSlug, 'after_insert', item, execCtx);

		// Server functions: after_insert
		try {
			await ServerFunctionService.executeHooks(this.db, 'after_insert', collectionSlug, item);
		} catch (err) {
			console.error('[server-functions] after_insert failed:', err);
		}

		// Audit log — only when the collection opts in (audit_enabled).
		if (info.audit_enabled) {
			this.audit
				.log(
					execCtx ?? null,
					{
						collection_slug: collectionSlug,
						document_id: raw.id as string,
						action: 'create',
						user_id: auth?.user_id || null,
						snapshot_after: item as Record<string, unknown>,
					},
					info.snapshotMode,
				)
				.catch((err) => console.error('[audit] create log failed:', err));
			// Field-level lineage — one row per field (source='create').
			const { FieldAuditService } = await import('@/lib/services/field-audit.service');
			new FieldAuditService(this.db)
				.logCreate(collectionSlug, raw.id as string, item as Record<string, unknown>, auth)
				.catch((err) => console.error('[field-audit] create log failed:', err instanceof Error ? err.message : err));
		}

		// M2M junction rows are already part of the atomic batch above

		// Webhook — payload is redacted to the caller's field restrictions so
		// receivers never see fields the triggering user cannot read (M7).
		if (execCtx) {
			const payload = await this.redactToVisibleFields(item, collectionSlug, schemaFields);
			await this.webhooks.fire(execCtx, collectionSlug, 'create', payload);
		}

		// Cascade recalc — parents with stored formulas aggregating over this
		// collection (o2m/m2m/table/m2o) recompute now that the child exists.
		await this.recalcAffectedParents(collectionSlug, raw.id as string, tableName);

		// Invalidate this collection's response cache so new rows are visible immediately.
		// The row id rides along so the response's change envelope can name the exact row.
		invalidateCollectionReads(collectionSlug, raw.id as string);
		// Register R2 media refs for the new document (best-effort) — enables later
		// guarded media cleanup / GC once nothing references an uploaded asset.
		if (ItemMutationService.schemaHasMediaFields(schemaFields) || extractMediaKeys(item).length > 0) {
			await this.maintainMediaRefs(collectionSlug, raw.id as string, item);
		}
		return this.redactToVisibleFields(item, collectionSlug, schemaFields);
	}

	async updateItem(
		collectionSlug: string,
		id: string,
		body: Record<string, unknown>,
		execCtx?: ExecutionCtx,
		/** Optimistic concurrency: expected `updated_at` (from If-Match) — stale writes get 409. */
		expectedUpdatedAt?: string | null,
	): Promise<Record<string, unknown>> {
		const info = await this.schema.getCollection(collectionSlug);
		this.assertGenericWrite(collectionSlug, info, 'update');
		const { table_name: tableName, schemaFields, systemFieldOptions } = info;
		assertValid(validators.uuid(id, 'id'));
		if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('Request body must be a JSON object');

		// Check DocStatus transition
		const existing = await this.db.first<Record<string, unknown>>(QueryBuilder.from(tableName).select('*').where('id', id).toSelect());
		if (!existing) throw new NotFoundError('Item', id);
		this.assertNotFrozen(collectionSlug, info, existing);
		// Row-level RBAC on write — cannot update a record the role cannot see.
		await checkRowFilterAccess(this.db, this.getAuth(), collectionSlug, tableName, id);

		// Optimistic concurrency — the client sends the `updated_at` it loaded;
		// if the record moved on since, the write is stale → 409 (never silently
		// clobber another user's edit). O(1) — one string compare.
		if (expectedUpdatedAt && existing.updated_at && String(existing.updated_at) !== String(expectedUpdatedAt)) {
			throw new ConflictError(
				`Record was modified by someone else at ${String(existing.updated_at)} — reload it and re-apply your changes`,
			);
		}

		const { doc_status: newStatus, ...userDataRest } = body;
		let userData = userDataRest;
		this.bindActorFields(collectionSlug, info, userData, 'update');
		this.stripFrozenFields(info, userData);
		await this.assertWritableFields(collectionSlug, info, userData);

		// Formula write-back (inverse): derive source fields from computed values
		// in the payload before validation (existing row provides untouched scope).
		await this.applyInverseFormulas(schemaFields, userData, existing as Record<string, unknown>);

		// Validate docstatus transition with RBAC permission check
		if (newStatus && typeof newStatus === 'string') {
			if (!isValidDocStatus(newStatus))
				throw new ValidationError(
					`Invalid doc_status: "${newStatus}". Valid: draft, submitted, approved, cancelled, confirmed, pending_review, rejected`,
				);
			const currentStatus = (existing.doc_status as DocStatus) || 'draft';
			// `confirmed` stays a domain-service-owned posted state by default; a
			// collection that opts into `writes.confirmable` may reach it from a draft.
			const allowConfirmed = info.policies?.writes?.confirmable === true;
			if (!isValidTransition(currentStatus, newStatus as DocStatus, { allowConfirmed })) {
				throw new ValidationError(`Cannot transition from "${currentStatus}" to "${newStatus}"`);
			}
			// RBAC: Check can_submit / can_approve permissions
			const auth = this.getAuth();
			if (auth && !auth.is_admin) {
				if (newStatus === 'submitted') {
					const canSubmit = await PermissionEvaluator.checkBusiness(this.db, auth, collectionSlug, 'submit');
					if (!canSubmit) throw new ForbiddenError(`You do not have permission to submit documents in "${collectionSlug}"`);
				}
				if (newStatus === 'approved') {
					const canApprove = await PermissionEvaluator.checkBusiness(this.db, auth, collectionSlug, 'approve');
					if (!canApprove) throw new ForbiddenError(`You do not have permission to approve documents in "${collectionSlug}"`);
				}
			}
		}

		if (Object.keys(userData).length === 0 && !newStatus) throw new ValidationError('No valid fields to update');

		// Plugin hooks: before_update — the transform chain runs BEFORE constraint
		// validation and column extraction so a returned doc actually reaches the
		// UPDATE statement (the previous ordering dropped before_update mutations).
		const beforeUpdate = await pluginHookRegistry.dispatchTransform(
			collectionSlug,
			'before_update',
			{ ...userData, _existing: existing },
			this.db,
			this.getAuth(),
		);
		if (beforeUpdate.abort) throw new ValidationError(beforeUpdate.abort.error);
		userData = beforeUpdate.doc;
		delete (userData as Record<string, unknown>)._existing;

		// Marketplace plugins: before_update interceptor chain (native/binding/sandbox)
		userData = await this.runMarketplaceChain(collectionSlug, 'before_update', userData);
		// Decision tables: data-driven business rules on update. The merged
		// (existing + payload) doc gives rules full context; only the delta is
		// returned so untouched fields never get re-written.
		userData = await this.runDecisionTables(collectionSlug, userData, id, existing as Record<string, unknown>);

		// Field constraint validation (min, max, max_length, unique)
		await this.validateFieldConstraints(schemaFields, userData, tableName, id);

		// Child-table (table type) payloads are extracted FIRST so they never leak
		// into the parent row — they replace the child set after the update.
		const childService = new ChildTableService(this.db);
		const { cleanBody, childData } = childService.extractChildData(userData, schemaFields);
		const { columns, meta } = splitRowData(cleanBody, schemaFields);

		// Stored computed fields — recompute over the merged (existing + payload)
		// scope so formulas referencing untouched fields stay correct.
		const computed = await this.computeStoredFormulas(
			collectionSlug,
			schemaFields,
			{ ...(existing as Record<string, unknown>), ...userData },
			tableName,
			id,
		);
		Object.assign(columns, computed);

		// Server functions: validate + before_update
		const validateResult = await ServerFunctionService.executeHooks(
			this.db,
			'validate',
			collectionSlug,
			userData,
			existing as Record<string, unknown>,
		);
		if (validateResult?.abort) {
			throw new ValidationError(validateResult.error || 'Validation failed', validateResult.message, validateResult.field);
		}
		// Plugin hooks: validate
		const phValidateUpd = await pluginHookRegistry.dispatch(
			collectionSlug,
			'validate',
			{ ...userData, _existing: existing },
			this.db,
			this.getAuth(),
		);
		if (phValidateUpd) throw new ValidationError(phValidateUpd.error);

		const beforeUpdateResult = await ServerFunctionService.executeHooks(
			this.db,
			'before_update',
			collectionSlug,
			userData,
			existing as Record<string, unknown>,
		);
		if (beforeUpdateResult?.abort) throw new ValidationError(beforeUpdateResult.error || 'Operation aborted');

		// ── Declarative status machine (schema_json.status_machine) ──
		// Generically enforce legal state transitions on ANY collection that opts
		// in — no business-specific plugin. Mirrors the guard the HR plugin used
		// to provide (approved→rejected is terminal; approve-after-cancel is the
		// race this closes), but it is now pure configuration data.
		if (info.statusMachine && userData[info.statusMachine.field] !== undefined) {
			const sm = info.statusMachine;
			const next = userData[sm.field];
			const current = (existing as Record<string, unknown>)[sm.field];
			const changed = String(next ?? '') !== String(current ?? '');
			if (changed) {
				const allowed = sm.transitions[String(current ?? '')] ?? [];
				if (!allowed.includes(String(next ?? ''))) {
					const curLabel = current != null && current !== '' ? `'${current}'` : 'unknown';
					throw new ValidationError(
						`မှတ်တမ်း အခြေအနေ '${curLabel}' မှ '${String(next ?? '')}' သို့ ပြောင်း၍မရပါ — ${Object.keys(sm.transitions).join(' / ')} စသည့် ခွင့်ပြုထားသော အကူးအပြောင်းများသာ ရှိပါသည်`,
						undefined,
						sm.field,
					);
				}
			}
		}

		let mergedMeta: Record<string, unknown> = {};
		if (existing._meta && typeof existing._meta === 'string') {
			try {
				mergedMeta = JSON.parse(existing._meta);
			} catch {
				console.warn(`[updateItem] _meta JSON parse failed for ${collectionSlug}/${id}, resetting`);
			}
		}
		Object.assign(mergedMeta, meta);

		// v0.7: Encrypt fields marked encrypted=true before update
		const encryptedColumns = await this.encryptColumns(columns, schemaFields);

		const updateData: Record<string, unknown> = {
			...encryptedColumns,
			_meta: JSON.stringify(mergedMeta),
			updated_at: new Date().toISOString(),
		};
		if (newStatus) updateData.doc_status = newStatus;
		// Track updated_by if auth context available
		const auth = this.getAuth();
		if (auth?.user_id && systemFieldOptions.updated_by) {
			updateData.updated_by = auth.user_id;
		}

		const stmt = QueryBuilder.from(tableName).where('id', id).toUpdate(updateData);
		// Atomic: the item update and any M2M junction replace commit in ONE D1 batch,
		// so a junction failure can never leave the parent updated with stale links.
		const junctionStmts = await this.cascade.buildM2MStatements(tableName, userData, schemaFields, id, 'update');
		const batchResults = await this.db.batch([stmt, ...junctionStmts]);
		// Rows-affected from the first (UPDATE) statement — avoids a redundant re-read
		// of the row we already fetched as `existing`.
		const changes = (batchResults[0]?.meta as { changes?: number } | undefined)?.changes ?? 0;
		if (changes === 0) throw new NotFoundError('Item', id);
		const raw = { ...existing, ...updateData }; // post-update state without a second SELECT
		const item = mergeRowData(raw);

		// Child-table records (table type) — delete + recreate the child set
		// atomically so the parent's children always mirror the payload.
		if (Object.keys(childData).length > 0) {
			const childMap = await childService.getChildMap(schemaFields);
			await childService.replaceChildren(id, childData, childMap);
			// Stored formulas referencing child-table children — recompute now that
			// the children were replaced and persist (engine-owned columns only).
			const computed2 = await this.computeStoredFormulas(
				collectionSlug,
				schemaFields,
				{ ...(existing as Record<string, unknown>), ...userData },
				tableName,
				id,
			);
			if (Object.keys(computed2).length > 0) {
				await this.db.run(QueryBuilder.from(tableName).where('id', id).toUpdate(computed2));
				Object.assign(item, computed2);
			}
		}

		// Plugin hooks: on_change + after_update (fire-and-forget). The PRE-update row
		// rides along as `_existing` — the SAME sentinel `before_update` / `validate`
		// hooks already read — so an after_update hook can tell the document MOVED
		// (e.g. a child re-assigned to another parent) and repair the owner it LEFT,
		// not only the new one. A COPY is passed: `item` is the response body.
		const postUpdateHookDoc = { ...item, _existing: existing as Record<string, unknown> };
		pluginHookRegistry.dispatchFireAndForget(collectionSlug, 'on_change', postUpdateHookDoc, this.db, this.getAuth());
		pluginHookRegistry.dispatchFireAndForget(collectionSlug, 'after_update', postUpdateHookDoc, this.db, this.getAuth());
		// Marketplace plugins: on_change + after_update interceptor chains
		this.runMarketplaceChainAsync(collectionSlug, 'on_change', item, execCtx);
		this.runMarketplaceChainAsync(collectionSlug, 'after_update', item, execCtx);

		// Server functions: on_change + after_update
		try {
			await ServerFunctionService.executeHooks(this.db, 'on_change', collectionSlug, item, existing as Record<string, unknown>);
		} catch (err) {
			console.error('[server-functions] on_change failed:', err);
		}
		try {
			await ServerFunctionService.executeHooks(this.db, 'after_update', collectionSlug, item, existing as Record<string, unknown>);
		} catch (err) {
			console.error('[server-functions] after_update failed:', err);
		}

		// v0.7: Status lifecycle hooks handled by ServerFunctionService (declarative rules)

		// Audit log — only when the collection opts in (audit_enabled).
		const auditAction = newStatus === 'submitted' ? 'submit' : newStatus === 'approved' ? 'approve' : 'update';
		if (info.audit_enabled) {
			this.audit
				.log(
					execCtx ?? null,
					{
						collection_slug: collectionSlug,
						document_id: id,
						action: auditAction,
						user_id: auth?.user_id || null,
						changes: userData as Record<string, unknown>,
						snapshot_before: existing as Record<string, unknown>,
						snapshot_after: item as Record<string, unknown>,
					},
					info.snapshotMode,
				)
				.catch((err) => console.error('[audit] update log failed:', err));
			// Field-level lineage — only the fields that actually changed.
			const { FieldAuditService } = await import('@/lib/services/field-audit.service');
			new FieldAuditService(this.db)
				.logUpdate(collectionSlug, id, existing as Record<string, unknown>, item as Record<string, unknown>, auth)
				.catch((err) => console.error('[field-audit] update log failed:', err instanceof Error ? err.message : err));
		}

		// M2M junction updates are now part of the atomic batch above

		// Webhook: submit/approve fire special events. Payload redacted to the
		// caller's field restrictions (same rule as create — see M7).
		if (execCtx) {
			const payload = await this.redactToVisibleFields(item, collectionSlug, schemaFields);
			if (newStatus === 'submitted') await this.webhooks.fire(execCtx, collectionSlug, 'submit', payload);
			if (newStatus === 'approved') await this.webhooks.fire(execCtx, collectionSlug, 'approve', payload);
			await this.webhooks.fire(execCtx, collectionSlug, 'update', payload);
		}

		// Invalidate this collection's response cache so edited rows reflect immediately.
		invalidateCollectionReads(collectionSlug, id);
		// Cascade recalc — parents aggregating over this collection follow the update.
		await this.recalcAffectedParents(collectionSlug, id, tableName);
		// Maintain media ref registry (releases any R2 asset the row stopped using).
		if (ItemMutationService.schemaHasMediaFields(schemaFields) || extractMediaKeys(item).length > 0) {
			await this.maintainMediaRefs(collectionSlug, id, item);
		}
		return this.redactToVisibleFields(item, collectionSlug, schemaFields);
	}

	/** Memoized inbound RESTRICT index: parentSlug → [{childName, table, field}]. */
	private buildRestrictMap(all: EntitySchema[]): Map<string, { childName: string; table: string; field: string }[]> {
		const hit = this.restrictMapCache.get(all);
		if (hit) return hit;
		const map = new Map<string, { childName: string; table: string; field: string }[]>();
		for (const c of all) {
			let fields: FieldDefinition[] = [];
			try {
				fields = (JSON.parse(c.schema_json || '{}') as { fields?: FieldDefinition[] }).fields ?? [];
			} catch {
				continue;
			}
			for (const f of fields) {
				// RESTRICT only when EXPLICITLY declared — `true` cascades, absent is
				// legacy-permissive, `false` blocks the parent delete while children live.
				if (f.type !== 'm2o' || f.cascade_delete !== false || !f.related_collection) continue;
				if (f.related_collection === c.slug) continue; // self-reference guard
				const list = map.get(f.related_collection) ?? [];
				list.push({ childName: c.name, table: c.table_name, field: f.name });
				map.set(f.related_collection, list);
			}
		}
		this.restrictMapCache.set(all, map);
		return map;
	}

	/**
	 * RESTRICT guard for a delete — throws `ConflictError` (409) when any collection
	 * holds live rows whose m2o points at this one on a field that EXPLICITLY
	 * declares `cascade_delete: false`. Collections with no inbound RESTRICT field
	 * pay one map lookup and zero queries.
	 */
	private async assertNoRestrictiveReferences(collectionSlug: string, id: string): Promise<void> {
		const inbound = this.buildRestrictMap(await this.schema.getCollections()).get(collectionSlug);
		if (!inbound || inbound.length === 0) return;
		const blockers: string[] = [];
		for (const { childName, table, field } of inbound) {
			const row = await this.db.first<{ n: number }>({
				sql: `SELECT COUNT(*) AS n FROM "${table}" WHERE "${field}" = ?1 AND deleted_at IS NULL`,
				bindings: [id],
			});
			const n = Number(row?.n ?? 0);
			if (n > 0) blockers.push(`${n} record(s) in "${childName}"`);
		}
		if (blockers.length > 0) {
			throw new ConflictError(
				`Cannot delete this record — it is still referenced by ${blockers.join(', ')}. Remove or reassign those records first.`,
			);
		}
	}

	async softDeleteItem(
		collectionSlug: string,
		id: string,
		execCtx?: ExecutionCtx,
	): Promise<{ id: string; deleted_at: string; deleted_by?: string | null }> {
		const info = await this.schema.getCollection(collectionSlug);
		this.assertGenericWrite(collectionSlug, info, 'delete');
		const { table_name: tableName, systemFieldOptions } = info;
		assertValid(validators.uuid(id, 'id'));

		const existing = await this.db.first(QueryBuilder.from(tableName).select('*').where('id', id).toSelect());
		if (!existing) throw new NotFoundError('Item', id);
		this.assertNotFrozen(collectionSlug, info, existing as Record<string, unknown>);
		// Row-level RBAC on delete.
		await checkRowFilterAccess(this.db, this.getAuth(), collectionSlug, tableName, id);
		// Referential guard — an m2o that EXPLICITLY declares `cascade_delete: false`
		// is RESTRICT: refuse while live child rows still point here, so a delete never
		// silently orphans a reference. Runs BEFORE hooks (fail fast, cheap).
		await this.assertNoRestrictiveReferences(collectionSlug, id);

		// Server functions: before_delete — check before actually deleting
		const deleteResult = await ServerFunctionService.executeHooks(
			this.db,
			'before_delete',
			collectionSlug,
			existing as Record<string, unknown>,
		);
		if (deleteResult?.abort) {
			throw new ValidationError(deleteResult.error || 'Deletion blocked', deleteResult.message, deleteResult.field);
		}
		// Plugin hooks: before_delete — transform chain (abort semantics preserved)
		const phDelete = await pluginHookRegistry.dispatchTransform(
			collectionSlug,
			'before_delete',
			existing as Record<string, unknown>,
			this.db,
			this.getAuth(),
		);
		if (phDelete.abort) throw new ValidationError(phDelete.abort.error);
		// Marketplace plugins: before_delete interceptor chain
		await this.runMarketplaceChain(collectionSlug, 'before_delete', existing as Record<string, unknown>);

		const now = new Date().toISOString();
		const updateData: Record<string, unknown> = { deleted_at: now, updated_at: now };
		const auth = this.getAuth();
		if (auth?.user_id && systemFieldOptions.deleted_by) {
			updateData.deleted_by = auth.user_id;
		}
		const stmt = QueryBuilder.from(tableName).where('id', id).toUpdate(updateData);
		try {
			await this.db.run(stmt);
		} catch (fallbackErr) {
			// Fallback: if deleted_by column doesn't exist in legacy table, retry without it
			if (updateData.deleted_by) {
				delete updateData.deleted_by;
				const fallback = QueryBuilder.from(tableName).where('id', id).toUpdate(updateData);
				await this.db.run(fallback);
			} else {
				throw fallbackErr;
			}
		}

		// Audit log — only when the collection opts in (audit_enabled).
		if (info.audit_enabled) {
			this.audit
				.log(
					execCtx ?? null,
					{
						collection_slug: collectionSlug,
						document_id: id,
						action: 'delete',
						user_id: auth?.user_id || null,
						snapshot_before: existing as Record<string, unknown>,
					},
					info.snapshotMode,
				)
				.catch((err) => console.error('[audit] softDelete log failed:', err));
		}

		if (execCtx) await this.webhooks.fire(execCtx, collectionSlug, 'delete', { id });

		// Cascade: soft-delete child records referenced via cascade_delete m2o fields
		try {
			await this.cascade.cascadeDelete(collectionSlug, id, 'soft');
		} catch (err) {
			console.error(`[cascade] soft delete failed for ${collectionSlug}/${id}:`, err);
		}

		// Cascade recalc — soft-deleted children drop out of parents' SUM/COUNT.
		await this.recalcAffectedParents(collectionSlug, id, tableName);

		// Lifecycle: after_delete — the row just left every live read, so a
		// denormalized pointer ranked BY this collection (e.g. a parent's
		// "latest child" pointer) must be recomputed NOW. AWAITED, unlike the after_update
		// fire-and-forget above: a delete is the only signal that the pointer's
		// TARGET vanished, and dropping the recompute leaves it aimed at a trashed row
		// — which every reader resolves to null and shows as "no document", hiding a
		// live one (the licenses/insurances "some trucks show nothing" bug). The cost
		// is one extra UPDATE before the response; the hook swallows its own errors.
		await pluginHookRegistry.dispatchFireAndForget(
			collectionSlug,
			'after_delete',
			existing as Record<string, unknown>,
			this.db,
			this.getAuth(),
		);

		invalidateCollectionReads(collectionSlug, id);
		return { id, deleted_at: now, deleted_by: auth?.user_id ?? null };
	}

	async restoreItem(collectionSlug: string, id: string, execCtx?: ExecutionCtx): Promise<{ id: string; restored: boolean }> {
		const info = await this.schema.getCollection(collectionSlug);
		this.assertGenericWrite(collectionSlug, info, 'update');
		const { table_name: tableName } = info;
		assertValid(validators.uuid(id, 'id'));

		const existing = await this.db.first(QueryBuilder.from(tableName).select('*').where('id', id).toSelect());
		if (!existing) throw new NotFoundError('Item', id);
		if (!existing.deleted_at) throw new ValidationError('Item is not trashed');
		this.assertNotFrozen(collectionSlug, info, existing as Record<string, unknown>);
		// Row-level RBAC on restore.
		await checkRowFilterAccess(this.db, this.getAuth(), collectionSlug, tableName, id);

		const stmt = QueryBuilder.from(tableName).where('id', id).toUpdate({ deleted_at: null, updated_at: new Date().toISOString() });
		await this.db.run(stmt);
		// Audit log — only when the collection opts in (audit_enabled).
		if (info.audit_enabled) {
			this.audit
				.log(
					execCtx ?? null,
					{
						collection_slug: collectionSlug,
						document_id: id,
						action: 'restore',
						user_id: this.getAuth()?.user_id || null,
						snapshot_before: existing as Record<string, unknown>,
					},
					info.snapshotMode,
				)
				.catch((err) => console.error('[audit] restore log failed:', err));
		}
		// Webhook
		if (execCtx) await this.webhooks.fire(execCtx, collectionSlug, 'update', { id, restored: true });
		// Cascade recalc — restored children re-enter parents' aggregates.
		await this.recalcAffectedParents(collectionSlug, id, tableName);

		// Lifecycle: after_restore — the row is live again, so a denormalized pointer
		// ranked by this collection (a parent's "latest child" pointer) may now rank
		// it first again. Awaited for the same reason as after_delete (see softDeleteItem).
		await pluginHookRegistry.dispatchFireAndForget(
			collectionSlug,
			'after_restore',
			existing as Record<string, unknown>,
			this.db,
			this.getAuth(),
		);

		invalidateCollectionReads(collectionSlug, id);
		return { id, restored: true };
	}

	async hardDeleteItem(collectionSlug: string, id: string, execCtx?: ExecutionCtx): Promise<{ id: string; deleted: boolean }> {
		const info = await this.schema.getCollection(collectionSlug);
		this.assertGenericWrite(collectionSlug, info, 'delete');
		const { table_name: tableName } = info;
		assertValid(validators.uuid(id, 'id'));
		// Capture the full row BEFORE deletion — cascade recalcs need the linkage
		// (o2m FK / parent_id) after the row is gone.
		const existing = await this.db.first<Record<string, unknown>>(QueryBuilder.from(tableName).select('*').where('id', id).toSelect());
		if (!existing) throw new NotFoundError('Item', id);
		this.assertNotFrozen(collectionSlug, info, existing);
		await checkRowFilterAccess(this.db, this.getAuth(), collectionSlug, tableName, id);
		await this.db.run(QueryBuilder.from(tableName).where('id', id).toDelete());
		// Clean up M2M junction rows referencing this item (avoid orphaned links)
		await this.cascade.deleteM2MJunctions(collectionSlug, [id]);
		// Cascade: hard-delete child records referenced via cascade_delete m2o fields
		try {
			await this.cascade.cascadeDelete(collectionSlug, id, 'hard');
		} catch (err) {
			console.error(`[cascade] hard delete failed for ${collectionSlug}/${id}:`, err);
		}
		// Audit log — only when the collection opts in (audit_enabled).
		if (info.audit_enabled) {
			this.audit
				.log(
					execCtx ?? null,
					{
						collection_slug: collectionSlug,
						document_id: id,
						action: 'delete',
						user_id: this.getAuth()?.user_id || null,
						snapshot_before: existing as Record<string, unknown>,
					},
					info.snapshotMode,
				)
				.catch((err) => console.error('[audit] hardDelete log failed:', err));
		}
		if (execCtx) await this.webhooks.fire(execCtx, collectionSlug, 'delete', { id });
		// Cascade recalc — hard-deleted children drop out of parents' aggregates.
		await this.recalcAffectedParents(collectionSlug, id, tableName, existing as Record<string, unknown>);

		// Lifecycle: after_delete — same reason as softDeleteItem: a denormalized
		// pointer ranked by this collection must be recomputed now the row is gone
		// (and it must happen while we still hold the pre-delete row's parent link).
		await pluginHookRegistry.dispatchFireAndForget(
			collectionSlug,
			'after_delete',
			existing as Record<string, unknown>,
			this.db,
			this.getAuth(),
		);

		invalidateCollectionReads(collectionSlug, id);
		// Release the document's R2 media refs now its row is gone (best-effort).
		if (extractMediaKeys(existing).length > 0) {
			await this.maintainMediaRefs(collectionSlug, id, {});
		}
		return { id, deleted: true };
	}

	// ── Write-side validation + encryption ───────────────

	/**
	 * Field constraint validation.
	 *
	 * min/max/max_length are pure JS; unique checks are batched into ONE
	 * db.batch round-trip instead of one query per unique field in the payload
	 * (a write with k unique fields used to cost k sequential SELECTs). Each
	 * statement is identical to the old per-field query, so semantics are
	 * unchanged; results are evaluated in schema order so the first violating
	 * field still wins the error message.
	 */
	private async validateFieldConstraints(
		fields: FieldDefinition[],
		userData: Record<string, unknown>,
		tableName: string,
		excludeId?: string,
	): Promise<void> {
		// ── Pure-JS constraints (min / max / max_length) — no queries ──
		for (const field of fields) {
			const value = userData[field.name];
			if (value === undefined || value === null) continue;

			// min / max validation for number values
			if (typeof value === 'number') {
				if (field.min !== undefined && value < field.min) {
					throw new ValidationError(`"${field.name}" must be >= ${field.min}`, undefined, field.name);
				}
				if (field.max !== undefined && value > field.max) {
					throw new ValidationError(`"${field.name}" must be <= ${field.max}`, undefined, field.name);
				}
			}

			// max_length validation for string values
			if (typeof value === 'string' && field.max_length !== undefined) {
				if (value.length > field.max_length) {
					throw new ValidationError(`"${field.name}" exceeds maximum length of ${field.max_length}`, undefined, field.name);
				}
			}
		}

		// ── unique validation — ONE batched round-trip ──
		const uniqueFields = fields.filter((f) => f.unique && userData[f.name] !== undefined && userData[f.name] !== null);
		if (uniqueFields.length === 0) return;
		const stmts = uniqueFields.map((f) => {
			const qb = QueryBuilder.from(tableName).select('id').where(f.name, userData[f.name]).whereNull('deleted_at');
			if (excludeId) qb.where('id', '!=', excludeId);
			return qb.toSelect();
		});
		// D1 batches cap at 100 statements — chunk defensively for extreme schemas.
		for (let i = 0; i < stmts.length; i += 50) {
			const results = await this.db.batch<{ id: string }>(stmts.slice(i, i + 50));
			for (let j = 0; j < results.length; j++) {
				if ((results[j]?.results?.length ?? 0) > 0) {
					const field = uniqueFields[i + j];
					throw new ValidationError(
						`"${field.name}" must be unique. A record with value "${userData[field.name]}" already exists.`,
						undefined,
						field.name,
					);
				}
			}
		}
	}

	/** Fields marked encrypted=true in the schema */
	private encryptedFields(schemaFields: FieldDefinition[]): FieldDefinition[] {
		return schemaFields.filter((f) => (f as FieldDefinition & { encrypted?: boolean }).encrypted === true);
	}

	/**
	 * Redact a post-mutation row to only the fields the CALLER can read (their
	 * role's field_restrictions whitelist). Used for BOTH the caller-facing write
	 * response and webhook payloads: without it a create/update echoes back every
	 * column (and a receiver learns every column) — including ones the role is not
	 * allowed to see. Admins and unrestricted roles pass through unchanged; the
	 * returned object is a copy, so the audit snapshot keeps the full row.
	 */
	private async redactToVisibleFields(
		item: Record<string, unknown>,
		collectionSlug: string,
		schemaFields: FieldDefinition[],
	): Promise<Record<string, unknown>> {
		const auth = this.getAuth();
		// Field-level RBAC first (so a hidden encrypted column is never decrypted in
		// memory), then decrypt — the SAME order the read path uses. Without this the
		// write response (and the webhook payload derived from it) echoed back the raw
		// `v1:iv:ct` ciphertext for `encrypted` fields while a read returned plaintext:
		// a client POSTing a secret got garbage back.
		const visible =
			!auth || auth.is_admin
				? item
				: await DataFilterService.applyFieldFilterToItem(
						item,
						{ db: this.db, auth, collectionSlug },
						schemaFields.map((f) => f.name),
					);
		return this.decryptVisibleFields(visible, schemaFields);
	}

	/** Decrypt the `encrypted` fields present on a write response (copy, never fails the write). */
	private async decryptVisibleFields(item: Record<string, unknown>, schemaFields: FieldDefinition[]): Promise<Record<string, unknown>> {
		const encFields = this.encryptedFields(schemaFields).filter((f) => typeof item[f.name] === 'string' && item[f.name] !== '');
		if (encFields.length === 0) return item;
		try {
			const { FieldEncryption } = await import('@/lib/services/field-encryption.service');
			const out = { ...item };
			for (const f of encFields) out[f.name] = await FieldEncryption.decrypt(out[f.name] as string);
			return out;
		} catch {
			return item; // a decrypt failure must not fail an otherwise-successful write
		}
	}

	/**
	 * Recompute STORED formula fields (store: true) into a fresh object.
	 *
	 * - Dependency order: a stored formula referencing another stored formula
	 *   (e.g. `grand_total = total * 1.1`) computes AFTER its dependency.
	 * - Lookups: o2m/m2m/table children + m2o targets are fetched from the DB
	 *   (single record) and attached to the evaluator scope. For child-table
	 *   payloads in the SAME request, callers run a second pass AFTER the
	 *   children are written (see createItem/updateItem pass 2).
	 * - Never throws on evaluation errors: a failing formula persists null
	 *   (virtual formulas behave the same on read).
	 */
	private async computeStoredFormulas(
		collectionSlug: string,
		schemaFields: FieldDefinition[],
		rowScope: Record<string, unknown>,
		tableName: string,
		id: string | null,
	): Promise<Record<string, unknown>> {
		const stored = schemaFields.filter((f) => f.type === 'formula' && f.store && f.formula);
		if (stored.length === 0) return {};
		const ordered = topoSortStoredFormulas(stored);
		if (ordered.length === 0) return {};
		const lookupService = new ComputedFieldService(this.db, await this.schema.getCollections());
		const scope: Record<string, unknown> = { ...rowScope };
		const out: Record<string, unknown> = {};
		for (const f of ordered) {
			Object.assign(scope, out); // earlier computed values visible to later formulas
			await lookupService.attachLookupScope(scope, f.formula as string, schemaFields, tableName, id);
			try {
				out[f.name] = coerceComputedValue(evaluateExpression(f.formula as string, scope), formulaResultType(f), {
					precision: f.precision,
					rounding: f.rounding,
				});
			} catch {
				out[f.name] = null;
			}
		}
		return out;
	}

	/**
	 * Formula write-back (the Odoo `inverse` equivalent): when the payload
	 * includes a formula field that declares `inverse_formula`/`inverse_target`,
	 * derive the source field BEFORE validation — so a client can send
	 * `{ rate, total }` and the engine computes `qty = total / rate` (the
	 * computed field is the authority when both are supplied). Runs before
	 * required-field checks so the derived source satisfies NOT NULL.
	 */
	private async applyInverseFormulas(
		schemaFields: FieldDefinition[],
		userData: Record<string, unknown>,
		existing?: Record<string, unknown> | null,
	): Promise<void> {
		for (const f of schemaFields) {
			if (f.type !== 'formula' || !f.inverse_formula || !f.inverse_target) continue;
			if (!(f.name in userData) || userData[f.name] === null || userData[f.name] === undefined) continue;
			const targetField = schemaFields.find((x) => x.name === f.inverse_target);
			if (!targetField) continue;
			const scope: Record<string, unknown> = { ...(existing ?? {}), ...userData };
			try {
				const v = evaluateExpression(f.inverse_formula, scope);
				userData[f.inverse_target] = coerceValue(v, targetField.type);
			} catch {
				// A failing inverse leaves the source untouched — the normal formula
				// recompute still runs and overwrites the computed field with the
				// source-derived value.
			}
		}
	}

	/**
	 * Cascade recalc — the Odoo `depends` equivalent.
	 *
	 * After a write to THIS collection, find every parent collection whose
	 * STORED formula aggregates over this collection (o2m / m2m / child-table /
	 * m2o relations) and recompute + persist the affected parent rows — so
	 * `SUM(children.amount)` stays correct when a child is created / updated /
	 * soft-deleted / restored / hard-deleted directly, without touching the
	 * parent. Engine writes only (stored columns; no hooks/audit/webhooks — same
	 * semantics as the pass-2 recompute). No recursion: the parent write only
	 * touches stored columns, so it never re-enters here.
	 */
	private async recalcAffectedParents(
		collectionSlug: string,
		childId: string,
		childTableName: string,
		/** Pre-delete child row (hard delete) — the row is gone before the recalc runs. */
		childRow?: Record<string, unknown> | null,
	): Promise<void> {
		const allCollections = await this.schema.getCollections();
		for (const parent of allCollections) {
			let parentInfo;
			try {
				parentInfo = await this.schema.getCollection(parent.slug);
			} catch {
				continue;
			}
			const parentFields = parentInfo.schemaFields;
			const stored = parentFields.filter((f) => f.type === 'formula' && f.store && f.formula);
			if (stored.length === 0) continue;
			// Relations the stored formulas aggregate over — keep only ones linking to THIS collection.
			const refs = new Map<string, FieldDefinition>();
			for (const f of stored) for (const [name, def] of extractLookupRefs(f.formula as string, parentFields)) refs.set(name, def);
			const linked = [...refs.values()].filter((def) => def.related_collection === collectionSlug);
			if (linked.length === 0) continue;

			// Find the parent rows affected by this child write.
			const parentIds = new Set<string>();
			for (const def of linked) {
				if (def.type === 'o2m' && def.foreign_key) {
					// The child row carries the parent FK (WHERE foreign_key = parent.id).
					// On hard delete the row is gone — the pre-delete snapshot covers it.
					let pid = childRow?.[def.foreign_key];
					if (typeof pid !== 'string' || pid.length === 0) {
						const row = await this.db.first<Record<string, unknown>>(
							QueryBuilder.from(childTableName).select(def.foreign_key).where('id', childId).toSelect(),
						);
						pid = row?.[def.foreign_key];
					}
					if (typeof pid === 'string' && pid.length > 0) parentIds.add(pid);
				} else if (def.type === 'm2m') {
					const jt = `_jt_${parent.table_name}_${childTableName}`;
					const rows = await this.db.all<{ source_id: string }>(
						QueryBuilder.from(jt).select('source_id').where('target_id', childId).toSelect(),
					);
					for (const r of rows) if (r.source_id) parentIds.add(r.source_id);
				} else if (def.type === 'table') {
					let parentId: string | undefined = typeof childRow?.parent_id === 'string' ? childRow.parent_id : undefined;
					if (!parentId) {
						const row = await this.db.first<{ parent_id: string }>(
							QueryBuilder.from(childTableName).select('parent_id').where('id', childId).toSelect(),
						);
						parentId = row?.parent_id;
					}
					if (parentId) parentIds.add(parentId);
				} else if (def.type === 'm2o') {
					// The FK lives on the parent row (WHERE field = child.id).
					const rows = await this.db.all<{ id: string }>(
						QueryBuilder.from(parent.table_name).select('id').where(def.name, childId).toSelect(),
					);
					for (const r of rows) parentIds.add(r.id);
				}
			}
			if (parentIds.size === 0) continue;

			for (const pid of parentIds) {
				const parentRow = await this.db.first<Record<string, unknown>>(
					QueryBuilder.from(parent.table_name).select('*').where('id', pid).toSelect(),
				);
				if (!parentRow) continue;
				const computed = await this.computeStoredFormulas(parent.slug, parentFields, parentRow, parent.table_name, pid);
				if (Object.keys(computed).length > 0) {
					await this.db.run(QueryBuilder.from(parent.table_name).where('id', pid).toUpdate(computed));
					invalidateCollectionReads(parent.slug, pid);
				}
			}
		}
	}

	// ── Marketplace interceptor chain (Phase 3) ─────────────

	/**
	 * Thread the document through active marketplace plugins for this event.
	 * Lazy import keeps the core pipeline free of plugin dependencies; a
	 * failing chain never blocks the write (logged, doc unchanged).
	 */
	private async runMarketplaceChain(collectionSlug: string, event: string, doc: Record<string, unknown>): Promise<Record<string, unknown>> {
		try {
			const { runForEvent } = await import('@/plugins/marketplace/chain');
			return await runForEvent(collectionSlug, event, doc, this.db, this.getAuth());
		} catch (err) {
			// Fail-closed plugins throw ValidationError (manifest.on_error='abort') —
			// that must propagate so the write is rejected. Everything else is a
			// broken-plugin failure: log and continue with the doc unchanged.
			if (err instanceof ValidationError) throw err;
			console.error('[marketplace] chain failed:', err instanceof Error ? err.message : err);
			return doc;
		}
	}

	/**
	 * Run enabled decision tables for the collection against the doc. Rule aborts
	 * (ValidationError) propagate — a business rule can reject a write; broken
	 * rule infrastructure is logged and skipped (doc unchanged).
	 *
	 * On UPDATE (existing provided) the FULL merged doc is evaluated so rules see
	 * fields outside the payload (e.g. a rule keyed on customer_grade while the
	 * user only changed amount); the returned object is the delta vs existing.
	 */
	private async runDecisionTables(
		collectionSlug: string,
		doc: Record<string, unknown>,
		documentId?: string,
		existing?: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		try {
			const { DecisionTableService } = await import('@/plugins/decision-table/service');
			const svc = new DecisionTableService(this.db);
			if (!existing) {
				const result = await svc.evaluateFor(collectionSlug, doc, this.getAuth(), documentId);
				return result.doc;
			}
			const merged = { ...existing, ...doc };
			const result = await svc.evaluateFor(collectionSlug, merged, this.getAuth(), documentId);
			const delta: Record<string, unknown> = {};
			for (const [field, value] of Object.entries(result.doc)) {
				if (field.startsWith('_')) continue; // _existing / _transition meta
				if (JSON.stringify(existing[field]) !== JSON.stringify(value)) delta[field] = value;
			}
			return delta;
		} catch (err) {
			if (err instanceof ValidationError) throw err;
			console.error('[decision-table] evaluation failed:', err instanceof Error ? err.message : err);
			return doc;
		}
	}

	/** Fire-and-forget variant — waits on execCtx when available, else best-effort. */
	private runMarketplaceChainAsync(collectionSlug: string, event: string, doc: Record<string, unknown>, execCtx?: ExecutionCtx): void {
		const p = this.runMarketplaceChain(collectionSlug, event, doc);
		if (execCtx?.executionCtx?.waitUntil) {
			execCtx.executionCtx.waitUntil(p);
		} else {
			void p;
		}
	}

	/** Encrypt encrypted fields before write. FAILS CLOSED: if a field is marked
	 *  `encrypted` but the key is unavailable, the write is REFUSED rather than
	 *  silently persisted as plaintext (the same rule the nightly backup follows). */
	private async encryptColumns(columns: Record<string, unknown>, schemaFields: FieldDefinition[]): Promise<Record<string, unknown>> {
		const encFields = this.encryptedFields(schemaFields);
		if (encFields.length === 0) return columns;
		try {
			const { FieldEncryption } = await import('@/lib/services/field-encryption.service');
			return await FieldEncryption.encryptFields(columns, encFields);
		} catch {
			// Deny-by-default: never store plaintext for a field declared encrypted at
			// rest. A missing/rotated ENCRYPTION_KEY is an operator error — refuse the
			// write loudly instead of leaking PII into the table.
			console.error(
				'[encryption] REFUSED write: ENCRYPTION_KEY missing/invalid but the collection has `encrypted` fields. Set ENCRYPTION_KEY (64 hex chars) to enable field encryption.',
			);
			throw new Error(
				`Cannot write encrypted field(s) [${encFields.map((f) => f.name).join(', ')}]: field encryption is not configured (set ENCRYPTION_KEY).`,
			);
		}
	}
}

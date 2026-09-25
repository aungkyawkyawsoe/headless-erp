/**
 * IDP Service — the Internal Developer Platform's read/aggregate surface.
 *
 * Speaks only the generic engine API (`@mmbix/core` QueryBuilder + D1Client),
 * never the factory's business routes. The factory core never imports this.
 *
 * The catalog is the IDP's headline: a read-only view over `_modules` (the
 * SYSTEM table — the software being built) joined with `idp_ownership` and
 * `idp_deployment` (IDP entity collections). Because the source of truth is
 * the live `_modules` table, catalog entries are LIVE, not synced metadata —
 * the core advantage over Backstage/Cortex/Port.
 */

import { D1Client, QueryBuilder, invalidateCollectionReads } from '@mmbix/core';
import { collectionTable } from '@/lib/utils/table-name';
import { findCollectionRows } from '@/lib/services/schema-lookup';
import { SchemaService } from '@/lib/services/collection-schema.service';
import { IDP_COLLECTIONS } from './collections';
import { APP_VERSION } from '@mmbix/config';
import type { AuthContext, EntitySchema, SchemaSnapshot, RoleRecord, RolePermissionRecord, WebhookRecord } from '@mmbix/types';

/**
 * An IDP failure with the HTTP status it should surface as. Routes map it with
 * `idpFail` so a missing deployment is a 404 and a blocked migration a 409 —
 * instead of every service error collapsing into a 500.
 */
export class IdpError extends Error {
	constructor(
		message: string,
		readonly status: number = 400,
	) {
		super(message);
		this.name = 'IdpError';
	}
}

/** Minimal workflow-row surface the IDP needs (avoids a hard plugin import). */
interface WorkflowRowLike {
	id: string;
	version: number;
	enabled: number;
	definition: {
		name: string;
		collection: string;
		initial: string;
		states: string[];
		transitions: Array<{ id: string; from: string; to: string }>;
	};
}

export interface CatalogEnvironment {
	environment_id: string;
	environment: string;
	kind: string | null;
	status: string | null;
	version: string | null;
	deployed_at: string | null;
}

export interface CatalogEntry {
	id: string;
	name: string;
	slug: string;
	version: string;
	is_active: number;
	icon: string | null;
	icon_color: string | null;
	bg_color: string | null;
	owner: string | null;
	owner_role: string | null;
	environments: CatalogEnvironment[];
}

/**
 * Policy-as-data: the declarative rules the governance scorecard evaluates.
 * Adding a rule is one entry here + one branch in `policies()` — the shape a
 * real policy engine would load from a table; kept as a typed constant because
 * the factory ships a fixed, auditable baseline (a caller-supplied ruleset would
 * be an unvalidated expression surface).
 */
export interface IdpPolicyRule {
	id: string;
	label: string;
	description: string;
}

export const IDP_POLICY_RULES: IdpPolicyRule[] = [
	{ id: 'has_owner', label: 'Owned', description: 'The module has at least one owner' },
	{ id: 'live_deployment', label: 'Live', description: 'The module has a live deployment' },
	{ id: 'multi_env', label: 'Multi-environment', description: 'The module is live in two or more environments' },
	{ id: 'release_record', label: 'Release record', description: 'A live deployment captured a manifest (data lineage)' },
	{ id: 'golden_path', label: 'Golden path', description: 'The module was scaffolded from a golden-path template' },
];

export class IdpService {
	constructor(private db: D1Client) {}

	/**
	 * Provision the IDP collections if they don't exist yet (idempotent).
	 *
	 * Memoized per isolate: the four `idp_*` tables are checked ONCE per isolate
	 * (the promise is shared so two concurrent first requests can't both run DDL;
	 * a failure clears it so the next request retries). Every IDP route goes
	 * through this — reads and writes alike — because the first writer (create
	 * environment / deployment / ownership) would otherwise hit a missing table.
	 */
	private static _ensure: Promise<string[]> | null = null;

	async ensureCollections(): Promise<string[]> {
		IdpService._ensure ??= this._provisionCollections().catch((err) => {
			IdpService._ensure = null;
			throw err;
		});
		return IdpService._ensure;
	}

	private async _provisionCollections(): Promise<string[]> {
		const created: string[] = [];
		for (const def of IDP_COLLECTIONS) {
			const existing = await this.db.first<{ id: string }>(
				QueryBuilder.from('_entity_schemas').select('id').where('slug', def.slug).toSelect(),
			);
			if (existing) {
				// The table exists — reconcile any field added to the definition
				// AFTER this install was created. `CREATE TABLE IF NOT EXISTS` in
				// `createCollectionRecord` can only build the initial shape, so a
				// new declared field (e.g. `idp_audit`) would otherwise be missing
				// on an existing DB and every write to it would 500. Idempotent and
				// additive: columns are added nullable (SQLite cannot ADD a NOT NULL
				// column to a table with rows), never dropped or retyped.
				await this.reconcileColumns(def);
				continue;
			}
			// Create the collection row + table directly (mirrors what the
			// schema designer's POST /api/collections does, minus the HTTP layer).
			await this.createCollectionRecord(def);
			created.push(def.slug);
		}
		// Raw DDL above bypassed `SchemaService`, so the cached collection list
		// would otherwise not know these tables exist (a later read would 500).
		if (created.length > 0) SchemaService.invalidateCache();
		return created;
	}

	/**
	 * Add any declared field that is missing from an already-existing table.
	 * Reads the real columns via `PRAGMA table_info` (a table may legitimately
	 * carry extra columns a future definition dropped); only ADDs. Memoized by
	 * the caller's per-isolate `ensureCollections`, so this costs one PRAGMA per
	 * collection per isolate.
	 */
	private async reconcileColumns(def: { slug: string; fields: Array<{ name: string; type: string }> }): Promise<void> {
		const tableName = collectionTable(def.slug);
		const have = new Set(
			(await this.db.all<{ name: string }>({ sql: `PRAGMA table_info("${tableName}")`, bindings: [] })).map((c) => c.name),
		);
		for (const f of def.fields) {
			if (have.has(f.name)) continue;
			// db.exec() splits statements on newlines — DDL must be single-line.
			await this.db.exec(`ALTER TABLE "${tableName}" ADD COLUMN ${f.name} ${fieldSqlType(f.type)};`);
		}
	}

	/**
	 * The catalog — every active module with its owner and per-environment
	 * deployments, assembled from `_modules` + `idp_ownership` + `idp_deployment`
	 * in three queries (one round of latency, no N+1).
	 */
	async catalog(): Promise<CatalogEntry[]> {
		const modules = await this.db.all<{
			id: string;
			name: string;
			slug: string;
			version: string;
			is_active: number;
			icon: string | null;
			icon_color: string | null;
			bg_color: string | null;
		}>(
			QueryBuilder.from('_modules')
				.select('id', 'name', 'slug', 'version', 'is_active', 'icon', 'icon_color', 'bg_color')
				.orderBy('name', 'asc')
				.toSelect(),
		);

		const ownership = await this.db.all<{
			module_id: string;
			owner_id: string;
			role: string | null;
		}>(QueryBuilder.from(collectionTable('idp_ownership')).select('module_id', 'owner_id', 'role').toSelect());

		const depTable = collectionTable('idp_deployment');
		const envTable = collectionTable('idp_environment');
		// ORDER BY `deployed_at` alone leaves two deployments that landed in the same
		// second (a retry, a double promote) in SQLite's arbitrary row order, so the
		// catalog's per-environment list could reshuffle between two identical reads.
		// The PK breaks the tie identically for every caller and isolate.
		const deployments = await this.db.all<{
			module_id: string;
			environment_id: string;
			version: string | null;
			status: string | null;
			deployed_at: string | null;
			environment_name: string;
			environment_kind: string | null;
		}>({
			sql: `SELECT d.module_id, d.environment_id, d.version, d.status, d.deployed_at,
					e.name AS environment_name, e.kind AS environment_kind
				FROM "${depTable}" d
				LEFT JOIN "${envTable}" e ON e.id = d.environment_id
				WHERE d.deleted_at IS NULL
				ORDER BY d.deployed_at DESC, d.id DESC`,
			bindings: [],
		});

		const ownerByModule = new Map<string, { owner_id: string; role: string | null }>();
		for (const o of ownership) {
			// Prefer the highest-privilege role (owner > maintainer > viewer).
			const existing = ownerByModule.get(o.module_id);
			if (!existing || roleRank(o.role) < roleRank(existing.role)) ownerByModule.set(o.module_id, o);
		}

		const envsByModule = new Map<string, CatalogEnvironment[]>();
		for (const d of deployments) {
			const list = envsByModule.get(d.module_id) ?? [];
			list.push({
				environment_id: d.environment_id,
				environment: d.environment_name,
				kind: d.environment_kind,
				status: d.status,
				version: d.version,
				deployed_at: d.deployed_at,
			});
			envsByModule.set(d.module_id, list);
		}

		return modules.map((m) => {
			const owner = ownerByModule.get(m.id);
			return {
				id: m.id,
				name: m.name,
				slug: m.slug,
				version: m.version,
				is_active: m.is_active,
				icon: m.icon,
				icon_color: m.icon_color,
				bg_color: m.bg_color,
				owner: owner?.owner_id ?? null,
				owner_role: owner?.role ?? null,
				environments: envsByModule.get(m.id) ?? [],
			};
		});
	}

	// ─── Phase 3: Operate wiring ───────────────────────────

	/**
	 * Idempotently ensure the deployment workflow exists (one per collection).
	 * A declarative state machine: draft → review → promoted → live, with
	 * rollback. Guards/roles are enforced by the workflow engine (workerd-safe).
	 */
	async ensureWorkflow(): Promise<WorkflowRowLike> {
		const { WorkflowService } = await import('@/plugins/workflow/service');
		const svc = new WorkflowService(this.db);
		const existing = await svc.getByCollection('idp_deployment');
		if (existing) return existing;
		const def = {
			name: 'Deployment Promotion',
			description: 'Governed promotion of a module to an environment.',
			collection: 'idp_deployment',
			initial: 'draft',
			states: ['draft', 'review', 'promoted', 'live', 'rolled_back'],
			transitions: [
				{ id: 'submit', from: 'draft', to: 'review' },
				{ id: 'approve', from: 'review', to: 'promoted' },
				{ id: 'deploy', from: 'promoted', to: 'live' },
				{ id: 'reject', from: 'review', to: 'rolled_back' },
				{ id: 'rollback', from: 'live', to: 'rolled_back' },
			],
			enabled: true,
		};
		const saved = await svc.upsert(def);
		return (await svc.get(saved.id))!;
	}

	/**
	 * Advance a deployment one step through the promotion chain
	 * (draft → review → promoted → live). Deterministic + idempotent: at a
	 * terminal state (live / rolled_back) it is a no-op. On reaching `live` it
	 * captures the module manifest (data lineage) and fires a durable event.
	 */
	async promote(deploymentId: string, auth: AuthContext | null): Promise<Record<string, unknown>> {
		// 404 (not a generic workflow error) when the deployment doesn't exist.
		const dep = await this.getDeployment(deploymentId);
		const workflow = await this.ensureWorkflow();
		const { WorkflowService } = await import('@/plugins/workflow/service');
		const { WorkflowEngine } = await import('@/plugins/workflow/engine');
		const wsvc = new WorkflowService(this.db);
		const engine = new WorkflowEngine(this.db, wsvc);

		const current = (await wsvc.getState('idp_deployment', deploymentId)) ?? workflow.definition.initial;
		const next = { draft: 'review', review: 'promoted', promoted: 'live' }[current];
		if (!next) {
			// Already at a terminal state — idempotent no-op.
			return { deployment_id: deploymentId, state: current, terminal: true };
		}

		// Data lineage, captured BEFORE the transition: the manifest is derived from
		// the module's collections, never from this deployment's state, so the moment
		// is equivalent — but it means a corrupt schema fails the request while the
		// workflow still reads `promoted`, instead of after `_workflow_states` has
		// already moved to `live` (which would leave the two out of step).
		const manifest = next === 'live' ? await this.moduleManifest(dep.module_id) : null;

		const result = await engine.transition(workflow, 'idp_deployment', deploymentId, next, auth, { comment: 'Promote' });

		// The workflow engine tracks state in `_workflow_states`; mirror it onto the
		// collection's denormalized `status` so the catalog + scorecard (which read
		// `idp_deployment.status`) can never drift from the workflow. On `live` the
		// same write carries the captured manifest and a durable event follows.
		//
		// Not atomic, deliberately stated: the engine's commit is its own side-table
		// write + history append (a plugin service call, not plain SQL), so it cannot
		// join a `db.batch` with the mirror. The mirror is therefore the VERY NEXT
		// statement (nothing between them) and a failure is loud — see
		// `writeDeploymentStatus` — because a silently missing mirror is a catalog
		// that reports a state the workflow does not have.
		await this.writeDeploymentStatus(deploymentId, next, manifest ? { manifest_json: JSON.stringify(manifest) } : {});
		if (manifest) await this.notifyDeployed(dep, manifest, auth);
		await this.recordAudit('deployment.promote', 'idp_deployment', deploymentId, auth, { from: result.from, to: next });

		return { deployment_id: deploymentId, from: result.from, to: result.to, state: next };
	}

	/**
	 * The ONE writer of `idp_deployment.status` (plus its provenance columns).
	 * The workflow side table (`_workflow_states`) is the single source of truth;
	 * this mirrors it onto the denormalized column the catalog + scorecard read.
	 * Every caller must have ALREADY moved the workflow — see `commitDeploymentState`
	 * when it has not.
	 */
	private async writeDeploymentStatus(deploymentId: string, state: string, extra: Record<string, unknown> = {}): Promise<void> {
		try {
			await this.db.run(
				QueryBuilder.from(collectionTable('idp_deployment'))
					.where('id', deploymentId)
					.toUpdate({
						...extra,
						status: state,
						updated_at: new Date().toISOString(),
					}),
			);
		} catch (err) {
			// The workflow has already moved, so a failure here is a live drift between
			// `_workflow_states` and the column the catalog reads — never swallow it.
			console.error(
				`[idp] status write failed — _workflow_states=${state} for deployment ${deploymentId} is not reflected in idp_deployment.status:`,
				err instanceof Error ? err.message : err,
			);
			throw err;
		}
		// Raw write → clear this collection's response cache so the new status is
		// visible on the very next read (the engine's own writes do this for us).
		invalidateCollectionReads('idp_deployment', deploymentId);
	}

	/**
	 * Move a deployment to `toState` through the workflow side table (optimistic
	 * lock + append-only history) AND mirror it onto `status` — in ONE place.
	 *
	 * The GitOps `apply`/`rollback` paths set `status = 'live'` directly before
	 * this existed, which moved the column but NOT `_workflow_states`: a
	 * deployment could read `status='live'` while its workflow still said
	 * `draft` (the dual-writer drift). Now the only way to reach a state is here,
	 * so the two can never disagree.
	 */
	private async commitDeploymentState(
		deploymentId: string,
		toState: string,
		auth: AuthContext | null,
		extra: Record<string, unknown> = {},
		comment = 'Deploy',
	): Promise<void> {
		const workflow = await this.ensureWorkflow();
		const { WorkflowService } = await import('@/plugins/workflow/service');
		const wsvc = new WorkflowService(this.db);
		const current = (await wsvc.getState('idp_deployment', deploymentId)) ?? workflow.definition.initial;
		if (current !== toState) {
			// Optimistic lock — a concurrent transition already past `current` is a
			// 409, never a silent overwrite of someone else's move.
			const committed = await wsvc.transitionState('idp_deployment', deploymentId, current, toState);
			if (!committed) {
				throw new IdpError(`Deployment already left state "${current}" (concurrent change) — reload and retry`, 409);
			}
			await wsvc.logHistory({
				workflow_id: workflow.id,
				collection_slug: 'idp_deployment',
				document_id: deploymentId,
				from_state: current,
				to_state: toState,
				by_user: auth?.user_id ?? null,
				by_email: auth?.email ?? null,
				comment,
			});
		}
		await this.writeDeploymentStatus(deploymentId, toState, extra);
	}

	/** Generic workflow transition on a deployment (submit/approve/reject/rollback). */
	async transition(deploymentId: string, toState: string, auth: AuthContext | null): Promise<Record<string, unknown>> {
		// 404 when the deployment doesn't exist, before touching the workflow.
		await this.getDeployment(deploymentId);
		const workflow = await this.ensureWorkflow();
		const { WorkflowService } = await import('@/plugins/workflow/service');
		const { WorkflowEngine } = await import('@/plugins/workflow/engine');
		const wsvc = new WorkflowService(this.db);
		const engine = new WorkflowEngine(this.db, wsvc);
		const result = await engine.transition(workflow, 'idp_deployment', deploymentId, toState, auth, { comment: 'Transition' });
		// Keep the denormalized status column in lock-step with the workflow state —
		// the same shared writer (and drift log) `promote` uses.
		await this.writeDeploymentStatus(deploymentId, toState);
		await this.recordAudit('deployment.transition', 'idp_deployment', deploymentId, auth, { from: result.from, to: toState });
		return { deployment_id: deploymentId, from: result.from, to: result.to };
	}

	/** Audit trail for a deployment (append-only workflow history). */
	async deploymentHistory(deploymentId: string): Promise<unknown[]> {
		const { WorkflowService } = await import('@/plugins/workflow/service');
		const wsvc = new WorkflowService(this.db);
		return wsvc.getHistory('idp_deployment', deploymentId);
	}

	/** The exact module manifest (collections + fields) at a point in time — data lineage. */
	async moduleManifest(moduleId: string): Promise<Record<string, unknown>> {
		const mod = await this.db.first<{ id: string; name: string; slug: string; version: string }>(
			QueryBuilder.from('_modules').select('id', 'name', 'slug', 'version').where('id', moduleId).toSelect(),
		);
		if (!mod) throw new Error('Module not found');
		const { ModuleService } = await import('@/lib/services/module.service');
		const moduleSvc = new ModuleService(this.db);
		const collections = await moduleSvc.getModuleCollections(mod.slug);
		// ONE batched, cached read for every collection in the module (was one
		// uncached `SELECT schema_json` per collection).
		const rows = await findCollectionRows(
			this.db,
			collections.map((c) => c.slug),
		);
		const schemas = collections.map((c) => {
			const raw = rows.get(c.slug)?.schema_json;
			let fields: Array<{ name: string; type: string }> | null = null;
			if (raw !== undefined) {
				try {
					// `schema_json` is stored as `{ "fields": [...] }` by the designer, but
					// the snapshot paths also accept a BARE array — read both, exactly like
					// `cleanSchemaJson` / `parseFields` do.
					const parsed: unknown = JSON.parse(raw);
					const list = Array.isArray(parsed) ? parsed : (parsed as { fields?: unknown } | null)?.fields;
					if (Array.isArray(list)) {
						fields = (list as Array<{ name: string; type: string }>).map((f) => ({ name: f.name, type: f.type }));
					}
				} catch {
					/* fall through to the explicit failure below */
				}
			}
			// A missing, unparseable or field-less schema must NOT become an empty
			// manifest: the manifest is the release's single version of the truth
			// (`manifest_json`), so a fabricated "collection with no fields" is
			// indistinguishable from a real one and silently wrong forever. Fail loudly.
			if (!fields) {
				throw new IdpError(
					`Collection "${c.slug}" has a missing or malformed schema_json — cannot capture a manifest for module "${mod.slug}"`,
					500,
				);
			}
			return { slug: c.slug, name: c.name, fields };
		});
		return {
			module: { id: mod.id, name: mod.name, slug: mod.slug, version: mod.version },
			collections: schemas,
			captured_at: new Date().toISOString(),
		};
	}

	private async getDeployment(id: string): Promise<{
		id: string;
		module_id: string;
		environment_id: string;
		version: string | null;
		git_ref: string | null;
		snapshot_json: string | null;
	}> {
		const row = await this.db.first<{
			id: string;
			module_id: string;
			environment_id: string;
			version: string | null;
			git_ref: string | null;
			snapshot_json: string | null;
		}>(
			QueryBuilder.from(collectionTable('idp_deployment'))
				.select('id', 'module_id', 'environment_id', 'version', 'git_ref', 'snapshot_json')
				.where('id', id)
				.toSelect(),
		);
		if (!row) throw new IdpError('Deployment not found', 404);
		return row;
	}

	/** Durable, idempotent ship-visibility event via the outbox hook spine. */
	private async notifyDeployed(
		dep: { id: string; module_id: string; environment_id: string; version: string | null },
		manifest: Record<string, unknown>,
		auth: AuthContext | null,
	): Promise<void> {
		try {
			const { OutboxService } = await import('@/plugins/outbox/service');
			const outbox = new OutboxService(this.db);
			await outbox.enqueue(
				'hook',
				{
					collection: 'idp_deployment',
					event: 'idp.deployed',
					doc: {
						deployment_id: dep.id,
						module_id: dep.module_id,
						environment_id: dep.environment_id,
						version: dep.version,
						manifest,
						deployed_by: auth?.email ?? null,
					},
				},
				{ dedupeKey: `idp:deploy:${dep.id}:live` },
			);
		} catch (err) {
			console.error('[idp] deploy notify error:', err instanceof Error ? err.message : err);
		}
	}

	// ─── Phase 4: Govern + create ───────────────────────────

	/**
	 * Governance scorecard — MECE coverage metrics over the live catalog.
	 * Deterministic single query set (no N+1): total modules, owner coverage,
	 * live-deployment coverage, and the four mutually-exclusive buckets.
	 */
	async scorecard(): Promise<Record<string, unknown>> {
		const modules = await this.db.all<{ id: string }>(QueryBuilder.from('_modules').select('id').toSelect());
		const ownership = await this.db.all<{ module_id: string }>(
			QueryBuilder.from(collectionTable('idp_ownership')).select('module_id').toSelect(),
		);
		const deployments = await this.db.all<{ module_id: string; status: string }>(
			QueryBuilder.from(collectionTable('idp_deployment')).select('module_id', 'status').toSelect(),
		);
		const ownerSet = new Set(ownership.map((o) => o.module_id));
		const liveSet = new Set(deployments.filter((d) => d.status === 'live').map((d) => d.module_id));
		const total = modules.length;
		const withOwner = modules.filter((m) => ownerSet.has(m.id)).length;
		const withLive = modules.filter((m) => liveSet.has(m.id)).length;
		const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
		return {
			total,
			with_owner: withOwner,
			owner_coverage_pct: pct(withOwner),
			with_live_deployment: withLive,
			deploy_coverage_pct: pct(withLive),
			// MECE buckets — every module falls into exactly one.
			owned_and_live: modules.filter((m) => ownerSet.has(m.id) && liveSet.has(m.id)).length,
			owned_not_live: modules.filter((m) => ownerSet.has(m.id) && !liveSet.has(m.id)).length,
			unowned_live: modules.filter((m) => !ownerSet.has(m.id) && liveSet.has(m.id)).length,
			unowned_not_live: modules.filter((m) => !ownerSet.has(m.id) && !liveSet.has(m.id)).length,
		};
	}

	/**
	 * Governance scorecard as policy-as-data — every module evaluated against
	 * `IDP_POLICY_RULES`, with the exact rule ids it violates. One deterministic
	 * query set (no N+1), ordered by module name so two reads agree.
	 *
	 * Distinct from `scorecard()` (which reports coverage percentages): this is
	 * the actionable "which module FAILS which rule" view a golden-path program
	 * enforces against, and it is the consumer of the same source tables — never
	 * a parallel log.
	 */
	async policies(): Promise<Record<string, unknown>> {
		const modules = await this.db.all<{ id: string; name: string; slug: string }>(
			QueryBuilder.from('_modules').select('id', 'name', 'slug').orderBy('name', 'asc').toSelect(),
		);
		const ownership = await this.db.all<{ module_id: string }>(
			QueryBuilder.from(collectionTable('idp_ownership')).select('module_id').toSelect(),
		);
		const deployments = await this.db.all<{ module_id: string; environment_id: string; status: string; manifest_json: string | null }>(
			QueryBuilder.from(collectionTable('idp_deployment')).select('module_id', 'environment_id', 'status', 'manifest_json').toSelect(),
		);
		const usage = await this.db.all<{ module_id: string }>(
			QueryBuilder.from(collectionTable('idp_template_usage')).select('module_id').toSelect(),
		);

		const ownerSet = new Set(ownership.map((o) => o.module_id));
		const goldenSet = new Set(usage.map((u) => u.module_id));
		// Aggregate live deployments per module: distinct env count + whether any
		// live deployment pinned a manifest.
		const live = new Map<string, { envs: Set<string>; manifest: boolean }>();
		for (const d of deployments) {
			if (d.status !== 'live') continue;
			const acc = live.get(d.module_id) ?? { envs: new Set<string>(), manifest: false };
			acc.envs.add(d.environment_id);
			if (d.manifest_json) acc.manifest = true;
			live.set(d.module_id, acc);
		}

		const violationsFor = (id: string): string[] => {
			const v: string[] = [];
			const l = live.get(id);
			if (!ownerSet.has(id)) v.push('has_owner');
			if (!l) v.push('live_deployment');
			if (!l || l.envs.size < 2) v.push('multi_env');
			if (!l || !l.manifest) v.push('release_record');
			if (!goldenSet.has(id)) v.push('golden_path');
			return v;
		};

		const entries = modules.map((m) => {
			const violations = violationsFor(m.id);
			return { id: m.id, slug: m.slug, name: m.name, status: violations.length === 0 ? 'pass' : 'fail', violations };
		});
		const perRule = IDP_POLICY_RULES.map((r) => {
			const passed = entries.filter((e) => !e.violations.includes(r.id)).length;
			return { ...r, passed, total: entries.length, pass_pct: entries.length ? Math.round((passed / entries.length) * 100) : 0 };
		});
		return {
			rules: IDP_POLICY_RULES,
			modules: entries,
			summary: {
				total: entries.length,
				passing: entries.filter((e) => e.status === 'pass').length,
				failing: entries.filter((e) => e.status === 'fail').length,
				rules: perRule,
			},
		};
	}

	/**
	 * Append one audit row for an IDP governance action. NEVER throws — a failing
	 * audit write must not fail the action it records (the action's own write is
	 * the source of truth; this is its trail). `action` is a dotted
	 * `<entity>.<verb>` token, `entity` the collection/system it touched.
	 */
	async recordAudit(
		action: string,
		entity: string,
		entityId: string | null,
		auth: AuthContext | null,
		detail?: Record<string, unknown>,
	): Promise<void> {
		try {
			const now = new Date().toISOString();
			await this.db.run(
				QueryBuilder.from(collectionTable('idp_audit')).toInsert({
					id: crypto.randomUUID(),
					action,
					entity,
					entity_id: entityId,
					actor_email: auth?.email ?? null,
					detail_json: detail ? JSON.stringify(detail) : null,
					created_at: now,
					updated_at: now,
				}),
			);
			invalidateCollectionReads('idp_audit');
		} catch (err) {
			console.error('[idp] audit record failed:', err instanceof Error ? err.message : err);
		}
	}

	/** The append-only audit trail, newest first (LIMIT-bounded). */
	async audit(limit = 100): Promise<unknown[]> {
		await this.ensureCollections();
		const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
		return this.db.all({
			// Identifier interpolated from a closed constant, never request input.
			sql: `SELECT * FROM "${collectionTable('idp_audit')}" WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT ?`,
			bindings: [n],
		});
	}

	/** List golden-path templates from the shared registry (single source of truth). */
	async listTemplates(): Promise<unknown[]> {
		const { listTemplates } = await import('@/plugins/templates/registry');
		return listTemplates();
	}

	/**
	 * Scaffold a module from a golden-path template: create the module, create
	 * each template entity, and attach them. Reuses the templates registry + the
	 * module/collection services — no new creation logic. Records template
	 * adoption (software-factory usage) in idp_template_usage.
	 */
	async scaffoldModule(
		templateName: string,
		meta: { name?: string; slug?: string; icon?: string },
		auth?: AuthContext | null,
	): Promise<Record<string, unknown>> {
		const { getTemplate } = await import('@/plugins/templates/registry');
		const template = getTemplate(templateName);
		if (!template) throw new Error(`Template "${templateName}" not found`);
		const { ModuleService } = await import('@/lib/services/module.service');
		const { CollectionService } = await import('@/lib/services/collection.service');
		const moduleSvc = new ModuleService(this.db);
		const collSvc = new CollectionService(this.db);
		const module = await moduleSvc.createModule({
			name: meta.name ?? template.name,
			slug: meta.slug ?? templateName,
			icon: meta.icon ?? 'lucide:box',
			description: template.description,
			version: '1.0.0',
		});
		const created: string[] = [];
		for (const entity of template.entities) {
			await collSvc.createCollection(entity as unknown as Parameters<typeof collSvc.createCollection>[0]);
			await moduleSvc.attachCollection(module.slug, entity.slug);
			created.push(entity.slug);
		}
		// Record template adoption — the one factory-usage signal not derivable
		// from the source tables (a scaffolded module is otherwise indistinguishable).
		try {
			await this.db.run(
				QueryBuilder.from(collectionTable('idp_template_usage')).toInsert({
					id: crypto.randomUUID(),
					template_name: templateName,
					module_id: module.id,
					created_by_email: auth?.email ?? null,
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				}),
			);
			invalidateCollectionReads('idp_template_usage');
		} catch (err) {
			console.error('[idp] template usage record failed:', err instanceof Error ? err.message : err);
		}
		await this.recordAudit('template.scaffold', 'module', module.id, auth ?? null, { template: templateName, collections: created });
		return { module, collections: created };
	}

	// ─── Software-factory usage ─────────────────────────────

	/**
	 * Factory usage — derived from the SOURCE-OF-TRUTH tables (modules,
	 * collections, deployments, ownership), never a parallel log. Returns
	 * time-bucketed activity series + health totals + template adoption.
	 * Deterministic: same data in → same numbers out (single version of truth).
	 */
	async usage(days = 30): Promise<Record<string, unknown>> {
		const from = new Date(Date.now() - days * 86_400_000).toISOString();
		const depTable = collectionTable('idp_deployment');
		const ownTable = collectionTable('idp_ownership');
		const tplTable = collectionTable('idp_template_usage');

		// The daily bucket builder INTERPOLATES both the table and the column — an
		// identifier cannot be a bound parameter — so the pair is a closed, typed
		// constant instead of a caller-supplied string. A string signature was
		// injection-by-refactor waiting for a future caller to pass something derived
		// from a request; now there is no such parameter to pass.
		const SERIES_SOURCES: Record<'modules' | 'collections' | 'deployments' | 'ownership', { table: string; col: string }> = {
			modules: { table: '_modules', col: 'created_at' },
			collections: { table: '_entity_schemas', col: 'created_at' },
			deployments: { table: depTable, col: 'deployed_at' },
			ownership: { table: ownTable, col: 'created_at' },
		};

		const series = async (source: keyof typeof SERIES_SOURCES): Promise<Array<{ day: string; n: number }>> => {
			const { table, col } = SERIES_SOURCES[source];
			const rows = await this.db.all<{ day: string; n: number }>({
				sql: `SELECT strftime('%Y-%m-%d', ${col}) AS day, COUNT(*) AS n
					FROM "${table}" WHERE ${col} >= ? GROUP BY day ORDER BY day`,
				bindings: [from],
			});
			return rows.map((r) => ({ day: r.day, n: Number(r.n) }));
		};

		const [modules, collections, deployments, ownership, templateUsage, totals] = await Promise.all([
			series('modules'),
			series('collections'),
			series('deployments'),
			series('ownership'),
			this.db.all<{ template_name: string; n: number }>({
				sql: `SELECT template_name, COUNT(*) AS n FROM "${tplTable}" GROUP BY template_name ORDER BY n DESC`,
				bindings: [],
			}),
			this.db.first<{ modules: number; collections: number; deployments: number; ownership: number }>({
				sql: `SELECT
					(SELECT COUNT(*) FROM _modules) AS modules,
					(SELECT COUNT(*) FROM _entity_schemas) AS collections,
					(SELECT COUNT(*) FROM "${depTable}") AS deployments,
					(SELECT COUNT(*) FROM "${ownTable}") AS ownership`,
				bindings: [],
			}),
		]);

		return {
			days,
			series: { modules, collections, deployments, ownership },
			totals: {
				modules: Number(totals?.modules ?? 0),
				collections: Number(totals?.collections ?? 0),
				deployments: Number(totals?.deployments ?? 0),
				ownership: Number(totals?.ownership ?? 0),
			},
			template_adoption: templateUsage.map((t) => ({ template: t.template_name, count: Number(t.n) })),
		};
	}

	/** Create one IDP collection's table + `_entity_schemas` row. */
	private async createCollectionRecord(def: { name: string; slug: string; description: string; fields: unknown[] }): Promise<void> {
		const tableName = collectionTable(def.slug);
		const sysCols = [
			'id TEXT PRIMARY KEY',
			"doc_status TEXT NOT NULL DEFAULT 'draft'",
			'display_number TEXT',
			'_owner TEXT',
			'created_by TEXT',
			'updated_by TEXT',
			'deleted_at TEXT',
			'deleted_by TEXT',
			'_meta TEXT',
			'created_at TEXT',
			'updated_at TEXT',
		];
		const colDefs = sysCols.concat(
			(def.fields as Array<{ name: string; type: string; required?: boolean }>).map((f) => {
				const sqlType = fieldSqlType(f.type);
				const nullable = f.required === false ? '' : ' NOT NULL';
				return `${f.name} ${sqlType}${nullable}`;
			}),
		);
		await this.db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs.join(', ')});`);
		await this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_deleted_id" ON "${tableName}" ("deleted_at", "id");`);

		const id = crypto.randomUUID();
		const fieldMeta = (def.fields as Array<{ name: string; type: string; label?: string; required?: boolean; options?: string[] }>).map(
			(f) => {
				const obj: Record<string, unknown> = { name: f.name, type: f.type, label: f.label ?? f.name };
				if (f.required === false) obj.required = false;
				if (f.options && f.options.length > 0) obj.options = f.options;
				return JSON.stringify(obj);
			},
		);
		const allFields = [
			'{"name":"id","type":"text","label":"ID","required":true}',
			...fieldMeta,
			'{"name":"created_at","type":"timestamp","label":"Created At"}',
			'{"name":"updated_at","type":"timestamp","label":"Updated At"}',
		];
		const escName = def.name.replace(/'/g, "''");
		const escDesc = def.description.replace(/'/g, "''");
		await this.db.exec(
			`INSERT INTO _entity_schemas (id, name, slug, table_name, description, schema_json) VALUES ('${id}', '${escName}', '${def.slug}', '${tableName}', '${escDesc}', '{"fields":[${allFields.join(',')}]}');`,
		);
	}

	// ─── Phase 5: GitOps deploy (plan / apply / rollback) ──

	/**
	 * Idempotently ensure the SHARED migration ledger (`_migrations`) is usable by
	 * the IDP. The ledger records every applied snapshot (by checksum + environment)
	 * so applies are naturally idempotent and a partial migration is never
	 * re-applied. Non-destructive by construction — see the notes below.
	 */
	async ensureMigrationLedger(): Promise<void> {
		// db.exec() splits statements on newlines — DDL must be single-line.
		//
		// The ledger LIVES IN `_migrations`, the CANONICAL table the core
		// `MigrationRunner` and `PluginMigrationService` already share and key by
		// `name` (id, name, applied_at). It also must not move to a table of its own:
		// the seed reset drops `_migrations`, so a ledger outside it would survive a
		// wiped database and keep answering "already applied" for snapshots whose
		// collections are gone.
		//
		// The previous "self-heal" here declared a DIFFERENT shape for that name
		// (`checksum` / `environment_id`) and, on finding the canonical one, DROPPED
		// the table. That destroyed every applied core + plugin migration (each became
		// re-appliable) and left a table the core runner cannot read at all
		// (`SELECT name ...` → no such column), all without a log line. Now nothing is
		// ever dropped: the canonical shape is created as the other two runners create
		// it, and the IDP's own columns are ADDED only when missing — nullable columns
		// in the same table are invisible to runners that name their columns
		// explicitly, and a canonical row can never collide with an IDP row (its
		// `checksum` is NULL).
		await this.db.exec(
			'CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, name TEXT, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);',
		);
		// ALTER TABLE ... ADD COLUMN has no IF NOT EXISTS in SQLite, so probe the
		// columns first (the pattern PluginMigrationService uses). Must NOT be memoized
		// per isolate: a wiped database re-runs this route with `_migrations` canonical
		// again, so the IDP columns have to come back too.
		// `applied_at` deliberately carries no DEFAULT here — SQLite rejects a
		// non-constant DEFAULT in ADD COLUMN; every IDP ledger insert binds it.
		const have = new Set((await this.db.all<{ name: string }>({ sql: 'PRAGMA table_info(_migrations)', bindings: [] })).map((c) => c.name));
		for (const col of ['name', 'applied_at', 'checksum', 'environment_id', 'applied_by']) {
			if (!have.has(col)) await this.db.exec(`ALTER TABLE _migrations ADD COLUMN ${col} TEXT;`);
		}
	}

	/** The live DB's full schema snapshot (mirrors /api/snapshot/diff-v2's current state). */
	private async buildCurrentSnapshot(): Promise<SchemaSnapshot> {
		const collections = (await this.db.all<EntitySchema>(QueryBuilder.from('_entity_schemas').select('*').toSelect())).map((c) => ({
			...c,
			schema_json: this.cleanSchemaJson(c.schema_json, c.slug),
		}));
		const roles = await this.db.all<RoleRecord>(QueryBuilder.from('_roles').select('*').toSelect());
		const permissions = await this.db.all<RolePermissionRecord>(QueryBuilder.from('_role_permissions').select('*').toSelect());
		const webhooks = await this.db.all<WebhookRecord>(QueryBuilder.from('_webhooks').select('*').toSelect());
		return {
			version: APP_VERSION,
			timestamp: new Date().toISOString(),
			checksum: '',
			collections,
			roles,
			permissions,
			webhooks,
			plugins: [],
		};
	}

	/**
	 * SchemaDiffer expects `schema_json` to be a BARE array of field definitions,
	 * but the DB stores `{ "fields": [...] }`. Normalize either form to a bare array
	 * AND strip system-managed fields so the current state matches what git export
	 * produces (otherwise every system field looks like a breaking "removed").
	 *
	 * Fails LOUDLY on a malformed or shapeless `schema_json` — the same rule
	 * `moduleManifest` enforces, and for the same reason. This snapshot is the
	 * "current state" side of the deployment diff, so a fabricated "collection with
	 * no fields" makes the differ report EVERY field as removed: a corrupt stored
	 * row would turn into a confident lie, and on the apply path that fabricated diff
	 * decides the breaking-change gate. Naming the collection is the whole point of
	 * the error — the bad row is otherwise invisible.
	 */
	private cleanSchemaJson(schemaJson: string, slug: string): string {
		const sys = new Set(['id', '_meta', 'doc_status', 'display_number', 'deleted_at', 'created_at', 'updated_at']);
		let fields: unknown;
		try {
			const parsed: unknown = JSON.parse(schemaJson);
			fields = Array.isArray(parsed) ? parsed : (parsed as { fields?: unknown } | null)?.fields;
		} catch {
			throw new IdpError(`Collection "${slug}" has a malformed schema_json — cannot build a schema snapshot`, 500);
		}
		if (!Array.isArray(fields)) {
			throw new IdpError(
				`Collection "${slug}" has a shapeless schema_json (expected an array or { fields: [...] }) — cannot build a schema snapshot`,
				500,
			);
		}
		const cleaned = (fields as Array<{ name?: string }>).filter((f) => !(f && typeof f === 'object' && f.name && sys.has(f.name)));
		return JSON.stringify(cleaned);
	}

	/** Deterministic, dependency-free checksum over a snapshot's canonical JSON. */
	private snapshotChecksum(snapshot: SchemaSnapshot): string {
		const json = JSON.stringify(snapshot);
		let h = 0x811c9dc5;
		for (let i = 0; i < json.length; i++) {
			h ^= json.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return 'fnv1a-' + (h >>> 0).toString(16).padStart(8, '0');
	}

	/** Parse a stored snapshot JSON into a typed, normalized SchemaSnapshot. */
	private parseSnapshot(json: string | null): SchemaSnapshot {
		if (!json) throw new Error('Deployment has no snapshot to apply');
		let parsed: unknown;
		try {
			parsed = JSON.parse(json);
		} catch {
			throw new Error('Deployment snapshot_json is malformed');
		}
		if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as SchemaSnapshot).collections)) {
			throw new Error('Deployment snapshot_json must contain a "collections" array');
		}
		return this.normalizeSnapshot(parsed as SchemaSnapshot);
	}

	/**
	 * Normalize a snapshot so every collection carries `schema_json` as a BARE array
	 * of fields (the format SchemaDiffer + the apply path expect). Git-exported
	 * snapshots carry a bare `fields` array instead — convert those for compatibility.
	 */
	private normalizeSnapshot(raw: SchemaSnapshot): SchemaSnapshot {
		return {
			version: raw.version,
			timestamp: raw.timestamp,
			checksum: raw.checksum,
			collections: raw.collections.map((c) => {
				const anyC = c as unknown as { fields?: unknown[]; schema_json?: string };
				if (anyC.schema_json) return { ...c, schema_json: this.cleanSchemaJson(anyC.schema_json, c.slug) } as EntitySchema;
				return { ...c, schema_json: JSON.stringify(anyC.fields ?? []) } as EntitySchema;
			}),
			roles: raw.roles ?? [],
			permissions: raw.permissions ?? [],
			webhooks: raw.webhooks ?? [],
			plugins: raw.plugins ?? [],
		};
	}

	/** Parse a collection's `schema_json` (bare array OR `{fields:[...]}`) into field definitions. */
	private parseFields(col: EntitySchema): import('@mmbix/types').FieldDefinition[] {
		try {
			const parsed = JSON.parse(col.schema_json ?? '[]');
			if (Array.isArray(parsed)) return parsed as import('@mmbix/types').FieldDefinition[];
			if (parsed && Array.isArray(parsed.fields)) return parsed.fields as import('@mmbix/types').FieldDefinition[];
			return [];
		} catch {
			return [];
		}
	}

	/**
	 * Plan a deployment — diff the deployment's pinned snapshot against the live
	 * DB and return a human-readable migration plan + safety assessment. Read-only.
	 */
	async planDeployment(deploymentId: string): Promise<Record<string, unknown>> {
		const dep = await this.getDeployment(deploymentId);
		const snapshot = this.parseSnapshot(dep.snapshot_json);
		const current = await this.buildCurrentSnapshot();
		const { SchemaDiffer } = await import('@mmbix/core');
		const diff = SchemaDiffer.diff(current, snapshot);
		return { deployment_id: deploymentId, git_ref: dep.git_ref, diff, summary: diff.summary };
	}

	/**
	 * Apply a deployment's pinned snapshot to the DB. Idempotent (ledger), gated
	 * on breaking changes (unless forced), and records the migration + marks live.
	 */
	async applyDeployment(deploymentId: string, auth: AuthContext | null, force = false): Promise<Record<string, unknown>> {
		const dep = await this.getDeployment(deploymentId);
		const result = await this.applySnapshot(deploymentId, dep.snapshot_json, auth, force);
		// Audit only a real apply — an idempotent no-op (`already_applied`) is not a
		// new action and would otherwise pad the trail on every retry.
		if (result.applied) {
			await this.recordAudit('deployment.apply', 'idp_deployment', deploymentId, auth, {
				checksum: result.checksum,
				environment_id: dep.environment_id,
			});
		}
		return result;
	}

	/**
	 * Rollback — re-apply the previous live snapshot for the same module+env.
	 * Human-initiated (safer for prod); force is implied since we're restoring.
	 */
	async rollbackDeployment(deploymentId: string, auth: AuthContext | null): Promise<Record<string, unknown>> {
		const dep = await this.getDeployment(deploymentId);
		// This picks WHICH snapshot a rollback restores, so it must be deterministic:
		// `deployed_at` alone would leave two live deployments in the same second to
		// SQLite's row order, and a rollback could restore snapshot A on one attempt
		// and B on the next. The PK tie-break always resolves the same way.
		const prev = await this.db.first<{ id: string; snapshot_json: string | null }>({
			sql: `SELECT id, snapshot_json FROM "${collectionTable('idp_deployment')}"
				WHERE module_id = ? AND environment_id = ? AND id != ? AND status = 'live' AND deleted_at IS NULL
				ORDER BY deployed_at DESC, id DESC LIMIT 1`,
			bindings: [dep.module_id, dep.environment_id, deploymentId],
		});
		if (!prev?.snapshot_json) throw new IdpError('No previous live snapshot to roll back to', 409);
		const result = await this.applySnapshot(deploymentId, prev.snapshot_json, auth, true);
		await this.recordAudit('deployment.rollback', 'idp_deployment', deploymentId, auth, {
			restored_from: prev.id,
			environment_id: dep.environment_id,
		});
		return result;
	}

	/** Shared apply path — idempotent, gated, atomic, ledgered. */
	private async applySnapshot(
		deploymentId: string,
		snapshotJson: string | null,
		auth: AuthContext | null,
		force: boolean,
	): Promise<Record<string, unknown>> {
		await this.ensureMigrationLedger();
		const dep = await this.getDeployment(deploymentId);
		const snapshot = this.parseSnapshot(snapshotJson);
		const checksum = this.snapshotChecksum(snapshot);

		// Idempotency: already applied for this environment? → no-op, not an error.
		const existing = await this.db.first<{ id: string }>({
			sql: 'SELECT id FROM _migrations WHERE checksum = ? AND environment_id = ?',
			bindings: [checksum, dep.environment_id],
		});
		if (existing) {
			return { deployment_id: deploymentId, applied: false, already_applied: true, checksum };
		}

		// Safety gate: breaking changes block unless explicitly forced.
		const current = await this.buildCurrentSnapshot();
		const { SchemaDiffer } = await import('@mmbix/core');
		const diff = SchemaDiffer.diff(current, snapshot);
		if (!diff.summary.safeToApply && !force) {
			throw new IdpError(
				`Breaking schema changes — apply blocked (${diff.summary.breakingChanges.join('; ')}). Use force to override.`,
				409,
			);
		}

		// Apply each collection (create if missing) — idempotent per collection.
		const { CollectionService } = await import('@/lib/services/collection.service');
		const svc = new CollectionService(this.db);
		const results: Array<{ slug: string; status: string }> = [];
		for (const col of snapshot.collections) {
			const existingCol = await this.db.first<{ slug: string }>({
				sql: 'SELECT slug FROM _entity_schemas WHERE slug = ?',
				bindings: [col.slug],
			});
			if (existingCol) {
				results.push({ slug: col.slug, status: 'skipped' });
				continue;
			}
			await svc.createCollection({
				name: col.name,
				slug: col.slug,
				description: col.description ?? undefined,
				fields: this.parseFields(col),
			});
			results.push({ slug: col.slug, status: 'created' });
		}

		// Record the migration ledger row (idempotency marker).
		const ledgerId = crypto.randomUUID();
		await this.db.run({
			sql: 'INSERT INTO _migrations (id, checksum, environment_id, applied_by, applied_at) VALUES (?, ?, ?, ?, ?)',
			bindings: [ledgerId, checksum, dep.environment_id, auth?.email ?? null, new Date().toISOString()],
		});

		// Mark the deployment live + capture the applied snapshot + notify. Routed
		// through `commitDeploymentState` so `_workflow_states` moves in lock-step
		// (this used to write the `status` column alone, leaving the workflow at
		// `draft` — the drift this fixes).
		await this.commitDeploymentState(deploymentId, 'live', auth, {
			deployed_at: new Date().toISOString(),
			deployed_by: auth?.email ?? null,
			manifest_json: JSON.stringify(snapshot),
		});
		await this.notifyDeployed(dep, snapshot as unknown as Record<string, unknown>, auth);

		return { deployment_id: deploymentId, applied: true, checksum, results, summary: diff.summary };
	}
}

/** SQL type for an entity field type (subset used by the IDP collections). */
function fieldSqlType(type: string): string {
	switch (type) {
		case 'boolean':
			return 'INTEGER';
		case 'datetime':
		case 'date':
		case 'timestamp':
			return 'TEXT';
		case 'json':
			return 'TEXT';
		default:
			return 'TEXT';
	}
}

/** Higher rank = more privilege. owner > maintainer > viewer. */
function roleRank(role: string | null): number {
	switch (role) {
		case 'owner':
			return 3;
		case 'maintainer':
			return 2;
		case 'viewer':
			return 1;
		default:
			return 0;
	}
}

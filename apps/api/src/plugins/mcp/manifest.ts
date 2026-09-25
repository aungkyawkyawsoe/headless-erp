/**
 * Manifest engine — plan (read-only) and apply (the one governed write).
 *
 * A manifest is a declarative description of collections + pages. `planManifest`
 * diffs it against the live factory and never writes; `applyManifest` is
 * idempotent (collections are created once then skipped; pages are upserted and
 * skipped when byte-identical) and isolates per-item failures so one bad entry
 * never aborts the batch.
 */

import { D1Client, MigrationRunner } from '@mmbix/core';
import { sanitizeIdentifier, VALID_FIELD_TYPES } from '@mmbix/utils';
import type {
	FactoryApiKeySpec,
	FactoryCollectionSpec,
	FactoryFieldSpec,
	FactoryKpiSpec,
	FactoryManifest,
	FactoryMenuSpec,
	FactoryPageSpec,
	FactoryPermissionSpec,
	FactoryReportSpec,
	FactoryRoleSpec,
	FactoryScheduleSpec,
	FactoryServerFunctionSpec,
	FactoryWorkflowSpec,
	FieldDefinition,
	ManifestAction,
	ManifestPlan,
} from '@mmbix/types';
import { DECLARATIVE_TRIGGER_EVENTS } from '@mmbix/types';
import { hasHandler, isValidCron, isValidTimeZone, registerBuiltinHandlers, SchedulerService } from '@mmbix/scheduler';
import type { SchedulerEnv } from '@mmbix/scheduler';
import type { AuthContext } from '@/lib/services/auth.service';
import { AuthService } from '@/lib/services/auth.service';
import { CollectionService } from '@/lib/services/collection.service';
import { normalizeBlocks } from '@/lib/services/block-validation';
import { PageService, type PageBlocks } from '@/lib/services/page.service';
import { ModuleMenuService } from '@/lib/services/module-menu.service';
import { ApiKeyService, type ApiKeyScope } from '@/lib/services/api-key.service';
import { WorkflowService } from '@/plugins/workflow/service';
import type { WorkflowDefinition } from '@/plugins/workflow/types';
import { KpiService, type KpiDefinition } from '@/plugins/kpi/service';
import { ServerFunctionService } from '@/plugins/server-functions/service';
import type { ServerFunctionInput } from '@/plugins/server-functions/types';

const MAX_COLLECTIONS = 50;
const MAX_FIELDS_PER_COLLECTION = 100;
const MAX_PAGES = 100;
const MAX_ROLES = 50;
const MAX_PERMISSIONS = 200;
const MAX_WORKFLOWS = 50;
const MAX_MENUS = 100;
const MAX_KPIS = 100;
const MAX_SERVER_FUNCTIONS = 100;
const MAX_API_KEYS = 20;
const MAX_SCHEDULES = 100;
const MAX_REPORTS = 100;

/** Bindings a schedule needs to arm its alarm. Omitted → the watchdog arms it. */
export type ManifestEnv = { DB: D1Database; SCHEDULER?: DurableObjectNamespace };

/**
 * Deterministic id for a manifest-declared artifact. Replay resolves to the SAME
 * row (an upsert), so a manifest is idempotent without storing a version.
 */
function declaredId(prefix: string, name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${prefix}${slug || 'item'}`;
}

/** The report table's `cron` is NOT NULL but nothing dispatches it — see the spec. */
const REPORT_CRON_SENTINEL = 'on-demand';

/**
 * Durable ownership marker written onto every row `applyManifest` creates. A row
 * with any OTHER `source` (or `NULL` = hand/Studio/CLI-created) is INVISIBLE to
 * reconciliation — the safety property that a manifest can only ever remove the
 * rows it itself created. Mirrors `_role_permissions.source` (migration 036).
 */
const MANIFEST_SOURCE = 'manifest';

/** Upper bound on rows examined per reconciled domain (reads are LIMIT-bounded). */
const RECONCILE_SCAN_LIMIT = 500;

export interface ManifestValidation {
	manifest: FactoryManifest | null;
	warnings: string[];
}

function asObject(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function safeName(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	try {
		return sanitizeIdentifier(trimmed, 'manifest identifier');
	} catch {
		return null;
	}
}

/** Map a manifest field spec onto the engine's FieldDefinition (shared by create + add). */
function fieldDefinitionOf(f: FactoryFieldSpec): FieldDefinition {
	return {
		name: f.name,
		type: f.type,
		required: f.required ?? false,
		...(f.related_collection ? { related_collection: f.related_collection } : {}),
		...(f.options ? { options: f.options } : {}),
		...(f.unique ? { unique: true } : {}),
	};
}

/**
 * Normalize an untrusted field list against the field-type SSOT. The ONE
 * validator: `validate_manifest` (via collections) and the `validate_fields`
 * dry-run tool both call it, so the two can never disagree on what a valid
 * field is. Invalid entries are DROPPED and reported — never invented.
 */
export function normalizeFields(owner: string, raw: unknown, warnings: string[], limit = MAX_FIELDS_PER_COLLECTION): FactoryFieldSpec[] {
	if (!Array.isArray(raw)) {
		if (raw !== undefined) warnings.push(`${owner}: fields must be an array`);
		return [];
	}
	const fields: FactoryFieldSpec[] = [];
	for (const rf of raw.slice(0, limit)) {
		const f = asObject(rf);
		const name = safeName(f?.name);
		const type = typeof f?.type === 'string' ? f.type : '';
		if (!f || !name || !VALID_FIELD_TYPES.has(type)) {
			warnings.push(`${owner}: dropped field with invalid name/type`);
			continue;
		}
		const related = f.related_collection === undefined ? undefined : (safeName(f.related_collection) ?? undefined);
		fields.push({
			name,
			type: type as FactoryFieldSpec['type'],
			...(typeof f.required === 'boolean' ? { required: f.required } : {}),
			...(related ? { related_collection: related } : {}),
			...(Array.isArray(f.options) ? { options: f.options.filter((x): x is string => typeof x === 'string') } : {}),
			...(f.unique === true ? { unique: true } : {}),
		});
	}
	return fields;
}

/** Validate + normalize an untrusted manifest. Invalid entries are dropped + warned. */
export function validateManifest(input: unknown): ManifestValidation {
	const warnings: string[] = [];
	const o = asObject(input);
	if (!o) return { manifest: null, warnings: ['Manifest must be a JSON object'] };
	if (o.version !== undefined && o.version !== 1) warnings.push(`Unknown manifest version "${String(o.version)}" — treating as 1`);

	const collections: FactoryCollectionSpec[] = [];
	if (o.collections !== undefined) {
		if (!Array.isArray(o.collections)) return { manifest: null, warnings: ['collections must be an array'] };
		for (const raw of o.collections.slice(0, MAX_COLLECTIONS)) {
			const c = asObject(raw);
			const slug = safeName(c?.slug);
			if (!c || !slug) {
				warnings.push('Dropped a collection with an invalid slug');
				continue;
			}
			collections.push({
				slug,
				...(typeof c.name === 'string' ? { name: c.name.slice(0, 200) } : {}),
				...(typeof c.naming_series === 'string' ? { naming_series: c.naming_series.slice(0, 64) } : {}),
				fields: normalizeFields(`collection "${slug}"`, c.fields, warnings),
				...(asObject(c.policies) ? { policies: c.policies as Record<string, unknown> } : {}),
			});
		}
	}

	const schedules: FactoryScheduleSpec[] = [];
	if (o.schedules !== undefined) {
		if (!Array.isArray(o.schedules)) return { manifest: null, warnings: ['schedules must be an array'] };
		for (const raw of o.schedules.slice(0, MAX_SCHEDULES)) {
			const s = asObject(raw);
			const name = safeName(s?.name);
			const type = typeof s?.type === 'string' ? s.type.trim() : '';
			if (!s || !name || !type) {
				warnings.push('Dropped a schedule with an invalid name/type');
				continue;
			}
			if (s.cron !== undefined && (typeof s.cron !== 'string' || !isValidCron(s.cron))) {
				warnings.push(`schedule "${name}": dropped — invalid cron ${JSON.stringify(s.cron)}`);
				continue;
			}
			if (s.timezone !== undefined && (typeof s.timezone !== 'string' || !isValidTimeZone(s.timezone))) {
				warnings.push(`schedule "${name}": dropped — invalid timezone ${JSON.stringify(s.timezone)}`);
				continue;
			}
			const repeatMs = typeof s.repeat_ms === 'number' && Number.isInteger(s.repeat_ms) && s.repeat_ms > 0 ? s.repeat_ms : undefined;
			// One-shot vs recurring are MECE: a trigger cannot be both.
			const runNow = s.run_now === true;
			if (runNow && (s.cron !== undefined || repeatMs !== undefined)) {
				warnings.push(`schedule "${name}": dropped — run_now is one-shot and cannot take a cron/repeat_ms`);
				continue;
			}
			if (!s.cron && repeatMs === undefined && !runNow) {
				warnings.push(`schedule "${name}": dropped — needs a cron, a positive repeat_ms, or run_now`);
				continue;
			}
			schedules.push({
				name,
				type: type.slice(0, 100),
				...(typeof s.cron === 'string' ? { cron: s.cron } : {}),
				...(repeatMs !== undefined ? { repeat_ms: repeatMs } : {}),
				...(runNow ? { run_now: true } : {}),
				...(typeof s.timezone === 'string' ? { timezone: s.timezone } : {}),
				...(asObject(s.payload) ? { payload: s.payload as Record<string, unknown> } : {}),
				...(typeof s.max_attempts === 'number' ? { max_attempts: s.max_attempts } : {}),
			});
		}
	}

	const reports: FactoryReportSpec[] = [];
	if (o.reports !== undefined) {
		if (!Array.isArray(o.reports)) return { manifest: null, warnings: ['reports must be an array'] };
		for (const raw of o.reports.slice(0, MAX_REPORTS)) {
			const r = asObject(raw);
			const name = typeof r?.name === 'string' ? r.name.trim() : '';
			const collection = safeName(r?.collection);
			if (!r || !name || !collection) {
				warnings.push('Dropped a report with an invalid name/collection');
				continue;
			}
			reports.push({
				name: name.slice(0, 100),
				collection,
				...(r.format === 'csv' || r.format === 'json' ? { format: r.format } : {}),
			});
		}
	}

	const pages: FactoryPageSpec[] = [];
	if (o.pages !== undefined) {
		if (!Array.isArray(o.pages)) return { manifest: null, warnings: ['pages must be an array'] };
		for (const raw of o.pages.slice(0, MAX_PAGES)) {
			const p = asObject(raw);
			const path = typeof p?.path === 'string' ? p.path.trim() : '';
			const title = typeof p?.title === 'string' ? p.title.trim() : '';
			if (!p || !path || !title) {
				warnings.push('Dropped a page missing path/title');
				continue;
			}
			const module = p.module === undefined ? undefined : (safeName(p.module) ?? undefined);
			pages.push({
				path: path.slice(0, 200),
				title: title.slice(0, 200),
				...(module ? { module } : {}),
				// The block tree goes through the SAME registry-backed validator the
				// patch path uses, so an unknown block type is reported here (plan)
				// instead of being written and then rendering as nothing.
				blocks: normalizeBlocks(`page "${path}"`, p.blocks, warnings) as unknown as Array<Record<string, unknown>>,
			});
		}
	}

	const roles: FactoryRoleSpec[] = [];
	if (o.roles !== undefined) {
		if (!Array.isArray(o.roles)) return { manifest: null, warnings: ['roles must be an array'] };
		for (const raw of o.roles.slice(0, MAX_ROLES)) {
			const r = asObject(raw);
			const name = typeof r?.name === 'string' ? r.name.trim() : '';
			if (!r || !name) {
				warnings.push('Dropped a role with no name');
				continue;
			}
			roles.push({
				name: name.slice(0, 100),
				...(typeof r.description === 'string' ? { description: r.description.slice(0, 300) } : {}),
				...(Array.isArray(r.app_access) ? { app_access: r.app_access.filter((x): x is string => typeof x === 'string') } : {}),
			});
		}
	}

	const permissions: FactoryPermissionSpec[] = [];
	if (o.permissions !== undefined) {
		if (!Array.isArray(o.permissions)) return { manifest: null, warnings: ['permissions must be an array'] };
		for (const raw of o.permissions.slice(0, MAX_PERMISSIONS)) {
			const p = asObject(raw);
			const role = typeof p?.role === 'string' ? p.role.trim() : '';
			const collection = safeName(p?.collection);
			if (!p || !role || !collection) {
				warnings.push('Dropped a permission with no role/collection');
				continue;
			}
			const flags = {} as Record<string, boolean>;
			for (const k of ['can_read', 'can_write', 'can_create', 'can_delete', 'can_approve', 'can_submit'] as const) {
				if (typeof p[k] === 'boolean') flags[k] = p[k];
			}
			permissions.push({ role: role.slice(0, 100), collection, ...flags });
		}
	}

	const workflows: FactoryWorkflowSpec[] = [];
	if (o.workflows !== undefined) {
		if (!Array.isArray(o.workflows)) return { manifest: null, warnings: ['workflows must be an array'] };
		for (const raw of o.workflows.slice(0, MAX_WORKFLOWS)) {
			const w = asObject(raw);
			const collection = safeName(w?.collection);
			const name = typeof w?.name === 'string' ? w.name.trim() : '';
			const initial = typeof w?.initial === 'string' ? w.initial.trim() : '';
			const states = Array.isArray(w?.states) ? w.states.filter((s): s is string => typeof s === 'string') : [];
			const transitions = Array.isArray(w?.transitions)
				? (w.transitions as unknown[])
						.map((t) => asObject(t))
						.filter(
							(t): t is Record<string, unknown> =>
								!!t && typeof t.id === 'string' && typeof t.from === 'string' && typeof t.to === 'string',
						)
						.slice(0, 100)
						.map((t) => ({ id: String(t.id), from: String(t.from), to: String(t.to) }))
				: [];
			if (!w || !name || !collection || !initial || states.length === 0 || transitions.length === 0) {
				warnings.push('Dropped a workflow missing name/collection/initial/states/transitions');
				continue;
			}
			workflows.push({
				name: name.slice(0, 100),
				collection,
				initial: initial.slice(0, 100),
				states: states.slice(0, 50),
				transitions,
				...(asObject(w.doc_status_map) ? { doc_status_map: w.doc_status_map as Record<string, string> } : {}),
				...(typeof w.enabled === 'boolean' ? { enabled: w.enabled } : {}),
			});
		}
	}

	const menus: FactoryMenuSpec[] = [];
	if (o.menus !== undefined) {
		if (!Array.isArray(o.menus)) return { manifest: null, warnings: ['menus must be an array'] };
		for (const raw of o.menus.slice(0, MAX_MENUS)) {
			const m = asObject(raw);
			const module = safeName(m?.module);
			const label = typeof m?.label === 'string' ? m.label.trim() : '';
			if (!m || !module || !label) {
				warnings.push('Dropped a menu with no module/label');
				continue;
			}
			menus.push({
				module,
				label: label.slice(0, 100),
				...(typeof m.type === 'string' ? { type: m.type.slice(0, 40) } : {}),
				...(typeof m.target === 'string' ? { target: m.target.slice(0, 200) } : {}),
				...(typeof m.icon === 'string' ? { icon: m.icon.slice(0, 60) } : {}),
				...(typeof m.sort_order === 'number' ? { sort_order: m.sort_order } : {}),
				...(Array.isArray(m.roles) ? { roles: m.roles.filter((x): x is string => typeof x === 'string') } : {}),
				...(typeof m.template === 'string' ? { template: m.template.slice(0, 60) } : {}),
			});
		}
	}

	const kpis: FactoryKpiSpec[] = [];
	if (o.kpis !== undefined) {
		if (!Array.isArray(o.kpis)) return { manifest: null, warnings: ['kpis must be an array'] };
		for (const raw of o.kpis.slice(0, MAX_KPIS)) {
			const k = asObject(raw);
			const name = typeof k?.name === 'string' ? k.name.trim() : '';
			const collection = safeName(k?.collection);
			const agg = typeof k?.agg === 'string' ? k.agg.trim() : '';
			if (!k || !name || !collection || !agg) {
				warnings.push('Dropped a kpi missing name/collection/agg');
				continue;
			}
			kpis.push({
				name: name.slice(0, 100),
				collection,
				agg,
				...(typeof k.description === 'string' ? { description: k.description.slice(0, 300) } : {}),
				...(typeof k.field === 'string' ? { field: k.field.slice(0, 100) } : {}),
				...(Array.isArray(k.filter) ? { filter: (k.filter as Array<Record<string, unknown>>).slice(0, 50) } : {}),
				...(typeof k.group_by === 'string' ? { group_by: k.group_by.slice(0, 100) } : {}),
				...(typeof k.period === 'string' ? { period: k.period.slice(0, 40) } : {}),
				...(typeof k.schedule === 'string' ? { schedule: k.schedule.slice(0, 40) } : {}),
				...(typeof k.enabled === 'boolean' ? { enabled: k.enabled } : {}),
			});
		}
	}

	const serverFunctions: FactoryServerFunctionSpec[] = [];
	if (o.serverFunctions !== undefined) {
		if (!Array.isArray(o.serverFunctions)) return { manifest: null, warnings: ['serverFunctions must be an array'] };
		for (const raw of o.serverFunctions.slice(0, MAX_SERVER_FUNCTIONS)) {
			const s = asObject(raw);
			const name = typeof s?.name === 'string' ? s.name.trim() : '';
			const collection = safeName(s?.collection);
			const trigger = typeof s?.trigger_event === 'string' ? s.trigger_event : '';
			if (!s || !name || !collection || !(DECLARATIVE_TRIGGER_EVENTS as readonly string[]).includes(trigger)) {
				warnings.push('Dropped a serverFunction with invalid name/collection/trigger_event');
				continue;
			}
			serverFunctions.push({
				name: name.slice(0, 100),
				collection,
				trigger_event: trigger,
				...(Array.isArray(s.rules) ? { rules: (s.rules as Array<Record<string, unknown>>).slice(0, 50) } : {}),
				...(typeof s.enabled === 'boolean' ? { enabled: s.enabled } : {}),
			});
		}
	}

	const apiKeys: FactoryApiKeySpec[] = [];
	if (o.apiKeys !== undefined) {
		if (!Array.isArray(o.apiKeys)) return { manifest: null, warnings: ['apiKeys must be an array'] };
		for (const raw of o.apiKeys.slice(0, MAX_API_KEYS)) {
			const k = asObject(raw);
			const name = typeof k?.name === 'string' ? k.name.trim() : '';
			const userId = typeof k?.user_id === 'string' ? k.user_id.trim() : '';
			if (!k || !name || !userId) {
				warnings.push('Dropped an apiKey missing name/user_id');
				continue;
			}
			const scope = k.scope === 'write' || k.scope === 'admin' ? k.scope : 'read';
			apiKeys.push({
				name: name.slice(0, 100),
				user_id: userId,
				...(typeof k.role_id === 'string' ? { role_id: k.role_id } : {}),
				scope,
			});
		}
	}

	return {
		manifest: {
			version: 1,
			collections,
			pages,
			roles,
			permissions,
			workflows,
			menus,
			kpis,
			// Presence-preserving for the RECONCILED domains (`serverFunctions` /
			// `apiKeys` / `schedules` / `reports`): an ABSENT key means "this manifest
			// does not manage that domain", so reconciliation skips it entirely. A
			// PRESENT key (even `[]`) is a full declaration of that domain's
			// manifest-owned set. See `findManifestRemovals`.
			...(o.serverFunctions !== undefined ? { serverFunctions } : {}),
			...(o.apiKeys !== undefined ? { apiKeys } : {}),
			...(o.schedules !== undefined ? { schedules } : {}),
			...(o.reports !== undefined ? { reports } : {}),
		},
		warnings,
	};
}
/** Existing collections → the set of field names each already declares. */
async function existingCollections(db: D1Client): Promise<Map<string, Set<string>>> {
	const rows = await safeAll<{ slug: string; schema_json: string }>(db, 'SELECT slug, schema_json FROM _entity_schemas');
	const out = new Map<string, Set<string>>();
	for (const r of rows) {
		let fields: Array<{ name?: unknown }> = [];
		try {
			const parsed = JSON.parse(r.schema_json || '{}') as { fields?: Array<{ name?: unknown }> };
			fields = Array.isArray(parsed.fields) ? parsed.fields : [];
		} catch {
			fields = [];
		}
		out.set(r.slug, new Set(fields.map((f) => String(f.name))));
	}
	return out;
}

/** A table owned by a plugin may not exist until that plugin's routes run — treat as empty. */
async function safeAll<T>(db: D1Client, sql: string): Promise<T[]> {
	try {
		return await db.all<T>({ sql, bindings: [] });
	} catch {
		return [];
	}
}

async function moduleIds(db: D1Client): Promise<Map<string, string>> {
	const rows = await safeAll<{ id: string; slug: string }>(db, 'SELECT id, slug FROM _modules');
	return new Map(rows.map((r) => [r.slug, r.id]));
}

async function existingPages(db: D1Client): Promise<Map<string, string>> {
	const rows = await safeAll<{ path: string; module_id: string | null; blocks_json: string }>(
		db,
		'SELECT path, module_id, blocks_json FROM _pages',
	);
	const out = new Map<string, string>();
	for (const r of rows) out.set(`${r.module_id ?? ''}${r.path}`, r.blocks_json);
	return out;
}

/**
 * A manifest-owned row the CURRENT declaration no longer names.
 * `id` is the row's primary key (the unit reconciliation acts on).
 */
interface ManifestRemoval {
	domain: 'schedule' | 'apiKey' | 'serverFunction' | 'report';
	id: string;
	target: string;
}

/**
 * Rows the manifest itself created (`source = 'manifest'`) that its current
 * declaration no longer names — the work item for reconciliation.
 *
 * Three invariants make this safe by construction:
 *   1. Only `source = 'manifest'` rows are ever returned — a `NULL` source
 *      (hand/Studio/CLI-created) is invisible, so a manifest can never nuke an
 *      unrelated job/key/hook/report. (The negative-control property.)
 *   2. Only DOMAINS THIS MANIFEST DECLARES are examined. An absent key means "not
 *      managed here", so a partial manifest (e.g. three `schedules` added to an
 *      existing app) can never touch another domain's rows.
 *   3. Each read is LIMIT-bounded (`RECONCILE_SCAN_LIMIT`) and swallows a missing
 *      table/column (a not-yet-migrated database) as "nothing owned" — it fails
 *      CLOSED (no deletion) rather than throwing.
 */
async function findManifestRemovals(db: D1Client, manifest: FactoryManifest): Promise<ManifestRemoval[]> {
	const removals: ManifestRemoval[] = [];
	const ownedWhere = `source = '${MANIFEST_SOURCE}' LIMIT ${RECONCILE_SCAN_LIMIT}`;

	if (manifest.schedules !== undefined) {
		const declared = new Set(manifest.schedules.map((s) => declaredId('mf_', s.name)));
		const owned = await safeAll<{ id: string; name: string | null }>(db, `SELECT id, name FROM _scheduler_tasks WHERE ${ownedWhere}`);
		for (const row of owned) {
			if (declared.has(row.id)) continue;
			removals.push({ domain: 'schedule', id: row.id, target: `schedule:${row.name ?? row.id}` });
		}
	}

	if (manifest.apiKeys !== undefined) {
		const declared = new Set(manifest.apiKeys.map((k) => k.name));
		const owned = await safeAll<{ id: string; name: string }>(db, `SELECT id, name FROM _api_keys WHERE ${ownedWhere}`);
		for (const row of owned) {
			if (declared.has(row.name)) continue;
			removals.push({ domain: 'apiKey', id: row.id, target: `apiKey:${row.name}` });
		}
	}

	if (manifest.serverFunctions !== undefined) {
		const declared = new Set(manifest.serverFunctions.map((s) => s.name));
		const owned = await safeAll<{ id: string; name: string }>(db, `SELECT id, name FROM _server_functions WHERE ${ownedWhere}`);
		for (const row of owned) {
			if (declared.has(row.name)) continue;
			removals.push({ domain: 'serverFunction', id: row.id, target: `serverFunction:${row.name}` });
		}
	}

	if (manifest.reports !== undefined) {
		const declared = new Set(manifest.reports.map((r) => declaredId('mfr_', r.name)));
		const owned = await safeAll<{ id: string; name: string }>(db, `SELECT id, name FROM _report_schedules WHERE ${ownedWhere}`);
		for (const row of owned) {
			if (declared.has(row.id)) continue;
			removals.push({ domain: 'report', id: row.id, target: `report:${row.name}` });
		}
	}

	return removals;
}

/** Diff a manifest against the live factory. READ-ONLY — never writes. */
export async function planManifest(db: D1Client, manifest: FactoryManifest): Promise<ManifestPlan> {
	const actions: ManifestAction[] = [];
	const warnings: string[] = [];

	const collections = await existingCollections(db);
	for (const c of manifest.collections ?? []) {
		const existing = collections.get(c.slug);
		if (!existing) {
			actions.push({ kind: 'create', target: `collection:${c.slug}`, detail: `create with ${c.fields.length} fields` });
			continue;
		}
		const missing = c.fields.filter((f) => !existing.has(f.name));
		if (missing.length === 0) {
			actions.push({ kind: 'skip', target: `collection:${c.slug}`, detail: 'already exists' });
		} else {
			actions.push({
				kind: 'update',
				target: `collection:${c.slug}`,
				detail: `add ${missing.length} field(s): ${missing.map((f) => f.name).join(', ')}`,
			});
		}
	}

	const modules = await moduleIds(db);
	const pages = await existingPages(db);
	for (const p of manifest.pages ?? []) {
		const moduleId = p.module ? (modules.get(p.module) ?? null) : null;
		const key = `${moduleId ?? ''}${p.path}`;
		if (!pages.has(key)) {
			actions.push({ kind: 'create', target: `page:${p.module ?? '-'}${p.path}`, detail: 'create page' });
			continue;
		}
		const next = JSON.stringify(p.blocks ?? []);
		if (pages.get(key) === next) actions.push({ kind: 'skip', target: `page:${p.module ?? '-'}${p.path}`, detail: 'unchanged' });
		else actions.push({ kind: 'update', target: `page:${p.module ?? '-'}${p.path}`, detail: 'update blocks' });
	}

	const auth = new AuthService(db);
	let existingRoles: Array<{ id: string; name: string }> = [];
	try {
		existingRoles = await auth.listRoles();
	} catch {
		existingRoles = [];
	}
	const roleNames = new Set(existingRoles.map((r) => r.name));
	for (const r of manifest.roles ?? []) {
		actions.push(
			roleNames.has(r.name)
				? { kind: 'skip', target: `role:${r.name}`, detail: 'already exists' }
				: { kind: 'create', target: `role:${r.name}`, detail: 'create role' },
		);
	}

	// A role created by THIS manifest still counts for its grants (plan is advisory).
	const willExist = new Set([...roleNames, ...(manifest.roles ?? []).map((r) => r.name)]);
	const roleIdByName = new Map(existingRoles.map((r) => [r.name, r.id]));
	const existingPerms = new Set(
		(await safeAll<{ role_id: string; collection_slug: string }>(db, 'SELECT role_id, collection_slug FROM _role_permissions')).map(
			(p) => `${p.role_id}|${p.collection_slug}`,
		),
	);
	for (const p of manifest.permissions ?? []) {
		if (!willExist.has(p.role)) {
			warnings.push(`permission on "${p.collection}" skipped: role "${p.role}" is not declared or existing`);
			continue;
		}
		const rid = roleIdByName.get(p.role);
		const exists = rid ? existingPerms.has(`${rid}|${p.collection}`) : false;
		actions.push({
			kind: exists ? 'update' : 'create',
			target: `permission:${p.role}/${p.collection}`,
			detail: exists ? 'replace grant' : 'grant',
		});
	}

	const existingWorkflows = new Set(
		(await safeAll<{ collection_slug: string }>(db, 'SELECT collection_slug FROM _workflows')).map((w) => w.collection_slug),
	);
	for (const w of manifest.workflows ?? []) {
		actions.push(
			existingWorkflows.has(w.collection)
				? { kind: 'update', target: `workflow:${w.collection}`, detail: 'upsert workflow' }
				: { kind: 'create', target: `workflow:${w.collection}`, detail: 'define workflow' },
		);
	}

	const existingMenus = new Set(
		(await safeAll<{ module_id: string; label: string }>(db, 'SELECT module_id, label FROM _module_menus')).map(
			(m) => `${m.module_id}|${m.label}`,
		),
	);
	for (const m of manifest.menus ?? []) {
		const moduleId = modules.get(m.module);
		if (!moduleId) {
			warnings.push(`menu "${m.label}" skipped: module "${m.module}" does not exist`);
			continue;
		}
		const exists = existingMenus.has(`${moduleId}|${m.label}`);
		actions.push({
			kind: exists ? 'skip' : 'create',
			target: `menu:${m.module}/${m.label}`,
			detail: exists ? 'already exists' : 'create menu item',
		});
	}

	const existingKpis = new Set((await safeAll<{ name: string }>(db, 'SELECT name FROM _kpis')).map((k) => k.name));
	for (const k of manifest.kpis ?? []) {
		actions.push(
			existingKpis.has(k.name)
				? { kind: 'update', target: `kpi:${k.name}`, detail: 'upsert kpi' }
				: { kind: 'create', target: `kpi:${k.name}`, detail: 'define kpi' },
		);
	}

	const existingHooks = new Set((await safeAll<{ name: string }>(db, 'SELECT name FROM _server_functions')).map((s) => s.name));
	for (const s of manifest.serverFunctions ?? []) {
		actions.push(
			existingHooks.has(s.name)
				? { kind: 'skip', target: `serverFunction:${s.name}`, detail: 'already exists' }
				: { kind: 'create', target: `serverFunction:${s.name}`, detail: `on ${s.trigger_event}` },
		);
	}

	const existingKeyNames = new Set((await safeAll<{ name: string }>(db, 'SELECT name FROM _api_keys')).map((k) => k.name));
	for (const k of manifest.apiKeys ?? []) {
		actions.push(
			existingKeyNames.has(k.name)
				? { kind: 'skip', target: `apiKey:${k.name}`, detail: 'already exists' }
				: { kind: 'create', target: `apiKey:${k.name}`, detail: `scope ${k.scope ?? 'read'}` },
		);
	}

	// A schedule's WORK is code (the handler registry); its TIMING is data. Seed
	// the builtins so this is deterministic regardless of plugin load order, then
	// refuse an unregistered type up front — a typo must not become a task row
	// that silently never runs.
	registerBuiltinHandlers();
	const existingTaskIds = new Set((await safeAll<{ id: string }>(db, 'SELECT id FROM _scheduler_tasks')).map((t) => t.id));
	for (const s of manifest.schedules ?? []) {
		const target = `schedule:${s.name}`;
		if (!hasHandler(s.type)) {
			warnings.push(`schedule "${s.name}" skipped: no handler registered for type "${s.type}" (see list_handlers)`);
			continue;
		}
		// A one-shot trigger that already exists has fired: re-arming it on replay
		// would run the job a second time, which a manifest replay must never do.
		if (s.run_now && existingTaskIds.has(declaredId('mf_', s.name))) {
			actions.push({ kind: 'skip', target, detail: 'one-shot already triggered' });
			continue;
		}
		actions.push({
			kind: 'update',
			target,
			detail: s.run_now
				? `run ${s.type} now, once`
				: `upsert ${s.type} on ${s.cron ?? `${s.repeat_ms}ms`}${s.timezone ? ` ${s.timezone}` : ''}`,
		});
	}

	const existingReportNames = new Set((await safeAll<{ name: string }>(db, 'SELECT name FROM _report_schedules')).map((r) => r.name));
	for (const r of manifest.reports ?? []) {
		actions.push(
			existingReportNames.has(r.name)
				? { kind: 'update', target: `report:${r.name}`, detail: 'upsert report definition' }
				: { kind: 'create', target: `report:${r.name}`, detail: `saved ${r.format ?? 'json'} export` },
		);
	}

	// Reconcile preview — rows THIS manifest created that it no longer declares.
	// `plan_manifest` NEVER writes; it only reports what an `apply` would remove.
	for (const removal of await findManifestRemovals(db, manifest)) {
		actions.push({
			kind: 'remove',
			target: removal.target,
			detail: 'manifest no longer declares this — removed on apply',
		});
	}

	const summary = { create: 0, update: 0, skip: 0, remove: 0 };
	for (const a of actions) summary[a.kind]++;
	return { actions, summary, warnings };
}

export interface ManifestApplyResult {
	plan: ManifestPlan;
	/** Per-item outcome. `secret` is present ONLY for a freshly created api key. */
	results: Array<{ target: string; ok: boolean; error?: string; secret?: string }>;
}

/** Apply a manifest. Idempotent; per-item failures are isolated. */
export async function applyManifest(
	db: D1Client,
	auth: AuthContext,
	manifest: FactoryManifest,
	env?: ManifestEnv,
): Promise<ManifestApplyResult> {
	// Core tables (e.g. `_pages`, `_entity_schemas`) must exist before a write.
	await new MigrationRunner(db).runPending();
	// `arm()` only touches the DO binding, so a missing namespace degrades to the
	// `*/10` reconcile watchdog rather than failing the write.
	const schedulerEnv = { DB: env?.DB, SCHEDULER: env?.SCHEDULER } as unknown as SchedulerEnv;
	const plan = await planManifest(db, manifest);
	const planByTarget = new Map(plan.actions.map((a) => [a.target, a]));
	const results: ManifestApplyResult['results'] = [];
	const svc = new CollectionService(db, auth);
	const existingCols = await existingCollections(db);

	for (const c of manifest.collections ?? []) {
		const target = `collection:${c.slug}`;
		const action = planByTarget.get(target)?.kind;
		if (action !== 'create' && action !== 'update') {
			results.push({ target, ok: true });
			continue;
		}
		try {
			if (action === 'create') {
				await svc.createCollection({
					slug: c.slug,
					name: c.name ?? c.slug,
					fields: c.fields.map(fieldDefinitionOf),
					...(c.naming_series ? { naming_series: c.naming_series } : {}),
					...(c.policies ? { policies: c.policies as never } : {}),
				});
			} else {
				// Evolve an existing collection: add ONLY the fields it lacks.
				const have = existingCols.get(c.slug) ?? new Set<string>();
				const missing = c.fields.filter((f) => !have.has(f.name)).map(fieldDefinitionOf);
				await svc.addCollectionFields(c.slug, missing);
			}
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'collection apply failed' });
		}
	}

	const modules = await moduleIds(db);
	const pages = new PageService(db, auth);
	for (const p of manifest.pages ?? []) {
		const target = `page:${p.module ?? '-'}${p.path}`;
		if (planByTarget.get(target)?.kind === 'skip') {
			results.push({ target, ok: true });
			continue;
		}
		try {
			await pages.save({
				module_id: p.module ? (modules.get(p.module) ?? null) : null,
				path: p.path,
				title: p.title,
				blocks: (p.blocks ?? []) as unknown as PageBlocks[],
			});
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'page save failed' });
		}
	}

	// ── roles → permissions → workflows → menus ──────────────
	const authz = new AuthService(db);
	for (const r of manifest.roles ?? []) {
		const target = `role:${r.name}`;
		if (planByTarget.get(target)?.kind !== 'create') {
			results.push({ target, ok: true });
			continue;
		}
		try {
			await authz.createRole({
				name: r.name,
				...(r.description ? { description: r.description } : {}),
				...(r.app_access ? { app_access: r.app_access } : {}),
			});
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'role create failed' });
		}
	}

	// Roles (including ones just created) are now resolvable for their grants.
	let roleIdByName = new Map<string, string>();
	try {
		roleIdByName = new Map((await authz.listRoles()).map((r) => [r.name, r.id]));
	} catch {
		roleIdByName = new Map();
	}
	for (const p of manifest.permissions ?? []) {
		const target = `permission:${p.role}/${p.collection}`;
		const roleId = roleIdByName.get(p.role);
		if (!roleId) {
			results.push({ target, ok: false, error: `role "${p.role}" not found` });
			continue;
		}
		try {
			await authz.setPermission({
				role_id: roleId,
				collection_slug: p.collection,
				can_read: p.can_read,
				can_write: p.can_write,
				can_create: p.can_create,
				can_delete: p.can_delete,
				can_approve: p.can_approve,
				can_submit: p.can_submit,
			});
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'permission failed' });
		}
	}

	const workflows = new WorkflowService(db);
	for (const w of manifest.workflows ?? []) {
		const target = `workflow:${w.collection}`;
		try {
			const definition = {
				name: w.name,
				collection: w.collection,
				initial: w.initial,
				states: w.states,
				transitions: w.transitions,
				...(w.doc_status_map ? { doc_status_map: w.doc_status_map } : {}),
				...(w.enabled === false ? { enabled: false } : {}),
			} as WorkflowDefinition;
			await workflows.upsert(definition);
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'workflow upsert failed' });
		}
	}

	const menus = new ModuleMenuService(db, auth);
	for (const m of manifest.menus ?? []) {
		const target = `menu:${m.module}/${m.label}`;
		if (planByTarget.get(target)?.kind === 'skip') {
			results.push({ target, ok: true });
			continue;
		}
		try {
			await menus.createMenuItem({
				module_slug: m.module,
				label: m.label,
				type: m.type ?? 'action',
				...(m.target ? { target: m.target } : {}),
				...(m.icon ? { icon: m.icon } : {}),
				...(m.sort_order !== undefined ? { sort_order: m.sort_order } : {}),
				...(m.roles ? { roles: m.roles } : {}),
				...(m.template ? { template: m.template } : {}),
			});
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'menu create failed' });
		}
	}

	// KPIs → materialized analytics definitions.
	const kpiSvc = new KpiService(db);
	for (const k of manifest.kpis ?? []) {
		const target = `kpi:${k.name}`;
		try {
			const definition = {
				name: k.name,
				collection: k.collection,
				agg: k.agg,
				...(k.description ? { description: k.description } : {}),
				...(k.field ? { field: k.field } : {}),
				...(k.filter ? { filter: k.filter } : {}),
				...(k.group_by ? { group_by: k.group_by } : {}),
				...(k.period ? { period: k.period } : {}),
				...(k.schedule ? { schedule: k.schedule } : {}),
				...(k.enabled === false ? { enabled: false } : {}),
			} as KpiDefinition;
			kpiSvc.validate(definition);
			await kpiSvc.upsert(definition);
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'kpi upsert failed' });
		}
	}

	// Declarative server functions (hooks) — create once.
	const hooks = new ServerFunctionService(db);
	for (const s of manifest.serverFunctions ?? []) {
		const target = `serverFunction:${s.name}`;
		if (planByTarget.get(target)?.kind !== 'create') {
			results.push({ target, ok: true });
			continue;
		}
		try {
			await hooks.create({
				name: s.name,
				collection_slug: s.collection,
				trigger_event: s.trigger_event as ServerFunctionInput['trigger_event'],
				...(s.rules ? { rules: s.rules as unknown as ServerFunctionInput['rules'] } : {}),
				...(s.enabled === false ? { enabled: false } : {}),
				source: MANIFEST_SOURCE,
			});
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'server function create failed' });
		}
	}

	// Scoped machine keys — the plaintext is surfaced ONCE in the result.
	const keys = new ApiKeyService(db);
	for (const k of manifest.apiKeys ?? []) {
		const target = `apiKey:${k.name}`;
		if (planByTarget.get(target)?.kind !== 'create') {
			results.push({ target, ok: true });
			continue;
		}
		try {
			const created = await keys.create({
				name: k.name,
				user_id: k.user_id,
				...(k.role_id ? { role_id: k.role_id } : {}),
				scope: (k.scope ?? 'read') as ApiKeyScope,
				source: MANIFEST_SOURCE,
			});
			results.push({ target, ok: true, secret: created.key });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'api key create failed' });
		}
	}

	// Recurring jobs — the TIMING is data (a `_scheduler_tasks` row), the WORK is
	// code (a registered handler, re-checked here so a plan/apply race cannot slip
	// an unknown type through). The id is derived from the name, so replaying a
	// manifest re-arms the same row instead of stacking duplicates.
	const scheduler = new SchedulerService(db);
	for (const s of manifest.schedules ?? []) {
		const target = `schedule:${s.name}`;
		if (planByTarget.get(target)?.kind === 'skip') {
			results.push({ target, ok: true });
			continue;
		}
		if (!hasHandler(s.type)) {
			results.push({ target, ok: false, error: `no handler registered for type "${s.type}" — see list_handlers` });
			continue;
		}
		try {
			await scheduler.schedule(
				{
					id: declaredId('mf_', s.name),
					type: s.type,
					name: s.name,
					...(s.cron ? { cron: s.cron } : {}),
					...(s.repeat_ms ? { repeatMs: s.repeat_ms } : {}),
					...(s.run_now ? { delayMs: 0 } : {}),
					...(s.timezone ? { timezone: s.timezone } : {}),
					...(s.payload ? { payload: s.payload } : {}),
					...(s.max_attempts ? { maxAttempts: s.max_attempts } : {}),
				},
				schedulerEnv,
				{ source: MANIFEST_SOURCE },
			);
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'schedule upsert failed' });
		}
	}

	// Saved report definitions — materialized on demand by the scheduled-reports
	// route. `cron` holds a sentinel: nothing dispatches that column yet, and an
	// invalid cron fails closed for any future dispatcher.
	for (const r of manifest.reports ?? []) {
		const target = `report:${r.name}`;
		try {
			await db.run({
				sql: `INSERT INTO _report_schedules (id, name, collection_slug, format, cron, group_by, aggregate, filter_json, enabled, source)
					VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 1, '${MANIFEST_SOURCE}')
					ON CONFLICT(id) DO UPDATE SET name = excluded.name, collection_slug = excluded.collection_slug, format = excluded.format, cron = excluded.cron, source = COALESCE(_report_schedules.source, excluded.source)`,
				bindings: [declaredId('mfr_', r.name), r.name, r.collection, r.format ?? 'json', REPORT_CRON_SENTINEL],
			});
			results.push({ target, ok: true });
		} catch (err) {
			results.push({ target, ok: false, error: err instanceof Error ? err.message : 'report upsert failed' });
		}
	}

	// ── Reconcile: remove manifest-owned rows this declaration dropped ───────
	// Runs LAST, after every upsert, so a declared row is never mistaken for an
	// orphan. Only `source = 'manifest'` rows are candidates (hand/Studio rows are
	// invisible), and only for domains THIS manifest declares.
	for (const removal of await findManifestRemovals(db, manifest)) {
		try {
			if (removal.domain === 'schedule') {
				// Deletes the row AND disarms its DO alarm (see SchedulerService.remove).
				await scheduler.remove(removal.id, schedulerEnv);
			} else if (removal.domain === 'apiKey') {
				await keys.delete(removal.id);
			} else if (removal.domain === 'serverFunction') {
				await hooks.delete(removal.id);
			} else {
				// The `source` guard is belt-and-suspenders on top of the selection.
				await db.run({
					sql: `DELETE FROM _report_schedules WHERE id = ? AND source = '${MANIFEST_SOURCE}'`,
					bindings: [removal.id],
				});
			}
			results.push({ target: removal.target, ok: true });
		} catch (err) {
			results.push({ target: removal.target, ok: false, error: err instanceof Error ? err.message : 'reconcile failed' });
		}
	}

	return { plan, results };
}

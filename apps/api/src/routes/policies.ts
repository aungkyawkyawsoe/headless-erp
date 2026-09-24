/**
 * Runtime Feature Policies — /api/collections/:slug/policies
 *
 * The headless control plane: enable/configure/dispose ENGINE behaviors per
 * collection at runtime via REST — no code, no redeploy. Any collection; any
 * feature. The engine reads the MERGED policy (env defaults × per-collection)
 * through the PolicyResolver.
 *
 *   GET    /api/collections/:slug/policies             → current per-collection policy (raw)
 *   GET    /api/collections/:slug/policies/resolved    → merged policy (defaults × collection)
 *   GET    /api/collections/:slug/policies/features    → discoverable feature list
 *   PUT    /api/collections/:slug/policies             → partial-merge update (enable/configure)
 *   DELETE /api/collections/:slug/policies/:feature    → dispose one feature (reset to default)
 *
 * Examples:
 *   PUT /api/collections/orders/policies      { "auto_index": { "mode": "propose" }, "cache": { "enabled": false } }
 *   DELETE /api/collections/orders/policies/cache
 */

import { Hono, type Context } from 'hono';
import { D1Client, QueryBuilder, resolvePolicy, policyFeatures, DEFAULT_POLICY } from '@mmbix/core';
import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { ifMatchGuard } from '@/lib/api/preconditions';
import { CollectionService } from '@/lib/services/collection.service';
import type { AuthContext } from '@/lib/services/auth.service';
import type { PolicyInput } from '@mmbix/core';

type PolicyBindings = {
	Bindings: { DB: D1Database; [key: string]: unknown };
	Variables: { auth: AuthContext };
};

const app = new Hono<PolicyBindings>();
app.use('*', requireAuth, requireAdmin);

function getService(c: Context<PolicyBindings>): CollectionService {
	return new CollectionService(new D1Client(c.env.DB), c.get('auth'));
}

const POLICY_TOP_LEVEL = new Set([
	'auto_index',
	'cache',
	'offline_reads',
	'writes',
	'search',
	'integrity',
	'actor_fields',
	'audit',
	'hooks',
]);

app.get('/', async (c) => {
	const svc = getService(c);
	const slug = c.req.param('slug') ?? '';
	await svc.ensureMigrations();
	let info;
	try {
		info = await svc.getCollection(slug);
	} catch {
		return fail(c, 'Collection not found', 404);
	}
	return success(c, info.policies ?? {});
});

app.get('/resolved', async (c) => {
	const svc = getService(c);
	const slug = c.req.param('slug') ?? '';
	await svc.ensureMigrations();
	try {
		const info = await svc.getCollection(slug);
		return success(c, resolvePolicy(info.policies));
	} catch {
		return fail(c, 'Collection not found', 404);
	}
});

app.get('/features', (c) => success(c, policyFeatures()));

app.put('/', async (c) => {
	const svc = getService(c);
	const slug = c.req.param('slug');
	await svc.ensureMigrations();
	const body = (await c.req.json().catch(() => null)) as PolicyInput | null;
	if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(c, 'Policies must be a JSON object', 400);
	// Reject unknown top-level features (headless discoverability / validation).
	for (const key of Object.keys(body)) {
		if (!POLICY_TOP_LEVEL.has(key)) return fail(c, `Unknown policy feature "${key}". Available: ${policyFeatures().join(', ')}`, 400);
	}
	const db = new D1Client(c.env.DB);
	const existing = await db.first<Record<string, unknown>>(QueryBuilder.from('_entity_schemas').select('*').where('slug', slug).toSelect());
	if (!existing) return fail(c, 'Collection not found', 404);
	// Optimistic concurrency — a stale `If-Match` refuses the policy write 409.
	const conflict = ifMatchGuard(c, Number(existing._schema_version ?? 1));
	if (conflict) return conflict;
	let schemaJson: Record<string, unknown>;
	try {
		schemaJson = JSON.parse(existing.schema_json as string);
	} catch {
		schemaJson = {};
	}
	// Merge deeply per-feature so updating one feature keeps the others.
	const merged = (schemaJson.policies ?? {}) as Record<string, unknown>;
	for (const [feature, patch] of Object.entries(body)) {
		if (patch === null) {
			delete merged[feature];
		} else if (Array.isArray(patch)) {
			// List-valued policy (actor_fields) — replace, never spread into an object.
			merged[feature] = patch;
		} else if (patch && typeof patch === 'object') {
			merged[feature] = { ...((merged[feature] as object) ?? {}), ...(patch as object) };
		} else {
			return fail(c, `Policy for "${feature}" must be an object, an array, or null`, 400);
		}
	}
	// A max age is a duration — reject nonsense before it reaches a device that
	// would then keep serving a stale body for an arbitrary window.
	const offline = merged.offline_reads as { max_age_s?: unknown } | undefined;
	if (offline && typeof offline === 'object' && offline.max_age_s !== undefined) {
		const n = Number(offline.max_age_s);
		if (!Number.isFinite(n) || n < 1) return fail(c, 'offline_reads.max_age_s must be a positive number of seconds', 400);
		offline.max_age_s = Math.floor(n);
	}
	// Write lock — reject nonsense before it lands, mirroring the offline_reads guard
	// above. `writes` is what makes "the domain service is the sole writer" an
	// enforced invariant (see ItemMutationService.assertGenericWrite).
	const writes = merged.writes as
		{ mode?: unknown; append_only?: unknown; confirmable?: unknown; frozen_fields?: unknown; freeze_when?: unknown } | undefined;
	if (writes && typeof writes === 'object') {
		if (writes.mode !== undefined && writes.mode !== 'any' && writes.mode !== 'service') {
			return fail(c, 'writes.mode must be "any" or "service"', 400);
		}
		if (writes.append_only !== undefined && typeof writes.append_only !== 'boolean') {
			return fail(c, 'writes.append_only must be a boolean', 400);
		}
		if (writes.confirmable !== undefined && typeof writes.confirmable !== 'boolean') {
			return fail(c, 'writes.confirmable must be a boolean', 400);
		}
		if (writes.frozen_fields !== undefined) {
			if (!Array.isArray(writes.frozen_fields) || writes.frozen_fields.some((f) => typeof f !== 'string' || !f.trim())) {
				return fail(c, 'writes.frozen_fields must be an array of non-empty field names', 400);
			}
			writes.frozen_fields = writes.frozen_fields.map((f) => (f as string).trim());
		}
		if (writes.freeze_when !== undefined && writes.freeze_when !== null) {
			const fw = writes.freeze_when as { field?: unknown; values?: unknown };
			if (
				typeof fw !== 'object' ||
				typeof fw.field !== 'string' ||
				!fw.field.trim() ||
				!Array.isArray(fw.values) ||
				fw.values.length === 0 ||
				fw.values.some((v) => typeof v !== 'string' || !v.trim())
			) {
				return fail(c, 'writes.freeze_when must be { field: string, values: non-empty string[] }', 400);
			}
			writes.freeze_when = { field: fw.field.trim(), values: (fw.values as string[]).map((v) => v.trim()) };
		}
	}
	// Search behavior — reject nonsense before it changes how a read matches.
	// `search.fields` mirrors the actor_fields list validation below.
	const search = merged.search as { mode?: unknown; fields?: unknown } | undefined;
	if (search && typeof search === 'object') {
		if (search.mode !== undefined && search.mode !== 'contains' && search.mode !== 'prefix') {
			return fail(c, 'search.mode must be "contains" or "prefix"', 400);
		}
		if (search.fields !== undefined) {
			if (!Array.isArray(search.fields) || search.fields.some((f) => typeof f !== 'string' || !f.trim())) {
				return fail(c, 'search.fields must be an array of non-empty field names', 400);
			}
			search.fields = search.fields.map((f) => (f as string).trim());
		}
	}
	// Integrity rules — validate shape before a malformed rule reaches the executor.
	const INTEGRITY_RULE_TYPES = new Set(['orphan', 'aggregate_mismatch', 'duplicate', 'stale']);
	const integrity = merged.integrity as { enabled?: unknown; limit?: unknown; rules?: unknown } | undefined;
	if (integrity && typeof integrity === 'object') {
		if (integrity.enabled !== undefined && typeof integrity.enabled !== 'boolean') {
			return fail(c, 'integrity.enabled must be a boolean', 400);
		}
		if (integrity.limit !== undefined) {
			const n = Number(integrity.limit);
			if (!Number.isFinite(n) || n < 1) return fail(c, 'integrity.limit must be a positive number', 400);
			integrity.limit = Math.min(Math.floor(n), 1000);
		}
		if (integrity.rules !== undefined) {
			if (!Array.isArray(integrity.rules)) return fail(c, 'integrity.rules must be an array', 400);
			for (const r of integrity.rules) {
				const type = r && typeof r === 'object' ? (r as { type?: unknown }).type : undefined;
				if (typeof type !== 'string' || !INTEGRITY_RULE_TYPES.has(type)) {
					return fail(c, `integrity rule type must be one of: ${[...INTEGRITY_RULE_TYPES].join(', ')}`, 400);
				}
			}
		}
	}
	const actorFields = merged.actor_fields;
	if (actorFields !== undefined) {
		if (!Array.isArray(actorFields) || actorFields.some((f) => typeof f !== 'string' || !f.trim())) {
			return fail(c, 'actor_fields must be an array of non-empty field names', 400);
		}
		merged.actor_fields = actorFields.map((f) => (f as string).trim());
	}
	schemaJson.policies = merged;
	// Policies live inside schema_json, so a policy write IS a schema change —
	// bump `_schema_version` in the SAME statement (parity with the fields PUT)
	// so clients/SDK staleness detection sees it and it stays one write.
	await db.run({
		sql: 'UPDATE _entity_schemas SET schema_json = ?, updated_at = ?, _schema_version = COALESCE(_schema_version, 1) + 1 WHERE slug = ?',
		bindings: [JSON.stringify(schemaJson), new Date().toISOString(), slug],
	});
	CollectionService.invalidateCache(slug);
	return success(c, merged);
});

app.delete('/:feature', async (c) => {
	const slug = c.req.param('slug');
	const feature = c.req.param('feature');
	if (!POLICY_TOP_LEVEL.has(feature)) return fail(c, `Unknown feature "${feature}"`, 400);
	const db = new D1Client(c.env.DB);
	const existing = await db.first<Record<string, unknown>>(QueryBuilder.from('_entity_schemas').select('*').where('slug', slug).toSelect());
	if (!existing) return fail(c, 'Collection not found', 404);
	const conflict = ifMatchGuard(c, Number(existing._schema_version ?? 1));
	if (conflict) return conflict;
	let schemaJson: Record<string, unknown>;
	try {
		schemaJson = JSON.parse(existing.schema_json as string);
	} catch {
		schemaJson = {};
	}
	const policies = (schemaJson.policies ?? {}) as Record<string, unknown>;
	delete policies[feature];
	schemaJson.policies = Object.keys(policies).length > 0 ? policies : undefined;
	// Same as the PUT above — a policy removal changes schema_json, so bump the
	// version counter in the same statement.
	await db.run({
		sql: 'UPDATE _entity_schemas SET schema_json = ?, updated_at = ?, _schema_version = COALESCE(_schema_version, 1) + 1 WHERE slug = ?',
		bindings: [JSON.stringify(schemaJson), new Date().toISOString(), slug],
	});
	CollectionService.invalidateCache(slug);
	return success(c, { removed: feature });
});

// Keep DEFAULT_POLICY referenced for documentation/value (reflects engine defaults).
export const __policyEngine = { featureList: policyFeatures(), defaults: DEFAULT_POLICY };

export const policyRoutes = app;

/**
 * Integrity Routes — /api/collections/:slug/integrity
 *
 * The generic data-quality (anomaly) surface: run a collection's declared
 * `policies.integrity.rules` (orphan / aggregate_mismatch / duplicate / stale)
 * as bounded reads and return the violations. Read-only, gated on the caller's
 * `can_read` for the collection — an integrity report reveals row data.
 *
 *   GET /api/collections/:slug/integrity → { enabled, checked, violations, results, errors }
 *
 * When the collection has no integrity policy (or it is disabled) the response
 * is `{ enabled: false }` with 200 — a client can ask safely.
 */
import { Hono, type Context } from 'hono';
import { D1Client, resolvePolicy } from '@mmbix/core';
import type { FieldDefinition } from '@mmbix/types';
import { requireAuth } from './auth';
import { requireCollectionRead } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';
import { CollectionService } from '@/lib/services/collection.service';
import { IntegrityService } from '@/lib/services/integrity.service';
import type { AuthContext } from '@/lib/services/auth.service';

type IntegrityBindings = {
	Bindings: { DB: D1Database; [key: string]: unknown };
	Variables: { auth: AuthContext };
};

const app = new Hono<IntegrityBindings>();
app.use('*', requireAuth);

app.get(
	'/',
	requireCollectionRead((c) => c.req.param('slug') ?? null),
	async (c: Context<IntegrityBindings>) => {
		const slug = c.req.param('slug') ?? '';
		const db = new D1Client(c.env.DB);
		const svc = new CollectionService(db, c.get('auth'));
		await svc.ensureMigrations();

		// One cached read of every schema (the engine's schema cache) → the fields of
		// the target + of every collection a rule might reference (`aggregate_mismatch`).
		const all = await svc.getCollections();
		const map = new Map<string, { fields: FieldDefinition[]; policies: unknown }>();
		for (const row of all) {
			try {
				const parsed = JSON.parse(row.schema_json || '{}') as { fields?: FieldDefinition[]; policies?: unknown };
				map.set(row.slug, { fields: Array.isArray(parsed.fields) ? parsed.fields : [], policies: parsed.policies ?? {} });
			} catch {
				map.set(row.slug, { fields: [], policies: {} });
			}
		}

		const self = map.get(slug);
		if (!self) return fail(c, 'Collection not found', 404, 'NOT_FOUND');

		const policy = resolvePolicy(self.policies as never);
		if (!policy.integrity.enabled || policy.integrity.rules.length === 0) {
			return success(c, { enabled: false, checked: 0, violations: 0, results: [], errors: [] });
		}

		const report = await new IntegrityService(db).run(
			slug,
			self.fields,
			(s) => map.get(s)?.fields ?? null,
			policy.integrity.rules,
			policy.integrity.limit,
		);
		return success(c, { enabled: true, ...report });
	},
);

export { app as integrityRoutes };

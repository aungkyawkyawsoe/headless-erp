/**
 * Query Batch Routes — POST /api/query
 *
 * The generic "one view = one round trip" endpoint: a view declares ALL its
 * data needs as keyed { collection, params } specs, the server executes them
 * in PARALLEL through the same entity engine (row filters + field
 * restrictions + response cache apply per collection automatically) and
 * returns one keyed payload. This is the generic form of the hand-crafted
 * `/api/hr/attendance/summary` consolidation — any view can now batch its
 * reads without writing a bespoke endpoint.
 *
 * Per-key error isolation: a failing collection (missing, permission denied,
 * bad params) yields `ok: false` for THAT key — the rest of the view still
 * renders.
 */
import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { requireAuth } from './auth';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { SmartCollectionService } from '@/lib/services/smart-collection.service';
import { success, fail } from '@/lib/api/response';
import type { AuthContext } from '@/lib/services/auth.service';

type QueryBindings = {
	Bindings: { DB: D1Database; [key: string]: unknown };
	Variables: { auth: AuthContext };
};

interface QuerySpec {
	key?: string;
	collection?: string;
	/** URL search params as a flat record (the client's serialized query). */
	params?: Record<string, string>;
}

/** Upper bound on queries per batch — a view legitimately needs a handful. */
const MAX_QUERIES_PER_BATCH = 12;

const app = new Hono<QueryBindings>();
app.use('*', requireAuth);

app.post('/', async (c: Context<QueryBindings>) => {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);

	const body = (await c.req.json().catch(() => null)) as { queries?: QuerySpec[] } | null;
	// Keep the slice for backward compat, but surface truncation: >12 specs are
	// dropped (not failed) and the response meta advertises truncated: true.
	// A NON-ARRAY `queries` (a map, a string) is a client error, not a server one —
	// without the guard `requested.slice` threw and the request answered 500.
	const requested = Array.isArray(body?.queries) ? body.queries : [];
	const truncated = requested.length > MAX_QUERIES_PER_BATCH;
	const specs = requested.slice(0, MAX_QUERIES_PER_BATCH);
	if (specs.length === 0) return fail(c, 'queries[] with at least one { key, collection } is required', 422);

	const svc = new SmartCollectionService(db, auth);
	await svc.ensureMigrations();

	const results = await Promise.all(
		specs.map(async (spec) => {
			const collection = String(spec.collection ?? '');
			const key = spec.key || collection;
			if (!collection) return { key, ok: false as const, error: 'collection is required' };

			// Collection-level read gate (the same check entity routes run).
			if (!auth.is_admin) {
				const allowed = await PermissionEvaluator.checkBusiness(db, auth, collection, 'read');
				if (!allowed) return { key, ok: false as const, error: 'You do not have "read" permission on this collection' };
			}

			try {
				const url = new URL(`http://internal/${collection}`);
				for (const [k, v] of Object.entries(spec.params ?? {})) url.searchParams.set(k, v);
				const page = await svc.listItems(collection, url);
				return { key, ok: true as const, data: page.data, meta: page.meta };
			} catch (err) {
				return { key, ok: false as const, error: err instanceof Error ? err.message : String(err) };
			}
		}),
	);

	return success(c, { results }, 200, truncated ? { truncated: true } : undefined);
});

export const queryRoutes = app;

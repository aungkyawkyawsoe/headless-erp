/**
 * Studio worker — production host for the Studio SPA.
 *
 * In local dev the Studio talks to the API worker through Vite's proxy and its
 * `/__studio/*` metadata is served by the dev-only Vite plugin
 * (apps/studio/studio.db/vitePlugin.ts, backed by the committed local sqlite).
 * Neither exists in a static production build, so this worker provides both:
 *
 *   - Cloudflare Assets serve the built SPA (`assets.not_found_handling:
 *     single-page-application`), exactly like the client app worker.
 *   - `/api/*` + `/trpc/*` are proxied to the core API worker through the
 *     private `API` service binding (no CORS, no public API exposure).
 *   - `/__studio/*` re-implements the dev plugin's metadata routes against a
 *     D1 database (`STUDIO_DB`) — same table-driven upsert/delete surface, so
 *     the browser code is identical in dev and prod. Reads (meta/prompt) are
 *     open (the catalog is design-time metadata, non-sensitive); writes are
 *     gated behind the SAME admin session the Studio logs in with (verified by
 *     calling back through the `API` service binding — the JWT secret never
 *     lives in this worker).
 *
 * What is deliberately NOT here: `/sync-ds` and `/reset` from the dev plugin.
 * Both spawn node / import the design system at runtime, which cannot run on
 * workerd — ds_exports is (re)seeded at deploy time from the committed
 * studio.db (see apps/studio/studio.db/d1-export.js).
 */

import { encodeMeta } from '../src/lib/meta-codec';

interface Env {
	ASSETS: Fetcher;
	/** Private service binding → the core API worker (WORKER_API in infra/env.prod). */
	API: Fetcher;
	/** D1 holding a copy of the studio metadata tables (schema.sql). */
	STUDIO_DB: D1Database;
}

type Row = Record<string, unknown>;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});
}

/* ── Reads — mirror the vite plugin's snapshot() ──────────────────────────── */

const SNAPSHOT_QUERIES: Array<[string, string]> = [
	['components', 'SELECT * FROM design_components WHERE is_active = 1 ORDER BY sort_order'],
	['props', 'SELECT * FROM component_props ORDER BY component_id, sort_order'],
	['styles', 'SELECT * FROM component_styles ORDER BY component_id, sort_order'],
	['events', 'SELECT * FROM component_events'],
	['viewModes', 'SELECT * FROM view_modes ORDER BY sort_order'],
	['templates', 'SELECT * FROM page_templates ORDER BY sort_order'],
	['templateViews', 'SELECT * FROM template_views ORDER BY template_id, sort_order'],
	['stylePresets', 'SELECT * FROM style_presets ORDER BY group_key, sort_order'],
	['eventActions', 'SELECT * FROM event_action_types ORDER BY sort_order'],
	['dsExports', 'SELECT * FROM ds_exports ORDER BY export_name'],
	['config', 'SELECT * FROM studio_config'],
	['shortcuts', 'SELECT * FROM keyboard_shortcuts ORDER BY sort_order'],
];

async function snapshot(db: D1Database): Promise<Record<string, Row[]>> {
	const out: Record<string, Row[]> = {};
	// ONE D1 round trip for the whole catalog. As 12 parallel `prepare().all()`
	// calls this was 12 round trips — paid on every cache MISS of `/meta` and on
	// EVERY `/prompt` read (which is not edge-cached). `batch()` runs all the
	// statements in a single call and returns their results in order.
	const results = await db.batch(SNAPSHOT_QUERIES.map(([, sql]) => db.prepare(sql)));
	for (let i = 0; i < SNAPSHOT_QUERIES.length; i++) {
		out[SNAPSHOT_QUERIES[i][0]] = (results[i]?.results ?? []) as unknown as Row[];
	}
	return out;
}

/* ── Writes — table-driven, ported 1:1 from the vite plugin's ROUTES ────────
 * Each upsert is `INSERT … ON CONFLICT DO UPDATE`; each delete is one or more
 * `DELETE`s. Multi-statement operations run in ONE `db.batch()` (atomic) — D1
 * does not enforce FK cascades, so the explicit cascade DELETEs below matter. */

type BindFromBody = (b: Row) => Array<string | number | null>;
type BindFromParams = (p: URLSearchParams) => Array<string | number | null>;
type DeleteGuard = (db: D1Database, p: URLSearchParams) => Promise<string | null>;

interface UpsertSpec {
	/** Body keys that must be present (non-empty). */
	required: string[];
	sql: string;
	bind: BindFromBody;
	/** Statements run right after the upsert in the SAME batch (e.g. replace a template's views). */
	extra?: (b: Row) => Array<{ sql: string; bind: Array<string | number | null> }>;
}

interface DeleteSpec {
	/** Query params that must be present. */
	required: string[];
	statements: Array<{ sql: string; bind: BindFromParams }>;
	guard?: DeleteGuard;
}

interface RouteSpec {
	path: string;
	upsert?: UpsertSpec;
	delete?: DeleteSpec;
}

const ROUTES: RouteSpec[] = [
	{
		path: '/component',
		upsert: {
			required: ['name'],
			sql: `INSERT INTO design_components (id, name, label, group_name, icon, def_type, defaults_json, capabilities_json, is_active, is_system, sort_order)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?)
				ON CONFLICT(name) DO UPDATE SET
					label = excluded.label, group_name = excluded.group_name, icon = excluded.icon,
					def_type = excluded.def_type, defaults_json = excluded.defaults_json,
					capabilities_json = excluded.capabilities_json, sort_order = excluded.sort_order`,
			bind: (b) => [
				String(b.id ?? `custom/${b.name}`),
				String(b.name),
				String(b.label ?? b.name),
				String(b.group_name ?? 'Content'),
				String(b.icon ?? 'box'),
				String(b.def_type ?? 'page_block'),
				String(b.defaults_json ?? '{}'),
				String(b.capabilities_json ?? '{}'),
				Number(b.sort_order ?? 1000),
			],
		},
		delete: {
			required: ['name'],
			// Cascade: remove the component's props/styles/events, then the row itself.
			statements: [
				{
					sql: 'DELETE FROM component_props WHERE component_id IN (SELECT id FROM design_components WHERE name = ?)',
					bind: (p) => [p.get('name')],
				},
				{
					sql: 'DELETE FROM component_styles WHERE component_id IN (SELECT id FROM design_components WHERE name = ?)',
					bind: (p) => [p.get('name')],
				},
				{
					sql: 'DELETE FROM component_events WHERE component_id IN (SELECT id FROM design_components WHERE name = ?)',
					bind: (p) => [p.get('name')],
				},
				{ sql: 'DELETE FROM design_components WHERE name = ?', bind: (p) => [p.get('name')] },
			],
		},
	},
	{
		path: '/component/prop',
		upsert: {
			required: ['component_id', 'config_key'],
			sql: `INSERT INTO component_props (id, component_id, config_key, label, prop_type, options_json, placeholder, default_value, is_required, is_readonly, hint_text, sort_order)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(component_id, config_key) DO UPDATE SET
					label = excluded.label, prop_type = excluded.prop_type, options_json = excluded.options_json,
					placeholder = excluded.placeholder, default_value = excluded.default_value,
					is_required = excluded.is_required, hint_text = excluded.hint_text, sort_order = excluded.sort_order`,
			bind: (b) => [
				String(b.id ?? `${b.component_id}.${b.config_key}`),
				String(b.component_id),
				String(b.config_key),
				String(b.label ?? b.config_key),
				String(b.prop_type ?? 'text'),
				b.options_json != null ? String(b.options_json) : null,
				b.placeholder != null ? String(b.placeholder) : null,
				b.default_value != null ? String(b.default_value) : null,
				Number(b.is_required ?? 0),
				0,
				b.hint_text != null ? String(b.hint_text) : null,
				Number(b.sort_order ?? 0),
			],
		},
		delete: {
			required: ['component_id'],
			statements: [{ sql: 'DELETE FROM component_props WHERE component_id = ?', bind: (p) => [p.get('component_id')] }],
		},
	},
	{
		path: '/component/style',
		upsert: {
			required: ['component_id', 'style_key'],
			sql: `INSERT INTO component_styles (component_id, style_key, label, style_type, preset_group, default_val, sort_order)
				VALUES (?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(component_id, style_key) DO UPDATE SET
					label = excluded.label, style_type = excluded.style_type, preset_group = excluded.preset_group,
					default_val = excluded.default_val, sort_order = excluded.sort_order`,
			bind: (b) => [
				String(b.component_id),
				String(b.style_key),
				String(b.label ?? b.style_key),
				String(b.style_type ?? 'preset'),
				b.preset_group != null ? String(b.preset_group) : null,
				b.default_val != null ? String(b.default_val) : null,
				Number(b.sort_order ?? 0),
			],
		},
		delete: {
			required: ['component_id'],
			statements: [{ sql: 'DELETE FROM component_styles WHERE component_id = ?', bind: (p) => [p.get('component_id')] }],
		},
	},
	{
		path: '/component/event',
		upsert: {
			required: ['component_id', 'event_name'],
			sql: `INSERT INTO component_events (component_id, event_name, event_type, description)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(component_id, event_name) DO UPDATE SET
					event_type = excluded.event_type, description = excluded.description`,
			bind: (b) => [
				String(b.component_id),
				String(b.event_name),
				String(b.event_type ?? 'action_list'),
				b.description != null ? String(b.description) : null,
			],
		},
		delete: {
			required: ['component_id'],
			statements: [{ sql: 'DELETE FROM component_events WHERE component_id = ?', bind: (p) => [p.get('component_id')] }],
		},
	},
	{
		path: '/template',
		upsert: {
			required: ['key'],
			sql: `INSERT INTO page_templates (key, label, description, is_default, sort_order)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(key) DO UPDATE SET label = excluded.label, description = excluded.description, is_default = excluded.is_default, sort_order = excluded.sort_order`,
			bind: (b) => [
				String(b.key),
				String(b.label ?? b.key),
				b.description != null ? String(b.description) : null,
				Number(b.is_default ?? 0),
				Number(b.sort_order ?? 100),
			],
			// Replace the template's views wholesale (delete + re-insert) — atomic with the upsert.
			extra: (b) => {
				const key = String(b.key);
				const views = Array.isArray(b.views) ? b.views.map(String) : [];
				const stmts: Array<{ sql: string; bind: Array<string | number | null> }> = [
					{ sql: 'DELETE FROM template_views WHERE template_id = ?', bind: [key] },
				];
				const ins = 'INSERT INTO template_views (template_id, view_key, sort_order) VALUES (?, ?, ?)';
				views.forEach((v, i) => stmts.push({ sql: ins, bind: [key, v, i] }));
				return stmts;
			},
		},
		delete: {
			required: ['key'],
			statements: [{ sql: 'DELETE FROM page_templates WHERE key = ?', bind: (p) => [p.get('key')] }],
		},
	},
	{
		path: '/style-preset',
		upsert: {
			required: ['group_key', 'value_key'],
			sql: `INSERT INTO style_presets (group_key, value_key, label, css_value, sort_order)
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT(group_key, value_key) DO UPDATE SET
					label = excluded.label, css_value = excluded.css_value, sort_order = excluded.sort_order`,
			bind: (b) => [
				String(b.group_key),
				String(b.value_key),
				String(b.label ?? b.value_key),
				b.css_value != null ? String(b.css_value) : null,
				Number(b.sort_order ?? 0),
			],
		},
		delete: {
			required: ['group_key', 'value_key'],
			statements: [
				{ sql: 'DELETE FROM style_presets WHERE group_key = ? AND value_key = ?', bind: (p) => [p.get('group_key'), p.get('value_key')] },
			],
		},
	},
	{
		path: '/event-action',
		upsert: {
			required: ['action_key'],
			sql: `INSERT INTO event_action_types (action_key, label, params_json, sort_order)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(action_key) DO UPDATE SET
					label = excluded.label, params_json = excluded.params_json, sort_order = excluded.sort_order`,
			bind: (b) => [String(b.action_key), String(b.label ?? b.action_key), String(b.params_json ?? '[]'), Number(b.sort_order ?? 0)],
		},
		delete: {
			required: ['action_key'],
			statements: [{ sql: 'DELETE FROM event_action_types WHERE action_key = ?', bind: (p) => [p.get('action_key')] }],
		},
	},
	{
		path: '/ds-export',
		upsert: {
			required: ['name'],
			sql: 'UPDATE ds_exports SET is_used = ?, category = ?, has_props = ? WHERE export_name = ?',
			bind: (b) => [Number(b.is_used ?? 0), String(b.category ?? 'general'), Number(b.has_props ?? 0), String(b.name)],
		},
	},
	{
		path: '/view-mode',
		upsert: {
			required: ['key'],
			sql: `INSERT INTO view_modes (key, label, icon, data_configurable, block_fallback, groupable, field_visible, sortable, description, sort_order)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(key) DO UPDATE SET
					label = excluded.label, icon = excluded.icon, data_configurable = excluded.data_configurable,
					block_fallback = excluded.block_fallback, groupable = excluded.groupable,
					field_visible = excluded.field_visible, sortable = excluded.sortable,
					description = excluded.description, sort_order = excluded.sort_order`,
			bind: (b) => [
				String(b.key),
				String(b.label ?? b.key),
				String(b.icon ?? 'table'),
				Number(b.data_configurable ?? 1),
				Number(b.block_fallback ?? 0),
				Number(b.groupable ?? 0),
				Number(b.field_visible ?? 1),
				Number(b.sortable ?? 0),
				b.description != null ? String(b.description) : null,
				Number(b.sort_order ?? 0),
			],
		},
		delete: {
			required: ['key'],
			statements: [{ sql: 'DELETE FROM view_modes WHERE key = ?', bind: (p) => [p.get('key')] }],
			guard: async (db, p) => {
				const { results } = await db.prepare('SELECT COUNT(*) AS c FROM template_views WHERE view_key = ?').bind(p.get('key')).all();
				const used = results[0] as { c?: number } | undefined;
				return (used?.c ?? 0) > 0 ? `view mode is used by ${used?.c ?? 0} template(s)` : null;
			},
		},
	},
	{
		path: '/config',
		upsert: {
			required: ['config_key'],
			sql: `INSERT INTO studio_config (config_key, config_val, description)
				VALUES (?, ?, ?)
				ON CONFLICT(config_key) DO UPDATE SET config_val = excluded.config_val, description = excluded.description, updated_at = datetime('now')`,
			bind: (b) => [String(b.config_key), String(b.config_val ?? '{}'), b.description != null ? String(b.description) : null],
		},
		delete: {
			required: ['key'],
			statements: [{ sql: 'DELETE FROM studio_config WHERE config_key = ?', bind: (p) => [p.get('key')] }],
		},
	},
];

/* ── /__studio request handler ────────────────────────────────────────────── */

/** Verify the bearer token against the API worker and require an admin session. */
async function isAdminSession(env: Env, request: Request): Promise<boolean> {
	const authz = request.headers.get('Authorization');
	if (!authz) return false;
	try {
		// Call back through the private service binding — this worker never holds JWT_SECRET.
		const res = await env.API.fetch('https://mff-sys-api/api/auth/me', { headers: { Authorization: authz } });
		if (!res.ok) return false;
		const body = (await res.json()) as { success?: boolean; data?: { is_admin?: boolean } };
		return body.success === true && body.data?.is_admin === true;
	} catch {
		return false;
	}
}

/**
 * The catalog version — a marker bumped by every admin write. It keys the edge
 * cache so a GET can serve the near-static snapshot without re-reading D1, while
 * an edit lands on the very next request from ANY colo (the key changes, so no
 * cross-colo purge is needed). Absent ⇒ '0'.
 */
async function catalogVersion(db: D1Database): Promise<string> {
	const { results } = await db.prepare("SELECT config_val FROM studio_config WHERE config_key = 'meta_version'").all();
	return String((results[0] as { config_val?: string } | undefined)?.config_val ?? '0');
}

/** Bump the catalog version after a write so cached snapshots are re-keyed. */
async function bumpCatalogVersion(db: D1Database): Promise<void> {
	await db
		.prepare(
			"INSERT INTO studio_config (config_key, config_val) VALUES ('meta_version', ?) " +
				"ON CONFLICT(config_key) DO UPDATE SET config_val = excluded.config_val, updated_at = datetime('now')",
		)
		.bind(String(Date.now()))
		.run();
}

async function handleStudio(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	const db = env.STUDIO_DB;
	if (!db) return json(503, { error: '/__studio is unavailable — STUDIO_DB binding missing' });
	const url = new URL(request.url);
	const path = url.pathname.startsWith('/__studio') ? url.pathname.slice('/__studio'.length) : url.pathname;
	const method = request.method;

	try {
		// Read-only snapshot endpoints (mirror the dev plugin).
		//
		// `/meta` is the app's hot path. The catalog is near-static — it changes only
		// when an admin writes — so serving it from D1 on every view was the one
		// avoidable cost. It is (a) edge-cached under a version key and (b) sent in
		// the compact columnar wire form, so a repeat read costs one tiny version
		// query and about half the bytes. `/prompt` stays raw and readable for LLMs.
		if (path === '/meta' && method === 'GET') {
			const version = await catalogVersion(db);
			const etag = `"meta-${version}"`;
			if (request.headers.get('If-None-Match') === etag) {
				return new Response(null, { status: 304, headers: { ETag: etag } });
			}
			const cacheKey = new Request(`https://studio-meta.internal/meta?v=${version}`);
			const cached = await caches.default.match(cacheKey);
			if (cached) return cached;
			const response = json(200, encodeMeta(await snapshot(db)), {
				ETag: etag,
				'Cache-Control': 'public, max-age=31536000, immutable',
			});
			ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
			return response;
		}
		if (path === '/prompt' && method === 'GET') {
			return json(200, {
				role: 'studio-metadata',
				description: 'Complete catalog of what the visual page builder can create. Use this to generate valid page configurations.',
				tables: await snapshot(db),
			});
		}

		const route = ROUTES.find((r) => r.path === path);
		if (!route) return json(404, { error: 'Not Found' });

		// Writes mutate shared design metadata — require the Studio admin session.
		if (!(await isAdminSession(env, request))) {
			return request.headers.get('Authorization')
				? json(403, { error: 'Admin session required' })
				: json(401, { error: 'Authentication required' });
		}

		if (method === 'POST' && route.upsert) {
			const body = (await request.json().catch(() => ({}))) as Row;
			const missing = route.upsert.required.filter((k) => !String(body[k] ?? '').trim());
			if (missing.length) return json(400, { error: `${missing.join(', ')} required` });
			const stmts = [{ sql: route.upsert.sql, bind: route.upsert.bind(body) }, ...(route.upsert.extra?.(body) ?? [])];
			await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...s.bind)));
			await bumpCatalogVersion(db);
			return json(200, { ok: true });
		}

		if (method === 'DELETE' && route.delete) {
			const missing = route.delete.required.filter((k) => !url.searchParams.get(k));
			if (missing.length) return json(400, { error: `${missing.join(', ')} param(s) required` });
			if (route.delete.guard) {
				const guardErr = await route.delete.guard(db, url.searchParams);
				if (guardErr) return json(400, { error: guardErr });
			}
			await db.batch(route.delete.statements.map((s) => db.prepare(s.sql).bind(...s.bind(url.searchParams))));
			await bumpCatalogVersion(db);
			return json(200, { ok: true });
		}

		return json(405, { error: 'Method Not Allowed' });
	} catch (e) {
		// Never leak internal error strings (SQL, stack frames) to callers.
		console.error('[studio /__studio] request failed:', e instanceof Error ? e.stack || e.message : e);
		return json(500, { error: 'studio metadata request failed' });
	}
}

/* ── Worker entrypoint ────────────────────────────────────────────────────── */

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/health') {
			return Response.json({ status: 'ok', worker: 'studio' });
		}

		// Core API proxy (REST + tRPC) — private service binding. Exact-segment
		// match: `/api/…`, `/trpc` or `/trpc/…`, never `/apifoo`.
		if ((url.pathname.startsWith('/api/') || url.pathname === '/trpc' || url.pathname.startsWith('/trpc/')) && env.API) {
			return env.API.fetch(request);
		}

		// Studio metadata — production stand-in for the dev-only Vite plugin.
		if (url.pathname.startsWith('/__studio')) return handleStudio(request, env, ctx);

		// SPA routes → Cloudflare Assets (not_found_handling: single-page-application).
		if (env.ASSETS) return env.ASSETS.fetch(request);
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;

/**
 * Vite plugin — serves the studio metadata database as JSON.
 *
 * Mounted on a dedicated `/__studio` prefix (NOT `/api`) so the dev-only metadata
 * server can never collide with the API worker's route space behind the Vite proxy.
 *
 * Read endpoints:
 *   GET  /__studio/meta    → full metadata snapshot
 *   GET  /__studio/prompt  → AI-ready schema prompt (compact JSON for LLMs)
 *
 * Write endpoints (local studio.db — git-committed). Each is a thin upsert/delete
 * over one table, so they are declared as data in `ROUTES` below rather than as
 * ~20 hand-written handlers:
 *   POST/DELETE /component · /component/prop · /component/style · /component/event
 *   POST/DELETE /template · /style-preset · /event-action · /view-mode · /config
 *   POST /ds-export (update) · /sync-ds · /reset
 *
 * The database is opened read-only for reads; writes open it read-write.
 * If studio.db is missing it is rebuilt automatically. Everything is local.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Plugin, Connect } from 'vite';
import { encodeMeta } from '../src/lib/meta-codec';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, 'studio.db');
const buildScript = join(here, 'build.js');

function ensureBuilt() {
	if (!existsSync(dbPath)) {
		const r = spawnSync(process.execPath, [buildScript], { stdio: 'inherit' });
		if (r.status !== 0) throw new Error(`studio.db build failed (status ${r.status})`);
	}
}

function openDb(write = false) {
	ensureBuilt();
	const db = new DatabaseSync(dbPath, write ? {} : { readOnly: true });
	// SQLite does NOT enforce FKs by default — required for ON DELETE CASCADE.
	if (write) db.exec('PRAGMA foreign_keys = ON');
	return db;
}

function snapshot(db: DatabaseSync): Record<string, unknown> {
	const q = (sql: string) => db.prepare(sql).all();
	return {
		components: q('SELECT * FROM design_components WHERE is_active = 1 ORDER BY sort_order'),
		props: q('SELECT * FROM component_props ORDER BY component_id, sort_order'),
		styles: q('SELECT * FROM component_styles ORDER BY component_id, sort_order'),
		events: q('SELECT * FROM component_events'),
		viewModes: q('SELECT * FROM view_modes ORDER BY sort_order'),
		templates: q('SELECT * FROM page_templates ORDER BY sort_order'),
		templateViews: q('SELECT * FROM template_views ORDER BY template_id, sort_order'),
		stylePresets: q('SELECT * FROM style_presets ORDER BY group_key, sort_order'),
		eventActions: q('SELECT * FROM event_action_types ORDER BY sort_order'),
		dsExports: q('SELECT * FROM ds_exports ORDER BY export_name'),
		config: q('SELECT * FROM studio_config'),
		shortcuts: q('SELECT * FROM keyboard_shortcuts ORDER BY sort_order'),
	};
}

/** Re-scan the installed @mmbix/design-system package into ds_exports (idempotent). */
async function syncDsExports(db: DatabaseSync): Promise<number> {
	const DS = await import('@mmbix/design-system');
	const names = Object.keys(DS).filter((n) => /^[A-Z]/.test(n));
	const isAtom = (n: string) =>
		/(Button|Badge|Input|Label|Avatar|Checkbox|Switch|Slider|Progress|Rating|Separator|Skeleton|Spinner|Kbd|Tag|Textarea|SearchBox|NativeSelect)$/.test(
			n,
		);
	const isBlock = (n: string) =>
		/(Card|Table|Alert|Bubble|LinksCard|ChoiceCard|Tabs|Accordion|Empty|Message|Code|Collapsible|Timeline)$/.test(n) && !isAtom(n);
	const isModule = (n: string) =>
		/(DataTable|Kanban|Calendar|DatePicker|Combobox|Signature|TextEditor|File|M2O|Sidebar|AppShell|Breadcrumb|Chart|Carousel|Command|Sheet|Drawer|Dialog|Popover|Tooltip|DropdownMenu|Select|TagsInput|ColorPicker|Checkbox)$/.test(
			n,
		) &&
		!isAtom(n) &&
		!isBlock(n);

	const upsert = db.prepare(`INSERT OR REPLACE INTO ds_exports (export_name, ds_level, category, has_props, is_used)
		VALUES (?, ?, ?, ?, ?)`);
	db.exec('BEGIN');
	let count = 0;
	for (const n of names) {
		const level = isAtom(n) ? 'atom' : isBlock(n) ? 'block' : isModule(n) ? 'module' : null;
		if (!level) continue;
		// is_used defaults to 1 (opt-out): the palette shows DB-flagged exports unless toggled off.
		upsert.run(n, level, 'general', 1, 1);
		count++;
	}
	db.exec('COMMIT');
	return count;
}

/** Parse a JSON request body into an object ({} on failure). */
function readJson(req: Connect.IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve) => {
		let body = '';
		req.on('data', (chunk: Buffer) => {
			body += chunk.toString();
		});
		req.on('end', () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch {
				resolve({});
			}
		});
		req.on('error', () => resolve({}));
	});
}

function send(res: ServerResponse, status: number, data: unknown) {
	res.statusCode = status;
	res.setHeader('Content-Type', 'application/json');
	res.end(JSON.stringify(data));
}

/* ── Table-driven write routes ────────────────────────────────
 * Every upsert is `INSERT … ON CONFLICT DO UPDATE`; every delete is one or more
 * `DELETE` statements. Only the SQL, required keys, and bind values differ, so
 * each route is declared as data instead of a hand-written handler. */

type UpsertBind = (body: Record<string, unknown>) => Array<string | number | null>;
type DeleteBind = (params: URLSearchParams) => Array<string | number | null>;

interface UpsertSpec {
	/** Body keys that must be present (non-empty). */
	required: string[];
	sql: string;
	bind: UpsertBind;
	/** Extra statements after the upsert (e.g. template → replace its views). */
	after?: (db: DatabaseSync, body: Record<string, unknown>) => void;
}

interface DeleteSpec {
	/** Query params that must be present. */
	required: string[];
	statements: Array<{ sql: string; bind: DeleteBind }>;
	/** Optional guard — returns an error message to reject the delete, or null to allow. */
	guard?: (db: DatabaseSync, params: URLSearchParams) => string | null;
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
			// Replace the template's views wholesale (delete + re-insert).
			after: (db, b) => {
				const key = String(b.key);
				const views = Array.isArray(b.views) ? b.views.map(String) : [];
				db.prepare('DELETE FROM template_views WHERE template_id = ?').run(key);
				const ins = db.prepare('INSERT INTO template_views (template_id, view_key, sort_order) VALUES (?, ?, ?)');
				views.forEach((v, i) => ins.run(key, v, i));
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
			guard: (db, p) => {
				const used = db.prepare('SELECT COUNT(*) AS c FROM template_views WHERE view_key = ?').get(p.get('key')) as { c: number };
				return used.c > 0 ? `view mode is used by ${used.c} template(s)` : null;
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

export function studioDbPlugin(): Plugin {
	return {
		name: 'studio-db',
		configureServer(server) {
			server.middlewares.use('/__studio', async (req, res, next) => {
				// Mounted at '/__studio' — req.url is '/meta', '/component', etc.
				const path = (req.url ?? '/').split('?')[0];
				const url = new URL(req.url ?? '/', 'http://localhost');

				try {
					// Read-only snapshot endpoints.
					if (path === '/meta' && req.method === 'GET') {
						const db = openDb();
						const data = snapshot(db);
						db.close();
						// Compact columnar wire — decoded by the client (see meta-codec.ts).
						send(res, 200, encodeMeta(data));
						return;
					}
					if (path === '/prompt' && req.method === 'GET') {
						const db = openDb();
						const data = snapshot(db);
						db.close();
						send(res, 200, {
							role: 'studio-metadata',
							description: 'Complete catalog of what the visual page builder can create. Use this to generate valid page configurations.',
							tables: data,
						});
						return;
					}

					// Table-driven write routes (upsert + delete).
					const route = ROUTES.find((r) => r.path === path);
					if (route) {
						if (req.method === 'POST' && route.upsert) {
							const body = await readJson(req);
							const missing = route.upsert.required.filter((k) => !String(body[k] ?? '').trim());
							if (missing.length) return send(res, 400, { error: `${missing.join(', ')} required` });
							const db = openDb(true);
							db.prepare(route.upsert.sql).run(...route.upsert.bind(body));
							route.upsert.after?.(db, body);
							db.close();
							return send(res, 200, { ok: true });
						}
						if (req.method === 'DELETE' && route.delete) {
							const missing = route.delete.required.filter((k) => !url.searchParams.get(k));
							if (missing.length) return send(res, 400, { error: `${missing.join(', ')} param(s) required` });
							const db = openDb(true);
							const guardErr = route.delete.guard?.(db, url.searchParams) ?? null;
							if (guardErr) {
								db.close();
								return send(res, 400, { error: guardErr });
							}
							for (const st of route.delete.statements) db.prepare(st.sql).run(...st.bind(url.searchParams));
							db.close();
							return send(res, 200, { ok: true });
						}
					}

					if (path === '/sync-ds' && req.method === 'POST') {
						const db = openDb(true);
						const count = await syncDsExports(db);
						db.close();
						send(res, 200, { ok: true, synced: count });
						return;
					}

					if (path === '/reset' && req.method === 'POST') {
						const r = spawnSync(process.execPath, [buildScript], { stdio: 'inherit' });
						send(res, 200, { ok: r.status === 0 });
						return;
					}

					next();
				} catch (e) {
					// Never leak internal error strings to LAN clients (they can reveal
					// paths, SQL, or stack frames) — details go to the dev server console.
					console.error('[studio.db] request failed:', e instanceof Error ? e.stack || e.message : e);
					send(res, 500, { error: 'studio.db request failed' });
				}
			});
		},
	};
}

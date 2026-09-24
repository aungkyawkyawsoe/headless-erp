/**
 * Schema Snapshot Plugin — Infrastructure as Code for Entity Engine
 *
 * Git-friendly schema management (export / import / diff full schema).
 *
 *   GET  /api/snapshot/export     → Export full schema as JSON file
 *   POST /api/snapshot/apply      → Apply snapshot (create missing, skip existing)
 *   POST /api/snapshot/apply?force=true → Force re-apply (drop & recreate)
 *   POST /api/snapshot/diff       → Compare current DB vs uploaded snapshot
 *
 * Usage:
 *   curl https://api/snapshot/export > snapshot.json
 *   curl -X POST https://api/entities/snapshot/apply -d @snapshot.json
 *   curl -X POST https://api/entities/snapshot/diff -d @snapshot.json
 *
 * Bundle impact: ~4KB
 */
import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client, QueryBuilder } from '@mmbix/core';
import { CollectionService } from '@/lib/services/collection.service';
import { MigrationRunner } from '@mmbix/core';
import { APP_VERSION } from '@mmbix/config';
import type { EntitySchema } from '@mmbix/types';
import { requireAuth } from '@/routes/auth';
import { requireAdmin } from '@/middleware/rbac-guard';
import { success, fail } from '@/lib/api/response';

// ─── Types ──────────────────────────────────────────

interface SnapshotField {
	name: string;
	type: string;
	label?: string;
	required?: boolean;
	default?: unknown;
	source?: string;
	related_collection?: string;
	related_collections?: string[];
	foreign_key?: string;
}

interface SnapshotCollection {
	name: string;
	slug: string;
	table_name: string;
	description?: string;
	naming_series?: string | null;
	fields: SnapshotField[];
}

interface SnapshotRelation {
	source: string;
	field: string;
	target: string;
	type: string;
}

interface SchemaSnapshot {
	version: string;
	generated_at: string;
	collections: SnapshotCollection[];
	relations: SnapshotRelation[];
}

interface DiffResult {
	added: string[]; // Collections in snapshot but not in DB
	existing: string[]; // Collections in both
	missing_in_snapshot: string[]; // Collections in DB but not in snapshot
	details: Array<{
		slug: string;
		status: 'added' | 'existing' | 'changed';
		fields_added: string[];
		fields_removed: string[];
		fields_changed: string[];
	}>;
}

// ─── Helpers ───────────────────────────────────────

function extractRelations(collections: SnapshotCollection[]): SnapshotRelation[] {
	const relations: SnapshotRelation[] = [];
	const relTypes = new Set(['m2o', 'o2m', 'm2m', 'm2a']);
	for (const col of collections) {
		for (const field of col.fields) {
			if (relTypes.has(field.type)) {
				relations.push({
					source: col.slug,
					field: field.name,
					target: field.related_collection || field.related_collections?.[0] || '',
					type: field.type,
				});
			}
		}
	}
	return relations;
}

function diffCollection(
	dbCol: { name: string; slug: string; fields: SnapshotField[] },
	snapCol: SnapshotCollection,
): { status: 'added' | 'existing' | 'changed'; fields_added: string[]; fields_removed: string[]; fields_changed: string[] } {
	const dbFields = new Map(dbCol.fields.map((f) => [f.name, f]));
	const snapFields = new Map(snapCol.fields.map((f) => [f.name, f]));

	const fieldsAdded: string[] = [];
	const fieldsRemoved: string[] = [];
	const fieldsChanged: string[] = [];

	for (const [name, snapF] of snapFields) {
		if (!dbFields.has(name)) {
			fieldsAdded.push(name);
		} else {
			const dbF = dbFields.get(name)!;
			if (dbF.type !== snapF.type) {
				fieldsChanged.push(`${name} (${dbF.type} → ${snapF.type})`);
			}
		}
	}

	for (const name of dbFields.keys()) {
		if (!snapFields.has(name)) {
			fieldsRemoved.push(name);
		}
	}

	const status = fieldsAdded.length > 0 || fieldsRemoved.length > 0 || fieldsChanged.length > 0 ? 'changed' : 'existing';

	return { status, fields_added: fieldsAdded, fields_removed: fieldsRemoved, fields_changed: fieldsChanged };
}

// ─── Plugin ────────────────────────────────────────

export function snapshotPlugin(): Plugin {
	return {
		id: 'snapshot',
		name: 'Schema Snapshot (IaC)',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			type SnapshotEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<SnapshotEnv>();
			app.use('*', requireAuth);
			app.use('*', requireAdmin);

			// ── GET /snapshot/export ──────────────────────

			app.get('/export', async (c) => {
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();

				const schemas = await db.all<EntitySchema>({
					sql: 'SELECT * FROM _entity_schemas ORDER BY name',
					bindings: [],
				});

				const collections: SnapshotCollection[] = schemas.map((s) => ({
					name: s.name,
					slug: s.slug,
					table_name: s.table_name,
					description: s.description || undefined,
					naming_series: s.naming_series,
					fields: (() => {
						try {
							const parsed = JSON.parse(s.schema_json);
							return (parsed.fields || []).filter(
								(f: { name: string }) =>
									!['id', '_meta', 'doc_status', 'display_number', 'deleted_at', 'created_at', 'updated_at'].includes(f.name),
							);
						} catch {
							return [];
						}
					})(),
				}));

				const snapshot: SchemaSnapshot = {
					version: APP_VERSION,
					generated_at: new Date().toISOString(),
					collections,
					relations: extractRelations(collections),
				};

				return success(c, snapshot, 200, { total_collections: collections.length });
			});

			// ── POST /snapshot/apply ─────────────────────

			app.post('/apply', async (c) => {
				const body = await c.req.json();
				const snapshot = (body.snapshot || body) as SchemaSnapshot;
				const force = c.req.query('force') === 'true';

				if (!snapshot.collections || !Array.isArray(snapshot.collections)) {
					return fail(c, 'Invalid snapshot: "collections" array required', 400);
				}

				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();
				const svc = new CollectionService(db);

				const results: Array<{ slug: string; status: string; error?: string }> = [];
				let created = 0,
					skipped = 0,
					errors = 0;

				for (const col of snapshot.collections) {
					try {
						// Check if collection already exists
						const existing = await db.first<{ slug: string }>({
							sql: 'SELECT slug FROM _entity_schemas WHERE slug = ?',
							bindings: [col.slug],
						});

						if (existing && !force) {
							results.push({ slug: col.slug, status: 'skipped' });
							skipped++;
						} else if (existing && force) {
							// Force: delete existing, then recreate
							await db.run({
								sql: 'DELETE FROM _entity_schemas WHERE slug = ?',
								bindings: [col.slug],
							});
							await svc.createCollection({
								name: col.name,
								slug: col.slug,
								description: col.description,
								naming_series: col.naming_series || undefined,
								fields: col.fields as import('@mmbix/types').FieldDefinition[],
							});
							results.push({ slug: col.slug, status: 'recreated' });
							created++;
						} else {
							await svc.createCollection({
								name: col.name,
								slug: col.slug,
								description: col.description,
								naming_series: col.naming_series || undefined,
								fields: col.fields as import('@mmbix/types').FieldDefinition[],
							});
							results.push({ slug: col.slug, status: 'created' });
							created++;
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : 'Unknown error';
						results.push({ slug: col.slug, status: 'error', error: msg });
						errors++;
					}
				}

				return success(c, { total: snapshot.collections.length, created, skipped, errors, results });
			});

			// ── POST /snapshot/diff ──────────────────────

			app.post('/diff', async (c) => {
				const body = await c.req.json();
				const snapshot = (body.snapshot || body) as SchemaSnapshot;

				if (!snapshot.collections || !Array.isArray(snapshot.collections)) {
					return fail(c, 'Invalid snapshot: "collections" array required', 400);
				}

				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();

				// Get current DB state
				const dbSchemas = await db.all<EntitySchema>({
					sql: 'SELECT * FROM _entity_schemas WHERE 1=1',
					bindings: [],
				});

				const dbMap = new Map(dbSchemas.map((s) => [s.slug, s]));
				const snapSlugs = new Set(snapshot.collections.map((c) => c.slug));

				const diff: DiffResult = {
					added: [],
					existing: [],
					missing_in_snapshot: [],
					details: [],
				};

				for (const snapCol of snapshot.collections) {
					if (!dbMap.has(snapCol.slug)) {
						diff.added.push(snapCol.slug);
						diff.details.push({ slug: snapCol.slug, status: 'added', fields_added: [], fields_removed: [], fields_changed: [] });
					} else {
						const dbRow = dbMap.get(snapCol.slug)!;
						let dbFields: SnapshotField[] = [];
						try {
							dbFields = JSON.parse(dbRow.schema_json).fields || [];
						} catch {}

						const d = diffCollection(
							{
								name: dbRow.name,
								slug: dbRow.slug,
								fields: dbFields.filter(
									(f) => !['id', '_meta', 'doc_status', 'display_number', 'deleted_at', 'created_at', 'updated_at'].includes(f.name),
								),
							},
							snapCol,
						);

						if (d.status === 'changed') diff.details.push({ slug: snapCol.slug, ...d });
						else diff.existing.push(snapCol.slug);
					}
				}

				for (const [slug] of dbMap) {
					if (!snapSlugs.has(slug)) {
						diff.missing_in_snapshot.push(slug);
					}
				}

				return success(c, diff, 200, {
					db_collections: dbSchemas.length,
					snapshot_collections: snapshot.collections.length,
					added: diff.added.length,
					changed: diff.details.filter((d) => d.status === 'changed').length,
					missing: diff.missing_in_snapshot.length,
				});
			});

			// ── POST /snapshot/diff-v2 — v0.7 SchemaDiffer (breaking-change detection) ──

			app.post('/diff-v2', async (c) => {
				const body = await c.req.json();
				const snapshot = (body.snapshot || body) as import('@mmbix/types').SchemaSnapshot;

				if (!snapshot.collections || !Array.isArray(snapshot.collections)) {
					return fail(c, 'Invalid snapshot: "collections" array required', 400);
				}

				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				await new MigrationRunner(db).runPending();

				// Load current state
				const collections = await db.all<EntitySchema>(QueryBuilder.from('_entity_schemas').select('*').toSelect());
				const roles = await db.all<import('@mmbix/types').RoleRecord>(QueryBuilder.from('_roles').select('*').toSelect());
				const permissions = await db.all<import('@mmbix/types').RolePermissionRecord>(
					QueryBuilder.from('_role_permissions').select('*').toSelect(),
				);
				const webhooks = await db.all<import('@mmbix/types').WebhookRecord>(QueryBuilder.from('_webhooks').select('*').toSelect());

				// SchemaDiffer expects `schema_json` to be a JSON string of a BARE field
				// array, but rows store `{"fields":[...]}` and snapshot exports carry
				// pre-extracted arrays. Normalize BOTH sides to the differ's contract
				// (same system-field exclusion as /snapshot/export) so the comparison
				// is real — and default the role/permission/webhook arrays so a diff
				// can never crash on an export that omits them.
				const SNAP_SYSTEM = new Set(['id', '_meta', 'doc_status', 'display_number', 'deleted_at', 'created_at', 'updated_at']);
				const toDifferCollection = (c: {
					slug: string;
					name?: string;
					table_name?: string;
					schema_json?: string;
					fields?: Array<{ name: string }>;
				}): EntitySchema => {
					let fields: Array<{ name: string }> = [];
					if (Array.isArray(c.fields)) {
						fields = c.fields;
					} else {
						try {
							const parsed = JSON.parse(c.schema_json ?? '{}') as { fields?: Array<{ name: string }> } | Array<{ name: string }>;
							if (Array.isArray(parsed)) fields = parsed;
							else fields = parsed.fields ?? [];
						} catch {
							// Malformed row: keep [] — the differ will report additions,
							// never a spurious "all fields removed" breaking change.
						}
					}
					return {
						id: `col_${c.slug}`,
						name: c.name ?? c.slug,
						slug: c.slug,
						table_name: c.table_name ?? `cms_${c.slug}`,
						description: null,
						naming_series: null,
						created_at: '1970-01-01T00:00:00.000Z',
						updated_at: '1970-01-01T00:00:00.000Z',
						schema_json: JSON.stringify(fields.filter((f) => !SNAP_SYSTEM.has(f.name))),
					};
				};

				const current: import('@mmbix/types').SchemaSnapshot = {
					version: APP_VERSION,
					timestamp: new Date().toISOString(),
					checksum: '',
					collections: collections.map(toDifferCollection),
					roles,
					permissions,
					webhooks,
					plugins: [],
				};
				const normalizedIncoming: import('@mmbix/types').SchemaSnapshot = {
					version: snapshot.version ?? APP_VERSION,
					timestamp: snapshot.timestamp ?? new Date().toISOString(),
					checksum: snapshot.checksum ?? '',
					collections: (snapshot.collections ?? []).map(toDifferCollection),
					roles: snapshot.roles ?? [],
					permissions: snapshot.permissions ?? [],
					webhooks: snapshot.webhooks ?? [],
					plugins: snapshot.plugins ?? [],
				};

				const { SchemaDiffer } = await import('@mmbix/core');
				const diff = SchemaDiffer.diff(current, normalizedIncoming);

				return success(c, diff);
			});

			return { routes: [{ path: '/api/snapshot', handler: app as unknown as Hono }] };
		},
	};
}

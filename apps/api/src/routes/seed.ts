/**
 * Database Seed Route (DEV ONLY)
 *
 * GET /api/seed — Resets the database: drops all tables and re-runs migrations.
 *
 * The starter template ships with NO demo data — after a seed the DB is a
 * clean slate. Create collections via the REST API or `headless collection create`.
 *
 * WARNING: This DELETES all existing CMS data.
 * DO NOT copy this pattern for user-input routes — use db.run() bindings.
 * Only available when dev mode is enabled.
 */

import { Hono } from 'hono';
import { D1Client, MigrationRunner, cache } from '@mmbix/core';
import { getConfig } from '@mmbix/config';
import { collectionTable } from '@/lib/utils/table-name';
import { success, fail } from '@/lib/api/response';

// ─── Demo Data ─────────────────────────────────────────

interface SeedColumn {
	name: string;
	type: string;
	nullable: boolean;
	dflt: string | null;
	/** Application-level field type (text, select, longtext, timestamp, etc.). Falls back to inferred from SQL type. */
	appType?: string;
	/** Select options (for select/rating fields) */
	options?: string[];
}

interface SeedCollection {
	name: string;
	slug: string;
	description: string;
	fields: SeedColumn[];
	items: Record<string, unknown>[];
}

const DEMO_COLLECTIONS: SeedCollection[] = [
	// The starter template ships with NO demo data — a clean slate.
	// Create collections via the admin UI or:
	//   headless module create --template <id>
];

// ─── Router ────────────────────────────────────────────

import { requireAuth } from './auth';
import { requireAdmin } from '@/middleware/rbac-guard';

const app = new Hono<{
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
}>();
app.use('*', requireAuth);
app.use('*', requireAdmin);

app.get('/', async (c) => {
	// Only allow in dev mode
	const config = getConfig();
	if (!config.isDev) {
		return fail(c, 'Seed endpoint is only available in development mode', 403);
	}

	const db = new D1Client((c.env as { DB: D1Database }).DB);
	const results: string[] = [];

	try {
		// Step 1: Drop all existing tables
		results.push('🔄 Dropping all tables...');
		await db.exec(
			`DROP TABLE IF EXISTS _module_menus;
DROP TABLE IF EXISTS _module_views;
DROP TABLE IF EXISTS _module_collections;
DROP TABLE IF EXISTS _modules;
DROP TABLE IF EXISTS _tenants;
DROP TABLE IF EXISTS _approvals;
DROP TABLE IF EXISTS _scheduled_jobs;
DROP TABLE IF EXISTS _audit_log;
DROP TABLE IF EXISTS _webhooks;
DROP TABLE IF EXISTS _role_permissions;
DROP TABLE IF EXISTS _roles;
DROP TABLE IF EXISTS _users;
DROP TABLE IF EXISTS _media;
DROP TABLE IF EXISTS _entity_schemas;
DROP TABLE IF EXISTS _migrations;`,
		);

		// Step 2: Run all system migrations
		results.push('🔄 Running system migrations...');
		// Reset the per-isolate migration guard — the seed dropped _migrations,
		// so pending migrations must be re-applied (and the post-seed request
		// will re-run the deleted_id index backfill).
		(globalThis as unknown as Record<string, boolean>).__MIGRATIONS_INIT__ = false;
		(globalThis as unknown as Record<string, boolean>).__PLUGIN_MIGRATIONS_INIT__ = false;
		// Drop all cached schemas/permissions — the DB is now empty.
		cache.clear();
		const runner = new MigrationRunner(new D1Client((c.env as { DB: D1Database }).DB));
		const applied = await runner.runPending();
		results.push(...applied.map((m) => `  ✅ ${m}`));

		// Step 3: Create collections from the (empty by default) registry
		results.push('🔄 Creating collections...');
		const tableDDLs: string[] = [];
		const collectionInserts: string[] = [];
		const itemInserts: string[] = [];

		for (const col of DEMO_COLLECTIONS) {
			const tableName = collectionTable(col.slug);
			const sysColDefs = [
				'id TEXT PRIMARY KEY',
				"doc_status TEXT NOT NULL DEFAULT 'draft'",
				'display_number TEXT',
				'_owner TEXT',
				'created_by TEXT',
				'updated_by TEXT',
				'deleted_at TEXT',
				'deleted_by TEXT',
			];
			const colDefs = sysColDefs.concat(
				col.fields.map((f) => {
					let def = `${f.name} ${f.type}`;
					if (!f.nullable) def += ' NOT NULL';
					if (f.dflt !== null) def += ` DEFAULT ${f.dflt}`;
					return def;
				}),
			);

			tableDDLs.push(`DROP TABLE IF EXISTS ${tableName};`);
			tableDDLs.push(`CREATE TABLE IF NOT EXISTS ${tableName} (${colDefs.join(', ')});`);
			// Cursor-pagination + soft-delete index (normally created by createCollection)
			tableDDLs.push(`CREATE INDEX IF NOT EXISTS "idx_${tableName}_deleted_id" ON "${tableName}" ("deleted_at", "id");`);

			const collectionId = crypto.randomUUID();
			const fieldMeta = col.fields
				.filter((f) => f.name !== '_meta' && f.name !== 'created_at' && f.name !== 'updated_at')
				.map((f) => {
					const type =
						f.appType ||
						(f.type === 'INTEGER'
							? f.name === 'published' || f.name === 'in_stock'
								? 'boolean'
								: 'integer'
							: f.type === 'REAL'
								? 'number'
								: f.type.toLowerCase());
					const obj: Record<string, unknown> = { name: f.name, type, label: f.name.charAt(0).toUpperCase() + f.name.slice(1) };
					// Match the DDL nullability — nullable columns must not be required at the app layer
					if (f.nullable) obj.required = false;
					if (f.options && f.options.length > 0) obj.options = f.options;
					return JSON.stringify(obj);
				});
			const allFields = [
				'{"name":"id","type":"text","label":"ID","required":true}',
				...fieldMeta,
				'{"name":"created_at","type":"timestamp","label":"Created At"}',
				'{"name":"updated_at","type":"timestamp","label":"Updated At"}',
			];
			const escName = col.name.replace(/'/g, "''");
			collectionInserts.push(
				`INSERT INTO _entity_schemas (id, name, slug, table_name, description, schema_json) VALUES ('${collectionId}', '${escName}', '${col.slug}', '${tableName}', '${col.description?.replace(/'/g, "''") || ''}', '{"fields":[${allFields.join(',')}]}');`,
			);

			const colFields = col.fields.filter((f) => f.name !== 'created_at' && f.name !== 'updated_at');
			for (const item of col.items) {
				const itemId = crypto.randomUUID();
				const insertCols: string[] = ['id'];
				const insertVals: string[] = [`'${itemId}'`];
				for (const f of colFields) {
					insertCols.push(f.name);
					const val = item[f.name];
					if (val === undefined || val === null) {
						insertVals.push('NULL');
					} else if (f.type === 'TEXT') {
						insertVals.push(`'${String(val).replace(/'/g, "''")}'`);
					} else {
						insertVals.push(String(val));
					}
				}
				itemInserts.push(`INSERT INTO ${tableName} (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')});`);
			}

			results.push(`  ✅ ${col.name} (${col.items.length} items)`);
		}

		// No demo collections ship with the starter template — skip empty batches
		// (D1 rejects empty exec batches with "No SQL statements detected").
		if (tableDDLs.length > 0) await db.exec(tableDDLs.join('\n'));
		if (collectionInserts.length > 0) await db.exec(collectionInserts.join('\n'));
		if (itemInserts.length > 0) await db.exec(itemInserts.join('\n'));

		results.push('  ✅ All queries executed');
		results.push('');
		results.push(
			`✅ Seed complete! ${DEMO_COLLECTIONS.length} collections, ${DEMO_COLLECTIONS.reduce((s, c) => s + c.items.length, 0)} items`,
		);

		return success(c, { log: results });
	} catch (error) {
		console.error('[seed] Error:', error);
		return c.json({ success: false, error: String(error), data: { log: results } }, 500);
	}
});

export { app as seedRoutes };

#!/usr/bin/env node
/**
 * db:check — verifies the committed studio.db matches schema.sql + seed.sql
 * (the source of truth). Rebuilds to a temp file and compares every table's
 * content hash. Exit code 1 on drift — run `pnpm db:build` to fix.
 *
 * CI usage: pnpm --filter @mmbix/studio db:check
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const committed = join(here, 'studio.db');
const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
const seed = readFileSync(join(here, 'seed.sql'), 'utf8');

const TABLES = [
	'design_components', 'component_props', 'component_styles', 'component_events',
	'view_modes', 'page_templates', 'template_views', 'style_presets',
	'event_action_types', 'studio_config',
	// NOTE: ds_exports is intentionally excluded — it is derived from the installed
	// @mmbix/design-system (regenerate with `pnpm db:sync-ds`), not from seed.sql.
];

function tableHash(rows) {
	const h = createHash('sha1');
	for (const r of rows) h.update(JSON.stringify(r));
	return h.digest('hex');
}

function snapshotOf(db) {
	const out = {};
	for (const t of TABLES) {
		const rows = db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
		out[t] = { n: rows.length, hash: tableHash(rows) };
	}
	return out;
}

if (!existsSync(committed)) {
	console.error(`studio.db missing at ${committed} — run \`pnpm db:build\` first.`);
	process.exit(1);
}

const committedDb = new DatabaseSync(committed, { readOnly: true });
const a = snapshotOf(committedDb);
committedDb.close();

const tmp = join(tmpdir(), `studio-check-${process.pid}.db`);
const tmpDb = new DatabaseSync(tmp);
tmpDb.exec(schema);
tmpDb.exec(seed);
const b = snapshotOf(tmpDb);
tmpDb.close();

try {
	const { rmSync } = await import('node:fs');
	rmSync(tmp, { force: true });
} catch { /* best effort */ }

let drift = false;
for (const t of TABLES) {
	const match = a[t].n === b[t].n && a[t].hash === b[t].hash;
	if (!match) {
		drift = true;
		console.error(`✗ ${t}: committed=${a[t].n} rows, seed-built=${b[t].n} rows (content differs)`);
	}
}
if (drift) {
	console.error('studio.db is out of sync with schema.sql/seed.sql — run `pnpm db:build` and commit the result.');
	process.exit(1);
}
console.log('✓ studio.db matches schema.sql + seed.sql');

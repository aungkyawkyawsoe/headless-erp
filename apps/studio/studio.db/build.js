#!/usr/bin/env node
/**
 * studio.db builder — creates/rebuilds the studio metadata database.
 * Idempotent: DROP + CREATE + SEED from schema.sql + seed.sql.
 * Run manually (`node studio.db/build.js`) or automatically by the
 * Vite plugin when studio.db is missing.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, 'studio.db');
const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
const seed = readFileSync(join(here, 'seed.sql'), 'utf8');

const db = new DatabaseSync(dbPath);
db.exec(schema);
db.exec(seed);
const counts = db.prepare(
	`SELECT 'design_components' t, COUNT(*) n FROM design_components
	 UNION ALL SELECT 'component_props', COUNT(*) FROM component_props
	 UNION ALL SELECT 'view_modes', COUNT(*) FROM view_modes
	 UNION ALL SELECT 'page_templates', COUNT(*) FROM page_templates
	 UNION ALL SELECT 'template_views', COUNT(*) FROM template_views
	 UNION ALL SELECT 'style_presets', COUNT(*) FROM style_presets
	 UNION ALL SELECT 'event_action_types', COUNT(*) FROM event_action_types`,
).all();
db.close();
console.log(`studio.db rebuilt → ${dbPath}`);
for (const row of counts) console.log(`  ${row.t}: ${row.n}`);

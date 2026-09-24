#!/usr/bin/env node
/**
 * SET a collection's `offline_reads` freshness window on a REMOTE D1.
 *
 *   node scripts/patch-offline-policy-remote.mjs --collection veh_fleets --max-age-s 300 [--apply]
 *
 * WHY: `schema_json.policies.offline_reads.max_age_s` is the window for which the
 * mini app may PERSIST a read on the device (advertised as `X-Offline-Max-Age`).
 * It is the right knob for field staff who lose signal — but it is also a
 * FRESHNESS ceiling: with a 24h window a dashboard tile can show yesterday's
 * counts, and a change made OUT OF BAND (a raw D1 import, which emits no change
 * envelope and touches no invalidation seam) cannot reach the device until the
 * window lapses.
 *
 * The engine's own route for this is `PUT /api/collections/:slug/policies`
 * (admin-only); this script mirrors the ONE statement that path runs for an
 * operator WITHOUT a production admin token. It follows the engine's contract
 * for any `schema_json` change (`routes/collections.ts`): `_schema_version` is
 * bumped IN THE SAME STATEMENT so a client holding a cached schema re-fetches.
 *
 * ⚠️ Shortening the window does NOT retroactively flush an entry already stored
 * on a device — that entry keeps the window it was written with. The device must
 * clear its cache once (or let the old entry lapse) to pick up the new ceiling.
 *
 * Env overrides: CLOUDFLARE_ACCOUNT_ID, D1_ID (target).
 */
import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const APPLY = process.argv.includes('--apply');
const argOf = (flag) => {
	const i = process.argv.indexOf(flag);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const SLUG = argOf('--collection');
const MAX_AGE = Number(argOf('--max-age-s'));

if (!SLUG || !Number.isFinite(MAX_AGE) || MAX_AGE <= 0) {
	console.error('Usage: node scripts/patch-offline-policy-remote.mjs --collection <slug> --max-age-s <seconds> [--apply]');
	process.exit(1);
}

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const BASE = 'https://api.cloudflare.com/client/v4';

async function d1(sql, bindings = []) {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(`${BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${await loadCfToken()}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ sql, params: bindings }),
			});
			const json = await res.json();
			if (!json.success) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
			return json.result?.[0]?.results ?? [];
		} catch (err) {
			// The CF API intermittently answers 7403 / drops the socket; retry a few times.
			if (attempt >= 4) throw err;
			await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
		}
	}
}

const rows = await d1(`SELECT schema_json, _schema_version FROM _entity_schemas WHERE slug = ?`, [SLUG]);
const row = rows[0];
if (!row) {
	console.error(`No _entity_schemas row for \`${SLUG}\`.`);
	process.exit(1);
}

const schema = JSON.parse(row.schema_json);
const before = schema.policies?.offline_reads ?? null;
console.log(`_entity_schemas.${SLUG}._schema_version = ${row._schema_version}`);
console.log(`  offline_reads before: ${before ? `${before.enabled ? 'enabled' : 'disabled'}, max_age_s=${before.max_age_s}` : '(unset)'}`);

schema.policies = { ...(schema.policies ?? {}), offline_reads: { ...(before ?? {}), max_age_s: MAX_AGE } };
const next = schema.policies.offline_reads;

if (before && before.max_age_s === MAX_AGE && before.enabled) {
	console.log('already set — nothing to do.');
	process.exit(0);
}

if (!APPLY) {
	console.log(
		`  would set: enabled=${next.enabled ?? false}, max_age_s=${MAX_AGE} (bumping _schema_version to ${Number(row._schema_version ?? 1) + 1})`,
	);
	console.log('Re-run with --apply to write.');
	process.exit(0);
}

await d1(`UPDATE _entity_schemas SET schema_json = ?, updated_at = ?, _schema_version = COALESCE(_schema_version, 1) + 1 WHERE slug = ?`, [
	JSON.stringify(schema),
	new Date().toISOString(),
	SLUG,
]);

const verify = await d1(`SELECT _schema_version, schema_json FROM _entity_schemas WHERE slug = ?`, [SLUG]);
const after = JSON.parse(verify[0].schema_json).policies?.offline_reads ?? null;
console.log(
	`applied — _schema_version = ${verify[0]._schema_version}, offline_reads now: enabled=${after?.enabled}, max_age_s=${after?.max_age_s}`,
);

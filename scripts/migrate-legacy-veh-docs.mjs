#!/usr/bin/env node
/**
 * MIGRATE the legacy Directus vehicle documents → remote D1.
 *
 *   node scripts/migrate-legacy-veh-docs.mjs                         (dry run: both kinds)
 *   node scripts/migrate-legacy-veh-docs.mjs --apply
 *   node scripts/migrate-legacy-veh-docs.mjs --permits | --insurances   (select one kind)
 *   node scripts/migrate-legacy-veh-docs.mjs --fix-place      [--apply]
 *   node scripts/migrate-legacy-veh-docs.mjs --relink         [--apply]
 *
 * SOURCE (the legacy Directus instance, one collection per document kind):
 *   fleet_license   → cms_veh_permits      (/admin/content/fleet_license)
 *   fleet_insurance → cms_veh_insurances   (/admin/content/fleet_insurance)
 *
 * Each legacy row points at a legacy INTEGER `fleet_master.id`
 * (`fleet_license.truck_id` / `fleet_insurance.truck_number`). The modern
 * directory keys on a UUID (`veh_fleets.id`), so the bridge is
 * `legacy fleet id → fleet_master.plate_no → veh_fleets.plate_no`.
 *
 * Field mapping (legacy → target) is declared in `KINDS` below; the notable
 * conformations are: ISO datetimes trimmed to `YYYY-MM-DD`, money strings cast to
 * numbers, booleans to 0/1, `status` (`confirmed`/`pending`) → `doc_status`
 * (`confirmed`/`draft`), blanks written as NULL (except a NOT NULL column), and
 * the legacy write timestamps preserved in `created_at`/`updated_at`.
 *
 * Idempotency: every row's `id` is a DETERMINISTIC UUID derived from
 * `<legacy collection>:<legacy primary key>` — the SAME input always yields the
 * SAME id — and the insert is `INSERT OR IGNORE`, so a re-run adds nothing.
 *
 * ⚠️ RUN `--relink` AFTERWARDS. The vehicle-first registers in the mini app
 * (`/app/licenses/browse`, `/app/insurances/browse`) read the DENORMALIZED
 * `veh_fleets.last_license` / `last_insurance` pointers, NOT the document tables.
 * A raw insert bypasses the lifecycle hooks that maintain those pointers, so
 * without a relink the imported rows are INVISIBLE to the app.
 *
 * Credentials (env, never committed): LEGACY_DIRECTUS_EMAIL / _PASSWORD (and
 * optionally LEGACY_DIRECTUS_URL). D1 access uses the shared Cloudflare resolver
 * against the account/database in `infra/env.prod`.
 */
import { createHash } from 'node:crypto';

import { loadEnvFile } from './gen-wrangler.mjs';
import { loadCfToken } from './lib/cf-token.mjs';

const APPLY = process.argv.includes('--apply');
const FIX_PLACE = process.argv.includes('--fix-place');
const RELINK = process.argv.includes('--relink');
/** Which kinds to import — both when neither selector is given. */
const ONLY = ['--permits', '--insurances', '--fluids'].filter((f) => process.argv.includes(f));

const DIRECTUS = (process.env.LEGACY_DIRECTUS_URL ?? 'https://mex-svr.mfflogistics.com').replace(/\/$/, '');
const EMAIL = process.env.LEGACY_DIRECTUS_EMAIL;
const PASSWORD = process.env.LEGACY_DIRECTUS_PASSWORD;

const INFRA = loadEnvFile('prod');
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || INFRA.CF_ACCOUNT_ID;
const DB_ID = process.env.D1_ID || INFRA.D1_ID;
const CF_BASE = 'https://api.cloudflare.com/client/v4';

const BATCH = 300; // ids per SELECT
const CHUNK = 40; // statements per D1 request

const sqlText = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
/** A NOT NULL column (e.g. `provider`): never emit NULL. */
const sqlReqText = (v) => `'${String(v ?? '').replace(/'/g, "''")}'`;
const sqlNum = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 'NULL' : String(Number(v)));

/** The legacy date → `YYYY-MM-DD` (the engine stores dates, not datetimes). */
const dateOnly = (v) => {
	if (!v) return null;
	const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
	return m ? m[1] : null;
};

/** Stable UUID (v5-shaped) from a legacy key — the SAME input always yields the
 *  SAME id, which is what makes a re-run a no-op. */
function legacyUuid(namespace, legacyId) {
	const h = createHash('sha1').update(`${namespace}:${legacyId}`).digest('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Canonical place names. The legacy township strings carry trailing spaces,
// inconsistent casing and spelling drift; the DESTINATION already has a way of
// spelling each place, so we fold onto THAT (single source of truth) rather than
// invent a third spelling. Keys are the normalized form (lowercase, alnum only).
const PLACE_CANON = {
	ywarthargyi: 'YwarTharGyi',
	yawarthargyi: 'YwarTharGyi',
	ygn: 'YGN',
	mdy: 'MDY',
	bgo: 'BGO',
	ayy: 'AYY',
	mdysouth: 'MDY South',
	mandalaysouth: 'Mandalay South',
	mandalay: 'Mandalay',
	bago: 'Bago',
	yangon: 'Yangon',
	hlaing: 'Hlaing',
	thanlyin: 'Thanlyin',
};
// Tokens that stay upper-case when title-casing an unmapped value.
const ACRONYMS = new Set(['YGN', 'MDY', 'BGO', 'AYY', 'NPT', 'THN']);

/** Trim + collapse whitespace, fold known variants, else title-case (keeping acronyms). */
const canonicalPlace = (v) => {
	const trimmed = String(v ?? '')
		.trim()
		.replace(/\s+/g, ' ');
	if (!trimmed) return null;
	const known = PLACE_CANON[trimmed.toLowerCase().replace(/[^a-z0-9]/g, '')];
	if (known) return known;
	return trimmed
		.split(' ')
		.map((w) => (ACRONYMS.has(w.toUpperCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
		.join(' ');
};

// Legacy insurer name → the `veh_insurances.provider` select value. Only AYA's
// legacy spelling differs from its stored code; every other legacy name is
// already the code the field now declares (see schema-defs.json). Kept here, not
// in the SSOT, because it maps a LEGACY spelling onto a current code — the SSOT
// describes the present, not the retired system's text.
const PROVIDER_MAP = { 'AYA SOMPO': 'AYI' };

const providerCode = (v) => {
	const raw = String(v ?? '')
		.trim()
		.replace(/\s+/g, ' ');
	return PROVIDER_MAP[raw.toUpperCase()] ?? raw;
};

/** `status` (legacy) → `doc_status` (engine): only a confirmed document is
 *  confirmed; anything else is an unconfirmed draft. */
const docStatus = (status) => (status === 'confirmed' ? 'confirmed' : 'draft');

/** Fluid fills additionally use `completed` — the work was done, so it is a
 *  confirmed document just like `confirmed` (the app's `fillStatusOf` reads both
 *  as "Confirmed"). */
const docStatusFluid = (status) => (['confirmed', 'completed'].includes(String(status ?? '').toLowerCase()) ? 'confirmed' : 'draft');

/** The legacy `type` is an ARRAY of kinds (every row in practice carries exactly
 *  one); the target stores the single `fluid_kind`. */
const fluidKindOf = (r) => {
	const t = Array.isArray(r.type) ? r.type[0] : r.type;
	return String(t ?? '').trim();
};

/** The odometer at which the NEXT service of this kind is due.
 *
 *  Verified against the source data, not assumed: the legacy `life_cycle_odometer`
 *  is the service INTERVAL, and the actual odometer gap between consecutive fills
 *  of a truck tracks it (median 15,000 for the 15,000 rows). `odo_before_due` is
 *  the reminder LEAD (only ever 1000/2000), NOT a due offset — modelling it as one
 *  (`odo+life−lead`) fits the next fill markedly worse (median |error| 1146 km vs
 *  336 km), so the due is `odo_at_fill + life_cycle_odometer`. */
const nextDueOdoOf = (r) =>
	r.odometer == null || r.life_cycle_odometer == null ? null : Number(r.odometer) + Number(r.life_cycle_odometer);

/** The target has no `grade` column, so the oil spec (15W-40, SAE 80W-90, …) is
 *  folded onto the note rather than dropped — `'15W-40 — Hino Service'`, or just
 *  the grade when the legacy note is blank (25 of 151 rows). */
const noteWithGrade = (r) => {
	const grade = String(r.grade ?? '').trim();
	const note = String(r.note ?? '')
		.trim()
		.replace(/\s+/g, ' ');
	if (grade && note) return `${grade} — ${note}`;
	return grade || note || null;
};

/**
 * One document kind: where it comes from, where it lands, and how a legacy row
 * becomes a target row. `namespace` is the LEGACY collection name and MUST stay
 * stable — it seeds the deterministic id (changing it would re-import everything).
 */
const KINDS = {
	permits: {
		selector: '--permits',
		legacy: 'fleet_license',
		table: 'cms_veh_permits',
		truckField: 'truck_id',
		columns: [
			'id',
			'vehicle',
			'license_no',
			'place',
			'issue_date',
			'expiry_date',
			'license_fee',
			'note',
			'doc_status',
			'created_at',
			'updated_at',
		],
		values: (r, fleetId) => [
			sqlText(legacyUuid('fleet_license', r.id)),
			sqlText(fleetId),
			sqlText(r.license_code?.trim()),
			sqlText(canonicalPlace(r.license_township)),
			sqlText(dateOnly(r.issue_date)),
			sqlText(dateOnly(r.expiry_date)),
			sqlNum(r.last_year_license_fee),
			sqlText(r.remark?.trim()),
			sqlText(docStatus(r.status)),
			sqlText(r.date_created),
			sqlText(r.date_updated ?? r.date_created),
		],
		// "Already on file" identity — a truck's document number.
		keyOf: (r, fleetId) =>
			`${fleetId}|${String(r.license_code ?? '')
				.trim()
				.toLowerCase()}`,
		existingSql: 'SELECT vehicle, license_no FROM cms_veh_permits WHERE deleted_at IS NULL',
		existingKeyOf: (row) =>
			`${row.vehicle}|${String(row.license_no ?? '')
				.trim()
				.toLowerCase()}`,
	},
	insurances: {
		selector: '--insurances',
		legacy: 'fleet_insurance',
		table: 'cms_veh_insurances',
		truckField: 'truck_number',
		columns: [
			'id',
			'vehicle',
			'provider',
			'policy_no',
			'expiry_date',
			'betterment',
			'windscreen_cover',
			'premium_amount',
			'sum_insured',
			'note',
			'doc_status',
			'created_at',
			'updated_at',
		],
		values: (r, fleetId) => [
			sqlText(legacyUuid('fleet_insurance', r.id)),
			sqlText(fleetId),
			// NOT NULL column — an empty legacy provider must not become NULL.
			sqlReqText(providerCode(r.provider)),
			sqlText(r.policy_number?.trim()),
			// The target keeps only the policy END date (veh-relink ranks a policy by
			// expiry); the legacy start_date has no column and is deliberately dropped.
			sqlText(dateOnly(r.end_date)),
			r.betterment == null ? 'NULL' : r.betterment ? '1' : '0',
			sqlNum(r.windscreen_cover),
			sqlNum(r.premium_amount),
			sqlNum(r.sum_insured),
			sqlText(r.note?.trim()),
			sqlText(docStatus(r.status)),
			sqlText(r.date_created),
			sqlText(r.date_updated ?? r.date_created),
		],
		// A policy has no reliable unique number (41 of 73 legacy rows are blank),
		// so identity is the truck + the policy period it covers.
		keyOf: (r, fleetId) =>
			`${fleetId}|${String(r.policy_number ?? '')
				.trim()
				.toLowerCase()}|${dateOnly(r.end_date) ?? ''}`,
		existingSql: 'SELECT vehicle, policy_no, expiry_date FROM cms_veh_insurances WHERE deleted_at IS NULL',
		existingKeyOf: (row) =>
			`${row.vehicle}|${String(row.policy_no ?? '')
				.trim()
				.toLowerCase()}|${row.expiry_date ?? ''}`,
	},
	fluid_fills: {
		selector: '--fluids',
		legacy: 'oil_filter_change',
		table: 'cms_veh_fluid_fills',
		truckField: 'fleet_id',
		columns: ['id', 'vehicle', 'fluid_kind', 'odo_at_fill', 'next_due_odo', 'note', 'date', 'doc_status', 'created_at', 'updated_at'],
		// A row whose legacy `type` is empty cannot satisfy the NOT NULL kind —
		// skip it rather than invent one.
		skipReason: (r) => (fluidKindOf(r) ? null : 'no fluid type'),
		values: (r, fleetId) => [
			sqlText(legacyUuid('oil_filter_change', r.id)),
			sqlText(fleetId),
			sqlReqText(fluidKindOf(r)),
			sqlNum(r.odometer),
			sqlNum(nextDueOdoOf(r)),
			sqlText(noteWithGrade(r)),
			sqlText(dateOnly(r.date)),
			sqlText(docStatusFluid(r.status)),
			sqlText(r.date_created),
			sqlText(r.date_updated ?? r.date_created),
		],
		// Identity: a service of that kind on that truck at that odometer. Several
		// rows legitimately share an odometer (different dates/notes), but they are
		// all in the DB after run 1, so a re-run still skips every one of them —
		// and the deterministic id is the real guard.
		keyOf: (r, fleetId) => `${fleetId}|${fluidKindOf(r)}|${r.odometer}`,
		existingSql: 'SELECT vehicle, fluid_kind, odo_at_fill FROM cms_veh_fluid_fills WHERE deleted_at IS NULL',
		existingKeyOf: (row) => `${row.vehicle}|${row.fluid_kind}|${row.odo_at_fill}`,
	},
};

async function directusToken() {
	if (!EMAIL || !PASSWORD) throw new Error('Set LEGACY_DIRECTUS_EMAIL / LEGACY_DIRECTUS_PASSWORD.');
	const res = await fetch(`${DIRECTUS}/auth/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
	});
	const json = await res.json().catch(() => null);
	if (!res.ok || !json?.data?.access_token) throw new Error(`Directus login failed (HTTP ${res.status}).`);
	return json.data.access_token;
}

async function directusItems(token, collection) {
	const res = await fetch(`${DIRECTUS}/items/${collection}?limit=-1`, { headers: { Authorization: `Bearer ${token}` } });
	const json = await res.json().catch(() => null);
	if (!res.ok || !Array.isArray(json?.data)) throw new Error(`Directus read ${collection} failed (HTTP ${res.status}).`);
	return json.data;
}

async function d1(sql) {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetch(`${CF_BASE}/accounts/${ACCOUNT}/d1/database/${DB_ID}/query`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${await loadCfToken()}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ sql }),
			});
			const json = await res.json();
			if (!json.success) throw new Error(`D1: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
			return json.result?.[0]?.results ?? [];
		} catch (err) {
			// The CF API intermittently answers 7403 / drops the socket; retry a few times.
			if (attempt >= 4) throw err;
			await new Promise((r) => setTimeout(r, 750 * (attempt + 1)));
		}
	}
}

/** The `legacy fleet id → veh_fleets.id` crosswalk, built from the plate each
 *  system holds for the same vehicle (normalized: upper-case, alphanumerics
 *  only, so `1TLR-4882` and `1tlr 4882` agree). */
async function buildFleetBridge(entries) {
	const fleets = await d1('SELECT id, plate_no FROM cms_veh_fleets WHERE deleted_at IS NULL');
	const norm = (s) =>
		String(s ?? '')
			.toUpperCase()
			.replace(/[^A-Z0-9]/g, '');
	const byPlate = new Map(fleets.map((f) => [norm(f.plate_no), f]));
	const masters = new Map(entries.map((m) => [m.id, m]));
	const resolve = (legacyTruckId) => {
		const master = masters.get(legacyTruckId);
		return master ? (byPlate.get(norm(master.plate_no))?.id ?? null) : null;
	};
	console.log(`veh_fleets=${fleets.length} · fleet_master=${masters.size}`);
	return resolve;
}

/** Migrate one kind: map every legacy row, guard duplicates, insert. */
async function migrateKind(kind, token, resolveFleet) {
	const rows = await directusItems(token, kind.legacy);
	const mapped = [];
	const unmatched = [];
	const skipped = [];
	for (const r of rows) {
		const reason = kind.skipReason?.(r);
		if (reason) {
			skipped.push({ legacy_id: r.id, reason });
			continue;
		}
		const fleetId = resolveFleet(r[kind.truckField]);
		if (!fleetId) unmatched.push({ legacy_id: r.id, truck: r[kind.truckField] });
		else mapped.push({ r, fleetId });
	}

	console.log(
		`\n[${kind.legacy} → ${kind.table}] legacy=${rows.length} mapped=${mapped.length} unmatched=${unmatched.length} skipped=${skipped.length}`,
	);
	if (unmatched.length) console.log('  unmatched:', JSON.stringify(unmatched.slice(0, 10)));
	if (skipped.length) console.log('  skipped:', JSON.stringify(skipped.slice(0, 10)));

	// Guard against re-importing something already on file. Normalize BOTH sides
	// the same way (the insert trims the legacy text, so the guard must too).
	const existing = await d1(kind.existingSql);
	const have = new Set(existing.map(kind.existingKeyOf));
	const fresh = mapped.filter(({ r, fleetId }) => !have.has(kind.keyOf(r, fleetId)));
	console.log(`  already on file (skipped)=${mapped.length - fresh.length} · to insert=${fresh.length}`);

	const stmts = fresh.map(
		({ r, fleetId }) => `INSERT OR IGNORE INTO ${kind.table} (${kind.columns.join(', ')}) VALUES (${kind.values(r, fleetId).join(', ')})`,
	);

	if (!APPLY) {
		console.log('  --- would insert (first 2) ---');
		stmts.slice(0, 2).forEach((s) => console.log(`  ${s}`));
		console.log(`  re-run with --apply to write ${stmts.length} row(s)`);
		return;
	}
	for (let i = 0; i < stmts.length; i += CHUNK) await d1(stmts.slice(i, i + CHUNK).join(';\n'));
	console.log(`  applied ${stmts.length} insert(s)`);
}

/** `place` repair for already-imported permits — scoped to THIS migration's
 *  deterministic ids, so it can never touch a row the app created. */
async function fixPlace(token) {
	const kind = KINDS.permits;
	const rows = await directusItems(token, kind.legacy);
	const ids = rows.map((r) => legacyUuid(kind.legacy, r.id));
	const current = new Map();
	for (let i = 0; i < ids.length; i += BATCH) {
		const slice = ids.slice(i, i + BATCH);
		for (const r of await d1(`SELECT id, place FROM ${kind.table} WHERE id IN (${slice.map(sqlText).join(',')})`))
			current.set(r.id, r.place);
	}
	const fixes = rows
		.map((r) => ({
			id: legacyUuid(kind.legacy, r.id),
			from: current.get(legacyUuid(kind.legacy, r.id)) ?? null,
			to: canonicalPlace(r.license_township),
		}))
		.filter((f) => current.has(f.id) && (f.from ?? null) !== (f.to ?? null));
	console.log(`place fixes needed=${fixes.length}`);
	for (const f of fixes.slice(0, 8))
		console.log(`  ${f.from === null ? 'NULL' : JSON.stringify(f.from)} → ${f.to === null ? 'NULL' : JSON.stringify(f.to)}`);
	if (!APPLY || !fixes.length) return console.log(APPLY ? 'nothing to fix' : '(dry run — re-run with --fix-place --apply to write)');
	const updates = fixes.map((f) => `UPDATE ${kind.table} SET place = ${sqlText(f.to)} WHERE id = ${sqlText(f.id)}`);
	for (let i = 0; i < updates.length; i += CHUNK) await d1(updates.slice(i, i + CHUNK).join(';\n'));
	console.log(`applied ${fixes.length} place fix(es)`);
}

/** The vehicle-first registers (and the kiosk, and the renewal gates) do NOT read
 *  the document tables — they read the DENORMALIZED `veh_fleets` pointers. A raw
 *  insert bypasses the lifecycle hooks that maintain them, so an imported document
 *  is invisible to the app until they are recomputed. This mirrors the engine's
 *  own rule verbatim (`apps/api/src/domain-modules/mro/veh-relink.ts`
 *  RELINK_SPECS — keep in sync):
 *
 *    last_license   ← newest by issue_date, tie-break expiry_date, then created_at
 *    last_insurance ← furthest expiry_date, then created_at
 *
 *  ONE set-based UPDATE covers every fleet, versus the admin route
 *  (POST /api/mro/veh/relink) looping per fleet × per pointer. */
async function relinkPointers() {
	const now = new Date().toISOString();
	const specs = [
		{
			field: 'last_license',
			doc: KINDS.permits.table,
			order: `COALESCE(issue_date,'') DESC, COALESCE(expiry_date,'') DESC, created_at DESC`,
		},
		{ field: 'last_insurance', doc: KINDS.insurances.table, order: `COALESCE(expiry_date,'') DESC, created_at DESC` },
	];
	const before = await d1(
		`SELECT COUNT(*) AS n FROM cms_veh_fleets WHERE deleted_at IS NULL AND (last_license IS NOT NULL OR last_insurance IS NOT NULL)`,
	);
	console.log(`fleets with a live pointer BEFORE: ${before[0]?.n ?? 0}`);
	for (const s of specs) {
		const sql =
			`UPDATE cms_veh_fleets SET ${s.field} = ` +
			`(SELECT id FROM ${s.doc} WHERE vehicle = cms_veh_fleets.id AND deleted_at IS NULL ORDER BY ${s.order} LIMIT 1), ` +
			`updated_at = ${sqlText(now)} WHERE deleted_at IS NULL`;
		if (!APPLY) {
			console.log(`  would run: ${sql}`);
			continue;
		}
		await d1(sql);
		console.log(`  ${s.field} recomputed from ${s.doc}`);
	}
	if (!APPLY) return console.log('(dry run — re-run with --relink --apply to write)');
	const after = await d1(
		`SELECT SUM(last_license IS NOT NULL) AS lic, SUM(last_insurance IS NOT NULL) AS ins FROM cms_veh_fleets WHERE deleted_at IS NULL`,
	);
	console.log(`fleets now pointing at a current license: ${after[0]?.lic ?? 0} · current policy: ${after[0]?.ins ?? 0}`);
}

/** The Fleet Care app reads the master's denormalized care scalars, not the fill
 *  rows: km-left = `last_<kind>_oil` − `last_odo`. Mirrors
 *  `apps/api/src/domain-modules/mro/veh-care-denorm.ts` verbatim (keep in sync):
 *
 *    last_odo         ← the EXACT max `odo` across the vehicle's `veh_odo_months`
 *                       `readings` JSON buckets (ignore non-numeric entries, and
 *                       a malformed blob contributes nothing)
 *    last_engine_oil  ← the NEWEST engine_oil fill's stored `next_due_odo`
 *                       (highest odo_at_fill, created_at as tie-break)
 *    last_gear_oil    ← the same for gear_oil
 *
 *  Unlike the engine's per-fleet guarded writes, this is ONE set-based statement
 *  — with the SAME "only touch a row whose value actually moves" guard, so a
 *  fleet already correct keeps its `updated_at` and the run stays idempotent.
 *
 *  ⚠️ `last_odo` is deliberately NEVER blanked: the engine's rule is "the exact
 *  max of the odo buckets", which yields NULL for a fleet with no `veh_odo_months`
 *  rows — and nulling a reading the ODO app has not (yet) got a source row for
 *  DESTROYS it (it happened: 11 fleets carrying real readings from an earlier
 *  import were emptied). So the odometer is only ever RE-DERIVED when a source
 *  max exists; otherwise the stored reading is left alone. */
async function relinkCarePointers() {
	const fillDue = (kind) =>
		`(SELECT next_due_odo FROM cms_veh_fluid_fills WHERE vehicle = cms_veh_fleets.id AND fluid_kind = '${kind}' AND deleted_at IS NULL ORDER BY odo_at_fill DESC, created_at DESC LIMIT 1)`;
	const odoMax =
		`(SELECT MAX(json_extract(e.value, '$.odo')) FROM cms_veh_odo_months m, ` +
		`json_each(CASE WHEN json_valid(m.readings) THEN m.readings ELSE '[]' END) e ` +
		`WHERE m.vehicle = cms_veh_fleets.id AND m.deleted_at IS NULL ` +
		`AND typeof(json_extract(e.value, '$.odo')) IN ('integer', 'real'))`;

	const pairs = [
		// Keep the stored reading when the new system has no odometer source for it.
		['last_odo', `CASE WHEN ${odoMax} IS NOT NULL THEN ${odoMax} ELSE last_odo END`],
		['last_engine_oil', fillDue('engine_oil')],
		['last_gear_oil', fillDue('gear_oil')],
	];
	const assignments = pairs.map(([col, expr]) => `${col} = ${expr}`).join(', ');
	const guard = pairs.map(([col, expr]) => `COALESCE(${col}, -1) IS NOT COALESCE(${expr}, -1)`).join(' OR ');

	const before = await d1(
		`SELECT SUM(last_engine_oil IS NOT NULL) AS eo, SUM(last_gear_oil IS NOT NULL) AS go, SUM(last_odo IS NOT NULL) AS odo FROM cms_veh_fleets WHERE deleted_at IS NULL`,
	);
	console.log(
		`care pointers BEFORE — last_odo: ${before[0]?.odo ?? 0} · engine-oil due: ${before[0]?.eo ?? 0} · gear-oil due: ${before[0]?.go ?? 0}`,
	);

	const sql = `UPDATE cms_veh_fleets SET ${assignments}, updated_at = ${sqlText(new Date().toISOString())} WHERE deleted_at IS NULL AND (${guard})`;
	if (!APPLY) return console.log(`  would run: ${sql.slice(0, 240)}…`);
	const res = await d1(sql);
	const after = await d1(
		`SELECT SUM(last_engine_oil IS NOT NULL) AS eo, SUM(last_gear_oil IS NOT NULL) AS go, SUM(last_odo IS NOT NULL) AS odo FROM cms_veh_fleets WHERE deleted_at IS NULL`,
	);
	console.log(`care pointers recomputed (rows changed: ${res[0]?.changes ?? res[0]?.rows_written ?? 'n/a'})`);
	console.log(
		`care pointers AFTER  — last_odo: ${after[0]?.odo ?? 0} · engine-oil due: ${after[0]?.eo ?? 0} · gear-oil due: ${after[0]?.go ?? 0}`,
	);
}

const kinds = ONLY.length ? ONLY.map((flag) => Object.values(KINDS).find((k) => k.selector === flag)) : Object.values(KINDS);
if (RELINK) {
	await relinkPointers();
	await relinkCarePointers();
} else {
	const token = await directusToken();
	const masters = await directusItems(token, 'fleet_master');
	const resolveFleet = await buildFleetBridge(masters);
	if (FIX_PLACE) {
		await fixPlace(token);
	} else {
		for (const kind of kinds) await migrateKind(kind, token, resolveFleet);
		if (!APPLY) console.log('\nDRY RUN — re-run with --apply to write, then --relink --apply to publish.');
	}
}

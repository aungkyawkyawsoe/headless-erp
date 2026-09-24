#!/usr/bin/env node
/**
 * Fleet Care schema — provision the veh care collections for the Vehicle Care
 * apps (Daily ODO month buckets + oil fills). Each fill stores its OWN
 * `next_due_odo` — there is NO per-vehicle interval; the old per-fill `grade`
 * column and the fleet-master interval columns are REMOVED (clean break, no
 * legacy state).
 *
 * Idempotent — safe to re-run on an already-provisioned environment:
 *
 *   1. Removes the legacy `veh_fleets.engine_oil_interval_km` /
 *      `gear_oil_interval_km` columns when they still exist (the per-fill
 *      `next_due_odo` replaced them — no master service-frequency state).
 *   2. Reconciles `veh_fluid_fills`: ensures a `next_due_odo` (integer, the
 *      absolute odo the NEXT service is due at) field and drops the legacy
 *      `grade` column (field PUT-merge — same pattern as apply-veh-wheel-slots).
 *   3. Creates `veh_odo_months` (ONE row per vehicle-month; the `readings` JSON
 *      array holds that month's daily readings) + `veh_fluid_fills` (one row
 *      per engine-oil/gear-oil fill) when the collection is missing (POST
 *      /api/collections — same validated DDL + cache invalidation path
 *      apply-mro-schema uses). Their field defs also live in
 *      `apps/api/src/domain-modules/mro/schema-defs.json` `moreCollections` so
 *      a FRESH environment bootstraps them in the normal apply-mro-schema run.
 *   4. Drops the legacy `veh_odo_logs` collection (row-per-reading model) when
 *      it still exists — the month-row model replaced it and the old rows are
 *      NOT migrated (user decision). Runs only after the new collection exists.
 *   5. Grants the tgapp "Employee" role read+write+create on the two care
 *      collections (the same full-doc grant veh_permits/veh_insurances carry)
 *      — a missing row makes the mini-app's reads 403 to an EMPTY state.
 *
 *   node scripts/apply-veh-care-schema.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token`.
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	const text = await res.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	return { status: res.status, ok: res.ok, json };
}

/* ── Legacy master-interval columns removed (no per-vehicle frequency state) ── */

/** Field names dropped from veh_fleets — the per-fill `next_due_odo` on each
 *  `veh_fluid_fills` row replaced them, so no fleet master carries a fixed
 *  service interval anymore. */
const RETIRED_FLEET_INTERVAL_FIELDS = ['engine_oil_interval_km', 'gear_oil_interval_km'];

/* ── Fluid-fill field set (per-fill next due, no grade) ── */

/** The field to ENSURE on an existing veh_fluid_fills collection (added when
 *  missing) — the absolute odo at which the NEXT service of that kind is due. */
const NEXT_DUE_FIELD = {
	name: 'next_due_odo',
	label: 'Next Due Odo (km)',
	type: 'integer',
	required: false,
	description: 'The odometer at which the NEXT service of this kind is due — set per fill (odo_at_fill + the interval chosen at record time).',
};

/** The field name dropped from veh_fluid_fills — no longer recorded. */
const RETIRED_FLUID_GRADE_FIELD = 'grade';

/** The two fleet-care collections (also declared in schema-defs.json
 *  `moreCollections` so a fresh env bootstraps them via apply-mro-schema). */
const CARE_COLLECTIONS = [
	{
		name: 'VEH Odo Months',
		slug: 'veh_odo_months',
		description:
			"Daily odometer readings per veh_fleets vehicle, bucketed ONE row per (vehicle, Gregorian month) — the row's `readings` JSON array holds that month's daily readings [{date, odo, note?, at?}]. A vehicle's current odo = the newest-date entry across its month rows, the read-side floor every km service interval counts from (replaces the old row-per-reading veh_odo_logs model).",
		fields: [
			{
				name: 'vehicle',
				type: 'm2o',
				label: 'Vehicle',
				required: true,
				related_collection: 'veh_fleets',
				display_template: '{{plate_no}}',
				cascade_delete: false,
			},
			{ name: 'month', type: 'text', label: 'Month (YYYY-MM)', required: true },
			{ name: 'readings', type: 'longtext', label: 'Daily Readings (JSON)', required: true },
		],
	},
	{
		name: 'VEH Fluid Fills',
		slug: 'veh_fluid_fills',
		description:
			"Engine-oil / gear-oil fill history per veh_fleets vehicle (the Fleet Care Fluid app writes them) — one row per fill with the odometer at which the service happened (odo_at_fill) and the odometer at which the NEXT service of that kind is due (next_due_odo, chosen per fill — no fixed per-vehicle interval). km-left is derived read-side from that newest fill's next_due_odo.",
		fields: [
			{
				name: 'vehicle',
				type: 'm2o',
				label: 'Vehicle',
				required: true,
				related_collection: 'veh_fleets',
				display_template: '{{plate_no}}',
				cascade_delete: false,
			},
			{
				name: 'fluid_kind',
				type: 'select',
				label: 'Fluid Kind',
				required: true,
				options: [
					{ value: 'engine_oil', label: 'Engine Oil' },
					{ value: 'gear_oil', label: 'Gear Oil' },
				],
			},
			{ name: 'odo_at_fill', type: 'integer', label: 'Odo at Fill (km)', required: true },
			{ name: 'qty_liters', type: 'number', label: 'Qty (liters)', required: false },
			{ name: 'note', type: 'longtext', label: 'Note', required: false },
			{
				name: 'next_due_odo',
				label: 'Next Due Odo (km)',
				type: 'integer',
				required: false,
				description: 'The odometer at which the NEXT service of this kind is due — set per fill.',
			},
		],
	},
];

let failures = 0;
const log = [];

/** Remove the legacy per-vehicle interval columns from the veh_fleets master —
 *  the per-fill `next_due_odo` replaced them. Reads the live schema_json field
 *  list and PUT-merges it back WITHOUT the retired names (best-effort drop). No
 *  legacy frequency state is kept. */
async function reconcileVehFleets() {
	const col = await api('GET', '/api/collections/veh_fleets');
	if (!col.ok) {
		log.push(`FAIL  read veh_fleets: HTTP ${col.status}`);
		failures += 1;
		return;
	}
	const sj = col.json?.data?.schema_json ?? { fields: [] };
	const fields = (sj.fields ?? []).filter((f) => f && typeof f.name === 'string');
	const present = fields.filter((f) => !RETIRED_FLEET_INTERVAL_FIELDS.includes(f.name));
	if (present.length === fields.length) {
		log.push('veh_fleets: no legacy interval columns — no-op');
		return;
	}
	const updated = await api('PUT', '/api/collections/veh_fleets', { fields: present });
	if (updated.ok)
		log.push(
			`veh_fleets -${RETIRED_FLEET_INTERVAL_FIELDS.filter((n) => !present.some((f) => f.name === n)).join(', ')} (clean break — no master interval) ✅`,
		);
	else {
		log.push(`FAIL  veh_fleets column drop: HTTP ${updated.status} ${updated.json?.error ?? ''}`.trim());
		failures += 1;
	}
}

/** Reconcile an EXISTING veh_fluid_fills collection to the new per-fill field
 *  set: ensure `next_due_odo` exists and drop the legacy `grade` column (clean
 *  break — grade is no longer recorded). Fresh envs get the right defs from
 *  `createCareCollections`; this covers envs provisioned before the switch. */
async function reconcileFluidFills() {
	const col = await api('GET', '/api/collections/veh_fluid_fills');
	if (col.status === 404 || !col.ok) {
		// Collection doesn't exist yet — createCareCollections will make it fresh.
		if (col.status === 404) return;
		log.push(`FAIL  read veh_fluid_fills: HTTP ${col.status}`);
		failures += 1;
		return;
	}
	const sj = col.json?.data?.schema_json ?? { fields: [] };
	const fields = (sj.fields ?? []).filter((f) => f && typeof f.name === 'string');
	const names = new Set(fields.map((f) => f.name));
	const dropGrade = names.has(RETIRED_FLUID_GRADE_FIELD);
	const addNextDue = !names.has(NEXT_DUE_FIELD.name);
	if (!dropGrade && !addNextDue) {
		log.push('veh_fluid_fills: field set already current (next_due_odo · no grade) — no-op');
		return;
	}
	const next = fields.filter((f) => f.name !== RETIRED_FLUID_GRADE_FIELD);
	if (addNextDue) next.push(NEXT_DUE_FIELD);
	const updated = await api('PUT', '/api/collections/veh_fluid_fills', { fields: next });
	if (updated.ok)
		log.push([dropGrade ? '-grade' : null, addNextDue ? '+next_due_odo' : null].filter(Boolean).join(' ') + ' on veh_fluid_fills ✅');
	else {
		log.push(`FAIL  veh_fluid_fills field reconcile: HTTP ${updated.status} ${updated.json?.error ?? ''}`.trim());
		failures += 1;
	}
}

async function createCareCollections() {
	for (const def of CARE_COLLECTIONS) {
		const existing = await api('GET', `/api/collections/${def.slug}`);
		if (existing.status === 200) {
			log.push(`${def.slug} already exists — no-op`);
			continue;
		}
		const created = await api('POST', '/api/collections', {
			name: def.name,
			slug: def.slug,
			description: def.description,
			fields: def.fields,
		});
		if (created.status === 201) log.push(`create ${def.slug} (${def.name}) ✅`);
		else {
			log.push(`FAIL  create ${def.slug}: HTTP ${created.status} ${created.json?.error ?? ''}`.trim());
			failures += 1;
		}
	}
}

/** Drop the legacy row-per-reading `veh_odo_logs` collection — the month-row
 *  model replaced it and its old data is NOT migrated (user decision). Deletes
 *  the data table + schema row (irreversible) only when the collection still
 *  exists; skipped when it is already gone (fresh env / re-run). Runs AFTER the
 *  new collection is created so the care apps never lose their store. */
async function dropLegacyOdoLogs() {
	const existing = await api('GET', '/api/collections/veh_odo_logs');
	if (existing.status !== 200) {
		log.push('legacy veh_odo_logs already dropped — no-op');
		return;
	}
	const dropped = await api('DELETE', '/api/collections/veh_odo_logs');
	if (dropped.ok) log.push('drop legacy veh_odo_logs (old row-per-reading data removed — not migrated) ⚠️');
	else {
		log.push(`FAIL  drop legacy veh_odo_logs: HTTP ${dropped.status} ${dropped.json?.error ?? ''}`.trim());
		failures += 1;
	}
}

/** Grant/upgrade the tgapp Employee role to full read+write+create on the care
 *  collections (mirror of the veh_permits/veh_insurances grants). */
async function grantEmployeeCareAccess() {
	const roles = await api('GET', '/api/users/roles');
	if (!roles.ok) {
		log.push(`FAIL  read roles: HTTP ${roles.status}`);
		failures += 1;
		return;
	}
	const employees = (roles.json?.data ?? []).filter((r) => /employee/i.test(r.name ?? ''));
	if (employees.length === 0) {
		log.push('no "Employee"-role found — skipping grants (add one, then re-run)');
		return;
	}
	for (const role of employees) {
		const perms = await api('GET', `/api/users/permissions/${role.id}`);
		if (!perms.ok) {
			log.push(`FAIL  read permissions for role ${role.name}: HTTP ${perms.status}`);
			failures += 1;
			continue;
		}
		const rows = (perms.json?.data ?? []).filter((p) => CARE_COLLECTIONS.some((c) => c.slug === p.collection_slug));
		for (const def of CARE_COLLECTIONS) {
			const row = rows.find((p) => p.collection_slug === def.slug);
			if (row && row.can_read && row.can_write && row.can_create) {
				log.push(`grant  ${def.slug} (role ${role.name}) already full`);
				continue;
			}
			const grant = await api('POST', '/api/users/permissions', {
				role_id: role.id,
				collection_slug: def.slug,
				can_read: true,
				can_write: true,
				can_create: true,
			});
			if (grant.ok) log.push(`grant  ${def.slug} → read+write+create (role ${role.name})${row ? ' (upgraded)' : ''} ✅`);
			else {
				log.push(`FAIL  grant ${def.slug} for role ${role.name}: HTTP ${grant.status} ${grant.json?.error ?? ''}`.trim());
				failures += 1;
			}
		}
	}
}

const run = async () => {
	await reconcileVehFleets();
	await createCareCollections();
	await reconcileFluidFills();
	await dropLegacyOdoLogs();
	await grantEmployeeCareAccess();

	console.log(log.join('\n'));
	console.log(failures === 0 ? '\nFleet Care schema: OK ✅' : `\nFleet Care schema: ${failures} FAILURE(S) ❌`);
	process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
	console.error('APPLY ABORTED:', err);
	process.exit(2);
});

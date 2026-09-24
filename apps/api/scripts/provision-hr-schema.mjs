#!/usr/bin/env node
/**
 * Idempotent schema provisioning for the tgapp HR (+ fleet master) module.
 *
 * The tgapp's ရုံးတက် / ဆုံးဖြတ် / ဝန်ထမ်းများ data layers (attendance +
 * employees modules) read a NORMALIZED entity model — `employees` /
 * `attendances` / `leaves` / `overtimes` / `early_leaves` / `employee_links` /
 * `shifts` (+ `fleets` for the ယာဉ် master) — as physical `cms_*` tables. This
 * script provisions exactly those collections through the sanctioned collection
 * API (POST/PUT /api/collections) — NEVER raw SQL — so `_entity_schemas`, the
 * physical tables, indexes and m2m junction tables stay consistent.
 *
 * Usage:
 *   cd apps/api && npx wrangler dev          # terminal 1 (IS_DEV local: dev-token = admin)
 *   node scripts/provision-hr-schema.mjs     # terminal 2
 *
 * Env overrides: PROVISION_API (default http://127.0.0.1:8788),
 *                PROVISION_TOKEN (default dev-token)
 *
 * Idempotent: re-running only applies the delta (missing collections are
 * created; existing collections get the missing fields / type fixes merged in).
 */

const BASE = process.env.PROVISION_API || 'http://127.0.0.1:8788';
const TOKEN = process.env.PROVISION_TOKEN || 'dev-token';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

const log = (...a) => console.log(...a);
const fail = (m) => {
	console.error(`✗ ${m}`);
	process.exitCode = 1;
};

/* ── thin API helpers ─────────────────────────────────────────────────── */

async function call(path, opts = {}) {
	const res = await fetch(`${BASE}${path}`, { headers: HEADERS, ...opts });
	const text = await res.text();
	if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return null;
	try {
		const body = JSON.parse(text);
		return body && typeof body === 'object' && 'data' in body ? body.data : body;
	} catch {
		return text;
	}
}

const getCollection = (slug) =>
	call(`/api/collections/${slug}`).catch((err) => {
		if (/→ 404/.test(err.message)) return null;
		throw err;
	});
const postCollection = (slug, name, fields, policies) =>
	call('/api/collections', {
		method: 'POST',
		body: JSON.stringify({ name, slug, fields, ...(policies ? { policies } : {}) }),
	});
const putCollection = (slug, fields) => call(`/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify({ fields }) });
const putPolicies = (slug, policies) => call(`/api/collections/${slug}/policies`, { method: 'PUT', body: JSON.stringify(policies) });

/* ── field builders (engine type catalog) ─────────────────────────────── */

const text = (name, { required = false, label = name } = {}) => ({ name, type: 'text', required, label });
const longtext = (name, { required = false, label = name } = {}) => ({ name, type: 'longtext', required, label });
const number = (name, { required = false, label = name, default: def } = {}) => ({
	name,
	type: 'number',
	required,
	label,
	...(def !== undefined ? { default: def } : {}),
});
const date = (name, { required = false, label = name } = {}) => ({ name, type: 'date', required, label });
const datetime = (name, { required = false, label = name } = {}) => ({ name, type: 'datetime', required, label });
const time = (name, { required = false, label = name } = {}) => ({ name, type: 'time', required, label });
const select = (name, options, { required = false, label = name, default: def } = {}) => ({
	name,
	type: 'select',
	required,
	label,
	options: options.map((v) => ({ value: v, label: v })),
	...(def !== undefined ? { default: def } : {}),
});
const m2o = (name, related_collection, { required = false, label = name } = {}) => ({
	name,
	type: 'm2o',
	required,
	label,
	related_collection,
});
const m2m = (name, related_collection, { required = false, label = name } = {}) => ({
	name,
	type: 'm2m',
	required,
	label,
	related_collection,
});
/** Virtual reverse-read: children whose `foreign_key` m2o points back to this row. */
const o2m = (name, related_collection, { foreign_key, required = false, label = name } = {}) => ({
	name,
	type: 'o2m',
	required,
	label,
	related_collection,
	foreign_key,
});
const file = (name, { required = false, label = name } = {}) => ({ name, type: 'file', required, label });
const image = (name, { required = false, label = name } = {}) => ({ name, type: 'image', required, label });
/** Stored formula field — recomputed by the engine on every write to the row. */
const formula = (name, expression, { label = name, precision, store = true, result_type = 'number' } = {}) => ({
	name,
	type: 'formula',
	formula: expression,
	store,
	result_type,
	...((precision ?? '') !== '' ? { precision, rounding: 'half_up' } : {}),
	label,
	required: false,
});

const equalFields = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Merge `replace` (by field name, replaces in place) + `add` (only when the
 * name is missing) into a collection's CURRENT stored field list, then PUT the
 * full list back (schema updates replace the field list entirely). No-op when
 * nothing changed.
 */
async function reconcile(slug, { replace = {}, add = [] } = {}) {
	const cur = await getCollection(slug);
	if (!cur) return fail(`reconcile ${slug}: collection missing`);
	const raw = (cur.schema_json.fields ?? []).filter((f) => f && typeof f.name === 'string');
	const byName = new Map(raw.map((f) => [f.name, f]));
	// Duplicate field names in the stored list are a schema defect (earlier runs
	// of this script added a second `in_grace_period` to shifts) — collapse them.
	let changed = raw.length !== byName.size;
	for (const field of Object.values(replace)) {
		const existing = byName.get(field.name);
		if (!existing || !equalFields(existing, field)) {
			byName.set(field.name, field);
			changed = true;
		}
	}
	for (const field of add) {
		if (!byName.has(field.name)) {
			byName.set(field.name, field);
			changed = true;
		}
	}
	if (!changed) {
		log(`  = ${slug}: no schema change needed`);
		return;
	}
	await putCollection(slug, [...byName.values()]);
	log(`  ✓ ${slug}: reconciled (${changed ? 'fields merged' : 'no-op'})`);
}

/* ── CREATE: the five transactional HR collections ───────────────────────
 * Built lazily (function) because the attendances defs embed the stored-formula
 * consts declared further below — a top-level `const CREATE` array would hit
 * them before initialization (TDZ). */

function createDefs() {
	return [
		{
			slug: 'hrm_attendances',
			name: 'HRM Attendances',
			policies: EMPLOYEE_ACTOR_POLICY,
			fields: [
				m2o('employee', 'hrm_employees', { required: true, label: 'Employee' }),
				datetime('check_in', { required: true, label: 'Check In' }),
				datetime('check_out', { label: 'Check Out' }),
				m2o('shift', 'hrm_shifts', { required: true, label: 'Shift' }),
				text('geo_in', { label: 'Geo In' }),
				text('geo_out', { label: 'Geo Out' }),
				// Stored formula fields — see ATTENDANCE_ADD below (same defs; embedded so
				// a fresh provision creates the full collection in one step).
				ATT_ETG_FORMULA,
				ATT_EID_FORMULA,
				ATT_IN_STATUS_FORMULA,
				ATT_OUT_STATUS_FORMULA,
			],
		},
		{
			slug: 'hrm_leaves',
			name: 'HRM Leaves',
			policies: EMPLOYEE_ACTOR_POLICY,
			fields: [
				m2o('employee', 'hrm_employees', { required: true, label: 'Employee' }),
				date('start_date', { required: true, label: 'Start Date' }),
				date('end_date', { required: true, label: 'End Date' }),
				select('leave_duration_type', ['full_day', 'half_day', 'multi_day'], { required: true, label: 'Leave Duration Type' }),
				select('half_day_session', ['morning', 'afternoon'], { label: 'Half Day Session' }),
				select('start_day_session', ['morning', 'afternoon'], { label: 'Start Day Session' }),
				select('end_day_session', ['morning', 'afternoon'], { label: 'End Day Session' }),
				m2o('reliever_to', 'hrm_employees', { label: 'Reliever' }),
				longtext('reason', { label: 'Reason' }),
				number('total_days', { label: 'Total Days' }),
				m2o('approved_by', 'hrm_employees', { label: 'Approved By' }),
				longtext('superior_comment', { label: 'Superior Comment' }),
			],
		},
		{
			slug: 'hrm_overtimes',
			name: 'HRM Overtimes',
			policies: EMPLOYEE_ACTOR_POLICY,
			fields: [
				m2o('employee', 'hrm_employees', { required: true, label: 'Employee' }),
				date('date', { required: true, label: 'Date' }),
				time('start_time', { label: 'Start Time' }),
				time('end_time', { label: 'End Time' }),
				select('type', ['normal', 'sunday', 'holiday', 'thingyan'], { label: 'Type' }),
				number('total_hours', { label: 'Total Hours' }),
				longtext('reason', { label: 'Reason' }),
				m2o('approved_by', 'hrm_employees', { label: 'Approved By' }),
				longtext('superior_comment', { label: 'Superior Comment' }),
			],
		},
		{
			slug: 'hrm_early_leaves',
			name: 'HRM Early Leaves',
			policies: EMPLOYEE_ACTOR_POLICY,
			fields: [
				m2o('employee', 'hrm_employees', { required: true, label: 'Employee' }),
				datetime('date_time', { required: true, label: 'Date Time' }),
				text('location', { required: true, label: 'Location' }),
				longtext('reason', { label: 'Reason' }),
				m2o('approved_by', 'hrm_employees', { label: 'Approved By' }),
				longtext('superior_comment', { label: 'Superior Comment' }),
			],
		},
		{
			slug: 'hrm_employee_links',
			name: 'HRM Employee Links',
			fields: [
				m2o('superior', 'hrm_employees', { required: true, label: 'Superior' }),
				m2o('subordinate', 'hrm_employees', { required: true, label: 'Subordinate' }),
			],
		},
		{
			slug: 'veh_fleets',
			name: 'VEH Fleets',
			fields: [
				text('plate_no', { required: true, label: 'Plate No' }),
				select(
					'brand',
					[
						'faw',
						'fuso',
						'hino',
						'isuzu',
						'nissan diesel_ud',
						'nissan_diesel_ud',
						'panus',
						'qiang',
						'suzuki',
						'you',
						'volvo',
						'mitsubishi',
						'man',
						'toyota',
					],
					{ label: 'Brand' },
				),
				text('model', { label: 'Model' }),
				select('unit_type', ['box', 'trailer', 'tractor_unit', 'forklift', 'others'], { label: 'Unit Type' }),
				number('wheel', { label: 'Wheel' }),
				number('feet', { label: 'Feet' }),
				text('license_place', { label: 'License Place' }),
				text('license_township', { label: 'License Township' }),
				date('purchase_date', { label: 'Purchase Date' }),
				number('last_odo', { label: 'Last Odo (km)' }),
				number('last_engine_oil', { label: 'Next Engine-Oil Odo (km)' }),
				number('last_gear_oil', { label: 'Next Gear-Oil Odo (km)' }),
			],
		},
	];
}

/* ── RECONCILE: existing collections the tgapp needs extended/fixed ────── */

/** employees: the tgapp projects `avatar` (an IMAGE field — R2 media or
 *  external URL, vs `file` = any file) + `department` / `designation` (m2o
 *  expansions) + `shifts` (m2m → array of shift rows); `etg_id` is the
 *  unique Telegram link the auth gate + every fetcher filters on.
 *
 *  Reporting line: `hrm_employee_links` holds ONE superior→subordinate edge
 *  per row (m2o `superior` + m2o `subordinate`, both → hrm_employees), so a
 *  staff member can have any number of superiors and subordinates. The two
 *  directions surface on the employee record as VIRTUAL o2m reverse-reads of
 *  those link rows (the engine forbids two self-referencing m2m fields on one
 *  collection — they would share the same junction table — so an m2m
 *  `superiors` + `subordinates` pair is not a valid schema shape). */
const EMPLOYEE_ADD = [
	image('avatar', { label: 'Avatar' }),
	m2o('department', 'hrm_departments', { label: 'Department' }),
	m2o('designation', 'hrm_designations', { label: 'Designation' }),
	m2m('shifts', 'hrm_shifts', { label: 'Shifts' }),
	// o2m → hrm_employee_links rows where I am the superior: each child row's
	// `subordinate` side is one of MY subordinates.
	o2m('subordinates', 'hrm_employee_links', { foreign_key: 'superior', label: 'Subordinates' }),
	// o2m → hrm_employee_links rows where I am the subordinate: each child row's
	// `superior` side is one of MY superiors.
	o2m('superiors', 'hrm_employee_links', { foreign_key: 'subordinate', label: 'Superiors' }),
];

/** veh_fleets — denormalized pointers to the CURRENT (date-newest) document on
 *  file, kept fresh by domain-modules/mro/veh-relink.ts lifecycle hooks on every
 *  permit/policy create/update. Added by RECONCILE only (never in the create
 *  defs): veh_permits/veh_insurances are provisioned by the MRO schema apply,
 *  so a fresh veh_fleets create must not forward-reference tables that may not
 *  exist yet — run provision-hr after apply-mro to add the columns. */
const VEH_LASTDOC_ADD = [
	m2o('last_license', 'veh_permits', { label: 'Last License' }),
	m2o('last_insurance', 'veh_insurances', { label: 'Last Insurance' }),
];

/** veh_fleets — denormalized CARE scalars serving the fleet / fluid km-left cards
 *  from ONE veh_fleets fetch (a given DB may lack them if it predates this
 *  reconcile — this idempotent add brings any fleet DB current). */
const VEH_CARE_ADD = [
	number('last_odo', { label: 'Last Odo (km)' }),
	number('last_engine_oil', { label: 'Next Engine-Oil Odo (km)' }),
	number('last_gear_oil', { label: 'Next Gear-Oil Odo (km)' }),
];

/** leaves.total_days — STORED formula mirroring the tgapp leave form's rule
 *  (calendar days incl. weekends; first day 1|0.5 by start session, last day
 *  1|0.5 by end session, middle days 1 each; single full = 1, half = 0.5).
 *  The tgapp maps this column onto the card's ရက်/ရက်ခွဲ label. */
const LEAVE_DAYS_FORMULA = formula(
	'total_days',
	"IF(start_date == end_date, IF(leave_duration_type == 'half_day', 0.5, 1), IF(start_day_session == 'afternoon', 0.5, 1) + MAX(0, DAYS_BETWEEN(start_date, end_date) - 1) + IF(end_day_session == 'morning', 0.5, 1))",
	{ label: 'Total Days', precision: 1 },
);

/** attendances — STORED formula fields the tgapp code expects the server to
 *  compute (its comments: "`etg_id`/`eid`/`in_status`/`out_status` are stored
 *  formulas the server computes — never written here"). The status formulas
 *  are the spec-proven expressions from apps/api/test/attendance-status-formulas.spec.ts
 *  (shift m2o lookup, MMT minutes-of-day, grace windows) — pinned there verbatim. */

/** Denormalize the applicant's Telegram link onto the punch row (m2o lookup). */
const ATT_ETG_FORMULA = {
	name: 'etg_id',
	type: 'formula',
	formula: 'IF(IS_EMPTY(employee), null, employee.etg_id)',
	formula_type: 'expression',
	result_type: 'string',
	store: true,
	label: 'ETG ID',
	required: false,
};

/** Denormalize the applicant's employee code onto the punch row (m2o lookup). */
const ATT_EID_FORMULA = {
	name: 'eid',
	type: 'formula',
	formula: 'IF(IS_EMPTY(employee), null, employee.eid)',
	formula_type: 'expression',
	result_type: 'string',
	store: true,
	label: 'EID',
	required: false,
};

/** Classify the check-in punch vs the shift clock (MMT): on_time | grace_late_in | late_in. */
const ATT_IN_STATUS_FORMULA = {
	name: 'in_status',
	type: 'formula',
	formula:
		"IF(IS_EMPTY(check_in) || IS_EMPTY(shift) || IS_EMPTY(shift.time_in) || IS_EMPTY(shift.in_grace_period), null, IF((((MINUTES_BETWEEN(CONCAT(LEFT(check_in, 10), 'T00:00:00Z'), check_in) + 390) % 1440) <= MINUTES_BETWEEN('2000-01-01T00:00:00Z', CONCAT('2000-01-01T', LEFT(shift.time_in, 5), ':00Z'))), 'on_time', IF((((MINUTES_BETWEEN(CONCAT(LEFT(check_in, 10), 'T00:00:00Z'), check_in) + 390) % 1440) <= (MINUTES_BETWEEN('2000-01-01T00:00:00Z', CONCAT('2000-01-01T', LEFT(shift.time_in, 5), ':00Z')) + shift.in_grace_period)), 'grace_late_in', 'late_in')))",
	formula_type: 'expression',
	result_type: 'string',
	store: true,
	label: 'In Status',
	required: false,
};

/** Classify the check-out punch vs shift end (time_in + working_hours, MMT):
 *  on_time | grace_early_out | early_out — null until the day is closed. */
const ATT_OUT_STATUS_FORMULA = {
	name: 'out_status',
	type: 'formula',
	formula:
		"IF(IS_EMPTY(check_out) || IS_EMPTY(shift) || IS_EMPTY(shift.time_in) || IS_EMPTY(shift.out_grace_period) || IS_EMPTY(shift.working_hours), null, IF((MINUTES_BETWEEN('2000-01-01T00:00:00Z', CONCAT('2000-01-01T', LEFT(shift.time_in, 5), ':00Z')) + shift.working_hours * 60 <= ((MINUTES_BETWEEN(CONCAT(LEFT(check_out, 10), 'T00:00:00Z'), check_out) + 390) % 1440)), 'on_time', IF((MINUTES_BETWEEN('2000-01-01T00:00:00Z', CONCAT('2000-01-01T', LEFT(shift.time_in, 5), ':00Z')) + shift.working_hours * 60 - ((MINUTES_BETWEEN(CONCAT(LEFT(check_out, 10), 'T00:00:00Z'), check_out) + 390) % 1440) <= shift.out_grace_period), 'grace_early_out', 'early_out')))",
	formula_type: 'expression',
	result_type: 'string',
	store: true,
	label: 'Out Status',
	required: false,
};

const ATTENDANCE_ADD = [ATT_ETG_FORMULA, ATT_EID_FORMULA, ATT_IN_STATUS_FORMULA, ATT_OUT_STATUS_FORMULA];

/**
 * The engine's `policies.actor_fields` binding for HR rows that record WHO filed
 * them: a punch (`hrm_attendances`) and the three request collections. The
 * Telegram login already signs `employee_id` (the directory row) into the JWT, so
 * a client-supplied `employee` can never be forged into someone else's record.
 * An admin/dev-token session keeps explicit control (the engine exempts an admin).
 */
const EMPLOYEE_ACTOR_POLICY = { actor_fields: ['employee'] };
const ACTOR_POLICY_COLLECTIONS = ['hrm_attendances', 'hrm_leaves', 'hrm_overtimes', 'hrm_early_leaves'];

/** overtimes.total_hours — STORED formula: end − start span in hours from the
 *  `HH:MM` text columns, wrapping past midnight (+24 h), 2dp. The tgapp reads
 *  it as the OT card's hours (`hours_count ?? total_hours`); it never writes
 *  the column itself (the code comments call it the "native formula column"). */
const OT_HOURS_FORMULA = formula(
	'total_hours',
	"IF(IS_NULL(start_time) || start_time == '' || IS_NULL(end_time) || end_time == '', 0, ROUND(MOD(1440 + TO_NUMBER(LEFT(end_time, 2)) * 60 + TO_NUMBER(MID(end_time, 4, 2)) - TO_NUMBER(LEFT(start_time, 2)) * 60 - TO_NUMBER(MID(start_time, 4, 2)), 1440) / 60, 2))",
	{ label: 'Total Hours', precision: 2 },
);

/** shifts: the tgapp computes end time = `time_in` + `working_hours` (decimal
 *  hours), so `working_hours` must be a NUMBER — the current `time` type is a
 *  schema bug. Grace columns are renamed to the canonical spellings. */
const SHIFT_REPLACE = {
	working_hours: number('working_hours', { required: true, label: 'Working Hours', default: 0 }),
	in_grace_period: number('in_grace_period', { label: 'In Grace Period', default: 0 }),
	out_grace_period: number('out_grace_period', { label: 'Out Grace Period', default: 0 }),
};

/* ── run ───────────────────────────────────────────────────────────────── */

/** Transform already-created rows: the initial provisioning pass created
 *  `total_days` / `total_hours` as plain numbers (before the formula fields
 *  were specified). Replace them with the stored formulas (tables are empty,
 *  so the migrator's rebuild is a no-op data-wise). */
/** Drop legacy custom fields from the stored field list — idempotent. The
 *  request collections used to carry their own `status` select next to the
 *  engine's system `doc_status` column (the two-status confusion Studio showed).
 *  The system `doc_status` is the single source of truth now, so the redundant
 *  custom `status` field is removed (the migrator drops its physical column). */
async function dropFields(slug, names) {
	const cur = await getCollection(slug);
	if (!cur) return fail(`drop ${names.join('/')} from ${slug}: collection missing`);
	const raw = (cur.schema_json.fields ?? []).filter((f) => f && typeof f.name === 'string');
	const drop = new Set(names);
	const kept = raw.filter((f) => !drop.has(f.name));
	if (kept.length === raw.length) {
		log(`  = ${slug}: no field drop needed`);
		return;
	}
	await putCollection(slug, kept);
	log(`  ✓ ${slug}: dropped ${names.join(', ')}`);
}

async function promoteToFormula() {
	await reconcile('hrm_leaves', { replace: { total_days: LEAVE_DAYS_FORMULA } });
	await reconcile('hrm_overtimes', { replace: { total_hours: OT_HOURS_FORMULA } });
	await reconcile('hrm_employees', { replace: { avatar: image('avatar', { label: 'Avatar' }) } });
	await reconcile('hrm_attendances', { add: ATTENDANCE_ADD });
}

/**
 * Idempotently apply the employee actor binding to an EXISTING collection —
 * a greenfield create already carries it (see `createDefs`), but a database
 * provisioned before this rule must be reconciled too. Uses the validated
 * policies endpoint (partial merge), so it never disturbs other policies.
 */
async function applyActorPolicies() {
	const want = EMPLOYEE_ACTOR_POLICY.actor_fields;
	for (const slug of ACTOR_POLICY_COLLECTIONS) {
		const cur = await getCollection(slug);
		if (!cur) {
			fail(`actor policy: ${slug} missing`);
			continue;
		}
		const current = (cur.schema_json.policies ?? {}).actor_fields;
		if (Array.isArray(current) && current.length === want.length && want.every((f, i) => current[i] === f)) {
			log(`  = ${slug}: employee actor binding already set`);
			continue;
		}
		await putPolicies(slug, EMPLOYEE_ACTOR_POLICY);
		log(`  ✓ ${slug}: employee bound to the session (actor_fields)`);
	}
}

async function main() {
	log(`Provisioning against ${BASE} (token: ${TOKEN === 'dev-token' ? 'dev-token' : '***'})\n`);

	// Health first — a clear message beats a wall of fetch errors.
	try {
		const health = await call('/api/health');
		log(`  ✓ API reachable (${health && health.status ? health.status : 'ok'})`);
	} catch (err) {
		fail(`API not reachable at ${BASE} — start it first (cd apps/api && npx wrangler dev): ${err.message}`);
		return;
	}

	for (const { slug, name, fields, policies } of createDefs()) {
		const existing = await getCollection(slug);
		if (existing) {
			log(`  = ${slug}: already exists — skipping (reconcile below if needed)`);
			continue;
		}
		await postCollection(slug, name, fields, policies);
		log(`  ✓ ${slug} (cms_${slug}): created with ${fields.length} fields`);
	}

	log('');
	log('Reconciling existing collections…');
	await reconcile('hrm_employees', { add: EMPLOYEE_ADD });
	await reconcile('hrm_shifts', { replace: SHIFT_REPLACE });
	await promoteToFormula();
	// veh_fleets "current document" pointers (kept fresh by mro/veh-relink.ts
	// lifecycle hooks). Reconcile-add keeps them out of the greenfield create
	// defs — veh_permits/veh_insurances may not exist yet at first provision.
	await reconcile('veh_fleets', { add: VEH_LASTDOC_ADD });
	// Care scalars — a fleet DB that predates them gets them merged in.
	await reconcile('veh_fleets', { add: VEH_CARE_ADD });
	// The request lifecycle is the engine's system `doc_status` (draft →
	// pending_review → approved/rejected/cancelled) — remove the redundant custom
	// `status` select those collections used to carry next to it. `hrm_leaves`
	// additionally carries a stray OT-style `type` select (schema drift — it is
	// not part of the leave defs and nothing reads it).
	for (const slug of ['hrm_leaves', 'hrm_overtimes', 'hrm_early_leaves']) {
		await dropFields(slug, slug === 'hrm_leaves' ? ['status', 'type'] : ['status']);
	}
	// Runtime policies: bind punches + requests to the session employee.
	await applyActorPolicies();
	log('');
	log('✓ Done — collections are provisioned under their module slugs (hrm_* / veh_*),');
	log('  so physical tables are cms_hrm_* / cms_veh_* automatically. No rename step needed.');
}

main().catch((err) => {
	console.error(err);
	process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * Seed the vehicle-maintenance master + a small, consistent demo set for the
 * ပြင်ဆင် app (`/app/maintenances`):
 *
 *   1. `veh_issue_types` — the THREE baseline standard jobs a truck log can cite
 *      (Engine & Gearbox / Suspension / Lighting & Electronic). The category of
 *      each must be one of the master's declared set (eng | bod | sus | ele).
 *   2. `veh_maintenance_logs` — one worked example per baseline job on a real
 *      `veh_fleets` truck, so the app opens with a truthful timeline instead of
 *      an empty screen. `total_cost` is NOT sent — it is the engine-owned stored
 *      formula `parts_cost + labor_cost` and is computed server-side on write.
 *
 * IDEMPOTENT — safe to re-run:
 *   • issue types are matched by `job_code` (created only when absent);
 *   • logs are matched by (fleet, issues_type, started_at) — an existing row is
 *     left untouched, except that the `driver` column is BACKFILLED when the row
 *     carries none (the driver was added after these rows were first seeded), so
 *     an operator-set driver is never overwritten.
 * Vehicle ids are resolved by PLATE and employees by NAME (never hard-coded), so
 * the same script seeds any environment that carries the same fleet directory.
 *
 *   node scripts/seed-veh-maintenance.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token`.
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}

/** The three baseline maintenance jobs (one per category family the app ships). */
const ISSUE_TYPES = [
	{
		job_code: 'JOB-ENG',
		name_en: 'Engine & Gearbox Service',
		name_mm: 'အင်ဂျင်/ဂီယာ ထိန်းသိမ်းမှု',
		category: 'eng',
		keywords: ['engine', 'gearbox', 'oil', 'အင်ဂျင်'],
	},
	{
		job_code: 'JOB-SUS',
		name_en: 'Suspension Repair',
		name_mm: 'ဆိုင်းစနစ် ပြုပြင်မှု',
		category: 'sus',
		keywords: ['suspension', 'leaf', 'shock', 'ဆိုင်း'],
	},
	{
		job_code: 'JOB-ELE',
		name_en: 'Lighting & Electronic Repair',
		name_mm: 'မီးနှင့် အီလက်ထရောနစ် ပြုပြင်မှု',
		category: 'ele',
		keywords: ['light', 'wiring', 'battery', 'မီး'],
	},
];

/** The demo logs — resolved to real ids at run time (plate / employee name). */
const LOGS = [
	{
		plate: 'RF-11',
		job_code: 'JOB-SUS',
		started_at: '2026-08-12',
		end_at: '2026-08-15',
		odo: '184500',
		parts_cost: 250000,
		labor_cost: 80000,
		vendor_type: 'in_house',
		technician: 'Ko Aung (in-house)',
		note: 'Rear leaf spring + shackle bushing replaced; road-tested with a full load.',
		driver: 'U Soe Naing',
		recommended_by: 'U Soe Naing',
		approved_by: 'U Hla Tun',
	},
	{
		plate: '9Q-5691',
		job_code: 'JOB-ENG',
		started_at: '2026-08-20',
		end_at: '2026-08-22',
		odo: '231800',
		parts_cost: 480000,
		labor_cost: 120000,
		vendor_type: 'external',
		technician: 'Mandalay Diesel Workshop',
		note: 'Injector service + gearbox oil & filter change; external vendor invoice attached.',
		driver: 'U Ye Naing',
		recommended_by: 'U Ye Naing',
		approved_by: 'U Hla Tun',
	},
	{
		plate: '7S-6173',
		job_code: 'JOB-ELE',
		started_at: '2026-09-02',
		end_at: '2026-09-02',
		odo: '98650',
		parts_cost: 65000,
		labor_cost: 25000,
		vendor_type: 'in_house',
		technician: 'Ko Zaw (in-house)',
		note: 'Head-lamp relay + tail wiring loom repaired; brake lights re-tested.',
		driver: 'U Hla Tun',
		recommended_by: 'Ma Ei Mon',
		approved_by: 'U Soe Naing',
	},
];

async function listAll(slug, fields) {
	const res = await api('GET', `/api/entities/${slug}?limit=200&fields=${fields.join(',')}`);
	return res.json?.data ?? [];
}

const run = async () => {
	const log = [];
	let failures = 0;

	// ── 1. Issue-type master (upsert by job_code) ────────────────────────────
	const existingTypes = await listAll('veh_issue_types', ['id', 'job_code']);
	const typeByCode = new Map(existingTypes.filter((t) => t.job_code).map((t) => [t.job_code, t]));
	const issueTypeIds = new Map();

	for (const issueType of ISSUE_TYPES) {
		const found = typeByCode.get(issueType.job_code);
		if (found) {
			issueTypeIds.set(issueType.job_code, found.id);
			log.push(`skip  issue_type ${issueType.job_code} (exists)`);
			continue;
		}
		const created = await api('POST', '/api/entities/veh_issue_types', issueType);
		if (created.ok && created.json?.data?.id) {
			issueTypeIds.set(issueType.job_code, created.json.data.id);
			log.push(`create issue_type ${issueType.job_code} (${issueType.name_en})`);
		} else {
			log.push(`FAIL  issue_type ${issueType.job_code}: HTTP ${created.status} ${created.json?.error ?? ''}`.trim());
			failures += 1;
		}
	}

	// ── 2. Resolve real vehicle + employee ids (by plate / name) ─────────────
	const fleets = await listAll('veh_fleets', ['id', 'plate_no']);
	const fleetByPlate = new Map(fleets.filter((f) => f.plate_no).map((f) => [String(f.plate_no).trim(), f.id]));
	const employees = await listAll('hrm_employees', ['id', 'name_en']);
	const employeeByName = new Map(employees.filter((e) => e.name_en).map((e) => [String(e.name_en).trim(), e.id]));

	// ── 3. Maintenance logs (dedupe by fleet + issues_type + started_at) ─────
	// A bare `fields=fleet,issues_type` read returns each m2o EXPANDED (an object
	// with an `id`), so normalize to the id before keying — otherwise every re-run
	// would treat the row as new and duplicate it.
	const existingLogs = await listAll('veh_maintenance_logs', ['id', 'fleet', 'issues_type', 'started_at', 'driver']);
	const relId = (value) => (value && typeof value === 'object' ? value.id : value);
	const logKey = (fleet, typeId, startedAt) => `${fleet}|${typeId}|${startedAt}`;
	const existingByKey = new Map(existingLogs.map((l) => [logKey(relId(l.fleet), relId(l.issues_type), l.started_at), l]));

	for (const entry of LOGS) {
		const fleetId = fleetByPlate.get(entry.plate);
		const typeId = issueTypeIds.get(entry.job_code);
		if (!fleetId) {
			log.push(`FAIL  log ${entry.plate}/${entry.job_code}: vehicle not found on the fleet master`);
			failures += 1;
			continue;
		}
		if (!typeId) {
			log.push(`FAIL  log ${entry.plate}/${entry.job_code}: issue type not resolvable`);
			failures += 1;
			continue;
		}
		const key = logKey(fleetId, typeId, entry.started_at);
		const existing = existingByKey.get(key);
		if (existing) {
			const driverId = employeeByName.get(entry.driver);
			// Backfill the `driver` column onto rows seeded before it existed — only
			// when the row carries NO driver, so an operator-set one is never clobbered.
			if (driverId && relId(existing.driver) == null) {
				const filled = await api('PUT', `/api/entities/veh_maintenance_logs/${existing.id}`, { driver: driverId });
				if (filled.ok) {
					log.push(`fill  log ${entry.plate} ${entry.job_code} driver → ${entry.driver}`);
				} else {
					log.push(`FAIL  fill driver ${entry.plate} ${entry.job_code}: HTTP ${filled.status} ${filled.json?.error ?? ''}`.trim());
					failures += 1;
				}
			} else {
				log.push(`skip  log ${entry.plate} ${entry.job_code} ${entry.started_at} (exists)`);
			}
			continue;
		}

		const payload = {
			fleet: fleetId,
			issues_type: typeId,
			started_at: entry.started_at,
			...(entry.end_at ? { end_at: entry.end_at } : {}),
			...(entry.odo ? { odo: entry.odo } : {}),
			parts_cost: entry.parts_cost,
			labor_cost: entry.labor_cost,
			vendor_type: entry.vendor_type,
			...(entry.technician ? { technician: entry.technician } : {}),
			...(entry.note ? { note: entry.note } : {}),
			...(employeeByName.get(entry.driver) ? { driver: employeeByName.get(entry.driver) } : {}),
			...(employeeByName.get(entry.recommended_by) ? { recommended_by: employeeByName.get(entry.recommended_by) } : {}),
			...(employeeByName.get(entry.approved_by) ? { approved_by: employeeByName.get(entry.approved_by) } : {}),
		};

		const created = await api('POST', '/api/entities/veh_maintenance_logs', payload);
		if (created.ok && created.json?.data?.id) {
			const total = created.json.data.total_cost;
			log.push(`create log ${entry.plate} ${entry.job_code} ${entry.started_at} → total ${total}`);
		} else {
			log.push(`FAIL  log ${entry.plate} ${entry.job_code}: HTTP ${created.status} ${created.json?.error ?? ''}`.trim());
			failures += 1;
		}
	}

	console.log(log.join('\n'));
	console.log(failures === 0 ? '\nSeed: OK ✅' : `\nSeed: ${failures} FAILURE(S) ❌`);
	process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
	console.error('SEED ABORTED:', err);
	process.exit(2);
});

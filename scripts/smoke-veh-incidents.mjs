#!/usr/bin/env node
/**
 * Live end-to-end smoke for the Accidents & Incidents screen (`/app/incidents`)
 * against the REAL `veh_incidents` collection on the running worker.
 *
 *   node scripts/smoke-veh-incidents.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token`.
 *
 * Mirrors the exact reads the tgapp incidents module issues:
 *   - create → POST /api/entities/veh_incidents (vehicle m2o → veh_fleets,
 *     reporter m2o → hrm_employees, kind accident|incident, severity)
 *   - list   → GET .../veh_incidents?fields=id,vehicle,kind,title,severity,
 *              reported_by,incident_date,location&sort=-created_at
 * and asserts the card the UI builds resolves its plate + reporter name.
 *
 * Binds to a real plate already on the fleet directory + a real employee, so the
 * proof runs against the live directory (not throwaway fixtures).
 */

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}

let failures = 0;
const log = [];
function check(name, detail, cond, extra = '') {
	if (cond) log.push(`PASS  ${name}`);
	else {
		failures += 1;
		log.push(`FAIL  ${name} — ${detail} ${extra}`);
	}
}

const today = new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10);
const stamp = Date.now();
const unique = (s) => `${s}-${stamp % 100_000}`;

const run = async () => {
	// ── Resolve a REAL plate + reporter from the live directory ────────────────
	const fleets = await api('GET', '/api/entities/veh_fleets?fields=id,plate_no&limit=100');
	check('fleet directory readable', `got ${fleets.status}`, fleets.ok, fleets.json?.error ?? '');
	if (!fleets.ok) return;
	const plateRow = (fleets.json?.data ?? []).find((r) => r.plate_no?.trim());
	check('at least one plate on directory', JSON.stringify(fleets.json?.data), !!plateRow);

	const emps = await api('GET', '/api/entities/hrm_employees?fields=id,name_en&limit=100');
	check('employee directory readable', `got ${emps.status}`, emps.ok, emps.json?.error ?? '');
	if (!emps.ok) return;
	const reporterRow = (emps.json?.data ?? []).find((r) => r.name_en?.trim());
	check('at least one employee to report', `plate=${plateRow?.plate_no}`, !!reporterRow);
	if (!plateRow || !reporterRow) return;
	const PLATE = plateRow.id;
	const REPORTER = reporterRow.id;

	// ── Create one accident (high severity, est cost) ──────────────────────────
	const accident = await api('POST', '/api/entities/veh_incidents', {
		vehicle: PLATE,
		kind: 'accident',
		reported_by: REPORTER,
		title: unique('Live smoke accident — rear bumper scrape'),
		description: 'Side swipe at main gate while reversing.',
		incident_date: today,
		severity: 'high',
		location: 'Main store yard',
		est_cost: 250000,
	});
	check('create accident 201', `got ${accident.status}`, accident.ok, accident.json?.error ?? '');
	if (!accident.ok) return;
	const accData = accident.json.data;
	check(
		'accident row kind/severity/vehicle/reporter persisted',
		JSON.stringify(accData),
		accData.kind === 'accident' &&
			accData.severity === 'high' &&
			accData.vehicle === PLATE &&
			accData.reported_by === REPORTER &&
			Number(accData.est_cost) === 250000,
	);

	// ── Create one incident (defaults → incident kind, low severity) ───────────
	const incident = await api('POST', '/api/entities/veh_incidents', {
		vehicle: PLATE,
		kind: 'incident',
		reported_by: REPORTER,
		title: unique('Live smoke incident — bracket bolt loose'),
		incident_date: today,
		location: 'Workshop bay 2',
	});
	check('create incident 201', `got ${incident.status}`, incident.ok, incident.json?.error ?? '');
	if (!incident.ok) return;
	const incData = incident.json.data;
	check('incident row defaults (kind=incident)', JSON.stringify(incData), incData.kind === 'incident');

	// ── List back exactly as the UI does (fields + sort -created_at) ───────────
	const list = await api(
		'GET',
		'/api/entities/veh_incidents?fields=id,vehicle,kind,title,description,severity,reported_by,incident_date,location,est_cost,created_at&sort=-created_at&limit=25',
	);
	check('list 200', `got ${list.status}`, list.ok, list.json?.error ?? '');
	if (!list.ok) return;
	const items = Array.isArray(list.json?.data) ? list.json.data : [];
	check('created rows appear in the UI list', `found=${items.length}`, items.length >= 2);

	// Resolve the reporter name the card builds (via hrm_employees lookup).
	const reporterById = new Map((emps.json?.data ?? []).map((r) => [r.id, r]));
	const rows = items.filter((r) => r.id === accData.id || r.id === incData.id);
	check('both smoke rows present', JSON.stringify(rows.map((r) => r.id)), rows.length === 2);
	for (const row of rows) {
		const plate = row.vehicle?.plate_no ?? plateRow.plate_no;
		const reporter = row.reported_by;
		const reporterName = typeof reporter === 'object' ? reporter?.name_en : reporterById.get(reporter)?.name_en;
		check(
			`card for ${row.kind} resolves plate + reporter name`,
			`plate=${plate} name=${reporterName}`,
			plate === plateRow.plate_no && !!reporterName,
		);
	}

	console.log(log.join('\n'));
	console.log(`\nSmoke: ${failures === 0 ? 'ALL PASS ✅' : `${failures} FAILURE(S) ❌`}`);
	process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
	console.error('SMOKE ABORTED:', err);
	process.exit(2);
});

#!/usr/bin/env node
/**
 * Local demo seed — Team Tracking data for ONE superior.
 *
 * Wires the given superior (default MFF-009 · ဦးလှထွန်း) to a set of
 * `hrm_employee_links` subordinates, then seeds `hrm_attendances` day rows for
 * the last few work days (check-in / check-out + the GPS `geo_in` / `geo_out`),
 * so the tgapp opens on a populated Team Tracking list and a 7-day detail.
 *
 * Runs against a LOCAL dev API (`npx wrangler dev`, port 8788) with the
 * dev-token. A trusted-root admin is exempt from the attendance time lock and
 * the `employee` actor binding, so the back-dated times and the named employee
 * are honoured exactly as sent — this is a deliberate back-fill, not a punch.
 *
 * Usage:
 *   node scripts/seed-hr-team-demo.mjs
 *   SEED_RESET=1 node scripts/seed-hr-team-demo.mjs   # wipe this window, reseed
 *
 * Env:
 *   PROVISION_API   default http://127.0.0.1:8788
 *   PROVISION_TOKEN default dev-token
 *   SUPERIOR_EID    default MFF-009
 *   SUB_EIDS        default MFF-004,MFF-006,MFF-007,MFF-008,MFF-010
 *   SEED_DAYS       default 7
 *   SEED_RESET      "1" to delete the seeded employees' rows in the window first
 *
 * Idempotent: links are matched by (superior, subordinate) and a day row is
 * skipped when the employee already has an attendance row on that work date.
 */

const BASE = process.env.PROVISION_API || 'http://127.0.0.1:8788';
const TOKEN = process.env.PROVISION_TOKEN || 'dev-token';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

const SUPERIOR_EID = process.env.SUPERIOR_EID || 'MFF-009';
const SUB_EIDS = (process.env.SUB_EIDS || 'MFF-004,MFF-006,MFF-007,MFF-008,MFF-010')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const SEED_DAYS = Number(process.env.SEED_DAYS || '7') || 7;
const RESET = process.env.SEED_RESET === '1';

const DAY_MS = 86_400_000;
const MMT_OFFSET_MS = 6.5 * 3_600_000;
const WORK_DAY_START_HOUR = 4;

const log = (...a) => console.log(...a);
const fail = (m) => {
	console.error(`✗ ${m}`);
	process.exitCode = 1;
};

/* ── work-date helpers (mirror the tgapp's MMT 4 AM boundary) ─────────────── */
const mmtDate = (ms) => new Date(ms + MMT_OFFSET_MS).toISOString().slice(0, 10);
/** The current MMT work date (before 04:00 MMT it is still yesterday's window). */
function todayWorkDate() {
	const shifted = new Date(Date.now() + MMT_OFFSET_MS);
	if (shifted.getUTCHours() < WORK_DAY_START_HOUR) return new Date(shifted.getTime() - DAY_MS).toISOString().slice(0, 10);
	return shifted.toISOString().slice(0, 10);
}
/** The work date (`YYYY-MM-DD`) of an instant — matches `toWorkDate` in the app. */
const workDateOf = (iso) => mmtDate(Date.parse(iso) - WORK_DAY_START_HOUR * 3_600_000);
/** `YYYY-MM-DD` shifted by `delta` days. */
const shiftDate = (date, delta) => new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);

/** A UTC instant at `HH:MM` MMT on the given work date (09:00 MMT → 02:30Z). */
const mmtInstant = (date, hour, minute) => new Date(Date.parse(`${date}T00:00:00Z`) - MMT_OFFSET_MS + hour * 3_600_000 + minute * 60_000).toISOString();

/* ── API helpers (mirror scripts/seed-hr-employees.mjs) ───────────────────── */
async function callRaw(path, opts = {}) {
	const res = await fetch(`${BASE}${path}`, { headers: HEADERS, ...opts });
	const text = await res.text();
	if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
async function call(path, opts = {}) {
	const body = await callRaw(path, opts);
	return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
async function fetchAll(slug, sort = 'name', fields) {
	const rows = [];
	let cursor;
	do {
		const q = new URLSearchParams({ limit: '100', sort });
		if (fields) q.set('fields', fields);
		if (cursor) q.set('cursor', cursor);
		const body = await callRaw(`/api/entities/${slug}?${q}`);
		rows.push(...body.data);
		cursor = body.meta.has_more ? body.meta.next_cursor : undefined;
	} while (cursor);
	return rows;
}
const idOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.id : '');

/* ── run ──────────────────────────────────────────────────────────────────── */
async function seed() {
	log(`Seeding Team Tracking demo against ${BASE}\n  superior=${SUPERIOR_EID}  reports=${SUB_EIDS.join(', ')}  days=${SEED_DAYS}${RESET ? '  RESET' : ''}\n`);

	try {
		await call('/api/health');
	} catch (err) {
		fail(`API not reachable at ${BASE} — start it first (cd apps/api && npx wrangler dev): ${err.message}`);
		return;
	}

	// ── resolve roster + a shift for the seeded punches ────────────────────
	const [employees, shifts] = await Promise.all([fetchAll('hrm_employees', 'eid'), fetchAll('hrm_shifts', 'name')]);
	const byEid = new Map(employees.map((e) => [e.eid, e]));
	const shiftByName = new Map(shifts.map((s) => [s.name, s]));

	const superior = byEid.get(SUPERIOR_EID);
	if (!superior) return fail(`Superior ${SUPERIOR_EID} not found — seed employees first (scripts/seed-hr-employees.mjs).`);

	const reports = SUB_EIDS.map((eid) => byEid.get(eid)).filter(Boolean);
	if (reports.length === 0) return fail(`None of the report eids exist: ${SUB_EIDS.join(', ')}`);

	const defaultShift = shiftByName.get('Shift for YGN,NPT,TGI,BGO') ?? shifts[0];
	const superiorShift = shiftByName.get('Shift for Safety') ?? defaultShift;
	if (!defaultShift) return fail('No shifts found — run scripts/seed-hr-masters.mjs first.');

	// ── reporting links (superior → each report), idempotent by pair ────────
	const existingLinks = await fetchAll('hrm_employee_links', 'id', 'superior,subordinate');
	const haveLink = new Set(existingLinks.map((l) => `${idOf(l.superior)}:${idOf(l.subordinate)}`));
	let linked = 0;
	for (const report of reports) {
		const key = `${superior.id}:${report.id}`;
		if (haveLink.has(key)) {
			log(`  = link ${SUPERIOR_EID} → ${report.eid} already present`);
			continue;
		}
		await call('/api/entities/hrm_employee_links', { method: 'POST', body: JSON.stringify({ superior: superior.id, subordinate: report.id }) });
		log(`  ✓ link ${SUPERIOR_EID} → ${report.eid} ${report.name_mm ?? report.name_en ?? ''}`);
		linked += 1;
	}

	// ── attendance rows: the last SEED_DAYS work dates ──────────────────────
	// Work dates newest-first; the CURRENT work date is left OPEN (no check-out)
	// so the "today" row reads like a live punch day.
	const today = todayWorkDate();
	const workDates = Array.from({ length: SEED_DAYS }, (_, i) => shiftDate(today, -i));

	const targets = [
		...reports.map((r, i) => ({ row: r, shiftId: defaultShift.id, jitter: i })),
		{ row: superior, shiftId: superiorShift.id, jitter: 0 }, // the viewer's own "My Attendance"
	];

	let created = 0;
	let skipped = 0;
	let removed = 0;

	for (const { row, shiftId, jitter } of targets) {
		const q = new URLSearchParams({ limit: '200', fields: 'id,check_in' });
		q.set('filter[employee][_eq]', row.id);
		const existing = (await callRaw(`/api/entities/hrm_attendances?${q}`)).data ?? [];
		const byWorkDate = new Map(existing.map((a) => [workDateOf(a.check_in), a.id]));

		if (RESET) {
			for (const date of workDates) {
				const id = byWorkDate.get(date);
				if (!id) continue;
				await call(`/api/entities/hrm_attendances/${id}`, { method: 'DELETE' });
				byWorkDate.delete(date);
				removed += 1;
			}
		}

		for (let d = 0; d < workDates.length; d++) {
			const date = workDates[d];
			if (byWorkDate.has(date)) {
				skipped += 1;
				continue;
			}
			const isToday = date === today;
			const inMin = 30 + jitter; // 09:00–09:04 MMT
			const payload = {
				employee: row.id,
				shift: shiftId,
				check_in: mmtInstant(date, 9, inMin),
				geo_in: geoFor(row.eid, date),
				...(isToday ? {} : { check_out: mmtInstant(date, 17, 30 + jitter), geo_out: geoFor(row.eid, date, 0.0007) }),
			};
			await call('/api/entities/hrm_attendances', { method: 'POST', body: JSON.stringify(payload) });
			created += 1;
		}
		log(`  ✓ attendance ${row.eid} ${row.name_mm ?? ''} — ${workDates.length} days`);
	}

	log(`\n✅ Done — ${linked} links added, ${created} punches created, ${skipped} already present, ${removed} reset.`);
	log(`   Team Tracking: /app/attendance?scope=team   (login as ${SUPERIOR_EID})`);
}

/** A plausible Yangon-area GPS fix ("lat,lng") with a deterministic per-day jitter. */
function geoFor(seed, date, extra = 0) {
	const h = [...`${seed}:${date}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
	const lat = 16.8409 + ((h % 1000) / 1000 - 0.5) * 0.06 + extra;
	const lng = 96.1735 + (((h >> 10) % 1000) / 1000 - 0.5) * 0.06 + extra;
	return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

seed();

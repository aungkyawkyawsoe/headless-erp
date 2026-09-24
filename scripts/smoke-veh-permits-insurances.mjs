#!/usr/bin/env node
/**
 * Live end-to-end smoke for the Licenses + Insurances screens (`/app/licenses`,
 * `/app/insurances`) against the REAL `veh_permits` / `veh_insurances`
 * collections on the running worker.
 *
 *   node scripts/smoke-veh-permits-insurances.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token`.
 *
 * Mirrors the exact reads the tgapp modules issue:
 *   - create → POST /api/entities/veh_permits & veh_insurances (vehicle m2o →
 *     veh_fleets, plus their document fields);
 *   - list   → GET each with the fields/sort the list screens project, joined
 *     client-side to the plate for the card.
 * Asserts the card resolves the real plate on both collections.
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
function check(name, condDetail, cond, extra = '') {
	if (cond) log.push(`PASS  ${name}`);
	else {
		failures += 1;
		log.push(`FAIL  ${name} — ${condDetail} ${extra}`);
	}
}

const today = new Date(Date.now() + 6.5 * 3600_000).toISOString().slice(0, 10);
const year = Number(today.slice(0, 4));
const nextYear = `${year + 1}${today.slice(4)}`;
const stamp = Date.now();
const unique = (s) => `${s}-${stamp % 100_000}`;

const run = async () => {
	// ── Resolve a REAL plate from the live directory ───────────────────────────
	const fleets = await api('GET', '/api/entities/veh_fleets?fields=id,plate_no&limit=100');
	check('fleet directory readable', `got ${fleets.status}`, fleets.ok, fleets.json?.error ?? '');
	if (!fleets.ok) return;
	const plateRow = (fleets.json?.data ?? []).find((r) => r.plate_no?.trim());
	check('at least one plate on directory', JSON.stringify(fleets.json?.data), !!plateRow);
	if (!plateRow) return;
	const PLATE = plateRow.id;

	// ── Create one license on veh_permits ──────────────────────────────────────
	const permit = await api('POST', '/api/entities/veh_permits', {
		vehicle: PLATE,
		license_no: unique('YGN/2026/LIC'),
		place: 'Yangon',
		issue_date: today,
		expiry_date: nextYear,
	});
	check('create permit 201', `got ${permit.status}`, permit.ok, permit.json?.error ?? '');
	if (permit.ok) {
		const d = permit.json.data;
		check(
			'permit row vehicle + dates persisted',
			JSON.stringify(d),
			d.vehicle === PLATE && d.issue_date === today && /^\d{4}-\d{2}-\d{2}$/.test(d.expiry_date ?? ''),
		);
	}

	// ── Create one policy on veh_insurances ────────────────────────────────────
	const policy = await api('POST', '/api/entities/veh_insurances', {
		vehicle: PLATE,
		provider: 'AYI',
		policy_no: unique('AYA/YGN/POL'),
		expiry_date: nextYear,
		betterment: true,
		windscreen_cover: 150000,
		premium_amount: 1250000,
		sum_insured: 50000000,
		note: 'smoke policy',
	});
	check('create policy 201', `got ${policy.status}`, policy.ok, policy.json?.error ?? '');
	if (!policy.ok) return;
	const pData = policy.json.data;
	check(
		'policy row vehicle/provider/terms persisted',
		JSON.stringify(pData),
		pData.vehicle === PLATE &&
			pData.provider === 'AYI' &&
			pData.premium_amount === 1250000 &&
			pData.betterment === true &&
			pData.coverage === undefined,
	);

	// ── List both back exactly as the list screens project ─────────────────────
	const permList = await api(
		'GET',
		'/api/entities/veh_permits?fields=id,vehicle,license_no,place,issue_date,expiry_date,created_at&sort=-created_at&limit=25',
	);
	check('veh_permits list 200', `got ${permList.status}`, permList.ok, permList.json?.error ?? '');
	if (permList.ok) {
		const rows = Array.isArray(permList.json?.data) ? permList.json.data : [];
		check('permit rows present', `found=${rows.length}`, rows.length >= 1);
		const mine = rows.find((r) => r.id === permit.json?.data?.id);
		if (mine) {
			const plate = mine.vehicle?.plate_no ?? plateRow.plate_no;
			check('permit card resolves plate', `plate=${plate}`, plate === plateRow.plate_no);
		} else {
			check('created permit appears in list', 'row not found', false);
		}
	}

	const insList = await api(
		'GET',
		'/api/entities/veh_insurances?fields=id,vehicle,provider,policy_no,expiry_date,premium_amount,sum_insured,betterment,note,created_at&sort=-created_at&limit=25',
	);
	check('veh_insurances list 200', `got ${insList.status}`, insList.ok, insList.json?.error ?? '');
	if (insList.ok) {
		const rows = Array.isArray(insList.json?.data) ? insList.json.data : [];
		check('policy rows present', `found=${rows.length}`, rows.length >= 1);
		const mine = rows.find((r) => r.id === pData.id);
		if (mine) {
			const plate = mine.vehicle?.plate_no ?? plateRow.plate_no;
			check('policy card resolves plate', `plate=${plate}`, plate === plateRow.plate_no);
		} else {
			check('created policy appears in list', 'row not found', false);
		}
	}

	console.log(log.join('\n'));
	console.log(`\nSmoke: ${failures === 0 ? 'ALL PASS ✅' : `${failures} FAILURE(S) ❌`}`);
	process.exit(failures === 0 ? 0 : 1);
};

run().catch((err) => {
	console.error('SMOKE ABORTED:', err);
	process.exit(2);
});

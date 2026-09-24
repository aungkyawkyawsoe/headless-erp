#!/usr/bin/env node
/**
 * Additive seed for the live vehicle Licenses (`veh_permits`) + Insurances
 * (`veh_insurances`) screens — a handful of realistic rows across the REAL
 * `veh_fleets` plates so both lists demonstrate the expiry-tone pills on first
 * open. Designed to be ADDITIVE and safe to run on a populated DB — no unique
 * serial fields exist, so rows never collide; running twice just adds more rows
 * (demo content, no movement/stock side effects).
 *
 *   node scripts/seed-veh-docs.mjs [baseUrl] [bearerToken]
 *
 * Uses `POST /api/entities/veh_permit`-style engine writes (never raw SQL).
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}

// MMT today + date helpers for expiry-window variety.
const today = () => {
	const d = new Date(Date.now() + 6.5 * 3600_000);
	return d.toISOString().slice(0, 10);
};
function dateFromToday(offsetDays) {
	const d = new Date(Date.now() + 6.5 * 3600_000 + offsetDays * 86_400_000);
	return d.toISOString().slice(0, 10);
}

// Real plates on the live veh_fleets directory (TRK-1001 / TRK-1002).
const run = async () => {
	const fleets = await api('GET', '/api/entities/veh_fleets?fields=id,plate_no&limit=100');
	if (!fleets.ok) {
		console.error('Could not read veh_fleets:', fleets.status);
		process.exit(1);
	}
	const plates = (fleets.json?.data ?? []).map((r) => r.id).filter(Boolean);
	const [plateA, plateB] = [plates[0], plates[1] ?? plates[0]];
	if (!plateA) {
		console.error('No plates on the veh_fleets directory — seed the fleet first.');
		process.exit(1);
	}

	const todayStr = today();
	const year = Number(todayStr.slice(0, 4));
	const yy = String(year).slice(2);
	const row = (n) => String(n).padStart(3, '0');

	const permits = [
		// Overdue — already past today.
		{ vehicle: plateA, license_no: `YGN/${yy}/${row(100)}`, place: 'Yangon', issue_date: dateFromToday(-380), expiry_date: dateFromToday(-95) },
		// Expiring — within 30 days.
		{ vehicle: plateB, license_no: `YLN/${yy}/${row(101)}`, place: 'Yangon', issue_date: dateFromToday(-340), expiry_date: dateFromToday(12) },
		// Valid — far out.
		{ vehicle: plateA, license_no: `MDY/${yy}/${row(102)}`, place: 'Mandalay', issue_date: dateFromToday(-120), expiry_date: dateFromToday(240) },
	];
	const policies = [
		// Expired — a full terms row (premium/sum insured/note shown on the cards).
		{
			vehicle: plateB,
			provider: 'AYI',
			policy_no: `AYA/YGN/${yy}/${row(40)}`,
			expiry_date: dateFromToday(-40),
			betterment: true,
			windscreen_cover: 150000,
			premium_amount: 1250000,
			sum_insured: 50000000,
			note: 'Full comprehensive incl. windscreen replacement',
		},
		// Expiring.
		{
			vehicle: plateA,
			provider: 'AYI',
			policy_no: `AYA/YGN/${yy}/${row(41)}`,
			expiry_date: dateFromToday(20),
			premium_amount: 980000,
			sum_insured: 35000000,
		},
		// Valid.
		{
			vehicle: plateB,
			provider: 'GGI',
			policy_no: `GG/YGN/${yy}/${row(42)}`,
			expiry_date: dateFromToday(280),
			windscreen_cover: 120000,
			premium_amount: 1640000,
			sum_insured: 60000000,
			note: 'Covers all drivers over 25',
		},
	];

	let ok = true;
	for (const p of permits) {
		const r = await api('POST', '/api/entities/veh_permits', p);
		if (!r.ok) {
			ok = false;
			console.error('FAIL create permit', p.license_no, r.status, r.json?.error ?? '');
		} else {
			console.log(`seed permit ${p.license_no} → ${r.json.data.id}`);
		}
	}
	for (const p of policies) {
		const r = await api('POST', '/api/entities/veh_insurances', p);
		if (!r.ok) {
			ok = false;
			console.error('FAIL create policy', p.policy_no, r.status, r.json?.error ?? '');
		} else {
			console.log(`seed policy ${p.policy_no} → ${r.json.data.id}`);
		}
	}
	console.log(ok ? '\nSeed: ALL ADDED ✅' : '\nSeed: PARTIAL ❌');
	process.exit(ok ? 0 : 1);
};

run().catch((err) => {
	console.error('SEED ABORTED:', err);
	process.exit(2);
});

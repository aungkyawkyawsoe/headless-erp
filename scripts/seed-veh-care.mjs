#!/usr/bin/env node
/**
 * Fleet Care demo seed — give the Vehicle Care apps live rows to show on first
 * open:
 *
 *  - a year of daily-ish `veh_odo_months` readings (monotonic, ending today) —
 *    ONE month bucket per (vehicle, month) with that month's readings in the
 *    `readings` JSON array;
 *  - `veh_fluid_fills` (engine + gear oil) placed at odo values INSIDE that
 *    range so the km-left badges demo all three tones (green ≥ 1000,
 *    amber 0–999, red past due). Each fill carries its OWN per-fill next-due
 *    interval and stores the derived `next_due_odo` — there is no per-vehicle
 *    interval on the fleet master anymore.
 *
 * Targets the plates that carry the seeded license/insurance docs (TRK-1001 /
 * TRK-1002) plus the other demo units, so the first care screens also show the
 * seeded expiry pills. Skips a plate that already has any month bucket (safe to
 * re-run — never stacks duplicates).
 *
 *   node scripts/seed-veh-care.mjs [baseUrl] [bearerToken]
 *
 * Uses `POST /api/entities/...` engine writes (never raw SQL).
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}

/** MMT calendar date offset by whole days from today (the app's "today"). */
function dateFromToday(offsetDays) {
	const d = new Date(Date.now() + 6.5 * 3600_000 + offsetDays * 86_400_000);
	return d.toISOString().slice(0, 10);
}

/**
 * Per-plate demo: an odo arc (date, km) ending today + the two fills placed on
 * that arc (odo must sit between neighbouring readings). `plate` maps each arc
 * to its real veh_fleets row by PLATE (the directory is keyed on plate_no — never
 * array position). The two units that carry the seeded license/insurance docs
 * (TRK-1001 / TRK-1002) come first so the top cards demo the FULL care board.
 *
 * There is NO per-vehicle interval anymore — each fill carries its OWN
 * `nextDueIntervalKm` (the per-fill service gap the operator would choose), and
 * the row stores the derived next-due odo. The gaps are chosen per plate so the
 * km-left badges demo all three tones (green ≥ 1000, amber 0–999, red past due):
 *   TRK-1001 engine+gear green · TRK-1002 engine amber / gear green
 *   TRK-2001 engine red / gear green · TRL-2001 engine amber / gear red
 */
const DEMO = [
	{
		plate: 'TRK-1001',
		odo: [
			[-200, 112_400],
			[-160, 115_250],
			[-120, 117_900],
			[-90, 120_300],
			[-60, 122_750],
			[-30, 125_100],
			[-10, 126_600],
			[0, 127_650],
		],
		fills: [
			{ fluid_kind: 'engine_oil', odo_at_fill: 124_000, dayOffset: -40, nextDueIntervalKm: 5000, qty_liters: 24 },
			{ fluid_kind: 'gear_oil', odo_at_fill: 118_900, dayOffset: -130, nextDueIntervalKm: 10000, qty_liters: 18 },
		],
	},
	{
		plate: 'TRK-1002',
		odo: [
			[-200, 54_800],
			[-160, 56_650],
			[-120, 58_200],
			[-90, 59_600],
			[-60, 61_400],
			[-30, 63_200],
			[-7, 64_200],
			[0, 64_800],
		],
		fills: [
			{ fluid_kind: 'engine_oil', odo_at_fill: 59_900, dayOffset: -100, nextDueIntervalKm: 5000, qty_liters: 24 },
			{ fluid_kind: 'gear_oil', odo_at_fill: 57_300, dayOffset: -145, nextDueIntervalKm: 10000, qty_liters: 18 },
		],
	},
	{
		plate: 'TRK-2001',
		odo: [
			[-200, 84_100],
			[-160, 86_450],
			[-120, 88_700],
			[-90, 90_300],
			[-60, 92_400],
			[-30, 94_600],
			[-7, 95_800],
			[0, 96_200],
		],
		fills: [
			{ fluid_kind: 'engine_oil', odo_at_fill: 89_400, dayOffset: -115, nextDueIntervalKm: 5000, qty_liters: 24 },
			{ fluid_kind: 'gear_oil', odo_at_fill: 92_700, dayOffset: -55, nextDueIntervalKm: 10000, qty_liters: 18 },
		],
	},
	{
		plate: 'TRL-2001',
		odo: [
			[-200, 164_320],
			[-160, 168_150],
			[-120, 171_880],
			[-90, 174_600],
			[-60, 177_900],
			[-30, 181_150],
			[-10, 183_800],
			[0, 186_400],
		],
		fills: [
			{ fluid_kind: 'engine_oil', odo_at_fill: 182_200, dayOffset: -30, nextDueIntervalKm: 5000, qty_liters: 24, note: 'Engine oil + filter' },
			{ fluid_kind: 'gear_oil', odo_at_fill: 173_900, dayOffset: -105, nextDueIntervalKm: 10000, qty_liters: 18 },
		],
	},
];

const run = async () => {
	const fleets = await api('GET', '/api/entities/veh_fleets?fields=id,plate_no&limit=100');
	if (!fleets.ok) {
		console.error('Could not read veh_fleets:', fleets.status);
		process.exit(1);
	}
	const byPlate = new Map((fleets.json?.data ?? []).filter((r) => r.id && r.plate_no?.trim()).map((r) => [r.plate_no.trim(), r]));
	if (byPlate.size === 0) {
		console.error('No plates on the veh_fleets directory — seed the fleet first.');
		process.exit(1);
	}

	let ok = true;
	for (const demo of DEMO) {
		const fleet = byPlate.get(demo.plate);
		if (!fleet) {
			console.warn(`skip  ${demo.plate} (not on the live directory)`);
			continue;
		}
		const plate = fleet.plate_no.trim();
		// Already seeded (or the vehicle is in real use) — never stack duplicates.
		const existing = await api('GET', `/api/entities/veh_odo_months?fields=id&filter[vehicle][_eq]=${fleet.id}&limit=1`);
		if (existing.ok && (existing.json?.data?.length ?? 0) > 0) {
			console.log(`skip  ${plate} (already has odo month buckets)`);
			continue;
		}

		// Bucket the day readings by (Gregorian) month — ONE row per month whose
		// `readings` JSON array holds that month's daily readings, date-sorted.
		const byMonth = new Map();
		for (const [dayOffset, odometer] of demo.odo) {
			const date = dateFromToday(dayOffset);
			const month = date.slice(0, 7);
			const list = byMonth.get(month) ?? [];
			list.push({
				date,
				odo: odometer,
				...(dayOffset === 0 ? { note: 'End-of-day reading' } : {}),
				at: `${date}T12:00:00.000Z`,
			});
			byMonth.set(month, list);
		}
		let seededReadings = 0;
		for (const [month, readings] of [...byMonth.entries()].sort()) {
			const r = await api('POST', '/api/entities/veh_odo_months', {
				vehicle: fleet.id,
				month,
				readings: JSON.stringify(readings),
			});
			if (!r.ok) {
				ok = false;
				console.error(`FAIL create odo month ${plate} ${month}:`, r.status, r.json?.error ?? '');
			} else {
				seededReadings += readings.length;
			}
		}
		console.log(
			`seed odo ${plate} → ${seededReadings} readings in ${byMonth.size} month bucket(s) (latest ${demo.odo[demo.odo.length - 1][1].toLocaleString()} km)`,
		);

		for (const fill of demo.fills) {
			const r = await api('POST', '/api/entities/veh_fluid_fills', {
				vehicle: fleet.id,
				fluid_kind: fill.fluid_kind,
				odo_at_fill: fill.odo_at_fill,
				// Next service due = this fill's chosen per-fill gap past its odo.
				next_due_odo: fill.odo_at_fill + fill.nextDueIntervalKm,
				...(fill.qty_liters != null ? { qty_liters: fill.qty_liters } : {}),
				...(fill.note ? { note: fill.note } : {}),
			});
			if (!r.ok) {
				ok = false;
				console.error(`FAIL create ${fill.fluid_kind} fill ${plate} @ ${fill.odo_at_fill}:`, r.status, r.json?.error ?? '');
			} else {
				console.log(`seed ${fill.fluid_kind} fill ${plate} @ ${fill.odo_at_fill.toLocaleString()} km (due ${(fill.odo_at_fill + fill.nextDueIntervalKm).toLocaleString()})`);
			}
		}
	}

	console.log(ok ? '\nFleet Care seed: OK ✅' : '\nFleet Care seed: PARTIAL ❌');
	process.exit(ok ? 0 : 1);
};

run().catch((err) => {
	console.error('SEED ABORTED:', err);
	process.exit(2);
});

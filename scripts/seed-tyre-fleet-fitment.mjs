#!/usr/bin/env node
/**
 * Demo seed for the tyre fitment board.
 *
 * Prereq: `scripts/apply-veh-wheel-slots.mjs` has added the engine JSON field
 * `veh_fleets.wheel_slots` (an ordered list of { id, label } wheel seats).
 *
 * Gives each live `veh_fleets` demo unit a `wheel_slots` list whose LENGTH
 * equals its `wheel` count and whose ORDER reads as a truck PLAN. The fitment
 * sheet draws those seats as a chassis map: a cabbed truck leads with steer
 * singles (`steer-l`/`steer-r`, labels `FL1`/`FR1`) and each rear axle carries
 * an outer+inner seat per side (`drv1-lo/drv1-li/drv1-ri/drv1-ro`, labels
 * `RL1-O/RL1-I/RR1-I/RR1-O`…); a TRAILER has no steering axle, so every axle is
 * a dual pair. One shared pure helper (`wheelSlotsFor`) produces the ordered
 * seats from the unit type + wheel count — the single vocabulary both the
 * board scaffold and fit writers use (no free-text drift).
 *
 *   node scripts/seed-tyre-fleet-fitment.mjs [baseUrl] [bearerToken]
 *
 * Idempotent: updates rows by plate via PUT (existing) / creates missing ones.
 * No serial/event writes — a mounted tyre still comes only from a real engine
 * issue confirm (the sole legit writer); we never fabricate history.
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init = {}) => ({ ...init, headers: { ...headers, ...(init.headers ?? {}) } });

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, H({ method, body: body === undefined ? undefined : JSON.stringify(body) }));
	const json = await res.json().catch(() => null);
	if (!res.ok || !(json && json.success)) {
		throw new Error(`${method} ${path} → HTTP ${res.status}: ${json?.error ?? JSON.stringify(json)}`);
	}
	return json.data;
}

/**
 * Ordered wheel seats for a unit type + wheel count, read as a TRUCK PLAN — the
 * fitment sheet draws them front→rear around the chassis spine. A cabbed unit
 * (box / tractor…) leads with 2 steer singles then dual rear axles (each side
 * carries an outer + inner wheel): a 6-wheel box = steer + ONE dual axle (6
 * seats), a 10-wheel tractor = steer + TWO dual axles (10). A TRAILER has no
 * steering axle — every axle is a dual pair (a 12-wheel trailer = three dual
 * axles). Unusual budgets (wheel-2 not a multiple of 4) fall back to single
 * rear wheels — never a bare unlabelled block. Front ids stay `steer-l/r` so
 * mounted serials already keyed to them keep seating; every seat's `label` is
 * the workshop-style position code the plan tiles show.
 */
function wheelSlotsFor(unitType, wheel) {
	if (!wheel || wheel <= 0) return null;
	const cabbed = unitType !== 'trailer';
	const seats = [];
	let budget = wheel;
	if (cabbed && wheel >= 4) {
		seats.push({ id: 'steer-l', label: 'FL1' });
		seats.push({ id: 'steer-r', label: 'FR1' });
		budget -= 2;
	}
	let axle = 1;
	// Rear axles — one outer + inner seat per side, ordered as the plan reads:
	// left outer, left inner, right inner, right outer.
	while (budget >= 4) {
		seats.push({ id: `drv${axle}-lo`, label: `RL${axle}-O` });
		seats.push({ id: `drv${axle}-li`, label: `RL${axle}-I` });
		seats.push({ id: `drv${axle}-ri`, label: `RR${axle}-I` });
		seats.push({ id: `drv${axle}-ro`, label: `RR${axle}-O` });
		budget -= 4;
		axle += 1;
	}
	// Leftover (unusual) budgets become single rear wheels, two per axle.
	while (budget >= 2) {
		seats.push({ id: `drv${axle}-l`, label: `R${axle}L` });
		seats.push({ id: `drv${axle}-r`, label: `R${axle}R` });
		budget -= 2;
		axle += 1;
	}
	if (budget === 1) seats.push({ id: 'axle-x1', label: 'Spare' });
	return seats.slice(0, wheel);
}

const FLEET = [
	{ plate_no: 'TRK-1001', wheel: 10, brand: 'hino', unit_type: 'tractor_unit', model: '2020', feet: 0 },
	{ plate_no: 'TRK-1002', wheel: 6, brand: 'fuso', unit_type: 'box', model: '2021', feet: 20 },
	{ plate_no: 'TRK-2001', wheel: 6, brand: 'hino', unit_type: 'box', model: '2022', feet: 24 },
	{ plate_no: 'TRL-2001', wheel: 22, brand: 'isuzu', unit_type: 'trailer', model: '2021', feet: 40 },
];

const run = async () => {
	const all = await api('GET', '/api/entities/veh_fleets?fields=id,plate_no,wheel,unit_type,feet&limit=100');
	const byPlate = new Map((all ?? []).map((r) => [String(r.plate_no).trim(), r]));

	let created = 0;
	for (const v of FLEET) {
		const wheelSlots = wheelSlotsFor(v.unit_type, v.wheel);
		const body = { ...v, wheel: v.wheel, wheel_slots: wheelSlots, feet: v.feet };
		const existing = byPlate.get(v.plate_no);
		if (existing) {
			// Keep the row's generated seat list authoritative on this plate.
			const seatCount = wheelSlots?.length ?? 0;
			if (seatCount !== v.wheel) console.warn(`⚠ ${v.plate_no}: wheel_slots(${seatCount}) ≠ wheel(${v.wheel})`);
			await api('PUT', `/api/entities/veh_fleets/${existing.id}`, body);
			console.log(`update ${v.plate_no} → wheel=${v.wheel} · slots=${seatCount} (${wheelSlots.map((s) => s.id).join(', ')})`);
		} else {
			const made = await api('POST', '/api/entities/veh_fleets', body);
			created += 1;
			console.log(`create ${v.plate_no} → wheel=${v.wheel} · slots=${wheelSlots.length}`);
		}
	}
	this?.console; // noop
	const after = await api('GET', '/api/entities/veh_fleets?fields=id,plate_no,wheel,unit_type,wheel_slots&limit=100&sort=plate_no');
	console.log('\nFleet (board scaffold):');
	for (const r of after ?? []) {
		const slots = r.wheel_slots;
		console.log(`  ${r.plate_no}  · ${r.unit_type ?? '—'}  · wheel=${r.wheel}  · slots=${Array.isArray(slots) ? slots.length : 'unset'}`);
	}
	console.log(created ? `\nSeed: DONE (${created} new, rest updated) ✅` : '\nSeed: DONE (all updated) ✅');
};

run().catch((err) => {
	console.error('SEED ABORTED:', err);
	process.exit(1);
});

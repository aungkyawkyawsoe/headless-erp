#!/usr/bin/env node
/**
 * End-to-end smoke test for the MRO ASSET HOLDER lifecycle — purchase → seat on a
 * truck → stage a spare → issue into an employee's custody → move custody →
 * write-off, against the LIVE engine API.
 *
 *   node scripts/smoke-mro-assets.mjs [baseUrl] [bearerToken]
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local).
 *
 * It starts from a PURCHASE, so it passes on a blank stock DB, and every
 * assertion is a DELTA (before → after) — whatever stock already exists is
 * irrelevant. Unique serials (a `Date.now()` tag) make it safe to re-run.
 *
 * What it verifies:
 *   1. Inbound creates `in_stock` serial units in a store.
 *   2. `/fit` with a seat seats one on a truck (holder = truck + slot);
 *      `/fit` without a seat stages another as that truck's standby spare.
 *   3. `GET /assets/holder?vehicle=` returns them display-ready with the derived
 *      holder (kind `tyre`, plate, slot) — and NOT units held elsewhere.
 *   4. `/issue` hands a store unit to an EMPLOYEE (deducts the store balance);
 *      `GET /assets/holder?employee=` returns it with the custodian name.
 *   5. A holder CHANGE (truck→person, person→person, person→truck) is refused by the
 *      direct `/move` route (403) and happens only through the approval gate: FILE an
 *      `mro_asset_requests` row, have it approved, then EXECUTE it (each step asserted).
 *   6. Guards: issuing a truck-bound unit is refused (409); a `write_off` request that
 *      also names a destination is refused (400) by the kind guard.
 *   7. A write-off is approval-gated too: direct `/scrap` → 403, and the approved
 *      request's execute scraps the unit where it sits and clears the custodian.
 */
import { listAllRows } from './lib/list-all-rows.mjs';

const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const LOCATION = 'vehicle_store';
const TAG = Date.now().toString(36);
const SERIALS = [`AST-${TAG}-1`, `AST-${TAG}-2`, `AST-${TAG}-3`];

const mmt = (offsetDays = 0) => {
	const t = Date.now() + 6.5 * 3600_000 + offsetDays * 86_400_000;
	return new Date(t).toISOString().slice(0, 10);
};

async function api(method, path, body) {
	const res = await fetch(`${baseUrl}${path}`, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const json = await res.json().catch(() => null);
	return { status: res.status, ok: res.ok, json };
}
const data = (r) => r.json?.data;
const err = (r) => r.json?.error ?? JSON.stringify(r.json);
/** Normalize an m2o value (bare id, expanded `{ id }`, or null) to its id. */
const relId = (value) => (typeof value === 'string' ? value : (value?.id ?? null));

let failures = 0;
const log = [];
function check(name, cond, detail = '') {
	if (cond) log.push(`PASS  ${name}`);
	else {
		failures += 1;
		log.push(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
	}
}
const title = (s) => log.push(`\n── ${s} ─${'─'.repeat(Math.max(0, 64 - s.length))}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One serial unit's live row (id + status). */
async function serialRow(serialNo) {
	const r = await api(
		'GET',
		`/api/entities/mro_stock_serials?limit=1&fields=id,serial_no,status,vehicle,slot,employee&filter[serial_no][_eq]=${encodeURIComponent(serialNo)}`,
	);
	return data(r)?.[0] ?? null;
}
/** The holder register for one holder (`{}` = fleet-wide). */
async function holderAssets(holder = {}) {
	const qs = new URLSearchParams(holder).toString();
	const r = await api('GET', `/api/mro/assets/holder${qs ? `?${qs}` : ''}`);
	if (!r.ok) throw new Error(`GET /assets/holder → HTTP ${r.status}: ${err(r)}`);
	return r.json.data.rows;
}
const onHandOf = async (modelId) => {
	const r = await api('GET', '/api/mro/stock/onhand');
	const rows = data(r)?.rows ?? [];
	return rows.filter((row) => row.model === modelId).reduce((sum, row) => sum + (Number(row.qty_on_hand) || 0), 0);
};

const run = async () => {
	// ── 0. Setup — a supplier, an asset SKU, a truck + an employee ────────────
	title('Setup — resolve catalog + holder fixtures');
	const suppliers = await listAllRows(baseUrl, token, 'mro_suppliers', 'id,name');
	if (!suppliers.length) throw new Error('no mro_suppliers row — run scripts/apply-mro-schema.mjs + a catalog seed first');

	const groups = await listAllRows(baseUrl, token, 'mro_item_name', 'id,name_en,assets');
	const assetGroups = groups.filter((g) => Number(g.assets ?? 0) === 1);
	// Prefer the Tyre group so the tyre-specific assertions hold; fall back to any
	// `assets` group (then `kind` is `asset`).
	const tyreGroup = assetGroups.find((g) => (g.name_en ?? '').trim().toLowerCase() === 'tyre') ?? assetGroups[0];
	if (!tyreGroup) throw new Error('no `assets`-flagged item name — run scripts/seed-mro-catalog.mjs --apply first');
	const models = await listAllRows(baseUrl, token, 'mro_item_model', 'id,name_en,item_name');
	const serial = models.find((m) => relId(m.item_name) === tyreGroup.id);
	if (!serial) throw new Error(`no SKU under "${tyreGroup.name_en}" — run scripts/seed-mro-catalog.mjs --apply first`);
	const expectedKind = (tyreGroup.name_en ?? '').trim().toLowerCase() === 'tyre' ? 'tyre' : 'asset';

	const fleets = await listAllRows(baseUrl, token, 'veh_fleets', 'id,plate_no,wheel_slots');
	const truck = fleets.find((f) => f.plate_no) ?? fleets[0];
	if (!truck) throw new Error('no veh_fleets row to hold an asset');
	let seat = 'steer-l';
	try {
		const slots = typeof truck.wheel_slots === 'string' ? JSON.parse(truck.wheel_slots || '[]') : truck.wheel_slots;
		if (Array.isArray(slots) && slots[0]?.id) seat = slots[0].id;
	} catch {
		/* keep the default seat id */
	}

	const employees = await listAllRows(baseUrl, token, 'hrm_employees', 'id,name_en');
	if (employees.length < 2) throw new Error('need at least two hrm_employees rows (a custodian + a re-home target)');
	const personA = employees[0];
	const personB = employees[1];
	const actor = personA.id;

	log.push(`asset SKU : ${serial.name_en} (${serial.id}) · kind ${expectedKind}`);
	log.push(`truck     : ${truck.plate_no} (${truck.id}) · seat ${seat}`);
	log.push(`custodians: ${personA.name_en} → ${personB.name_en}`);
	log.push(`store     : ${LOCATION} · run tag ${TAG}`);

	// ── 1. Purchase three serial asset units ─────────────────────────────────
	title('1. Purchase (inbound draft → confirm)');
	const stockBefore = await onHandOf(serial.id);
	const draft = await api('POST', '/api/entities/mro_inbounds', {
		supplier: suppliers[0].id,
		purchase_date: mmt(),
		type: 'purchase',
		location: LOCATION,
		lines: [{ item_model: serial.id, qty: 3, unit_price: 1000, serials: SERIALS }],
	});
	check(
		'inbound draft → 201 + INB- number',
		draft.ok && /^INB-/.test(String(data(draft)?.display_number ?? '')),
		`HTTP ${draft.status} ${err(draft)}`,
	);
	if (!draft.ok) throw new Error(`inbound draft failed: ${err(draft)}`);
	const inC = await api('POST', `/api/mro/inbounds/${data(draft).id}/confirm`, {});
	check('inbound confirm → 201 + confirmed', inC.status === 201 && data(inC)?.doc_status === 'confirmed', `HTTP ${inC.status} ${err(inC)}`);
	check('purchase +3 serial stock', (await onHandOf(serial.id)) === stockBefore + 3);

	const [u1, u2, u3] = [await serialRow(SERIALS[0]), await serialRow(SERIALS[1]), await serialRow(SERIALS[2])];
	check(
		'three in_stock serial units created',
		[u1, u2, u3].every((u) => u?.status === 'in_stock'),
	);

	// ── 2. Seat one on a truck + stage one as a spare ─────────────────────────
	title('2. Seat a tyre + stage a spare on the truck');
	const fit = await api('POST', `/api/mro/serials/${u1.id}/fit`, { to_vehicle: truck.id, to_slot: seat, actor_id: actor });
	check('fit to seat → 201 + fitted', fit.status === 201 && data(fit)?.event === 'fitted', `HTTP ${fit.status} ${err(fit)}`);
	const stage = await api('POST', `/api/mro/serials/${u2.id}/fit`, { to_vehicle: truck.id, actor_id: actor });
	check('fit without a seat → 201 (staged spare)', stage.status === 201 && data(stage)?.slot == null, `HTTP ${stage.status} ${err(stage)}`);
	check('store balance −2 after two fits', (await onHandOf(serial.id)) === stockBefore + 1);

	const truckRegister = await holderAssets({ vehicle: truck.id });
	const seated = truckRegister.find((row) => row.serial_no === SERIALS[0]);
	const spare = truckRegister.find((row) => row.serial_no === SERIALS[1]);
	check(
		'holder?vehicle lists the seated tyre with its slot',
		seated?.kind === expectedKind && seated?.slot === seat,
		JSON.stringify(seated),
	);
	check('holder?vehicle lists the spare with no slot', spare?.kind === expectedKind && spare?.slot == null, JSON.stringify(spare));
	check('holder?vehicle carries the plate display-ready', seated?.plate_no === truck.plate_no);
	check('holder?vehicle does NOT leak another holder’s unit', !truckRegister.some((row) => row.serial_no === SERIALS[2]));

	// ── 3. Issue a store unit into an employee's custody ─────────────────────
	title('3. Issue into an employee’s custody');
	const issue = await api('POST', `/api/mro/serials/${u3.id}/issue`, { to_employee: personA.id, actor_id: actor });
	check(
		'issue → 201 + issued event',
		issue.status === 201 && relId(data(issue)?.employee) === personA.id,
		`HTTP ${issue.status} ${err(issue)}`,
	);
	check('issue deducted the store balance', (await onHandOf(serial.id)) === stockBefore);
	const issuedRow = await serialRow(SERIALS[2]);
	check(
		'issued unit is employee-bound',
		issuedRow?.status === 'issued' && relId(issuedRow?.employee) === personA.id && issuedRow?.vehicle == null,
	);

	const personRegister = await holderAssets({ employee: personA.id });
	const held = personRegister.find((row) => row.serial_no === SERIALS[2]);
	check('holder?employee lists it with the custodian name', held?.employee_name === personA.name_en, JSON.stringify(held));
	const truckRegisterAfter = await holderAssets({ vehicle: truck.id });
	check('employee-held unit is NOT on the truck register', !truckRegisterAfter.some((row) => row.serial_no === SERIALS[2]));

	// ── 4. Move custody — every shape is approval-gated ──────────────────────
	// A holder CHANGE (truck→person, person→person, person→truck, and any write-off)
	// is refused by the direct kiosk routes and only happens when an approved request
	// is executed. This runner holds the ADMIN token, so it may decide any request —
	// it still names the deciding employee per call, which is what the decide routes
	// require of a controller-less session.
	title('4. Move custody through the approval gate');
	const filed = async (payload, note) => {
		const created = await api('POST', '/api/entities/mro_asset_requests', payload);
		check(
			`${note}: filed ATR`,
			created.status === 201 && /^ATR-\d{5}$/.test(String(data(created)?.display_number)),
			`HTTP ${created.status} ${err(created)}`,
		);
		const id = data(created)?.id;
		const approve = await api('POST', `/api/mro/asset-requests/${id}/approve`, { actor_id: actor });
		check(`${note}: approved by a recorded superior`, approve.status === 201, `HTTP ${approve.status} ${err(approve)}`);
		return api('POST', `/api/mro/asset-requests/${id}/execute`, { actor_id: actor });
	};

	// The DIRECT truck → person hop is refused on EVERY path (custody rule), so the
	// script proves the refusal first and then takes the honest route: truck → store.
	const directHop = await api('POST', `/api/mro/serials/${u1.id}/move`, { to_employee: personA.id, actor_id: actor });
	check('direct truck → person → 403 (governed)', directHop.status === 403, `HTTP ${directHop.status} ${err(directHop)}`);

	const toStore = await filed(
		{ serial: u1.id, from_vehicle: truck.id, from_slot: seat, to_location: LOCATION },
		'seated tyre → store (return)',
	);
	check(
		'return executes → 201 + `returned`',
		toStore.status === 201 && data(toStore)?.event === 'returned',
		`HTTP ${toStore.status} ${err(toStore)}`,
	);
	const returnedRow = await serialRow(SERIALS[0]);
	check(
		'returned unit is in a store, holder cleared',
		returnedRow?.status === 'in_stock' && returnedRow?.vehicle == null && returnedRow?.employee == null,
	);
	const issueBack = await api('POST', `/api/mro/serials/${u1.id}/issue`, { to_employee: personA.id, actor_id: actor });
	check(
		'issue from the store → 201 + `issued`',
		issueBack.status === 201 && data(issueBack)?.event === 'issued',
		`HTTP ${issueBack.status} ${err(issueBack)}`,
	);

	// person → person is the governed shape: the direct route refuses it, the request
	// moves custody between the two custodians.
	const directReassign = await api('POST', `/api/mro/serials/${u3.id}/move`, { to_employee: personB.id, actor_id: actor });
	check('direct person → person → 403 (governed)', directReassign.status === 403, `HTTP ${directReassign.status} ${err(directReassign)}`);
	const reassign = await filed({ serial: u3.id, from_employee: personA.id, to_employee: personB.id }, 'person → person');
	check(
		'custody move executes → 201 + `reissued`',
		reassign.status === 201 && data(reassign)?.event === 'reissued',
		`HTTP ${reassign.status} ${err(reassign)}`,
	);

	// A truck ↔ person hop is refused on EVERY path — even an approved request cannot
	// relocate across the two (the custody rule). The honest route is person → store
	// (a governed return), then the store issues/fits it.
	const directHop2 = await api('POST', `/api/mro/serials/${u3.id}/move`, { to_vehicle: truck.id, actor_id: actor });
	check('direct person → truck → 403 (never allowed)', directHop2.status === 403, `HTTP ${directHop2.status} ${err(directHop2)}`);
	const home = await filed({ serial: u3.id, from_employee: personB.id, to_location: LOCATION }, 'person → store (return)');
	check(
		'person → store executes → 201 + `returned`',
		home.status === 201 && data(home)?.event === 'returned',
		`HTTP ${home.status} ${err(home)}`,
	);
	const fitHome = await api('POST', `/api/mro/serials/${u3.id}/fit`, { to_vehicle: truck.id, actor_id: actor });
	check(
		'fit from the store onto the truck → 201 + `fitted`',
		fitHome.status === 201 && data(fitHome)?.event === 'fitted',
		`HTTP ${fitHome.status} ${err(fitHome)}`,
	);
	const truckRow = await serialRow(SERIALS[2]);
	check('the fitted unit is on its truck with no seat', relId(truckRow?.vehicle) === truck.id && truckRow?.slot == null);

	// ── 5. Guards ────────────────────────────────────────────────────────────
	title('5. Guards');
	const issueTruckBound = await api('POST', `/api/mro/serials/${u3.id}/issue`, { to_employee: personA.id, actor_id: actor });
	check('issuing a truck-bound unit → 409', issueTruckBound.status === 409, `HTTP ${issueTruckBound.status} ${err(issueTruckBound)}`);
	// A write-off that also names a destination is the ONE dangerous shape: the
	// compiled kind guard refuses it at create.
	const bothShapes = await api('POST', '/api/entities/mro_asset_requests', {
		serial: u1.id,
		from_employee: personA.id,
		write_off: true,
		to_vehicle: truck.id,
	});
	check('write_off + a destination → 400', bothShapes.status === 400, `HTTP ${bothShapes.status} ${err(bothShapes)}`);

	// ── 6. Write-off an employee-held unit (approval-gated) ────────────────
	title('6. Write-off (scrap) through the approval gate');
	const directScrap = await api('POST', `/api/mro/serials/${u1.id}/scrap`, { actor_id: actor });
	check('direct /scrap → 403 (governed)', directScrap.status === 403, `HTTP ${directScrap.status} ${err(directScrap)}`);
	const scrap = await filed(
		{ serial: u1.id, from_employee: personA.id, write_off: true, note: 'smoke write-off' },
		'person-held unit → written off',
	);
	check(
		'write-off executes → 201 + `written_off`',
		scrap.status === 201 && data(scrap)?.event === 'written_off',
		`HTTP ${scrap.status} ${err(scrap)}`,
	);
	const scrappedRow = await serialRow(SERIALS[0]);
	check(
		'scrapped unit cleared its holder',
		scrappedRow?.status === 'scrapped' && scrappedRow?.vehicle == null && scrappedRow?.employee == null,
	);
	const after = await holderAssets({ employee: personA.id });
	check('holder register excludes the written-off unit', !after.some((row) => row.serial_no === SERIALS[0]));

	await sleep(50);
	return;
};

run()
	.then(() => {
		console.log(log.join('\n'));
		if (failures) {
			console.log(`\nSmoke: ${failures} FAILED ❌`);
			process.exit(1);
		}
		console.log('\nSmoke: ALL PASS ✅');
	})
	.catch((e) => {
		console.log(log.join('\n'));
		console.error(`\nSmoke ABORTED ❌ — ${e.message}`);
		process.exit(1);
	});

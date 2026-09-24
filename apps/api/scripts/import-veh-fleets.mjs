#!/usr/bin/env node
/**
 * Idempotent fleet-master importer — syncs a CSV export of the fleet master
 * sheet into `veh_fleets` through the sanctioned entity API (POST for new
 * plates, PUT for changed ones) — never raw SQL, so schema validation, audit
 * and lifecycle hooks stay intact.
 *
 * Header columns (order independent): plate_no,brand,unit_type,model,wheel,
 * feet,license_place,license_township,purchase_date,last_odo.
 *
 * Each plate_no is upserted: missing rows are created; existing rows are
 * updated only where CSV values differ (hook-maintained columns such as
 * last_engine_oil / last_gear_oil are never touched); unchanged rows skip.
 *
 * Coercions: wheel/feet/last_odo are numeric schema columns — sheet cells like
 * "6W" reduce to their leading number (6), blanks become NULL, and stray
 * whitespace is trimmed (" Yangon" → "Yangon").
 *
 * Usage: cd apps/api && node scripts/import-veh-fleets.mjs [path/to/master.csv]
 * Env overrides: PROVISION_API (default http://127.0.0.1:8788),
 *                PROVISION_TOKEN (default dev-token)
 * Exit code is non-zero when any row fails. Re-running applies only the delta.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.PROVISION_API || 'http://127.0.0.1:8788';
const TOKEN = process.env.PROVISION_TOKEN || 'dev-token';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
const DEFAULT_CSV = fileURLToPath(new URL('../_data/fleet_master 20260909-52259.csv', import.meta.url));
const CSV_PATH = process.argv[2] || DEFAULT_CSV;
const log = (...a) => console.log(...a);
const fail = (m) => {
	console.error(`✗ ${m}`);
	process.exitCode = 1;
};

const COLS = ['plate_no', 'brand', 'unit_type', 'model', 'wheel', 'feet', 'license_place', 'license_township', 'purchase_date', 'last_odo'];
const NUMERIC = new Set(['wheel', 'feet', 'last_odo']);

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

/** Walk every page of veh_fleets, keyed by plate_no. */
async function fetchExisting() {
	const byPlate = new Map();
	let cursor;
	do {
		const q = new URLSearchParams({ fields: ['id', ...COLS].join(','), limit: '100', sort: 'plate_no' });
		if (cursor) q.set('cursor', cursor);
		const body = await callRaw(`/api/entities/veh_fleets?${q}`);
		for (const row of body.data) byPlate.set(row.plate_no, row);
		cursor = body.meta.has_more ? body.meta.next_cursor : undefined;
	} while (cursor);
	return byPlate;
}

/** RFC-4180-ish parser: quoted fields, "" escapes, CRLF, BOM. */
function parseCsv(text) {
	const rows = [];
	let row = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else inQuotes = false;
			} else field += c;
		} else if (c === '"') inQuotes = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\r' || c === '\n') {
			if (c === '\r' && text[i + 1] === '\n') i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
		} else field += c;
	}
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.map((r) => (r[0] ? [r[0].replace(/^\uFEFF/, ''), ...r.slice(1)] : r));
}

const cleanText = (raw) => {
	const v = String(raw ?? '').trim();
	return v === '' ? null : v;
};

const cleanNumber = (raw) => {
	const v = String(raw ?? '').trim();
	if (v === '') return null;
	const m = v.match(/^\d+(?:\.\d+)?/); // "6W" → 6, "40.00" → 40
	return m ? Number(m[0]) : Number.NaN;
};

const cellEquals = (existing, incoming) => {
	if (existing === null || existing === undefined || existing === '') return incoming === null;
	if (incoming === null) return false;
	return String(existing).trim() === String(incoming).trim();
};

/** One CSV row → entity payload; null when the row is malformed. */
function rowToPayload(row) {
	const raw = (col) => (row[col] === undefined ? '' : row[col]);
	const payload = {};
	for (const col of COLS) {
		let value = NUMERIC.has(col) ? cleanNumber(raw(col)) : cleanText(raw(col));
		if (NUMERIC.has(col) && value !== null && Number.isNaN(value)) return null;
		if (col === 'purchase_date' && value !== null && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
		payload[col] = value;
	}
	return payload.plate_no ? payload : null;
}

async function main() {
	log(`Importing fleet master from "${CSV_PATH}" into ${BASE} (token: ${TOKEN === 'dev-token' ? 'dev-token' : '***'})\n`);

	try {
		const health = await call('/api/health');
		if (!health) throw new Error('empty /api/health');
		log('  ✓ API reachable');
	} catch (err) {
		fail(`API not reachable at ${BASE} — start it first (cd apps/api && npx wrangler dev): ${err.message}`);
		return;
	}

	let text;
	try {
		text = readFileSync(CSV_PATH, 'utf8');
	} catch (err) {
		fail(`cannot read "${CSV_PATH}": ${err.message}`);
		return;
	}
	const parsed = parseCsv(text);
	if (parsed.length < 2) {
		fail('CSV has no data rows (header only?)');
		return;
	}
	const colIdx = new Map(parsed[0].map((h, i) => [h.trim(), i]));
	const missing = COLS.filter((c) => !colIdx.has(c));
	if (missing.length) {
		fail(`CSV header is missing columns: ${missing.join(', ')}`);
		return;
	}
	const rows = parsed.slice(1).map((cells) => {
		const row = {};
		for (const [name, idx] of colIdx) row[name] = cells[idx];
		return row;
	});
	log(`  ✓ parsed ${rows.length} rows (${parsed[0].length} columns)\n`);

	// Live schema → select option vocabularies, so bad values fail before POST.
	let optionSets = new Map();
	try {
		const col = await call('/api/collections/veh_fleets');
		if (!col) throw new Error('collection not found');
		for (const f of col?.schema_json?.fields ?? []) {
			if (f?.type === 'select') optionSets.set(f.name, new Set((f.options ?? []).map((o) => o.value)));
		}
	} catch (err) {
		fail(`cannot read veh_fleets schema: ${err.message}`);
		return;
	}
	log(`  ✓ veh_fleets schema loaded`);

	let existing = new Map();
	try {
		existing = await fetchExisting();
	} catch (err) {
		fail(`cannot list existing veh_fleets: ${err.message}`);
		return;
	}
	log(`  ✓ ${existing.size} existing rows loaded\n`);

	let created = 0;
	let updated = 0;
	let unchanged = 0;
	let errors = 0;
	const seen = new Set();

	for (let i = 0; i < rows.length; i++) {
		const lineNo = i + 2;
		const row = rows[i];
		const report = (m) => {
			errors++;
			console.error(`  ✗ line ${lineNo}: ${m}`);
		};

		const payload = rowToPayload(row);
		if (!payload) {
			report('invalid row — check numbers (wheel/feet/last_odo) and YYYY-MM-DD dates');
			continue;
		}
		if (seen.has(payload.plate_no)) {
			report(`duplicate plate_no "${payload.plate_no}" in the CSV`);
			continue;
		}
		seen.add(payload.plate_no);

		let badOption = false;
		for (const col of ['brand', 'unit_type']) {
			const set = optionSets.get(col);
			if (set && payload[col] !== null && !set.has(payload[col])) {
				report(`${col} "${payload[col]}" is not a valid option`);
				badOption = true;
				break;
			}
		}
		if (badOption) continue;

		const cur = existing.get(payload.plate_no);
		if (!cur) {
			// NEW plate → create.
			try {
				await call(`/api/entities/veh_fleets`, { method: 'POST', body: JSON.stringify(payload) });
				log(`  + ${payload.plate_no}`);
				created++;
			} catch (err) {
				report(`create ${payload.plate_no}: ${err.message}`);
			}
			continue;
		}

		// Existing plate → PUT only the fields that actually changed.
		const diff = {};
		for (const col of COLS) {
			if (!cellEquals(cur[col], payload[col])) diff[col] = payload[col];
		}
		const changedCols = Object.keys(diff);
		if (!changedCols.length) {
			log(`  = ${payload.plate_no} (unchanged)`);
			unchanged++;
			continue;
		}
		try {
			await call(`/api/entities/veh_fleets/${cur.id}`, { method: 'PUT', body: JSON.stringify(diff) });
			log(`  ~ ${payload.plate_no} (${changedCols.join(', ')})`);
			updated++;
		} catch (err) {
			report(`update ${payload.plate_no}: ${err.message}`);
		}
	}

	log('');
	log(`✅ Done — ${created} created, ${updated} updated, ${unchanged} unchanged`);
	if (errors) fail(`${errors} row(s) failed — see messages above`);
}

main();

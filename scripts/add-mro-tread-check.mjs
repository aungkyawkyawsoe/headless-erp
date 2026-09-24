#!/usr/bin/env node
/**
 * Add the tyre-inspection (Slice B) schema on the live MRO collections through
 * the VALIDATED engine API (never raw SQL) — idempotent, no-op when present.
 *
 * Slice B lets the tyre fitment board record a REAL remaining-tread/pressure
 * reading (`POST /api/mro/serials/:id/check` → a `checked` event) instead of
 * showing only fitted/rotate history. Three safe, additive, nullable changes:
 *
 *   · mro_item_model.reference_tread_mm      — new-tread depth baseline (per tyre SKU)
 *   · mro_stock_serials.tread_mm / .psi      — latest measured snapshot on the unit
 *   · mro_serial_events.event +='checked'    — the new select option (metadata-only)
 *   · mro_serial_events.tread_mm / .psi      — the reading carried on a checked event
 *
 * All nullable (required:false) so populated tables migrate with plain ADD
 * COLUMN / field re-sync; `event` option change is stored select metadata only.
 *
 *   node scripts/add-mro-tread-check.mjs [baseUrl] [bearerToken]
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init = {}) => ({ ...init, headers: { ...headers, ...(init.headers ?? {}) } });

const NUMBER_FIELD = (name, label, description) => ({ name, type: 'number', label, required: false, description });

/** A nullable select option to append to an existing event-kind select. */
const CHECKED_OPTION = { value: 'checked', label: 'Tread Inspected' };

async function call(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const text = await res.text();
	if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return null;
	try {
		const body = JSON.parse(text);
		return body && typeof body === 'object' && 'data' in body ? body.data : body;
	} catch {
		return text;
	}
}

async function load(slug) {
	const col = await call(`/api/collections/${slug}`);
	if (!col || !col.schema_json) throw new Error(`${slug} collection not found (${JSON.stringify(col).slice(0, 200)})`);
	return col;
}

async function save(slug, fields) {
	await call(`/api/collections/${slug}`, { method: 'PUT', body: JSON.stringify({ fields }) });
}

function log(ok, msg) {
	console.log(`${ok ? '✅' : 'ℹ️'} ${msg}`);
}

const ensureFields = (existingFields, additions) => {
	const have = new Set(existingFields.map((f) => f?.name).filter(Boolean));
	return additions.filter((a) => !have.has(a.name));
};

/** Append the `checked` option to an existing `event` select (metadata-only). */
function appendCheckOption(fields) {
	let changed = false;
	return fields.map((f) => {
		if (f?.type !== 'select' || f?.name !== 'event') return f;
		const opts = Array.isArray(f.options) ? f.options : [];
		if (opts.some((o) => o?.value === 'checked')) return f;
		changed = true;
		return { ...f, options: [...opts, CHECKED_OPTION] };
	});
}

const run = async () => {
	let ok = true;

	// 1. mro_item_model.reference_tread_mm — per-tyre-SKU new-tread baseline.
	{
		const col = await load('mro_item_model');
		const fields = (col.schema_json?.fields ?? []).filter((f) => f && typeof f.name === 'string');
		const missing = ensureFields(fields, [
			NUMBER_FIELD('reference_tread_mm', 'New-tread depth (mm)', 'A serial-tracked tyre’s depth when new — the baseline the fitment board derives remaining-tread %.'),
		]);
		if (missing.length === 0) log(true, 'mro_item_model.reference_tread_mm present — no-op');
		else {
			await save('mro_item_model', [...fields, ...missing]);
			log(true, `mro_item_model +${missing.map((f) => f.name).join(', ')}`);
		}
	}

	// 2. mro_stock_serials live snapshots tread_mm + psi.
	{
		const col = await load('mro_stock_serials');
		const fields = (col.schema_json?.fields ?? []).filter((f) => f && typeof f.name === 'string');
		const missing = ensureFields(fields, [
			NUMBER_FIELD('tread_mm', 'Tread depth (mm)', 'Latest measured tread depth on this serial tyre (a `checked` inspection snapshot).'),
			NUMBER_FIELD('psi', 'Pressure (psi)', 'Latest measured inflation pressure on this serial tyre.'),
		]);
		if (missing.length === 0) log(true, 'mro_stock_serials.tread_mm + psi present — no-op');
		else {
			await save('mro_stock_serials', [...fields, ...missing]);
			log(true, `mro_stock_serials +${missing.map((f) => f.name).join(', ')}`);
		}
	}

	// 3. mro_serial_events.event += 'checked' option + tread_mm/psi reading columns.
	{
		const col = await load('mro_serial_events');
		let fields = (col.schema_json?.fields ?? []).filter((f) => f && typeof f.name === 'string');
		// Select-option change is metadata; the confirm services only append a
		// `checked` row through the new writer, one atomic single-row insert.
		let eventChanged = false;
		fields = fields.map((f) => {
			if (f?.name === 'event' && f?.type === 'select') {
				const opts = Array.isArray(f.options) ? f.options : [];
				if (!opts.some((o) => o?.value === 'checked')) {
					eventChanged = true;
					return { ...f, options: [...opts, CHECKED_OPTION] };
				}
			}
			return f;
		});
		const missing = ensureFields(fields, [
			NUMBER_FIELD('tread_mm', 'Tread depth (mm)', 'Measured tread depth at this `checked` inspection.'),
			NUMBER_FIELD('psi', 'Pressure (psi)', 'Measured pressure at this `checked` inspection.'),
		]);
		if (!eventChanged && missing.length === 0) log(true, 'mro_serial_events field/option current — no-op');
		else {
			await save('mro_serial_events', [...fields, ...missing]);
			log(true, `mro_serial_events ${eventChanged ? '+event=checked ' : ''}${missing.length ? '+' + missing.map((f) => f.name).join(', ') : ''}`.trim());
		}
	}

	process.exit(ok ? 0 : 1);
};

run().catch((err) => {
	console.error('ABORTED:', err);
	process.exit(1);
});

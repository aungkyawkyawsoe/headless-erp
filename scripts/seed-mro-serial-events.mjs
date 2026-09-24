/**
 * MRO serial-events BACKFILL — give every existing serial-tracked unit that has NO
 * lifecycle history a truthful `purchased` event, so a brand-new tyre-detail timeline
 * reads as non-empty for units that predate the event log. History rows are immutable
 * and inert (never stock state), so writing them through the generic entity API is safe
 * and does NOT touch `MroInventoryService` (the sole stock writer).
 *
 *   node scripts/seed-mro-serial-events.mjs [baseUrl] [bearerToken]
 *
 * Defaults: http://localhost:8788 · `dev-token`.
 *
 * What it does:
 *   1. Cursor-walks every `mro_stock_serials` row (id, serial_no, location, status,
 *      vehicle, slot, source_inbound → its display_number).
 *   2. Cursor-walks every existing `mro_serial_events` row and collects the serial ids
 *      that ALREADY have at least one event (so re-running never double-logs).
 *   3. For each serial WITHOUT an event, POSTS one `purchased` event: `to_location` =
 *      the unit's store, `ref_kind = inbound/purchase`, and `ref_doc` = its source
 *      inbound's display number when known (else left null). Units currently seated on a
 *      vehicle are still logged as `purchased` — origin truth, not presence.
 *
 * Requires the `mro_serial_events` collection to already exist (run
 * `scripts/apply-mro-schema.mjs` first) and the executing role to have read access to
 * both collections. Re-run safe/idempotent.
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init) => ({ ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
const log = (...a) => console.log(...a);
const title = (s) => log(`\n── ${s}`);

async function api(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const body = await res.json().catch(() => null);
	if (!res.ok && !(body && body.success)) {
		throw new Error(`${init.method ?? 'GET'} ${path} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	}
	return body.data;
}

/** Cursor-walk a read to the end (the API caps a page at 100 rows). */
async function apiAll(path) {
	const PAGE = 100;
	const out = [];
	let cursor = null;
	let first = null;
	for (;;) {
		const sep = path.includes('?') ? '&' : '?';
		const qs = `limit=${PAGE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
		const page = first === null ? ((first = await api(`${path}${sep}${qs}`)), first) : await api(`${path}${sep}${qs}`);
		out.push(...(Array.isArray(page) ? page : []));
		cursor = page?.meta?.next_cursor ?? null;
		if (!page?.meta?.has_more || !cursor) break;
	}
	return out;
}

/** Bare id OR expanded row → id-string; expanded → resolved display_number name. */
function fkId(fk) {
	if (fk && typeof fk === 'object') return fk.id || null;
	return typeof fk === 'string' ? fk : null;
}

async function main() {
	title('Loading all serial units + existing events');
	const [units, events] = await Promise.all([
		apiAll('/api/entities/mro_stock_serials?fields=id,serial_no,location,status,vehicle,slot,source_inbound.display_number'),
		apiAll('/api/entities/mro_serial_events?fields=id,serial'),
	]);

	const haveEvent = new Set(
		events
			.map((e) => fkId(e.serial))
			.filter(Boolean),
	);
	const missing = (Array.isArray(units) ? units : []).filter((u) => !haveEvent.has(u.id));
	log(`  serial units: ${Array.isArray(units) ? units.length : 0} · already-logged: ${haveEvent.size} · need backfill: ${missing.length}`);

	const inboundNoById = new Map();
	async function inboundNo(serial) {
		const src = fkId(serial.source_inbound);
		if (!src) return null;
		if (!inboundNoById.has(src)) {
			try {
				const doc = await api(`/api/entities/mro_inbounds/${src}?fields=display_number`);
				inboundNoById.set(src, doc?.display_number ?? null);
			} catch {
				inboundNoById.set(src, null);
			}
		}
		return inboundNoById.get(src);
	}

	let created = 0;
	let skipped = 0;
	for (const unit of missing) {
		const refDoc = await inboundNo(unit);
		const body = {
			serial: unit.id,
			event: 'purchased',
			to_location: unit.location ?? null,
			ref_kind: 'inbound',
			ref_doc: refDoc ?? null,
			note: refDoc ? null : 'Pre-event-log unit — origin inbound not available',
		};
		const createdRow = await api('/api/entities/mro_serial_events', { method: 'POST', body: JSON.stringify(body) });
		if (createdRow?.id) {
			log(`  · ${String(unit.serial_no ?? unit.id).padEnd(18)} purchased${refDoc ? ` (${refDoc})` : ''}`);
			created += 1;
		} else {
			skipped += 1;
		}
	}

	log(`\nDone — wrote ${created} unit event(s)${skipped ? ` · ${skipped} skipped` : ''}. Refresh the တာယာ detail view.`);
	return created;
}

try {
	await main();
} catch (err) {
	console.error('SEED FAILED:', err.message);
	process.exitCode = 1;
}

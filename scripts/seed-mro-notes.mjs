/**
 * MRO note seed — give inbound/outbound MRO docs whose `note` is null a concise,
 * recognizable English note, so the redesigned list cards show something at a
 * glance (the card's quoted note caption area is hidden entirely when empty).
 *
 *   node scripts/seed-mro-notes.mjs [baseUrl] [bearerToken]
 *
 * Defaults: http://localhost:8788 · `dev-token`.
 *
 * What it does:
 *   1. Lists every `mro_inbounds` + `mro_outbounds` header (supplier expanded
 *      on inbounds) and skips any doc that already carries a non-empty note.
 *   2. For the empty-note docs it composes a short operator-style caption from
 *      the doc's REAL child lines — named items + quantities from `item_model`.
 *      Inbound (purchase):  "Purchase — <Supplier> · <Item> <qty>"
 *      Goods issue:         "Issued — <Item> <qty> + <Item> <qty>"
 *      Write-off:           "Write-off — expired <Item>"
 *      Defect/missing:      "Disposed — <Item> damaged/missing"
 *   3. PUTs each note onto the header via `PUT /api/entities/mro_<kind>/:id`.
 *
 * Reliable lines: the GET entity-list `?filter=` is currently ignored by the
 * engine for these tables (returns ALL rows), so instead of one filtered read
 * per doc the script pulls each line table once, walks cursors to the end, and
 * groups by `parent_id` in memory. The lines' `item_model` m2o is resolved to
 * `{ name, tracking }` by the engine (dot-path projection) so no extra name
 * lookups are needed.
 *
 * Re-run safe/idempotent: docs with a non-empty note are skipped.
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
	const first = await api(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}`);
	const out = Array.isArray(first) ? [...first] : [];
	let cursor = first?.meta?.next_cursor ?? null;
	while (first?.meta?.has_more && cursor) {
		const page = await api(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&cursor=${encodeURIComponent(cursor)}`);
		out.push(...(Array.isArray(page) ? page : []));
		cursor = page?.meta?.next_cursor ?? null;
	}
	return out;
}

/** Group lines by their header `parent_id`; resolve `item_model` to its name. */
function groupLines(lines) {
	const byDoc = new Map();
	for (const l of lines) {
		const pid = l.parent_id;
		if (!pid) continue;
		const name =
			typeof l.item_model === 'object' && l.item_model ? l.item_model.name?.trim() : null;
		const qty = Number(l.qty ?? 0);
		if (!byDoc.has(pid)) byDoc.set(pid, []);
		byDoc.get(pid).push({ name, qty, tracking: typeof l.item_model === 'object' ? l.item_model.tracking : null });
	}
	return byDoc;
}

/** compact "Name xQty" list, collapsing repeat names, capped then "+N more". */
function describeItems(rows, maxItems = 2) {
	if (!rows?.length) return null;
	const counts = new Map();
	for (const r of rows) {
		if (!r.name) continue;
		const k = r.name;
		counts.set(k, (counts.get(k) ?? 0) + Math.max(r.qty || 0, 1));
	}
	const parts = [...counts.entries()];
	if (!parts.length) return null;
	const shown = parts.slice(0, maxItems).map(([name, qty]) => `${name} ×${qty}`);
	const extra = parts.length - maxItems;
	if (extra > 0) shown.push(`+${extra} more`);
	return shown.join(', ');
}

/** Short, human caption suited to the card's two-line note area. */
function inboundNote(doc, items, suppliers) {
	const supplier =
		typeof doc.supplier === 'object' && doc.supplier?.name
			? doc.supplier.name.replace(/ Co\.,? Ltd\.?$/i, '').trim()
			: 'supplier';
	const desc = describeItems(items);
	if (desc) return `Purchase — ${supplier} · ${desc}`;
	return `Purchase received — ${supplier}`;
}

function outboundNote(doc, items) {
	const desc = describeItems(items);
	const issuer = (doc.location?.trim() || 'store').replace(/_/g, ' ');
	switch (doc.type) {
		case 'write_offs':
			return desc ? `Write-off — ${desc}` : `Write-off from ${issuer}`;
		case 'defects_missing':
			return desc ? `Disposed — ${desc}` : `Disposed from ${issuer}`;
		case 'goods_issue':
		default:
			return desc ? `Issued — ${desc}` : `Goods issue from ${issuer}`;
	}
}

async function fetchDocs(kind) {
	return apiAll(`/api/entities/mro_${kind}?fields=id,display_number,type,note,location,supplier.name`);
}

async function main() {
	const [inboundHeaders, outboundHeaders] = await Promise.all([fetchDocs('inbounds'), fetchDocs('outbounds')]);

	// Inbound suppliers are baked into the header projection above; nothing else needed.

	title('Loading lines (single read per line table, grouped in memory)');
	const [inboundLines, outboundLines] = await Promise.all([
		apiAll('/api/entities/mro_inbound_lines?fields=id,parent_id,qty,item_model.name,item_model.tracking'),
		apiAll('/api/entities/mro_outbound_lines?fields=id,parent_id,qty,item_model.name,item_model.tracking'),
	]);
	const inLinesByDoc = groupLines(inboundLines);
	const outLinesByDoc = groupLines(outboundLines);

	const needNote = (d) => !d.note || !String(d.note).trim();

	const inbounds = (Array.isArray(inboundHeaders) ? inboundHeaders : []).filter(needNote);
	const outbounds = (Array.isArray(outboundHeaders) ? outboundHeaders : []).filter(needNote);
	log(`  inbounds needing a note: ${inbounds.length} · outbounds needing a note: ${outbounds.length}`);

	let updated = 0;
	for (const doc of inbounds) {
		const note = inboundNote(doc, inLinesByDoc.get(doc.id) ?? []);
		if (!note) continue;
		await api(`/api/entities/mro_inbounds/${doc.id}`, { method: 'PUT', body: JSON.stringify({ note }) });
		log(`  · ${(doc.display_number ?? doc.id).padEnd(10)} ${note}`);
		updated += 1;
	}
	for (const doc of outbounds) {
		const note = outboundNote(doc, outLinesByDoc.get(doc.id) ?? []);
		if (!note) continue;
		await api(`/api/entities/mro_outbounds/${doc.id}`, { method: 'PUT', body: JSON.stringify({ note }) });
		log(`  · ${(doc.display_number ?? doc.id).padEnd(10)} ${note}`);
		updated += 1;
	}

	log(`\nDone — wrote ${updated} note(s). Refresh /app/inbounds & /app/outbounds to see them.`);
	return updated;
}

try {
	await main();
} catch (err) {
	console.error('SEED FAILED:', err.message);
	process.exitCode = 1;
}

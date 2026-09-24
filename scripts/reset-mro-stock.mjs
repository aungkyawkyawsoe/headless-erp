#!/usr/bin/env node
/**
 * Blank the MRO stock data — keep the item master data only.
 *
 *   node scripts/reset-mro-stock.mjs [baseUrl] [token]          # dry run
 *   node scripts/reset-mro-stock.mjs [baseUrl] [token] --apply  # wipe
 *
 * Defaults: baseUrl http://localhost:8788 · token `dev-token` (IS_DEV local, admin).
 *
 * WHAT IT DOES — HARD-deletes (DELETE .../force) every row from the transactional
 * / stock-trace MRO collections, including soft-deleted (trashed) rows, so the
 * stock screens (စတော့, ပစ္စည်းများ balances, တာယာ serial register) come up BLANK.
 * The catalog masters are NOT touched:
 *
 *   KEPT  → mro_item_categories, mro_item_name,
 *           mro_item_model (the SKUs), mro_suppliers
 *   WIPED → every document (in/out/transfer/adjustment/requisition) + their lines,
 *           the lot/serial trace + serial events, the provenance junctions
 *           (outbound/transfer lots+serials), and the mro_inventory balances.
 *
 * WHY the API and not raw SQL: the engine hard-delete path also invalidates the
 * read caches and runs the same cascade/audit path a normal delete does — the
 * repo rule is to never write the live D1 directly.
 *
 * Deletion order is children → parents (provenance, lines, headers, trace,
 * balances) so a cascade never has to guess. Idempotent: nothing left → nothing
 * deleted.
 */
import { listAllRows } from './lib/list-all-rows.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const baseUrl = (args[0] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = args[1] ?? 'dev-token';
const apply = process.argv.includes('--apply');

/** Catalog masters — the item master data the user asked to keep. */
const KEEP = ['mro_item_categories', 'mro_item_name', 'mro_item_model', 'mro_suppliers'];

/** Transactional / stock collections to hard-delete, CHILDREN FIRST. */
const WIPE = [
	// provenance junctions (point at lots/serials + document lines)
	'mro_outbound_lots',
	'mro_outbound_serials',
	'mro_transfer_lots',
	'mro_transfer_serials',
	// document lines
	'mro_outbound_lines',
	'mro_inbound_lines',
	'mro_transfer_lines',
	'mro_adjustment_lines',
	'mro_requisition_lines',
	// document headers
	'mro_outbounds',
	'mro_inbounds',
	'mro_transfers',
	'mro_adjustments',
	'mro_requisitions',
	// serial lifecycle history
	'mro_serial_events',
	// lot / serial trace
	'mro_stock_lots',
	'mro_stock_serials',
	// aggregate balances
	'mro_inventory',
];

const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const log = (...a) => console.log(...a);

async function forceDelete(slug, id) {
	const res = await fetch(`${baseUrl}/api/entities/${slug}/${id}/force`, { method: 'DELETE', headers });
	const body = await res.json().catch(() => null);
	if (!res.ok && !body?.success) {
		throw new Error(`DELETE ${slug}/${id}/force → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
	}
}

async function main() {
	log(`\n── Reset MRO stock${apply ? '' : '  [dry-run]'} — ${baseUrl}`);
	log(`keeping: ${KEEP.join(', ')}\n`);
	let total = 0;
	for (const slug of WIPE) {
		const live = await listAllRows(baseUrl, token, slug, 'id');
		const trashed = await listAllRows(baseUrl, token, slug, 'id', 100, { trashed: 'true' });
		const ids = [...live, ...trashed].map((row) => row.id).filter(Boolean);
		total += ids.length;
		log(`  ${String(ids.length).padStart(4)}  ${slug}${trashed.length ? `  (${live.length} live + ${trashed.length} trashed)` : ''}`);
		if (!apply) continue;
		for (const id of ids) await forceDelete(slug, id);
	}
	log(`\n${apply ? 'deleted' : 'would delete'} : ${total} rows across ${WIPE.length} collections`);
	if (!apply) log('(dry-run — nothing written. Re-run with --apply to wipe.)');
	else log(`done — base ${baseUrl}`);
}

main().catch((err) => {
	console.error(`\nFAIL ${err.message}`);
	process.exit(1);
});

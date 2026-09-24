/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { D1Client } from '@mmbix/core';
import { AuthService } from '@/lib/services/auth.service';
import { REQUISITION_DUPLICATE_ACK } from '@/domain-modules/mro/requisition-guard';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * MRO inventory engine — documents + confirm gate (/api/mro).
 *
 * Every scenario follows the real workflow: create a DRAFT document through the
 * GENERIC entity API (engine numbers it INB-/OUT-/TRF-/AJT-, lines are child
 * rows, stock untouched), then CONFIRM through /api/mro and assert the effect.
 *
 *   standard — balance in/out; oversell 409 leaves the draft untouched
 *   batch    — one lot per inbound line; FEFO consumes nearest expiry first;
 *              expired lots blocked from goods issues, struck by write-offs
 *   serial   — per-unit rows on confirm; global duplicate serial 409;
 *              explicit picks flip to issued/scrapped; returns re-instock
 *   doc      — display_number sequences, cancel vs confirm, idempotent
 *              re-confirm, header totals written at confirm
 *   multi    — one document with lines across ALL three policies in a single
 *              atomic confirm
 *   transfer — location→location: source deducts, destination receives,
 *              batch identity (batch_no + expiry) survives via merge/create
 *   adjust   — operator-reported add/remove; requires an authorizer distinct
 *              from the reporter; asserts signed line audit (expected/diff)
 *
 * Each scenario runs in its OWN store location so balances never leak between
 * tests. Schema is created through the SAME validated engine API the apply
 * script uses (POST /api/collections) — never raw SQL.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const LOCATIONS = ['main_store', 'admin_store', 'mandalay_store', 'safety_store', 'vehicle_store'];
const LOC_OPTS = LOCATIONS.map((value) => ({ value, label: value.replace('_', ' ') }));
const selectOpts = (options: Array<{ value: string; label: string }>) => options.map((o) => ({ ...o }));

const TRACKING_OPTS = [
	{ value: 'standard', label: 'Standard' },
	{ value: 'batch', label: 'Batch' },
	{ value: 'serial', label: 'Serial' },
];
const INBOUND_TYPES = [
	{ value: 'purchase', label: 'Purchase' },
	{ value: 'legacy', label: 'Legacy' },
	{ value: 'return', label: 'Return' },
];
const OUTBOUND_TYPES = [
	{ value: 'goods_issue', label: 'Goods Issue' },
	{ value: 'write_offs', label: 'Write Offs' },
	{ value: 'defects_missing', label: 'Defects / Missing' },
];
const REQUISITION_STATUSES = [
	{ value: 'requested', label: 'Requested' },
	{ value: 'approved', label: 'Approved' },
	{ value: 'partially_issued', label: 'Partially Issued' },
	{ value: 'fulfilled', label: 'Fulfilled' },
	{ value: 'cancelled', label: 'Cancelled' },
];
const CLOSE_REASONS = [
	{ value: 'fulfilled', label: 'Fulfilled' },
	{ value: 'stock_low', label: 'Stock too low' },
	{ value: 'cancelled', label: 'Cancelled' },
];

function mmtToday(offsetDays = 0): string {
	const t = Date.now() + 6.5 * 3600_000 + offsetDays * 86_400_000;
	return new Date(t).toISOString().slice(0, 10);
}

async function api(
	path: string,
	init?: RequestInit,
): Promise<{ status: number; body: { success?: boolean; error?: string; data?: unknown } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: (await res.json().catch(() => null)) ?? {} };
}

/** Create a collection through the validated API (schema mirror of schema-defs.json). */
async function createCollection(
	slug: string,
	name: string,
	fields: Array<Record<string, unknown>>,
	extra: Record<string, unknown> = {},
	description?: string,
) {
	const res = await api('/api/collections', {
		method: 'POST',
		body: JSON.stringify({ name, slug, description: description ?? null, fields, ...extra }),
	});
	expect(res.status, `create ${slug}`).toBe(201);
}

async function insert(table: string, row: Record<string, unknown>) {
	const cols = Object.keys(row);
	await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
		.bind(...cols.map((c) => row[c] as never))
		.run();
}

async function row(table: string, where: string, ...binds: unknown[]): Promise<Record<string, unknown> | null> {
	return env.DB.prepare(`SELECT * FROM ${table} WHERE ${where}`)
		.bind(...(binds as never[]))
		.first();
}

async function rows(table: string, where: string, ...binds: unknown[]): Promise<Array<Record<string, unknown>>> {
	const r = await env.DB.prepare(`SELECT * FROM ${table} WHERE ${where}`)
		.bind(...(binds as never[]))
		.all();
	return (r.results ?? []) as Array<Record<string, unknown>>;
}

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	// Engine rule: a field is NOT NULL unless `required: false` is explicit.
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

const locSelect = () => ({ type: 'select', options: selectOpts(LOC_OPTS) });

// Fixture ids MUST be UUID v4 — the engine validates m2o values as UUIDs.
const SUP = '44444444-4444-4444-8444-444444444444';
const M_STD = '11111111-1111-4111-8111-111111111111';
const M_BATCH = '22222222-2222-4222-8222-222222222222';
const M_SERIAL = '33333333-3333-4333-8333-333333333333';
// One item-name MASTER per tracking policy — the policy is declared ONCE on the
// master and each SKU below inherits it through `item_name` (mro_item_model has
// no tracking column). None of these masters carries a category, so they double
// as the "uncategorised model" control of the doc-level category reads.
const G_STD = '1a111111-1111-4111-8111-111111111111';
const G_BATCH = '2a222222-2222-4222-8222-222222222222';
const G_SERIAL = '3a333333-3333-4333-8333-333333333333';

// Two-person rule people: the operator who reports a transfer/adjustment and the
// separate approver who confirms it. Both are m2o → hrm_employees (UUID v4).
const REPORTER = '55555555-5555-4555-8555-555555555555';
const APPROVER = '66666666-6666-4666-8666-666666666666';

// The duplicate-basket guard's requester — a DEDICATED employee so its same-day
// baskets can never collide with the two-person requisition test above.
const DUPLICATOR = '77777777-7777-4777-8777-777777777777';

// A truck on the directory (veh_fleets) used to exercise a vehicle-bound request.
const V_FLEET = 'aaaaaaa1-1111-4111-a111-111111111111';

const IN_LINE_FIELDS = [
	field('parent_id', 'text'),
	field('item_model', 'm2o', { required: true, related_collection: 'mro_item_model', display_template: '{{name_en}}' }),
	field('qty', 'number', { required: true }),
	field('unit_price', 'number'),
	field('location', 'select', { ...locSelect() }),
	field('batch_no', 'text'),
	field('expiry_date', 'date'),
	field('serials', 'json'),
	field('note', 'longtext'),
];
const OUT_LINE_FIELDS = [
	field('parent_id', 'text'),
	field('item_model', 'm2o', { required: true, related_collection: 'mro_item_model', display_template: '{{name_en}}' }),
	field('qty', 'number', { required: true }),
	field('unit_price', 'number'),
	field('location', 'select', { ...locSelect() }),
	field('serials', 'json'),
	field('note', 'longtext'),
];

const HEADER_COMMON = [
	field('note', 'longtext'),
	field('total_qty', 'number'),
	field('line_count', 'integer'),
	field('total_amount', 'number'),
	field('confirmed_at', 'timestamp'),
	// The PAYMENT mirror the ledger's denorm hook maintains (schema-defs.json):
	// the card's Total/Paid/Left + "fully paid on" read these, never the ledger.
	field('paid_amount', 'number'),
	field('payment_status', 'select', {
		options: [
			{ value: 'unpaid', label: 'Unpaid' },
			{ value: 'partial', label: 'Partially paid' },
			{ value: 'paid', label: 'Paid' },
		],
	}),
	field('fully_paid_on', 'date'),
	// The CANCEL stamp (schema-defs.json) — service-written by `/api/mro/{kind}/:id/cancel`.
	// For a POSTED document the stamp IS the moment its stock effect was undone, so the
	// audit fact and the reversal are one atomic write, never two.
	field('cancelled_at', 'timestamp'),
	field('cancelled_by', 'm2o', {
		required: false,
		related_collection: 'hrm_employees',
		display_template: '{{name_en}}',
		cascade_delete: false,
	}),
];

/** The purchase payment ledger (`mro_inbound_payments`, schema-defs.json). */
const PAYMENT_METHODS = [
	{ value: 'cash', label: 'Cash' },
	{ value: 'bank', label: 'Bank transfer' },
	{ value: 'cheque', label: 'Cheque' },
	{ value: 'other', label: 'Other' },
];
const PAYMENT_FIELDS = [
	field('parent_id', 'm2o', {
		required: true,
		related_collection: 'mro_inbounds',
		display_template: '{{display_number}}',
		cascade_delete: true,
	}),
	field('paid_on', 'date', { required: true }),
	field('amount', 'number', { required: true }),
	field('method', 'select', { required: true, options: selectOpts(PAYMENT_METHODS), default: 'cash' }),
	field('reference', 'text'),
	field('note', 'longtext'),
	field('recorded_by', 'm2o', {
		required: false,
		related_collection: 'hrm_employees',
		display_template: '{{name_en}}',
		cascade_delete: false,
	}),
];
// Money is append-mostly: the columns that DEFINE a payment are refused on edit by
// the compiled `before_update` guard (a mistake is soft-deleted + re-filed — a
// `frozen_fields` policy cannot express this, because it would strip them from the
// CREATE too), and the recorder is session-stamped so nobody books a payment as
// someone else.
const PAYMENT_POLICY = {
	policies: {
		actor_fields: ['recorded_by'],
	},
};

// F6 — posted documents are immutable through the generic API: a confirmed header
// refuses generic update/delete/restore, and child lines are document-owned (only
// the parent's `lines` field + the confirm services write them). Mirrors schema-defs.json.
const POSTED = { policies: { writes: { freeze_when: { field: 'doc_status', values: ['confirmed'] } } } };
// The three CANCELLABLE stock headers additionally freeze `cancelled`: a cancelled
// stock document is final, so the generic `cancelled → draft` reopen (which the
// engine's status machine allows everywhere) is refused and a document can never
// read draft/confirmed while still carrying a cancel stamp. The cancel STAMP itself
// is `frozen_fields` — written only by the `/cancel` route's guarded batch, stripped
// from every generic write, so it can never be forged (or cleared) by a client.
const POSTED_CANCELLABLE = {
	policies: {
		writes: {
			freeze_when: { field: 'doc_status', values: ['confirmed', 'cancelled'] },
			frozen_fields: ['cancelled_at', 'cancelled_by'],
		},
	},
};
const SERVICE_ONLY = { policies: { writes: { mode: 'service' } } };

beforeAll(async () => {
	// Catalog collections (schema mirror of schema-defs.json) — the item-name
	// and brand masters are created before mro_item_model so its m2o
	// classification fields resolve.
	await createCollection('mro_item_categories', 'MRO Item Categories', [
		field('name_en', 'text', { required: true, index: true, unique: true }),
		field('name_mm', 'text'),
	]);
	await createCollection('mro_suppliers', 'MRO Suppliers', [field('name', 'text', { required: true, unique: true })]);
	await createCollection('mro_item_name', 'MRO Item Name', [
		field('name_en', 'text', { required: true, index: true, unique: true }),
		field('name_mm', 'text'),
		field('tracking', 'select', { options: selectOpts(TRACKING_OPTS), required: true, default: 'standard' }),
		field('assets', 'boolean', { default: false }),
		field('category', 'm2o', { related_collection: 'mro_item_categories', display_template: '{{name_en}}' }),
	]);
	await createCollection('mro_brand', 'MRO Brand', [field('name', 'text', { required: true, unique: true })]);
	await createCollection('mro_item_model', 'MRO Item Model', [
		field('name_en', 'text', { required: true, index: true }),
		field('name_mm', 'text'),
		field('item_name', 'm2o', {
			required: true,
			related_collection: 'mro_item_name',
			display_template: '{{name_en}}',
		}),
		field('brand', 'm2o', { related_collection: 'mro_brand', display_template: '{{name}}' }),
		field('image', 'image'),
		field('expiry_alert_days', 'integer', { default: 30 }),
		field('reference_tread_mm', 'number'),
	]);

	// People collection referenced by the transfer/adjustment headers' m2o
	// reporter/approver fields (schema-defs.json → hrm_employees). Two bare fixture
	// rows are seeded below so the two-person rule can be exercised. `avatar` is the
	// directory photo column the serial-events read joins for the timeline's actor
	// avatar, `name_mm` is the display name the movement ledger prefers, and
	// `etg_id` is the Telegram link a login row is matched on — all declared here
	// because a mirror that omits a column the read selects would let a broken
	// query pass CI (and `no such column: bu.avatar` is a 500).
	await createCollection('hrm_employees', 'HRM Employees', [
		field('name_en', 'text', { required: true }),
		field('name_mm', 'text', { required: false }),
		field('etg_id', 'text', { required: false }),
		field('avatar', 'text', { required: false }),
	]);

	// Reporting line — ONE superior→subordinate edge per row (schema-defs.json →
	// hrm_employee_links via provision-hr-schema). The asset-transfer approval gate
	// reads its OWN direction (superior = actor) to decide who may sign off.
	await createCollection('hrm_employee_links', 'HRM Employee Links', [
		field('superior', 'm2o', { required: true, related_collection: 'hrm_employees', cascade_delete: false }),
		field('subordinate', 'm2o', { required: true, related_collection: 'hrm_employees', cascade_delete: false }),
	]);

	// The app's one in-app notification inbox — the durable fallback the asset
	// transfer/return/write-off notifications (and the HR request ones) file into.
	await createCollection('hr_notifications', 'HR Notifications', [
		field('tg_id', 'text', { required: false }),
		field('title', 'text', { required: true }),
		field('body', 'longtext', { required: false }),
		field('type', 'select', {
			required: false,
			options: selectOpts([
				{ value: 'approval', label: 'Approval' },
				{ value: 'info', label: 'Info' },
				{ value: 'reminder', label: 'Reminder' },
			]),
			default: 'info',
		}),
		field('reference_id', 'text', { required: false }),
		field('read', 'boolean', { required: false, default: false }),
	]);

	// Vehicle directory referenced by the new `vehicle` m2o on requisitions & stock
	// serials (schema-defs.json → veh_fleets). One fixture plate seeded below.
	await createCollection('veh_fleets', 'VEH Fleets', [field('plate_no', 'text', { required: true })]);

	// Child-line collections first (headers reference them). Lines are DOCUMENT-OWNED:
	// written through the parent's `lines` field (ChildTableService) or the confirm
	// service, never the generic line API — so a posted receipt's lines cannot be rewritten.
	await createCollection('mro_inbound_lines', 'MRO Inbound Lines', IN_LINE_FIELDS, SERVICE_ONLY);
	await createCollection('mro_outbound_lines', 'MRO Outbound Lines', OUT_LINE_FIELDS, SERVICE_ONLY);

	// Movement headers — engine-owned drafts, numbered, status-machine guarded.
	await createCollection(
		'mro_inbounds',
		'MRO Inbounds',
		[
			field('supplier', 'm2o', {
				required: false,
				related_collection: 'mro_suppliers',
				display_template: '{{name}}',
				validation: [{ type: 'required_if', field: 'type', value: 'purchase' }],
			}),
			// The VENDOR-LESS counterparty: a return comes back from a person and an
			// opening balance is handed over by one — `required_if` per kind, so the
			// counterparty is exactly one of supplier / handed_by (mirrors schema-defs.json).
			field('handed_by', 'm2o', {
				required: false,
				related_collection: 'hrm_employees',
				display_template: '{{name_en}}',
				cascade_delete: false,
				validation: [
					{ type: 'required_if', field: 'type', value: 'legacy' },
					{ type: 'required_if', field: 'type', value: 'return' },
				],
			}),
			field('purchase_date', 'date', { required: true }),
			field('type', 'select', { required: true, options: selectOpts(INBOUND_TYPES), default: 'purchase' }),
			field('location', 'select', { required: true, ...locSelect() }),
			// The money came with the goods: the confirm files ONE payment equal to the
			// line total, dated the receipt date (mirrors schema-defs.json).
			field('paid_at_receipt', 'boolean', { required: false }),
			field('lines', 'table', { related_collection: 'mro_inbound_lines' }),
			field('received_by', 'm2o', {
				required: false,
				related_collection: 'hrm_employees',
				display_template: '{{name_en}}',
				cascade_delete: false,
			}),
			...HEADER_COMMON,
		],
		{ naming_series: 'INB-', ...POSTED_CANCELLABLE },
	);
	await createCollection(
		'mro_outbounds',
		'MRO Outbounds',
		[
			field('type', 'select', { required: true, options: selectOpts(OUTBOUND_TYPES) }),
			field('effective_date', 'date', { required: true }),
			field('location', 'select', { required: true, ...locSelect() }),
			field('lines', 'table', { related_collection: 'mro_outbound_lines' }),
			field('request', 'm2o', { required: false, related_collection: 'mro_requisitions', cascade_delete: false }),
			field('issued_by', 'm2o', { required: false, related_collection: 'hrm_employees', cascade_delete: false }),
			// The goods-issue DESTINATION (schema-defs.json) — a truck's inventory XOR a
			// person's custody; the confirm stamps it on every serial unit it issues.
			field('to_vehicle', 'm2o', { related_collection: 'veh_fleets', display_template: '{{plate_no}}' }),
			field('to_employee', 'm2o', { related_collection: 'hrm_employees', display_template: '{{name_en}}' }),
			...HEADER_COMMON,
		],
		{ naming_series: 'OUT-', ...POSTED_CANCELLABLE },
	);

	// The purchase PAYMENT ledger — created after its parent header (the m2o
	// `parent_id` + cascade_delete need mro_inbounds to exist).
	await createCollection('mro_inbound_payments', 'MRO Inbound Payments', PAYMENT_FIELDS, PAYMENT_POLICY);

	// Stock trace collections (same defs schema-defs.json ships).
	await createCollection(
		'mro_stock_lots',
		'MRO Stock Lots',
		[
			field('model', 'm2o', { required: true, related_collection: 'mro_item_model' }),
			field('location', 'select', { required: true, ...locSelect() }),
			field('batch_no', 'text', { required: true, index: true }),
			field('expiry_date', 'date'),
			field('remaining_qty', 'number'),
			field('status', 'select', {
				options: selectOpts([
					{ value: 'active', label: 'Active' },
					{ value: 'empty', label: 'Empty' },
					{ value: 'expired', label: 'Expired' },
				]),
				default: 'active',
			}),
			field('source_inbound', 'm2o', { related_collection: 'mro_inbounds' }),
			field('source_line', 'm2o', { related_collection: 'mro_inbound_lines' }),
			field('unit_cost', 'number'),
		],
		{ policies: { writes: { mode: 'service' } } },
		'test',
	);
	await createCollection(
		'mro_stock_serials',
		'MRO Stock Serials',
		[
			field('model', 'm2o', { required: true, related_collection: 'mro_item_model' }),
			field('location', 'select', { required: true, ...locSelect() }),
			field('serial_no', 'text', { required: true, unique: true, index: true }),
			field('vehicle', 'm2o', { required: false, related_collection: 'veh_fleets' }),
			field('slot', 'text'),
			field('employee', 'm2o', { required: false, related_collection: 'hrm_employees', cascade_delete: false }),
			field('status', 'select', {
				options: selectOpts([
					{ value: 'in_stock', label: 'In Stock' },
					{ value: 'issued', label: 'Issued' },
					{ value: 'scrapped', label: 'Scrapped' },
				]),
				default: 'in_stock',
			}),
			field('expiry_date', 'date'),
			field('source_inbound', 'm2o', { related_collection: 'mro_inbounds' }),
			field('source_line', 'm2o', { related_collection: 'mro_inbound_lines' }),
			field('unit_cost', 'number'),
			field('tread_mm', 'number'),
			field('psi', 'number'),
			field('condition', 'select', {
				options: selectOpts([
					{ value: 'good', label: 'Good' },
					{ value: 'fair', label: 'Fair' },
					{ value: 'poor', label: 'Poor' },
					{ value: 'damaged', label: 'Damaged' },
				]),
			}),
			field('note', 'longtext'),
		],
		// `search` mirrors schema-defs.json: the tgapp tyre type-ahead searches this
		// collection by serial prefix (an index seek on the indexed `serial_no`), not
		// an unindexed `%term%` scan.
		{ policies: { writes: { mode: 'service' }, search: { mode: 'prefix', fields: ['serial_no'] } } },
		'test',
	);

	// Immutable per-serial lifecycle feed (schema-defs.json → mro_serial_events).
	// The confirm services append ONE event row here for every serial-policy move
	// (purchase/fit/rotate/return/transfer/write-off/adjust), so the mirror MUST
	// exist before any serial flow confirms — mirror it exactly as schema-defs
	// ships it (same m2o selectors + select options), after mro_stock_serials /
	// veh_fleets / hrm_employees are created so its m2o columns resolve.
	await createCollection(
		'mro_serial_events',
		'MRO Serial Events',
		[
			field('serial', 'm2o', { required: true, related_collection: 'mro_stock_serials', cascade_delete: false }),
			field('event', 'select', {
				required: true,
				options: selectOpts([
					{ value: 'purchased', label: 'Purchased (Inbound)' },
					{ value: 'returned', label: 'Returned' },
					{ value: 'issued', label: 'Issued to Holder' },
					{ value: 'reissued', label: 'Re-issued (Holder Changed)' },
					{ value: 'fitted', label: 'Fitted to Vehicle' },
					{ value: 'store_transferred', label: 'Store Transferred' },
					{ value: 'rotated', label: 'Position Rotated' },
					{ value: 'refitted', label: 'Refitted to Another Vehicle' },
					{ value: 'unseated', label: 'Unseated (Kept as Truck Spare)' },
					{ value: 'written_off', label: 'Written Off' },
					{ value: 'adjusted', label: 'Adjusted (Removed)' },
					{ value: 'checked', label: 'Inspected' },
				]),
			}),
			field('tread_mm', 'number'),
			field('psi', 'number'),
			field('condition', 'select', {
				options: selectOpts([
					{ value: 'good', label: 'Good' },
					{ value: 'fair', label: 'Fair' },
					{ value: 'poor', label: 'Poor' },
					{ value: 'damaged', label: 'Damaged' },
				]),
			}),
			field('from_vehicle', 'm2o', { required: false, related_collection: 'veh_fleets', cascade_delete: false }),
			field('to_vehicle', 'm2o', { required: false, related_collection: 'veh_fleets', cascade_delete: false }),
			field('from_employee', 'm2o', { required: false, related_collection: 'hrm_employees', cascade_delete: false }),
			field('to_employee', 'm2o', { required: false, related_collection: 'hrm_employees', cascade_delete: false }),
			field('from_slot', 'text'),
			field('to_slot', 'text'),
			field('from_location', 'select', { ...locSelect() }),
			field('to_location', 'select', { ...locSelect() }),
			field('ref_kind', 'text'),
			field('ref_doc', 'text'),
			field('by_user', 'm2o', { required: false, related_collection: 'hrm_employees', cascade_delete: false }),
			field('note', 'longtext'),
			field('event_date', 'date'),
		],
		{ policies: { writes: { mode: 'service', append_only: true } } },
	);

	await createCollection(
		'mro_outbound_lots',
		'MRO Outbound Lots',
		[
			field('outbound_id', 'm2o', { required: true, related_collection: 'mro_outbounds' }),
			field('lot_id', 'm2o', { required: true, related_collection: 'mro_stock_lots' }),
			field('qty', 'number', { required: true }),
			field('outbound_line', 'm2o', { related_collection: 'mro_outbound_lines' }),
		],
		{ policies: { writes: { mode: 'service', append_only: true } } },
		'test',
	);
	await createCollection(
		'mro_outbound_serials',
		'MRO Outbound Serials',
		[
			field('outbound_id', 'm2o', { required: true, related_collection: 'mro_outbounds' }),
			field('serial_id', 'm2o', { required: true, related_collection: 'mro_stock_serials' }),
			field('outbound_line', 'm2o', { related_collection: 'mro_outbound_lines' }),
		],
		{ policies: { writes: { mode: 'service', append_only: true } } },
		'test',
	);
	await createCollection(
		'mro_inventory',
		'MRO Inventory',
		[
			field('model', 'm2o', { required: true, related_collection: 'mro_item_model' }),
			field('location', 'select', { required: true, ...locSelect() }),
			field('qty_on_hand', 'number'),
			field('reorder_level', 'number'),
		],
		{},
		'test',
	);

	// Transfer + adjustment collections (schema-defs.json — after the stock
	// trace collections they reference exist).
	const TR_LINE_FIELDS = [
		field('parent_id', 'text'),
		field('item_model', 'm2o', { required: true, related_collection: 'mro_item_model', display_template: '{{name_en}}' }),
		field('qty', 'number', { required: true }),
		field('batch_no', 'text'),
		field('serials', 'json'),
		field('note', 'longtext'),
	];
	const TR_HEADER = [
		field('reported_by', 'm2o', {
			required: true,
			related_collection: 'hrm_employees',
			display_template: '{{name_en}}',
		}),
		field('approved_by', 'm2o', {
			related_collection: 'hrm_employees',
			display_template: '{{name_en}}',
		}),
		field('note', 'longtext'),
		field('total_qty', 'number'),
		field('line_count', 'integer'),
		field('confirmed_at', 'timestamp'),
		field('cancelled_at', 'timestamp'),
		field('cancelled_by', 'm2o', { related_collection: 'hrm_employees', display_template: '{{name_en}}', cascade_delete: false }),
	];
	const m2o = (name: string, related: string, extra: Record<string, unknown> = {}) =>
		field(name, 'm2o', { required: true, related_collection: related, cascade_delete: false, ...extra });
	await createCollection('mro_transfer_lines', 'MRO Transfer Lines', TR_LINE_FIELDS, SERVICE_ONLY);
	await createCollection(
		'mro_transfers',
		'MRO Transfers',
		[
			field('from_location', 'select', { required: true, ...locSelect() }),
			field('to_location', 'select', { required: true, ...locSelect() }),
			field('transfer_date', 'date', { required: true }),
			field('lines', 'table', { related_collection: 'mro_transfer_lines' }),
			...TR_HEADER,
		],
		{ naming_series: 'TRF-', policies: { ...POSTED_CANCELLABLE.policies, actor_fields: ['reported_by'] } },
	);
	await createCollection(
		'mro_transfer_lots',
		'MRO Transfer Lots',
		[
			m2o('transfer_id', 'mro_transfers', { display_template: '{{display_number}}' }),
			m2o('from_lot', 'mro_stock_lots'),
			field('to_lot', 'm2o', { required: false, related_collection: 'mro_stock_lots', cascade_delete: false }),
			field('qty', 'number', { required: true }),
			field('transfer_line', 'm2o', { required: false, related_collection: 'mro_transfer_lines', cascade_delete: false }),
		],
		{ policies: { writes: { mode: 'service', append_only: true } } },
	);
	await createCollection(
		'mro_transfer_serials',
		'MRO Transfer Serials',
		[
			m2o('transfer_id', 'mro_transfers', { display_template: '{{display_number}}' }),
			m2o('serial_id', 'mro_stock_serials'),
			field('transfer_line', 'm2o', { required: false, related_collection: 'mro_transfer_lines', cascade_delete: false }),
		],
		{ policies: { writes: { mode: 'service', append_only: true } } },
	);
	// Adjustment collections (schema-defs.json — the signed add/remove stock change).
	const ADJ_DIR_OPTS = [
		{ value: 'add', label: 'Add (+)' },
		{ value: 'remove', label: 'Remove (−)' },
	];
	const ADJ_LINE_FIELDS = [
		field('parent_id', 'text'),
		field('item_model', 'm2o', { required: true, related_collection: 'mro_item_model', display_template: '{{name_en}}' }),
		field('direction', 'select', { required: true, options: selectOpts(ADJ_DIR_OPTS) }),
		field('qty', 'number', { required: true }),
		field('batch_no', 'text'),
		field('expiry_date', 'date'),
		field('unit_cost', 'number'),
		field('serials', 'json'),
		field('expected_qty', 'number'),
		field('diff_qty', 'number'),
	];
	const ADJ_HEADER = [
		field('description', 'longtext'),
		field('reported_by', 'm2o', {
			required: true,
			related_collection: 'hrm_employees',
			display_template: '{{name_en}}',
		}),
		field('approved_by', 'm2o', {
			related_collection: 'hrm_employees',
			display_template: '{{name_en}}',
		}),
		field('total_qty', 'number'),
		field('line_count', 'integer'),
		field('confirmed_at', 'timestamp'),
		// The cancel stamp, exactly as HEADER_COMMON carries it (schema-defs.json).
		field('cancelled_at', 'timestamp'),
		field('cancelled_by', 'm2o', {
			required: false,
			related_collection: 'hrm_employees',
			display_template: '{{name_en}}',
			cascade_delete: false,
		}),
	];
	await createCollection('mro_adjustment_lines', 'MRO Adjustment Lines', ADJ_LINE_FIELDS, SERVICE_ONLY);
	await createCollection(
		'mro_adjustments',
		'MRO Adjustments',
		[
			field('location', 'select', { required: true, ...locSelect() }),
			field('adjustment_date', 'date', { required: true }),
			field('lines', 'table', { related_collection: 'mro_adjustment_lines' }),
			...ADJ_HEADER,
		],
		{ naming_series: 'AJT-', policies: { ...POSTED_CANCELLABLE.policies, actor_fields: ['reported_by'] } },
	);
	// The adjustment's own trace (schema-defs.json) — which lot each line moved and
	// which units it removed. Written by the confirm service; it is the ONLY thing the
	// reversal reads to put stock back, so an approved adjustment is undone exactly
	// (never re-derived from a FEFO guess that would hit different lots).
	await createCollection(
		'mro_adjustment_lots',
		'MRO Adjustment Lots',
		[
			m2o('adjustment_id', 'mro_adjustments', { display_template: '{{display_number}}' }),
			m2o('lot_id', 'mro_stock_lots'),
			field('direction', 'select', { required: true, options: selectOpts(ADJ_DIR_OPTS) }),
			field('qty', 'number', { required: true }),
			field('adjustment_line', 'm2o', { required: false, related_collection: 'mro_adjustment_lines', cascade_delete: false }),
		],
		{ policies: { writes: { mode: 'service', append_only: true } } },
	);
	await createCollection(
		'mro_adjustment_serials',
		'MRO Adjustment Serials',
		[
			m2o('adjustment_id', 'mro_adjustments', { display_template: '{{display_number}}' }),
			m2o('serial_id', 'mro_stock_serials'),
			field('adjustment_line', 'm2o', { required: false, related_collection: 'mro_adjustment_lines', cascade_delete: false }),
		],
		{ policies: { writes: { mode: 'service', append_only: true } } },
	);

	// Requisition collections (schema-defs.json — approve flow, no stock effect).
	await createCollection(
		'mro_requisition_lines',
		'MRO Requisition Lines',
		[
			field('parent_id', 'text'),
			field('item_model', 'm2o', { required: true, related_collection: 'mro_item_model', display_template: '{{name_en}}' }),
			field('qty', 'number', { required: true }),
			field('note', 'longtext'),
		],
		SERVICE_ONLY,
	);
	await createCollection(
		'mro_requisitions',
		'MRO Requisitions',
		[
			field('request_date', 'date', { required: true }),
			field('location', 'select', { required: true, ...locSelect() }),
			field('note', 'longtext'),
			field('requested_by', 'm2o', { required: false, related_collection: 'hrm_employees', cascade_delete: false }),
			field('approved_by', 'm2o', { required: false, related_collection: 'hrm_employees', cascade_delete: false }),
			field('vehicle', 'm2o', { required: false, related_collection: 'veh_fleets' }),
			field('lines', 'table', { related_collection: 'mro_requisition_lines' }),
			field('requisition_status', 'select', { required: false, options: selectOpts(REQUISITION_STATUSES) }),
			field('issued_qty', 'number'),
			field('close_reason', 'select', { required: false, options: selectOpts(CLOSE_REASONS) }),
			field('total_qty', 'number'),
			field('line_count', 'integer'),
			field('confirmed_at', 'timestamp'),
		],
		{ naming_series: 'REQ-', policies: { ...POSTED.policies, actor_fields: ['requested_by'] } },
	);

	// Asset-transfer requests (schema-defs.json — the truck→truck approval gate the
	// move must pass). Mirror EXACTLY: `status`/`approved_by`/… are frozen and
	// `requested_by` is session-stamped, so the test proves a generic write cannot
	// forge a decision, and only a recorded superior (or an admin) can decide it.
	await createCollection(
		'mro_asset_requests',
		'MRO Asset Requests',
		[
			m2o('serial', 'mro_stock_serials', { display_template: '{{serial_no}}' }),
			m2o('from_vehicle', 'veh_fleets', { required: false, display_template: '{{plate_no}}' }),
			field('from_slot', 'text'),
			m2o('from_employee', 'hrm_employees', { required: false, display_template: '{{name_en}}' }),
			m2o('to_vehicle', 'veh_fleets', { required: false, display_template: '{{plate_no}}' }),
			field('to_slot', 'text'),
			m2o('to_employee', 'hrm_employees', { required: false, display_template: '{{name_en}}' }),
			// The RETURN destination (schema-defs.json) — set instead of a vehicle/person,
			// and the field that makes a request a return rather than a transfer.
			field('to_location', 'select', { required: false, ...locSelect() }),
			// The WRITE-OFF flag (schema-defs.json) — a destination-less request that
			// scraps the unit on execute; declared here because a mirror that omits a
			// column the read selects would let a broken query pass CI (`no such column`
			// is a 500 on EVERY decide route for the table).
			field('write_off', 'boolean', { required: false, default: 'false' }),
			field('note', 'longtext'),
			m2o('requested_by', 'hrm_employees', { required: false, display_template: '{{name_en}}' }),
			field('status', 'select', {
				required: true,
				default: 'requested',
				options: selectOpts([
					{ value: 'requested', label: 'Requested' },
					{ value: 'approved', label: 'Approved' },
					{ value: 'rejected', label: 'Rejected' },
					{ value: 'executed', label: 'Executed' },
				]),
			}),
			m2o('approved_by', 'hrm_employees', { required: false, display_template: '{{name_en}}' }),
			field('approved_at', 'timestamp'),
			field('rejected_reason', 'longtext'),
			field('executed_at', 'timestamp'),
		],
		{
			naming_series: 'ATR-',
			composite_indexes: [{ columns: ['status', 'created_at'] }, { columns: ['serial', 'created_at'] }],
			policies: {
				writes: { frozen_fields: ['status', 'approved_by', 'approved_at', 'rejected_reason', 'executed_at'] },
				actor_fields: ['requested_by'],
			},
		},
	);

	// Fixtures — one supplier + one item-name master per tracking policy, each with
	// its SKU. The POLICY lives on the item NAME (`tracking`) and the SKU inherits
	// it; masters carry no category so they are the uncategorised control below.
	await insert('cms_mro_suppliers', { id: SUP, name: 'Demo Supplier' });
	for (const [group, id, tracking, name_en] of [
		[G_STD, M_STD, 'standard', 'Bolt M10'],
		[G_BATCH, M_BATCH, 'batch', 'Engine Oil 10W-40'],
		[G_SERIAL, M_SERIAL, 'serial', 'Tyre 11R22.5'],
	]) {
		await insert('cms_mro_item_name', { id: group, name_en: `${name_en} Group`, tracking, assets: tracking === 'serial' ? 1 : 0 });
		await insert('cms_mro_item_model', { id, name_en, item_name: group, expiry_alert_days: 30 });
	}
	// Report/approve people for the transfer + adjustment documents. The approver
	// carries a DIRECTORY PHOTO so the serial-events read's actor avatar is provable
	// (the timeline's leading avatar is `by_user.avatar`).
	await insert('cms_hrm_employees', { id: REPORTER, name_en: 'Report Operator', etg_id: 'atr-reporter' });
	await insert('cms_hrm_employees', {
		id: APPROVER,
		name_en: 'Approving Operator',
		avatar: '/api/media/approver.jpg',
		etg_id: 'atr-approver',
	});
	// APPROVER is a recorded superior of REPORTER — the reporting edge BOTH the
	// asset-transfer and requisition notification flows resolve against (and the
	// asset-transfer approval gate). Seeded once here so a describe that runs
	// BEFORE the asset-transfer block still finds it.
	await insert('cms_hrm_employee_links', { id: crypto.randomUUID(), superior: APPROVER, subordinate: REPORTER });
	// The duplicate-basket guard's requester (isolated from the two-person test).
	await insert('cms_hrm_employees', { id: DUPLICATOR, name_en: 'Repeat Requester' });
	// A truck for vehicle-bound requisition/attribute tests.
	await insert('cms_veh_fleets', { id: V_FLEET, plate_no: 'TRK-X' });
});

// ── Draft + confirm helpers (the real client flow) ──────────────────────

async function inboundDraft(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}, location = 'main_store') {
	const type = typeof extra.type === 'string' ? extra.type : 'purchase';
	const res = await api('/api/entities/mro_inbounds', {
		method: 'POST',
		body: JSON.stringify({
			// The counterparty is PER KIND: a purchase names the VENDOR it was bought
			// from, every other kind names the EMPLOYEE the goods came back from /
			// were handed over by (`handed_by` in `extra`) — never both.
			...(type === 'purchase' ? { supplier: SUP } : {}),
			purchase_date: '2026-09-01',
			type,
			location,
			lines,
			...extra,
		}),
	});
	expect(res.status, `create inbound draft (${JSON.stringify(lines)})`).toBe(201);
	return (res.body.data ?? {}) as Record<string, unknown>;
}

async function outboundDraft(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}, location = 'main_store') {
	const res = await api('/api/entities/mro_outbounds', {
		method: 'POST',
		body: JSON.stringify({
			type: 'goods_issue',
			effective_date: mmtToday(),
			location,
			lines,
			...extra,
		}),
	});
	expect(res.status, `create outbound draft (${JSON.stringify(lines)})`).toBe(201);
	return (res.body.data ?? {}) as Record<string, unknown>;
}

const confirm = (
	kind: 'inbounds' | 'outbounds' | 'transfers' | 'adjustments' | 'requisitions',
	id: string,
	body: Record<string, unknown> = {},
) => api(`/api/mro/${kind}/${id}/confirm`, { method: 'POST', body: JSON.stringify(body) });

const reject = (id: string, body: Record<string, unknown> = {}) =>
	api(`/api/mro/requisitions/${id}/reject`, { method: 'POST', body: JSON.stringify(body) });

const onHandQty = async (model: string, location: string): Promise<number> => {
	const r = await row('cms_mro_inventory', 'model = ? AND location = ? AND deleted_at IS NULL', model, location);
	return Number(r?.qty_on_hand ?? 0);
};

// ── The RETURN + WRITE-OFF gate's shared harness ──────────────────────────────
// A return to store and a write-off both END a unit's custody, so both are
// approval-gated: the direct kiosk route refuses them and only an approved request
// reaches the writer. Any suite that needs either files one through these helpers,
// so the governance shape is exercised (not bypassed) wherever it appears here.
const RET_REQ_USER = 'e0a00000-0000-4000-8000-000000000001';
const RET_REQ_ROLE = 'e0a00000-0000-4000-8000-000000000002';
let retReqToken = '';
let retSupToken = '';

/** Mint the two session tokens the return gate needs — the operator who files and
 *  their recorded superior. One user row is enough: the EMPLOYEE binding is what
 *  `actorOf` reads and what the two-person rule compares. Idempotent, because more
 *  than one suite calls it against the same database. */
async function mintReturnActors(): Promise<void> {
	await insert('cms_hrm_employee_links', { id: crypto.randomUUID(), superior: APPROVER, subordinate: REPORTER });
	await env.DB.prepare('INSERT OR IGNORE INTO _roles (id, name, is_system) VALUES (?1, ?2, 0)')
		.bind(RET_REQ_ROLE, 'Return Requester')
		.run();
	// Filing a request IS a generic create, so the role needs `create` on the collection.
	const perm = await row('_role_permissions', 'role_id = ? AND collection_slug = ?', RET_REQ_ROLE, 'mro_asset_requests');
	if (!perm) {
		await insert('_role_permissions', {
			id: crypto.randomUUID(),
			role_id: RET_REQ_ROLE,
			collection_slug: 'mro_asset_requests',
			can_read: 1,
			can_write: 1,
			can_create: 1,
		});
	}
	const user = await row('_users', 'id = ?', RET_REQ_USER);
	if (!user) {
		await insert('_users', {
			id: RET_REQ_USER,
			email: 'tg-return-requester@test.local',
			full_name: 'Return Requester',
			password_hash: 'x',
			role_id: RET_REQ_ROLE,
			status: 'active',
		});
	}
	const secret = (env as unknown as Record<string, string>).JWT_SECRET;
	const auth = new AuthService(new D1Client(env.DB));
	retReqToken = await auth.generateToken(RET_REQ_USER, secret, REPORTER);
	retSupToken = await auth.generateToken(RET_REQ_USER, secret, APPROVER);
}

/** File a RETURN request for a unit at a known source, then walk it to `executed`.
 *  Returns the execute response, so a caller asserts on the real writer's verdict. */
async function returnToStore(
	serialId: string,
	from: { vehicle?: string | null; slot?: string | null; employee?: string | null },
	toLocation: string,
): Promise<Awaited<ReturnType<typeof api>>> {
	const filed = await api('/api/entities/mro_asset_requests', {
		method: 'POST',
		headers: { Authorization: `Bearer ${retReqToken}` },
		body: JSON.stringify({
			serial: serialId,
			from_vehicle: from.vehicle ?? null,
			from_slot: from.slot ?? null,
			from_employee: from.employee ?? null,
			to_location: toLocation,
		}),
	});
	expect(filed.status, filed.body?.error ?? '').toBe(201);
	const id = String((filed.body.data as Record<string, unknown>).id);
	const decide = (verb: string) =>
		api(`/api/mro/asset-requests/${id}/${verb}`, { method: 'POST', headers: { Authorization: `Bearer ${retSupToken}` } });
	expect((await decide('approve')).status).toBe(201);
	return decide('execute');
}

/** File a WRITE-OFF request for a unit at a known source, then walk it to
 *  `executed`. Returns the execute response, so a caller asserts on the real
 *  writer's verdict (the request carries `write_off` and NO destination). */
async function writeOffUnit(
	serialId: string,
	from: { vehicle?: string | null; slot?: string | null; employee?: string | null },
): Promise<Awaited<ReturnType<typeof api>>> {
	const filed = await api('/api/entities/mro_asset_requests', {
		method: 'POST',
		headers: { Authorization: `Bearer ${retReqToken}` },
		body: JSON.stringify({
			serial: serialId,
			from_vehicle: from.vehicle ?? null,
			from_slot: from.slot ?? null,
			from_employee: from.employee ?? null,
			write_off: true,
			note: 'worn out — write off',
		}),
	});
	expect(filed.status, filed.body?.error ?? '').toBe(201);
	const id = String((filed.body.data as Record<string, unknown>).id);
	const decide = (verb: string) =>
		api(`/api/mro/asset-requests/${id}/${verb}`, { method: 'POST', headers: { Authorization: `Bearer ${retSupToken}` } });
	expect((await decide('approve')).status).toBe(201);
	return decide('execute');
}

async function transferDraft(
	lines: Array<Record<string, unknown>>,
	extra: Record<string, unknown> = {},
	from = 'main_store',
	to = 'admin_store',
) {
	const res = await api('/api/entities/mro_transfers', {
		method: 'POST',
		body: JSON.stringify({ from_location: from, to_location: to, transfer_date: mmtToday(), reported_by: REPORTER, lines, ...extra }),
	});
	expect(res.status, `create transfer draft (${JSON.stringify(lines)})`).toBe(201);
	return (res.body.data ?? {}) as Record<string, unknown>;
}

async function adjustmentDraft(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}, location = 'main_store') {
	const res = await api('/api/entities/mro_adjustments', {
		method: 'POST',
		body: JSON.stringify({ location, adjustment_date: mmtToday(), reported_by: REPORTER, lines, ...extra }),
	});
	expect(res.status, `create adjustment draft (${JSON.stringify(lines)})`).toBe(201);
	return (res.body.data ?? {}) as Record<string, unknown>;
}

async function requisitionDraft(lines: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}, location = 'main_store') {
	const res = await api('/api/entities/mro_requisitions', {
		method: 'POST',
		body: JSON.stringify({ request_date: mmtToday(), location, lines, ...extra }),
	});
	expect(res.status, `create requisition draft (${JSON.stringify(lines)})`).toBe(201);
	return (res.body.data ?? {}) as Record<string, unknown>;
}

const lotOf = async (batchNo: string, location: string) =>
	row('cms_mro_stock_lots', 'batch_no = ? AND location = ? AND deleted_at IS NULL', batchNo, location);

// ── Tests ────────────────────────────────────────────────────────────────

describe('item-name master — the tracking policy is NEVER absent', () => {
	// The policy lives ONCE on the master (`mro_item_name.tracking`) and every SKU
	// inherits it, so a master with no policy would be a master whose stock the
	// engine cannot track. The schema declares it REQUIRED with a `standard`
	// DEFAULT: the column is NOT NULL, while the field stays OPTIONAL on the wire
	// (the engine skips the required check for any field with a default).

	it('defaults a create that OMITS tracking to standard (column is NOT NULL)', async () => {
		const id = 'cccc0000-0000-4000-8000-0000000000cc';
		const res = await api('/api/entities/mro_item_name', {
			method: 'POST',
			body: JSON.stringify({ id, name_en: 'Policy Default Probe' }),
		});
		expect(res.status, res.body.error).toBe(201);
		// The DEFAULT backfilled the column — the client never sent a policy.
		expect((res.body.data as Record<string, unknown>)?.tracking).toBe('standard');
		// Keep the shared fixture catalogue as it was.
		await env.DB.prepare('DELETE FROM cms_mro_item_name WHERE id = ?').bind(id).run();
	});

	it('rejects a NULL policy at the column (no "no policy" state exists)', async () => {
		await expect(
			insert('cms_mro_item_name', { id: 'cccc0000-0000-4000-8000-0000000000cd', name_en: 'Null Policy Probe', tracking: null }),
		).rejects.toThrow(/NOT NULL/);
	});
});

describe('document lifecycle — numbering, cancel, idempotent confirm', () => {
	it('numbers drafts INB-/OUT-, confirms once, and blocks generic confirms', async () => {
		const d1 = await inboundDraft([{ item_model: M_STD, qty: 10, unit_price: 5 }]);
		expect(d1.display_number).toBe('INB-00001');
		expect(d1.doc_status).toBe('draft');
		expect(d1.id).toBeTruthy();

		// Draft created NO stock yet.
		expect(await onHandQty(M_STD, 'main_store')).toBe(0);

		const confirmed = await confirm('inbounds', d1.id as string);
		expect(confirmed.status).toBe(201);
		expect((confirmed.body.data as Record<string, unknown>).doc_status).toBe('confirmed');
		expect((confirmed.body.data as Record<string, unknown>).total_qty).toBe(10);
		expect(await onHandQty(M_STD, 'main_store')).toBe(10);

		// Idempotent replay — no double stock.
		const again = await confirm('inbounds', d1.id as string);
		expect(again.status).toBe(201);
		expect((again.body.data as Record<string, unknown>).already).toBe(true);
		expect(await onHandQty(M_STD, 'main_store')).toBe(10);

		// A fresh draft cannot jump to confirmed through the generic API (status machine).
		const d2 = await inboundDraft([{ item_model: M_STD, qty: 1 }]);
		const hijack = await api(`/api/entities/mro_inbounds/${d2.id}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'confirmed' }),
		});
		expect(hijack.status).toBeGreaterThanOrEqual(400);
		expect(await onHandQty(M_STD, 'main_store')).toBe(10);

		// Cancel it through the generic API, then confirm must 409.
		const cancel = await api(`/api/entities/mro_inbounds/${d2.id}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'cancelled' }),
		});
		expect(cancel.status).toBe(200);
		const blocked = await confirm('inbounds', d2.id as string);
		expect(blocked.status).toBe(409);
		expect(await onHandQty(M_STD, 'main_store')).toBe(10);

		// Outbound numbering shares no sequence with inbounds.
		const o1 = await outboundDraft([{ item_model: M_STD, qty: 2 }]);
		expect(o1.display_number).toBe('OUT-00001');
		const ok = await confirm('outbounds', o1.id as string);
		expect(ok.status).toBe(201);
		expect(await onHandQty(M_STD, 'main_store')).toBe(8);
	});
});

describe('requisitions — approve without touching stock', () => {
	it('numbers REQ-, blocks generic confirms, and 409s cancelled docs', async () => {
		const d1 = await requisitionDraft([{ item_model: M_STD, qty: 10, note: 'workshop need' }]);
		expect(d1.display_number).toBe('REQ-00001');
		expect(d1.doc_status).toBe('draft');
		expect(d1.id).toBeTruthy();

		// Draft created NO stock and approving never touches stock.
		const before = await onHandQty(M_STD, 'main_store');
		const hijack = await api(`/api/entities/mro_requisitions/${d1.id}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'confirmed' }),
		});
		expect(hijack.status).toBeGreaterThanOrEqual(400);

		const approved = await confirm('requisitions', d1.id as string);
		expect(approved.status).toBe(201);
		const data = approved.body.data as Record<string, unknown>;
		expect(data.doc_status).toBe('confirmed');
		expect(data.total_qty).toBe(10);
		expect(data.line_count).toBe(1);
		expect(await onHandQty(M_STD, 'main_store')).toBe(before);

		// Idempotent replay — still approved, still no stock effect.
		const again = await confirm('requisitions', d1.id as string);
		expect(again.status).toBe(201);
		expect((again.body.data as Record<string, unknown>).already).toBe(true);
		expect(await onHandQty(M_STD, 'main_store')).toBe(before);

		// A cancelled requisition cannot be approved.
		const d2 = await requisitionDraft([{ item_model: M_STD, qty: 1 }]);
		const cancel = await api(`/api/entities/mro_requisitions/${d2.id}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'cancelled' }),
		});
		expect(cancel.status).toBe(200);
		expect((await confirm('requisitions', d2.id as string)).status).toBe(409);
		expect(await onHandQty(M_STD, 'main_store')).toBe(before);
	});

	it('approves a multi-line request (all policies) with summed totals', async () => {
		const d = await requisitionDraft([
			{ item_model: M_STD, qty: 3 },
			{ item_model: M_BATCH, qty: 5 },
			{ item_model: M_SERIAL, qty: 2 },
		]);
		expect(d.display_number).toMatch(/^REQ-\d{5}$/);

		const stdBefore = await onHandQty(M_STD, 'main_store');
		const approved = await confirm('requisitions', d.id as string);
		expect(approved.status).toBe(201);
		const data = approved.body.data as Record<string, unknown>;
		expect(data.line_count).toBe(3);
		expect(data.total_qty).toBe(10);
		expect(await onHandQty(M_STD, 'main_store')).toBe(stdBefore);

		const hdr = await row('cms_mro_requisitions', 'id = ?', d.id);
		expect(hdr?.doc_status).toBe('confirmed');
		expect(Number(hdr?.total_qty)).toBe(10);
		expect(Number(hdr?.line_count)).toBe(3);
		expect(hdr?.confirmed_at).toBeTruthy();
	});

	it('rejects empty drafts and unknown ids', async () => {
		expect((await confirm('requisitions', '00000000-0000-4000-8000-000000000000')).status).toBe(404);
		const d = await requisitionDraft([]);
		expect((await confirm('requisitions', d.id as string)).status).toBe(400);
	});

	it('requires a distinct approver once a requester is recorded (two-person)', async () => {
		const req = await requisitionDraft([{ item_model: M_STD, qty: 5 }], { requested_by: REPORTER });

		// Self-approval is rejected when the request records its requester.
		const self = await confirm('requisitions', req.id as string, { approved_by: REPORTER });
		expect(self.status).toBe(409);

		// A requested-but-unsigned approval is rejected (an approver id is required).
		const unsigned = await confirm('requisitions', req.id as string);
		expect(unsigned.status).toBe(400);

		// A DIFFERENT approver approves and persists the actor + lifecycle status.
		const ok = await confirm('requisitions', req.id as string, { approved_by: APPROVER });
		expect(ok.status).toBe(201);
		const data = ok.body.data as Record<string, unknown>;
		expect(data.doc_status).toBe('confirmed');
		expect(data.requisition_status).toBe('approved');
		expect(data.approved_by).toBe(APPROVER);

		const hdr = await row('cms_mro_requisitions', 'id = ?', req.id);
		expect(hdr?.doc_status).toBe('confirmed');
		expect(hdr?.approved_by).toBe(APPROVER);
		expect(hdr?.requested_by).toBe(REPORTER);
		expect(hdr?.requisition_status).toBe('approved');

		// Idempotent replay of an approved request stays a no-op.
		const again = await confirm('requisitions', req.id as string, { approved_by: APPROVER });
		expect(again.status).toBe(201);
		expect((again.body.data as Record<string, unknown>).already).toBe(true);
	});

	it('records issued_by and rolls the request partial → fulfilled across goods issues', async () => {
		const loc = 'vehicle_store';

		// Fresh stock so this fulfillment never depends on another test's balances.
		const seed = await inboundDraft([{ item_model: M_STD, qty: 10, unit_price: 5 }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		expect(await onHandQty(M_STD, loc)).toBe(10);

		const req = await requisitionDraft([{ item_model: M_STD, qty: 10 }], { requested_by: REPORTER }, loc);
		expect((await confirm('requisitions', req.id as string, { approved_by: APPROVER })).status).toBe(201);

		// Partial issue of 7/10 → partially_issued.
		const o1 = await outboundDraft([{ item_model: M_STD, qty: 7 }], { request: req.id }, loc);
		const c1 = await confirm('outbounds', o1.id as string, { issued_by: APPROVER });
		expect(c1.status).toBe(201);
		expect((c1.body.data as Record<string, unknown>).requisition_status).toBe('partially_issued');

		const h1 = await row('cms_mro_requisitions', 'id = ?', req.id);
		expect(h1?.requisition_status).toBe('partially_issued');
		expect(Number(h1?.issued_qty)).toBe(7);

		// Completing with the remaining 3/10 → fulfilled, issued_by recorded on the OUT.
		const o2 = await outboundDraft([{ item_model: M_STD, qty: 3 }], { request: req.id }, loc);
		const c2 = await confirm('outbounds', o2.id as string, { issued_by: APPROVER });
		expect(c2.status).toBe(201);
		expect((c2.body.data as Record<string, unknown>).requisition_status).toBe('fulfilled');

		const h2 = await row('cms_mro_requisitions', 'id = ?', req.id);
		expect(h2?.requisition_status).toBe('fulfilled');
		expect(Number(h2?.issued_qty)).toBe(10);

		for (const outId of [o1.id, o2.id]) {
			const oh = await row('cms_mro_outbounds', 'id = ?', outId);
			expect(oh?.issued_by).toBe(APPROVER);
			expect(oh?.request).toBe(req.id);
		}
		expect(await onHandQty(M_STD, loc)).toBe(0);

		// Replenish so a further attempt at this request fails on the LIFECYCLE guard
		// (no further issue onto a fulfilled request), not because stock ran dry —
		// stock must remain untouched on the 409.
		const refill = await inboundDraft([{ item_model: M_STD, qty: 10, unit_price: 5 }], {}, loc);
		expect((await confirm('inbounds', refill.id as string)).status).toBe(201);
		expect(await onHandQty(M_STD, loc)).toBe(10);

		const over = await outboundDraft([{ item_model: M_STD, qty: 1 }], { request: req.id }, loc);
		const cOver = await confirm('outbounds', over.id as string, { issued_by: APPROVER });
		expect(cOver.status).toBe(409);
		expect(cOver.body.error).toMatch(/fulfilled/i);
		expect(await row('cms_mro_requisitions', 'id = ?', req.id)).toMatchObject({
			requisition_status: 'fulfilled',
			issued_qty: 10,
		});
		expect(await onHandQty(M_STD, loc)).toBe(10); // no double stock

		// Drain the refill the same way (a write-off) so this test leaves the shared
		// location/model balance exactly how it found it — later suite tests assert
		// absolute on-hand values from their own fresh inbound.
		const drain = await outboundDraft([{ item_model: M_STD, qty: 10 }], {}, loc);
		expect((await confirm('outbounds', drain.id as string)).status).toBe(201);
		expect(await onHandQty(M_STD, loc)).toBe(0);
	});

	it('rejects an open requested draft → cancelled with close_reason and doc_status cancelled', async () => {
		const before = await onHandQty(M_STD, 'main_store');
		const d = await requisitionDraft([{ item_model: M_STD, qty: 4, note: 'no longer needed' }]);
		expect(d.doc_status).toBe('draft');

		const res = await reject(d.id as string, { close_reason: 'stock_low' });
		expect(res.status).toBe(201);
		const data = res.body.data as Record<string, unknown>;
		expect(data.requisition_status).toBe('cancelled');
		expect(data.close_reason).toBe('stock_low');
		expect(data.doc_status).toBe('cancelled'); // never-left-draft doc flips engine status too

		const hdr = await row('cms_mro_requisitions', 'id = ?', d.id);
		expect(hdr?.requisition_status).toBe('cancelled');
		expect(hdr?.close_reason).toBe('stock_low');
		expect(hdr?.doc_status).toBe('cancelled');

		// No stock effect and no double-cancel (guarded 409).
		expect(await onHandQty(M_STD, 'main_store')).toBe(before);
		expect((await reject(d.id as string)).status).toBe(409);
	});

	it('rejects an approved request → cancelled with close_reason default, keeping doc_status confirmed', async () => {
		// A basket distinct from the two-person test above — the duplicate guard
		// refuses a repeat same-day basket for the same requester.
		const req = await requisitionDraft([{ item_model: M_STD, qty: 6 }], { requested_by: REPORTER });
		expect((await confirm('requisitions', req.id as string, { approved_by: APPROVER })).status).toBe(201);

		const res = await reject(req.id as string); // no body → default cancelled
		expect(res.status).toBe(201);
		const data = res.body.data as Record<string, unknown>;
		expect(data.requisition_status).toBe('cancelled');
		expect(data.close_reason).toBe('cancelled');
		expect(data.doc_status).toBe('confirmed'); // approved docs keep engine confirmed

		const hdr = await row('cms_mro_requisitions', 'id = ?', req.id);
		expect(hdr?.requisition_status).toBe('cancelled');
		expect(hdr?.close_reason).toBe('cancelled');
		expect(hdr?.doc_status).toBe('confirmed');
	});

	it('409s rejecting an already fulfilled or cancelled requisition without changing it', async () => {
		const loc = 'admin_store';

		// Fulfilled — a seeded inbound fully issues the request.
		const seed = await inboundDraft([{ item_model: M_STD, qty: 3, unit_price: 4 }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		const fulfilled = await requisitionDraft([{ item_model: M_STD, qty: 3 }], {}, loc);
		expect((await confirm('requisitions', fulfilled.id as string)).status).toBe(201);
		const issue = await outboundDraft([{ item_model: M_STD, qty: 3 }], { request: fulfilled.id }, loc);
		expect((await confirm('outbounds', issue.id as string)).status).toBe(201);
		expect((await row('cms_mro_requisitions', 'id = ?', fulfilled.id))?.requisition_status).toBe('fulfilled');

		const fulfilledReject = await reject(fulfilled.id as string, { close_reason: 'stock_low' });
		expect(fulfilledReject.status).toBe(409);
		expect((await row('cms_mro_requisitions', 'id = ?', fulfilled.id))?.requisition_status).toBe('fulfilled');

		// Cancelled — flip a draft's engine status off, then reject must 409.
		const cancelled = await requisitionDraft([{ item_model: M_STD, qty: 1 }]);
		const dCancel = await api(`/api/entities/mro_requisitions/${cancelled.id}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'cancelled' }),
		});
		expect(dCancel.status).toBe(200);
		const cancelledReject = await reject(cancelled.id as string);
		expect(cancelledReject.status).toBe(409);
		expect((await row('cms_mro_requisitions', 'id = ?', cancelled.id))?.doc_status).toBe('cancelled');

		// Missing + bad-body guards.
		expect((await reject('00000000-0000-4000-8000-000000000000')).status).toBe(404);
		const badReason = await requisitionDraft([{ item_model: M_STD, qty: 1 }]);
		expect((await reject(badReason.id as string, { close_reason: 'nonsense' })).status).toBe(400);
	});

	it('notifies the requester’s superior on file and the requester on decide', async () => {
		const req = await requisitionDraft([{ item_model: M_STD, qty: 2 }], { requested_by: REPORTER });
		const id = String(req.id);

		// FILED rides a fire-and-forget hook — poll for the superior's durable row.
		let filed: Array<Record<string, unknown>> = [];
		for (let attempt = 0; attempt < 40 && filed.length === 0; attempt++) {
			filed = await rows('cms_hr_notifications', 'reference_id = ?', id);
			if (filed.length === 0) await new Promise((resolve) => setTimeout(resolve, 25));
		}
		expect(
			filed.find((r) => r.tg_id === 'atr-approver'),
			'superior notified on file',
		).toBeTruthy();
		expect(filed.some((r) => r.tg_id === 'atr-reporter')).toBe(false);

		// DECIDED is awaited by the route — the row is present when it returns.
		expect((await confirm('requisitions', id, { approved_by: APPROVER })).status).toBe(201);
		const toRequester = (await rows('cms_hr_notifications', 'reference_id = ?', id)).find((r) => r.tg_id === 'atr-reporter');
		expect(toRequester, 'requester notified on approve').toBeTruthy();
		expect(String(toRequester?.title)).toContain('✅');
	});
});

describe('requisition duplicate guard — one same-day basket per requester', () => {
	/** POST a basket through the generic API (no 201 assertion — the caller checks). */
	const basketPost = (requestedBy: string, lines: Array<Record<string, unknown>>) =>
		api('/api/entities/mro_requisitions', {
			method: 'POST',
			body: JSON.stringify({ request_date: mmtToday(), location: 'main_store', requested_by: requestedBy, lines }),
		});

	it('refuses the SAME basket (items + quantities) from the same requester on the same day', async () => {
		const first = await requisitionDraft(
			[
				{ item_model: M_STD, qty: 4 },
				{ item_model: M_BATCH, qty: 9 },
			],
			{ requested_by: DUPLICATOR },
		);
		expect(first.id).toBeTruthy();

		const dup = await basketPost(DUPLICATOR, [
			{ item_model: M_STD, qty: 4 },
			{ item_model: M_BATCH, qty: 9 },
		]);
		expect(dup.status).toBe(400);
		expect(String(dup.body.error)).toMatch(/identical requisition/i);
	});

	it('is order-INSENSITIVE, and a different basket or a different requester is not a duplicate', async () => {
		// The same basket REORDERED is still the same basket.
		const reordered = await basketPost(DUPLICATOR, [
			{ item_model: M_BATCH, qty: 9 },
			{ item_model: M_STD, qty: 4 },
		]);
		expect(reordered.status).toBe(400);

		// A different QUANTITY is a different basket.
		const otherQty = await requisitionDraft(
			[
				{ item_model: M_STD, qty: 4 },
				{ item_model: M_BATCH, qty: 10 },
			],
			{ requested_by: DUPLICATOR },
		);
		expect(otherQty.id).toBeTruthy();

		// A different ITEM is a different basket.
		const otherItem = await requisitionDraft(
			[
				{ item_model: M_STD, qty: 4 },
				{ item_model: M_SERIAL, qty: 9 },
			],
			{ requested_by: DUPLICATOR },
		);
		expect(otherItem.id).toBeTruthy();

		// The SAME basket for a DIFFERENT person is not a duplicate.
		const otherPerson = await requisitionDraft(
			[
				{ item_model: M_STD, qty: 4 },
				{ item_model: M_BATCH, qty: 9 },
			],
			{ requested_by: APPROVER },
		);
		expect(otherPerson.id).toBeTruthy();
	});

	it('frees the basket again when the same-day request is cancelled', async () => {
		const draft = await requisitionDraft([{ item_model: M_SERIAL, qty: 2 }], { requested_by: DUPLICATOR });
		expect(draft.id).toBeTruthy();

		// Blocked while it is live…
		expect((await basketPost(DUPLICATOR, [{ item_model: M_SERIAL, qty: 2 }])).status).toBe(400);

		// …and free again once it is cancelled (the slot is re-openable).
		expect((await reject(draft.id as string, { close_reason: 'stock_low' })).status).toBe(201);
		const refiled = await requisitionDraft([{ item_model: M_SERIAL, qty: 2 }], { requested_by: DUPLICATOR });
		expect(refiled.id).toBeTruthy();
	});

	it('never blocks a request with no recorded requester (the engine owns that rule)', async () => {
		// An identical basket, twice, with no `requested_by` — neither is a duplicate.
		const anonymousA = await requisitionDraft([{ item_model: M_BATCH, qty: 11 }]);
		const anonymousB = await requisitionDraft([{ item_model: M_BATCH, qty: 11 }]);
		expect(anonymousA.id).toBeTruthy();
		expect(anonymousB.id).toBeTruthy();
	});

	it('warns through the pre-flight read and files the duplicate once the warning is acknowledged', async () => {
		// A basket this describe has not used yet, so the assertions start clean.
		const basket = [
			{ item_model: M_STD, qty: 3 },
			{ item_model: M_BATCH, qty: 7 },
		];
		const check = (lines: Array<Record<string, unknown>>) =>
			api('/api/mro/requisitions/check-duplicate', {
				method: 'POST',
				body: JSON.stringify({ request_date: mmtToday(), requested_by: DUPLICATOR, lines }),
			});

		// Nothing filed yet → no warning, and nothing to acknowledge.
		const clean = await check(basket);
		expect(clean.status).toBe(200);
		expect(clean.body.data).toMatchObject({ duplicate: false, message: null, ack: null });

		expect((await requisitionDraft(basket, { requested_by: DUPLICATOR })).id).toBeTruthy();

		// The pre-flight now reports the guard's OWN verdict: the message the form
		// shows verbatim, and the token it returns on confirm.
		const warned = await check(basket);
		expect(warned.status).toBe(200);
		const warnedData = warned.body.data as Record<string, unknown>;
		expect(warnedData.duplicate).toBe(true);
		expect(warnedData.ack).toBe(REQUISITION_DUPLICATE_ACK);
		expect(String(warnedData.message)).toMatch(/identical requisition/i);
		expect(String(warnedData.display_number)).toMatch(/^REQ-/);

		// Deny-by-default: without the acknowledgement the guard still refuses.
		const unacked = await basketPost(DUPLICATOR, basket);
		expect(unacked.status).toBe(400);
		expect(String(unacked.body.error)).toMatch(/identical requisition/i);

		// Only the guard's OWN token acknowledges it — an unrelated header value
		// is not a confirmation.
		const wrongToken = await api('/api/entities/mro_requisitions', {
			method: 'POST',
			headers: { 'X-Write-Ack': 'some-other-guard' },
			body: JSON.stringify({ request_date: mmtToday(), location: 'main_store', requested_by: DUPLICATOR, lines: basket }),
		});
		expect(wrongToken.status).toBe(400);

		// Acknowledged → the repeat request the user explicitly confirmed is filed.
		const acked = await api('/api/entities/mro_requisitions', {
			method: 'POST',
			headers: { 'X-Write-Ack': REQUISITION_DUPLICATE_ACK },
			body: JSON.stringify({ request_date: mmtToday(), location: 'main_store', requested_by: DUPLICATOR, lines: basket }),
		});
		expect(acked.status).toBe(201);
		expect(String((acked.body.data as Record<string, unknown>).display_number)).toMatch(/^REQ-/);

		// The acknowledgement is request-scoped, NOT sticky: a later unacknowledged
		// create of the same basket is refused again.
		expect((await basketPost(DUPLICATOR, basket)).status).toBe(400);
	});
});

describe('standard items', () => {
	it('confirms a multi-line inbound/outbound and 409s on oversell without partial state', async () => {
		const d = await inboundDraft(
			[
				{ item_model: M_STD, qty: 12, unit_price: 2.5 },
				{ item_model: M_STD, qty: 8 },
			],
			{},
			'admin_store',
		);
		const confirmed = await confirm('inbounds', d.id as string);
		expect(confirmed.status).toBe(201);
		const data = confirmed.body.data as Record<string, unknown>;
		expect(data.total_qty).toBe(20);
		expect(data.line_count).toBe(2);
		expect(data.total_amount).toBe(30); // 12 × 2.5
		expect(await onHandQty(M_STD, 'admin_store')).toBe(20);

		const o = await outboundDraft([{ item_model: M_STD, qty: 7 }], {}, 'admin_store');
		expect((await confirm('outbounds', o.id as string)).status).toBe(201);
		expect(await onHandQty(M_STD, 'admin_store')).toBe(13);

		// Oversell draft stays a draft; nothing moves.
		const big = await outboundDraft([{ item_model: M_STD, qty: 999 }], {}, 'admin_store');
		const blocked = await confirm('outbounds', big.id as string);
		expect(blocked.status).toBe(409);
		expect(await onHandQty(M_STD, 'admin_store')).toBe(13);
		const hdr = await row('cms_mro_outbounds', 'id = ?', big.id);
		expect(hdr?.doc_status).toBe('draft');
	});
});

describe('batch items — lots, FEFO, expiry', () => {
	it('creates a lot per inbound line and consumes nearest expiry first (FEFO)', async () => {
		const far = await inboundDraft(
			[{ item_model: M_BATCH, qty: 10, batch_no: 'B-FAR', expiry_date: mmtToday(60) }],
			{ purchase_date: '2026-06-01' },
			'safety_store',
		);
		const near = await inboundDraft(
			[{ item_model: M_BATCH, qty: 10, batch_no: 'B-NEAR', expiry_date: mmtToday(20) }],
			{ purchase_date: '2026-06-15' },
			'safety_store',
		);
		expect((await confirm('inbounds', far.id as string)).status).toBe(201);
		expect((await confirm('inbounds', near.id as string)).status).toBe(201);

		const o = await outboundDraft([{ item_model: M_BATCH, qty: 12 }], {}, 'safety_store');
		expect((await confirm('outbounds', o.id as string)).status).toBe(201);

		const nearLot = await row('cms_mro_stock_lots', "batch_no = 'B-NEAR' AND deleted_at IS NULL");
		const farLot = await row('cms_mro_stock_lots', "batch_no = 'B-FAR' AND deleted_at IS NULL");
		expect(Number(nearLot?.remaining_qty)).toBe(0); // exhausted first (nearest expiry)
		expect(Number(farLot?.remaining_qty)).toBe(8); // 10 − 2 remaining from FEFO tail
		const links = await rows('cms_mro_outbound_lots', 'outbound_id = ?', o.id);
		expect(links.reduce((s, l) => s + Number(l.qty), 0)).toBe(12);
		expect(links.every((l) => l.outbound_line)).toBe(true); // line provenance recorded
		expect(await onHandQty(M_BATCH, 'safety_store')).toBe(8);
	});

	it('blocks expired lots from goods issues and targets them on write-offs', async () => {
		const stale = await inboundDraft(
			[{ item_model: M_BATCH, qty: 5, batch_no: 'B-OLD', expiry_date: mmtToday(-200) }],
			{ purchase_date: '2025-12-01' },
			'safety_store',
		);
		expect((await confirm('inbounds', stale.id as string)).status).toBe(201);

		// goods_issue must skip the expired lot → 409 (only 8 fresh left, ask 9).
		const issue = await outboundDraft([{ item_model: M_BATCH, qty: 9 }], {}, 'safety_store');
		expect((await confirm('outbounds', issue.id as string)).status).toBe(409);

		// write-off strikes the expired lot first.
		const wo = await outboundDraft([{ item_model: M_BATCH, qty: 5 }], { type: 'write_offs' }, 'safety_store');
		expect((await confirm('outbounds', wo.id as string)).status).toBe(201);
		const oldLot = await row('cms_mro_stock_lots', "batch_no = 'B-OLD' AND deleted_at IS NULL");
		expect(oldLot?.status).toBe('empty');
		expect(Number(oldLot?.remaining_qty)).toBe(0);
		expect(await onHandQty(M_BATCH, 'safety_store')).toBe(8); // expired 5 written off, fresh untouched
	});
});

describe('serial items — per-unit tracking', () => {
	it('creates one stock row per serial on confirm and rejects global duplicates', async () => {
		const d = await inboundDraft([{ item_model: M_SERIAL, qty: 3, serials: ['TY-001', 'TY-002', 'TY-003'] }]);
		expect((await confirm('inbounds', d.id as string)).status).toBe(201);
		const units = await rows('cms_mro_stock_serials', "status = 'in_stock' AND deleted_at IS NULL");
		expect(units).toHaveLength(3);
		expect(await onHandQty(M_SERIAL, 'main_store')).toBe(3);

		const dup = await inboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-001'] }]);
		const blocked = await confirm('inbounds', dup.id as string);
		expect(blocked.status).toBe(409);
		expect(await onHandQty(M_SERIAL, 'main_store')).toBe(3);
	});

	it('issues only the picked serials and returns them back to stock', async () => {
		const o = await outboundDraft([{ item_model: M_SERIAL, qty: 2, serials: ['TY-001', 'TY-002'] }]);
		expect((await confirm('outbounds', o.id as string)).status).toBe(201);
		const issued = await rows('cms_mro_stock_serials', "status = 'issued' AND deleted_at IS NULL");
		expect(issued.map((s) => s.serial_no).sort()).toEqual(['TY-001', 'TY-002']);
		const links = await rows('cms_mro_outbound_serials', 'outbound_id = ?', o.id);
		expect(links).toHaveLength(2);
		expect(links.every((l) => l.outbound_line)).toBe(true);
		expect(await onHandQty(M_SERIAL, 'main_store')).toBe(1);

		// A return inbound re-instocks them — no duplicate serials created. Goods
		// coming back carry the PERSON who returned them, not a vendor.
		const ret = await inboundDraft([{ item_model: M_SERIAL, qty: 2, serials: ['TY-001', 'TY-002'] }], {
			type: 'return',
			handed_by: REPORTER,
			purchase_date: mmtToday(),
		});
		expect((await confirm('inbounds', ret.id as string)).status).toBe(201);
		const units = await rows('cms_mro_stock_serials', "serial_no IN ('TY-001','TY-002') AND deleted_at IS NULL");
		expect(units).toHaveLength(2); // same rows, not duplicates
		expect(units.every((s) => s.status === 'in_stock')).toBe(true);
		expect(await onHandQty(M_SERIAL, 'main_store')).toBe(3);

		// Returning something that is already in stock is rejected.
		const again = await inboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-001'] }], {
			type: 'return',
			handed_by: REPORTER,
			purchase_date: mmtToday(),
		});
		expect((await confirm('inbounds', again.id as string)).status).toBe(409);
	});

	it('blocks goods issues of expired serials, scraps via write-off, and refuses scrapped returns', async () => {
		const d = await inboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-EXP'], expiry_date: mmtToday(-200) }], {
			purchase_date: '2025-12-01',
		});
		expect((await confirm('inbounds', d.id as string)).status).toBe(201);

		const gi = await outboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-EXP'] }]);
		expect((await confirm('outbounds', gi.id as string)).status).toBe(409); // expired — cannot issue

		const wo = await outboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-EXP'] }], { type: 'write_offs' });
		expect((await confirm('outbounds', wo.id as string)).status).toBe(201);
		const scrapped = await row('cms_mro_stock_serials', "serial_no = 'TY-EXP' AND deleted_at IS NULL");
		expect(scrapped?.status).toBe('scrapped');

		const ret = await inboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-EXP'] }], {
			type: 'return',
			handed_by: REPORTER,
			purchase_date: mmtToday(),
		});
		expect((await confirm('inbounds', ret.id as string)).status).toBe(409); // scrapped cannot return
	});
});

describe('multi-line mixed-policy document', () => {
	it('confirms standard + batch + serial lines in one atomic document', async () => {
		const d = await inboundDraft(
			[
				{ item_model: M_STD, qty: 4, unit_price: 1.5 },
				{ item_model: M_BATCH, qty: 6, batch_no: 'B-MIX', expiry_date: mmtToday(60) },
				{ item_model: M_SERIAL, qty: 2, serials: ['TY-10', 'TY-11'] },
			],
			{},
			'vehicle_store',
		);
		const confirmed = await confirm('inbounds', d.id as string);
		expect(confirmed.status).toBe(201);
		const data = confirmed.body.data as Record<string, unknown>;
		expect(data.line_count).toBe(3);
		expect(data.total_qty).toBe(12);
		expect(data.total_amount).toBe(6); // 4 × 1.5; batch/serial lines have no price

		expect(await onHandQty(M_STD, 'vehicle_store')).toBe(4);
		expect(await onHandQty(M_BATCH, 'vehicle_store')).toBe(6);
		expect(await onHandQty(M_SERIAL, 'vehicle_store')).toBe(2);
		const lot = await row('cms_mro_stock_lots', "batch_no = 'B-MIX' AND deleted_at IS NULL");
		expect(lot?.source_line).toBeTruthy();
		expect(Number(lot?.remaining_qty)).toBe(6);
		expect((await rows('cms_mro_stock_serials', "serial_no IN ('TY-10','TY-11') AND deleted_at IS NULL")).length).toBe(2);

		// One mixed outbound: consume across all three policies.
		const o = await outboundDraft(
			[
				{ item_model: M_STD, qty: 2 },
				{ item_model: M_BATCH, qty: 2 },
				{ item_model: M_SERIAL, qty: 1, serials: ['TY-10'] },
			],
			{},
			'vehicle_store',
		);
		expect((await confirm('outbounds', o.id as string)).status).toBe(201);
		expect(await onHandQty(M_STD, 'vehicle_store')).toBe(2);
		expect(await onHandQty(M_BATCH, 'vehicle_store')).toBe(4);
		expect(await onHandQty(M_SERIAL, 'vehicle_store')).toBe(1);
	});
});

describe('expiry feed + on-hand', () => {
	it('buckets expired vs expiring lots/serials', async () => {
		// Expired lot + expired serial at mandalay_store.
		const pastLot = await inboundDraft(
			[{ item_model: M_BATCH, qty: 2, batch_no: 'B-PAST', expiry_date: mmtToday(-200) }],
			{ purchase_date: '2025-11-01' },
			'mandalay_store',
		);
		const pastSerial = await inboundDraft(
			[{ item_model: M_SERIAL, qty: 1, serials: ['TY-PAST'], expiry_date: mmtToday(-200) }],
			{ purchase_date: '2025-11-01' },
			'mandalay_store',
		);
		// Expiring-soon stock.
		const soon = await inboundDraft(
			[{ item_model: M_BATCH, qty: 3, batch_no: 'B-SOON', expiry_date: mmtToday(10) }],
			{ purchase_date: mmtToday(-30) },
			'mandalay_store',
		);
		expect((await confirm('inbounds', pastLot.id as string)).status).toBe(201);
		expect((await confirm('inbounds', pastSerial.id as string)).status).toBe(201);
		expect((await confirm('inbounds', soon.id as string)).status).toBe(201);

		const res = await api('/api/mro/stock/expiring?days=30');
		expect(res.status).toBe(200);
		const data = res.body.data as { expired: Array<Record<string, unknown>>; expiring: Array<Record<string, unknown>> };
		expect(data.expired.some((r) => r.ref === 'B-PAST')).toBe(true);
		expect(data.expired.some((r) => r.ref === 'TY-PAST')).toBe(true);
		expect(data.expiring.some((r) => r.ref === 'B-SOON')).toBe(true);
	});

	it('reports on-hand balances with no drift for batch/serial models', async () => {
		const res = await api('/api/mro/stock/onhand');
		expect(res.status).toBe(200);
		const list = (res.body.data as { rows: Array<Record<string, unknown>> }).rows.filter((r) => r.location === 'mandalay_store');
		const batch = list.find((r) => r.model_name === 'Engine Oil 10W-40');
		const serial = list.find((r) => r.model_name === 'Tyre 11R22.5');
		expect(batch?.drift).toBe(false);
		expect(serial?.drift).toBe(false);
		expect(Number(batch?.derived_qty)).toBe(Number(batch?.qty_on_hand));
		expect(Number(serial?.derived_qty)).toBe(Number(serial?.qty_on_hand));
	});

	it('surfaces lot/serial stock with NO inventory row as orphan rows, metadata batched', async () => {
		// A master + SKU only THIS test has, plus a lot that never had a balance row
		// written — the report must still show the derived stock, and it resolves the
		// orphan model's name/policy in ONE batched read (the N+1 the report used to
		// pay per orphan). `safety_store` has no balance row for this model by design.
		const group = 'aaaa0000-0000-4000-8000-0000000000aa';
		const model = 'aaaa0000-0000-4000-8000-0000000000bb';
		await insert('cms_mro_item_name', { id: group, name_en: 'Orphan Part', tracking: 'batch' });
		await insert('cms_mro_item_model', { id: model, name_en: 'Orphan Part 1', item_name: group });
		await insert('cms_mro_stock_lots', {
			id: 'aaaa0000-0000-4000-8000-0000000000cc',
			model,
			location: 'safety_store',
			batch_no: 'ORPHAN-B1',
			expiry_date: mmtToday(90),
			remaining_qty: 5,
			status: 'active',
		});

		const res = await api('/api/mro/stock/onhand');
		expect(res.status).toBe(200);
		const orphan = (res.body.data as { rows: Array<Record<string, unknown>> }).rows.find(
			(r) => r.model === model && r.location === 'safety_store',
		);
		expect(orphan).toBeTruthy();
		expect(orphan?.id).toBeNull(); // derived — no balance row to point at
		expect(Number(orphan?.qty_on_hand)).toBe(0);
		expect(orphan?.model_name).toBe('Orphan Part 1'); // resolved through the batch
		expect(orphan?.tracking).toBe('batch'); // inherited from the item NAME
		expect(Number(orphan?.drift)).toBe(5); // the derived lot total
	});

	it('lists a model+location present in BOTH lots and serials exactly ONCE (partition), tracking-aware', async () => {
		// The "policy is set once" invariant makes this unreachable in normal use; the
		// report must still behave as a PARTITION if a stray row of the other kind
		// exists (e.g. a policy flipped mid-life after a bad import), reporting the
		// qty the model's CURRENT policy tracks — not two rows for one balance.
		const group = 'bbbb0000-0000-4000-8000-0000000000aa';
		const model = 'bbbb0000-0000-4000-8000-0000000000bb';
		await insert('cms_mro_item_name', { id: group, name_en: 'Mixed Part', tracking: 'batch' });
		await insert('cms_mro_item_model', { id: model, name_en: 'Mixed Part 1', item_name: group });
		await insert('cms_mro_stock_lots', {
			id: 'bbbb0000-0000-4000-8000-0000000000cc',
			model,
			location: 'safety_store',
			batch_no: 'MIXED-B1',
			expiry_date: mmtToday(90),
			remaining_qty: 7,
			status: 'active',
		});
		// A stray serial for the SAME model+location — the other derivation.
		await insert('cms_mro_stock_serials', {
			id: 'bbbb0000-0000-4000-8000-0000000000dd',
			model,
			location: 'safety_store',
			serial_no: 'MIXED-S1',
			status: 'in_stock',
		});

		const res = await api('/api/mro/stock/onhand');
		expect(res.status).toBe(200);
		const matched = (res.body.data as { rows: Array<Record<string, unknown>> }).rows.filter(
			(r) => r.model === model && r.location === 'safety_store',
		);
		expect(matched).toHaveLength(1); // ONE row — never a duplicate
		expect(matched[0]?.tracking).toBe('batch');
		expect(Number(matched[0]?.drift)).toBe(7); // the batch (lot) total, not the serial count
	});

	it('the per-model aggregate (the items-list chip) is the SINGLE VERSION of the report’s per-model total', async () => {
		// Two read paths answer "how much is on hand": the full report (dashboard) and
		// the `GROUP BY model` aggregate (items chip). Different SQL, so this pins them
		// EQUAL — a drift between the two screens becomes a failing test, not a support
		// ticket. It also pins the aggregate ALIAS contract (`${op}_${field}`), which the
		// client resolves through `@mmbix/sdk`'s `aggregateAlias`.
		const report = await api('/api/mro/stock/onhand');
		expect(report.status).toBe(200);
		const byModel = new Map<string, number>();
		for (const row of (report.body.data as { rows: Array<Record<string, unknown>> }).rows) {
			if (row.model == null) continue;
			const model = String(row.model);
			byModel.set(model, (byModel.get(model) ?? 0) + Number(row.qty_on_hand ?? 0));
		}

		const agg = await api('/api/entities/mro_inventory?groupBy%5B%5D=model&aggregate%5Bsum%5D=qty_on_hand');
		expect(agg.status).toBe(200);
		const rows = agg.body.data as Array<Record<string, unknown>>;

		for (const row of rows) {
			expect(row).toHaveProperty('sum_qty_on_hand'); // the alias contract
			const model = String(row.model);
			expect(Number(row.sum_qty_on_hand ?? 0)).toBe(byModel.get(model) ?? 0);
		}
		// An orphan-only model has derived stock but NO balance row, so it is absent
		// from the aggregate — and its report total is therefore zero.
		for (const [model, total] of byModel) {
			if (!rows.some((row) => String(row.model) === model)) expect(total).toBe(0);
		}
	});
});

describe('stock reconciliation — balance drift, orphan stock, stale snapshots', () => {
	// Every check gets its OWN model in its OWN (model, location) cell so no
	// assertion depends on another test's fixtures. `safety_store` is the store
	// this file's orphan/partition tests already use; the models below are new.
	const loc = 'safety_store' as const;
	const M_REC_CLEAN = 'dddd0000-0000-4000-8000-0000000000c1';
	const M_REC_DRIFT = 'dddd0000-0000-4000-8000-0000000000d1';
	const M_REC_ORPHAN = 'dddd0000-0000-4000-8000-0000000000e1';
	const M_REC_STALE = 'dddd0000-0000-4000-8000-0000000000f1';

	beforeAll(async () => {
		await insert('cms_mro_item_model', { id: M_REC_CLEAN, name_en: 'Reconcile Clean', item_name: G_BATCH });
		await insert('cms_mro_item_model', { id: M_REC_DRIFT, name_en: 'Reconcile Drift', item_name: G_BATCH });
		await insert('cms_mro_item_model', { id: M_REC_ORPHAN, name_en: 'Reconcile Orphan', item_name: G_BATCH });
		await insert('cms_mro_item_model', { id: M_REC_STALE, name_en: 'Reconcile Stale', item_name: G_SERIAL });
	});

	it('returns ZERO rows for cleanly received, untouched stock (no false positives)', async () => {
		const d = await inboundDraft([{ item_model: M_REC_CLEAN, qty: 4, batch_no: 'REC-CLEAN' }], {}, loc);
		expect((await confirm('inbounds', d.id as string)).status).toBe(201);

		const res = await api('/api/mro/stock/reconcile');
		expect(res.status).toBe(200);
		const data = res.body.data as { rows: Array<Record<string, unknown>>; summary: Record<string, number> };
		// summary.total is DERIVED from rows (one source), and NOTHING names this model.
		expect(data.summary.total).toBe(data.rows.length);
		expect(data.rows.some((r) => r.model === M_REC_CLEAN)).toBe(false);
	});

	it('flags an inventory balance that drifted from the lot ledger', async () => {
		const d = await inboundDraft([{ item_model: M_REC_DRIFT, qty: 5, batch_no: 'REC-DRIFT' }], {}, loc);
		expect((await confirm('inbounds', d.id as string)).status).toBe(201);
		const inv = await row('cms_mro_inventory', 'model = ? AND location = ? AND deleted_at IS NULL', M_REC_DRIFT, loc);
		expect(inv).toBeTruthy();
		// Corrupt the balance OUTSIDE the service — the double-write this check exists
		// to surface. Raw D1 so no service path can "explain" the discrepancy away.
		await env.DB.prepare('UPDATE cms_mro_inventory SET qty_on_hand = ? WHERE id = ?')
			.bind(99, inv?.id as string)
			.run();

		const res = await api('/api/mro/stock/reconcile');
		const drift = (res.body.data as { rows: Array<Record<string, unknown>> }).rows.find(
			(r) => r.check === 'balance_drift' && r.id === inv?.id,
		);
		expect(drift).toBeTruthy();
		expect(Number(drift?.stored_qty)).toBe(99);
		expect(Number(drift?.derived_qty)).toBe(5);
		expect(Number(drift?.delta)).toBe(94);
	});

	it('flags lot stock with no inventory balance row as orphan stock', async () => {
		await insert('cms_mro_stock_lots', {
			id: 'dddd0000-0000-4000-8000-0000000000e2',
			model: M_REC_ORPHAN,
			location: loc,
			batch_no: 'REC-ORPHAN',
			remaining_qty: 6,
			status: 'active',
		});
		const res = await api('/api/mro/stock/reconcile');
		const orphan = (res.body.data as { rows: Array<Record<string, unknown>> }).rows.find(
			(r) => r.check === 'orphan_stock' && r.model === M_REC_ORPHAN,
		);
		expect(orphan).toBeTruthy();
		expect(orphan?.collection).toBe('mro_stock_lots');
		expect(Number(orphan?.derived_qty)).toBe(6);
	});

	it('flags a serial whose newest lifecycle event postdates its snapshot row', async () => {
		const SID = 'dddd0000-0000-4000-8000-0000000000f2';
		await insert('cms_mro_stock_serials', {
			id: SID,
			model: M_REC_STALE,
			location: loc,
			serial_no: 'REC-STALE-1',
			status: 'in_stock',
		});
		// An event stamped in the FUTURE relative to the snapshot row's default
		// timestamp — exactly the "event written, snapshot left behind" defect.
		await insert('cms_mro_serial_events', {
			id: 'dddd0000-0000-4000-8000-0000000000f3',
			serial: SID,
			event: 'purchased',
			created_at: '2099-01-01T00:00:00.000Z',
			updated_at: '2099-01-01T00:00:00.000Z',
		});
		const res = await api('/api/mro/stock/reconcile');
		const stale = (res.body.data as { rows: Array<Record<string, unknown>> }).rows.find(
			(r) => r.check === 'snapshot_stale' && r.id === SID,
		);
		expect(stale).toBeTruthy();
		expect(stale?.serial_no).toBe('REC-STALE-1');
	});

	it('is admin-gated — a non-admin session is forbidden', async () => {
		const ROLE = 'dddd0000-0000-4000-8000-0000000000a1';
		const USER = 'dddd0000-0000-4000-8000-0000000000a2';
		await insert('_roles', { id: ROLE, name: 'Reconcile Viewer', is_system: 0 });
		await insert('_users', {
			id: USER,
			email: 'reconcile-viewer@test.local',
			full_name: 'Reconcile Viewer',
			password_hash: 'x',
			role_id: ROLE,
			status: 'active',
		});
		const secret = (env as unknown as Record<string, string>).JWT_SECRET;
		const token = await new AuthService(new D1Client(env.DB)).generateToken(USER, secret);
		const res = await api('/api/mro/stock/reconcile', { headers: { Authorization: `Bearer ${token}` } });
		expect(res.status).toBe(403);
	});
});

describe('transfers — location-to-location moves', () => {
	it('moves batch stock FEFO and merges into the same (batch, expiry) lot at the destination', async () => {
		// Fresh batch stock at admin_store (source) + the merge target at main_store.
		const a = await inboundDraft(
			[{ item_model: M_BATCH, qty: 10, batch_no: 'B-TRF-A', expiry_date: mmtToday(90) }],
			{ purchase_date: '2026-06-01' },
			'admin_store',
		);
		const b = await inboundDraft(
			[{ item_model: M_BATCH, qty: 6, batch_no: 'B-TRF-B', expiry_date: mmtToday(30) }],
			{ purchase_date: '2026-06-15' },
			'admin_store',
		);
		const tgt = await inboundDraft(
			[{ item_model: M_BATCH, qty: 4, batch_no: 'B-TRF-A', expiry_date: mmtToday(90) }],
			{ purchase_date: '2026-06-20' },
			'main_store',
		);
		expect((await confirm('inbounds', a.id as string)).status).toBe(201);
		expect((await confirm('inbounds', b.id as string)).status).toBe(201);
		expect((await confirm('inbounds', tgt.id as string)).status).toBe(201);

		const trf = await transferDraft([{ item_model: M_BATCH, qty: 12 }], {}, 'admin_store', 'main_store');
		expect(trf.display_number).toBe('TRF-00001');
		expect(trf.doc_status).toBe('draft');
		expect((await confirm('transfers', trf.id as string, { approved_by: APPROVER })).status).toBe(201);

		// FEFO: B-TRF-B (sooner expiry) fully drained first, then 6 of B-TRF-A.
		expect(Number((await lotOf('B-TRF-B', 'admin_store'))?.remaining_qty)).toBe(0);
		expect((await lotOf('B-TRF-B', 'admin_store'))?.status).toBe('empty');
		expect(Number((await lotOf('B-TRF-A', 'admin_store'))?.remaining_qty)).toBe(4);
		// Destination: B-TRF-A merged into the existing lot (4 + 6), B-TRF-B created fresh.
		expect(Number((await lotOf('B-TRF-A', 'main_store'))?.remaining_qty)).toBe(10);
		expect(Number((await lotOf('B-TRF-B', 'main_store'))?.remaining_qty)).toBe(6);
		expect((await lotOf('B-TRF-B', 'main_store'))?.status).toBe('active');
		expect(await onHandQty(M_BATCH, 'admin_store')).toBe(4);
		expect(await onHandQty(M_BATCH, 'main_store')).toBe(16);

		// Lot-level provenance: two takes, every row maps from_lot → to_lot.
		const trace = await rows('cms_mro_transfer_lots', 'transfer_id = ?', trf.id);
		expect(trace).toHaveLength(2);
		expect(trace.reduce((s, l) => s + Number(l.qty), 0)).toBe(12);
		expect(trace.every((l) => l.from_lot && l.to_lot && l.transfer_line)).toBe(true);

		// Idempotent replay.
		const replay = await confirm('transfers', trf.id as string, { approved_by: APPROVER });
		expect(replay.status).toBe(201);
		expect((replay.body.data as Record<string, unknown>).already).toBe(true);
		expect(await onHandQty(M_BATCH, 'main_store')).toBe(16);
	});

	it('moves listed serials to the destination and refuses non-local/expired/unknown units', async () => {
		const d = await inboundDraft([{ item_model: M_SERIAL, qty: 2, serials: ['TY-T1', 'TY-T2'] }], {}, 'admin_store');
		expect((await confirm('inbounds', d.id as string)).status).toBe(201);

		const trf = await transferDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-T1'] }], {}, 'admin_store', 'safety_store');
		expect((await confirm('transfers', trf.id as string, { approved_by: APPROVER })).status).toBe(201);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-T1' AND deleted_at IS NULL"))?.location).toBe('safety_store');
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-T2' AND deleted_at IS NULL"))?.location).toBe('admin_store');
		expect(await onHandQty(M_SERIAL, 'admin_store')).toBe(1);
		expect(await onHandQty(M_SERIAL, 'safety_store')).toBe(1);
		const trace = await rows('cms_mro_transfer_serials', 'transfer_id = ?', trf.id);
		expect(trace).toHaveLength(1);

		// Now TY-T1 lives at safety_store → a second move from admin_store must 409.
		const again = await transferDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-T1'] }], {}, 'admin_store', 'safety_store');
		expect((await confirm('transfers', again.id as string, { approved_by: APPROVER })).status).toBe(409);
		// Unknown serial → 409 (never created).
		const ghost = await transferDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-NOPE'] }], {}, 'admin_store', 'safety_store');
		expect((await confirm('transfers', ghost.id as string, { approved_by: APPROVER })).status).toBe(409);
		// Expired serials stay put (write off where they sit).
		const exp = await inboundDraft(
			[{ item_model: M_SERIAL, qty: 1, serials: ['TY-TEXP'], expiry_date: mmtToday(-200) }],
			{ purchase_date: '2025-12-01' },
			'admin_store',
		);
		expect((await confirm('inbounds', exp.id as string)).status).toBe(201);
		const blocked = await transferDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-TEXP'] }], {}, 'admin_store', 'safety_store');
		expect((await confirm('transfers', blocked.id as string, { approved_by: APPROVER })).status).toBe(409);
		expect(await onHandQty(M_SERIAL, 'admin_store')).toBe(2);
	});

	it('orders the timeline by the timestamp each row DISPLAYS — a back-dated fit reads in its physical place', async () => {
		// The page prints `event_date` when a fit/un-seat carries one (the operator's
		// "wear date") and `created_at` otherwise, so the ORDER is by that same DAY: a
		// wear recorded TODAY but dated last month belongs under today's rows, not on top
		// of them. Within one day the append order decides (rowid), because a single
		// confirm writes several events at once and a random UUID would shuffle them.
		// Its OWN truck: a wheel seat is a shared resource in this suite.
		const TRUCK = '7c0de000-0000-4000-8000-00000000ord1';
		await insert('cms_veh_fleets', { id: TRUCK, plate_no: 'TY-ORD-TRK' });
		const d = await inboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-ORD-1'] }], {}, 'admin_store');
		expect((await confirm('inbounds', d.id as string, { received_by: APPROVER })).status, 'seed inbound').toBe(201);
		const unit = await row('cms_mro_stock_serials', "serial_no = 'TY-ORD-1' AND deleted_at IS NULL");

		const fitted = await api(`/api/mro/serials/${unit!.id as string}/fit`, {
			method: 'POST',
			body: JSON.stringify({ to_vehicle: TRUCK, to_slot: 'steer-l', actor_id: APPROVER, event_date: '2001-02-03' }),
		});
		expect(fitted.status, fitted.body.error ?? '').toBe(201);

		const res = await api(`/api/mro/serials/${unit!.id as string}/events`);
		expect(res.status, res.body.error).toBe(200);
		const list = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;

		// The receipt (dated today) leads; the back-dated wear closes.
		expect(list.map((e) => e.event)).toEqual(['purchased', 'fitted']);
		expect(list[1].event_date).toBe('2001-02-03');
		// The wear WAS appended later (`created_at`), which is exactly why the order
		// cannot be `created_at` alone.
		expect(String(list[1].created_at) > String(list[0].created_at)).toBe(true);
	});

	it('dates a document-backed event by the DOCUMENT that authorised it, not by the confirm day', async () => {
		// The timeline prints, ages and ORDERS every movement by the day it TOOK EFFECT.
		// Stock bought in June and booked in today took effect in JUNE, so the receipt
		// row must read (and sort) as June rather than as the day someone typed it in —
		// otherwise "when did this happen" answers with the session's clock, not with
		// the movement. Each row takes the date of ITS OWN document, so two confirmations
		// made minutes apart still read in the order the movements happened.
		const d = await inboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-EFF-1'] }], { purchase_date: '2026-06-05' }, 'admin_store');
		expect((await confirm('inbounds', d.id as string, { received_by: APPROVER })).status, 'seed inbound').toBe(201);
		const unit = await row('cms_mro_stock_serials', "serial_no = 'TY-EFF-1' AND deleted_at IS NULL");

		const trf = await transferDraft(
			[{ item_model: M_SERIAL, qty: 1, serials: ['TY-EFF-1'] }],
			{ transfer_date: '2026-07-10' },
			'admin_store',
			'safety_store',
		);
		expect((await confirm('transfers', trf.id as string, { approved_by: APPROVER })).status, 'move it').toBe(201);

		const res = await api(`/api/mro/serials/${unit!.id as string}/events`);
		expect(res.status, res.body.error).toBe(200);
		const list = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;
		const of = (event: string) => list.find((e) => e.event === event) as Record<string, unknown>;

		expect(of('purchased').event_date).toBe('2026-06-05');
		expect(of('store_transferred').event_date).toBe('2026-07-10');
		// NEWEST FIRST by the day each row DISPLAYS — the July move leads the June
		// receipt, even though the receipt was confirmed FIRST.
		expect(list.map((e) => e.event)).toEqual(['store_transferred', 'purchased']);
	});

	it('narrates WHO performed a movement and by whose authority, and never invents either', async () => {
		// ONE unit, ONE receipt, ONE move — the two source documents differ in exactly
		// the way the timeline must respect: a receipt is nobody's approval, a transfer
		// is the confirming operator's. Both readings are DERIVED at the events read
		// (`ref_doc` ↔ `display_number`), so this is the difference between "the row
		// shows an approver" and "the row claims an approval that never happened".
		const d = await inboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-LIN-1'] }], {}, 'admin_store');
		expect((await confirm('inbounds', d.id as string, { received_by: APPROVER })).status).toBe(201);

		const trf = await transferDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-LIN-1'] }], {}, 'admin_store', 'safety_store');
		expect((await confirm('transfers', trf.id as string, { approved_by: APPROVER })).status).toBe(201);

		const sid = String((await row('cms_mro_stock_serials', "serial_no = 'TY-LIN-1' AND deleted_at IS NULL"))?.id ?? '');
		const res = await api(`/api/mro/serials/${sid}/events`);
		expect(res.status, res.body.error).toBe(200);
		const list = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;
		const of = (event: string) => list.find((e) => e.event === event) as Record<string, unknown>;

		// The MOVE: performed by the confirmer (with their directory photo) and
		// authorised by that same document's approver — who carries THEIR photo too,
		// because the timeline fronts whichever of the two the directory can picture.
		expect(of('store_transferred').by_user).toEqual({
			id: APPROVER,
			name_en: 'Approving Operator',
			avatar: '/api/media/approver.jpg',
		});
		expect(of('store_transferred').approved_by).toEqual({
			id: APPROVER,
			name_en: 'Approving Operator',
			avatar: '/api/media/approver.jpg',
		});

		// The RECEIPT: the actor is whoever booked the stock in (the confirm's
		// `received_by`), and the approver is NULL — an INB- names nobody, so the row
		// must not borrow the transfer's approver or the serial's own number.
		expect(of('purchased').by_user).toMatchObject({ id: APPROVER, name_en: 'Approving Operator' });
		expect(of('purchased').approved_by).toBeNull();

		// A receipt written BEFORE the confirm stamped its receiver — the case the
		// dev timeline shows on every legacy INB- row. The receiver is still the actor
		// by definition (the document says who received it), so it is resolved from the
		// header rather than left blank; the AUTHORISER stays null, because recording
		// stock in is nobody's approval.
		await env.DB.prepare(`UPDATE cms_mro_serial_events SET by_user = NULL WHERE ref_doc = ?`)
			.bind(String(of('purchased').ref_doc))
			.run();
		const legacy = (await api(`/api/mro/serials/${sid}/events`)).body.data as { rows: Array<Record<string, unknown>> };
		const legacyPurchase = legacy.rows.find((e) => e.event === 'purchased') as Record<string, unknown>;
		expect(legacyPurchase.by_user).toEqual({ id: APPROVER, name_en: 'Approving Operator', avatar: '/api/media/approver.jpg' });
		expect(legacyPurchase.approved_by).toBeNull();
	});

	it('moves standard stock atomically and blocks oversell / same-location drafts', async () => {
		const d = await inboundDraft([{ item_model: M_STD, qty: 5 }], {}, 'mandalay_store');
		expect((await confirm('inbounds', d.id as string)).status).toBe(201);

		const trf = await transferDraft([{ item_model: M_STD, qty: 3 }], {}, 'mandalay_store', 'safety_store');
		expect((await confirm('transfers', trf.id as string, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_STD, 'mandalay_store')).toBe(2);
		expect(await onHandQty(M_STD, 'safety_store')).toBe(3);

		// Oversell leaves the draft untouched.
		const big = await transferDraft([{ item_model: M_STD, qty: 99 }], {}, 'mandalay_store', 'safety_store');
		expect((await confirm('transfers', big.id as string, { approved_by: APPROVER })).status).toBe(409);
		expect(await onHandQty(M_STD, 'mandalay_store')).toBe(2);
		expect((await row('cms_mro_transfers', 'id = ?', big.id))?.doc_status).toBe('draft');

		// from == to is meaningless.
		const same = await transferDraft([{ item_model: M_STD, qty: 1 }], {}, 'mandalay_store', 'mandalay_store');
		expect((await confirm('transfers', same.id as string, { approved_by: APPROVER })).status).toBe(400);
	});
});

describe('adjustments — reported add/remove authorized by a separate employee', () => {
	// Every adjustment runs in its OWN store so balances never leak. The draft
	// carries `reported_by`; confirming (authorizing) must pass an authorizer
	// DISTINCT from it — the engine applies stock in that single authorize step.

	it('adds batch stock via a new lot, then removes it FEFO', async () => {
		// main_store currently holds B-TRF-A 10 + B-TRF-B 6 (from the transfer test) = 16.
		expect(await onHandQty(M_BATCH, 'main_store')).toBe(16);

		// Add 3 units of a fresh batch → new lot + balance 19.
		const a1 = await adjustmentDraft([{ item_model: M_BATCH, direction: 'add', qty: 3, batch_no: 'ADJ-B1' }], {}, 'main_store');
		expect(a1.display_number).toBe('AJT-00001');
		expect((await confirm('adjustments', a1.id as string, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_BATCH, 'main_store')).toBe(19);
		expect(Number((await lotOf('ADJ-B1', 'main_store'))?.remaining_qty)).toBe(3);
		const line1 = (await rows('cms_mro_adjustment_lines', 'parent_id = ?', a1.id))[0];
		expect(Number(line1.expected_qty)).toBe(16);
		expect(Number(line1.diff_qty)).toBe(3);

		// Remove 6 → FEFO empties B-TRF-B (sooner expiry) first, balance 13.
		const a2 = await adjustmentDraft([{ item_model: M_BATCH, direction: 'remove', qty: 6 }], {}, 'main_store');
		expect((await confirm('adjustments', a2.id as string, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_BATCH, 'main_store')).toBe(13);
		expect(Number((await lotOf('B-TRF-B', 'main_store'))?.remaining_qty)).toBe(0);
		expect((await lotOf('B-TRF-B', 'main_store'))?.status).toBe('empty');
		expect(Number((await lotOf('B-TRF-A', 'main_store'))?.remaining_qty)).toBe(10);
		expect(Number((await lotOf('ADJ-B1', 'main_store'))?.remaining_qty)).toBe(3);
		const line2 = (await rows('cms_mro_adjustment_lines', 'parent_id = ?', a2.id))[0];
		expect(Number(line2.expected_qty)).toBe(19);
		expect(Number(line2.diff_qty)).toBe(-6);

		// Reconfirm is a no-op; derived stock still equals the balance (no drift).
		const replay = await confirm('adjustments', a1.id as string, { approved_by: APPROVER });
		expect((replay.body.data as Record<string, unknown>).already).toBe(true);
		const onhand = await api('/api/mro/stock/onhand');
		const ohRow = (onhand.body.data as { rows: Array<Record<string, unknown>> }).rows.find(
			(r) => r.model_name === 'Engine Oil 10W-40' && r.location === 'main_store',
		);
		expect(ohRow?.drift).toBe(false);
		expect(Number(ohRow?.qty_on_hand)).toBe(13);
	});

	it('removes serial units and refuses an add while enforcing the two-person rule', async () => {
		// admin_store in-stock serials after the transfer tests: TY-T2 + TY-TEXP (expired) = 2.
		expect(await onHandQty(M_SERIAL, 'admin_store')).toBe(2);

		// Serial ADD is explicitly out of scope → clear 400 (receive via inbound).
		const a1 = await adjustmentDraft([{ item_model: M_SERIAL, direction: 'add', qty: 1 }], {}, 'admin_store');
		expect((await confirm('adjustments', a1.id as string, { approved_by: APPROVER })).status).toBe(400);

		// Remove a real unit by its serial → scrapped, balance 1.
		const a2 = await adjustmentDraft([{ item_model: M_SERIAL, direction: 'remove', qty: 1, serials: ['TY-T2'] }], {}, 'admin_store');
		expect((await confirm('adjustments', a2.id as string, { approved_by: APPROVER })).status).toBe(201);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-T2' AND deleted_at IS NULL"))?.status).toBe('scrapped');
		expect(await onHandQty(M_SERIAL, 'admin_store')).toBe(1);
		const line = (await rows('cms_mro_adjustment_lines', 'parent_id = ?', a2.id))[0];
		expect(Number(line.expected_qty)).toBe(2);
		expect(Number(line.diff_qty)).toBe(-1);

		// The authorizer must differ from the reporter (reported_by REPORTER).
		const self = await adjustmentDraft([{ item_model: M_SERIAL, direction: 'remove', qty: 1, serials: ['TY-TEXP'] }], {}, 'admin_store');
		expect((await confirm('adjustments', self.id as string, { approved_by: REPORTER })).status).toBe(409);
		expect((await confirm('adjustments', self.id as string)).status).toBe(400); // no authorizer supplied
		expect(await onHandQty(M_SERIAL, 'admin_store')).toBe(1); // nothing moved
	});

	it('nudges standard balances +/− and keeps engine writes from authorizing a doc', async () => {
		// safety_store M_STD currently 3 (from the standard transfer test).
		expect(await onHandQty(M_STD, 'safety_store')).toBe(3);

		// Add 5 → balance 8.
		const s1 = await adjustmentDraft([{ item_model: M_STD, direction: 'add', qty: 5 }], {}, 'safety_store');
		expect((await confirm('adjustments', s1.id as string, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_STD, 'safety_store')).toBe(8);
		const line1 = (await rows('cms_mro_adjustment_lines', 'parent_id = ?', s1.id))[0];
		expect(Number(line1.expected_qty)).toBe(3);
		expect(Number(line1.diff_qty)).toBe(5);

		// Remove 4 → balance 4.
		const s2 = await adjustmentDraft([{ item_model: M_STD, direction: 'remove', qty: 4 }], {}, 'safety_store');
		expect((await confirm('adjustments', s2.id as string, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_STD, 'safety_store')).toBe(4);
		const line2 = (await rows('cms_mro_adjustment_lines', 'parent_id = ?', s2.id))[0];
		expect(Number(line2.expected_qty)).toBe(8);
		expect(Number(line2.diff_qty)).toBe(-4);

		// Overshoot (remove more than is on hand) → 409, nothing partial.
		const over = await adjustmentDraft([{ item_model: M_STD, direction: 'remove', qty: 9 }], {}, 'safety_store');
		expect((await confirm('adjustments', over.id as string, { approved_by: APPROVER })).status).toBe(409);
		expect(await onHandQty(M_STD, 'safety_store')).toBe(4);

		// Generic writes still cannot authorize an adjustment; cancelling then authorizing 409s.
		const s3 = await adjustmentDraft([{ item_model: M_STD, direction: 'add', qty: 2 }], {}, 'safety_store');
		const hijack = await api(`/api/entities/mro_adjustments/${s3.id}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'confirmed' }),
		});
		expect(hijack.status).toBeGreaterThanOrEqual(400);
		const cancel = await api(`/api/entities/mro_adjustments/${s3.id}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'cancelled' }),
		});
		expect(cancel.status).toBe(200);
		expect((await confirm('adjustments', s3.id as string, { approved_by: APPROVER })).status).toBe(409);
		expect(await onHandQty(M_STD, 'safety_store')).toBe(4); // nothing moved
	});
});

describe('alerts — reorder flags + per-model expiry windows', () => {
	it('flags below_reorder on /stock/onhand once reorder_level is configured', async () => {
		// admin_store M_STD holds 13 from the standard-items test — a stable row.
		const inv = (await row('cms_mro_inventory', 'model = ? AND location = ? AND deleted_at IS NULL', M_STD, 'admin_store')) as Record<
			string,
			unknown
		>;
		expect(inv).toBeTruthy();

		// No reorder configured → no flag.
		const before = await api('/api/mro/stock/onhand');
		const rowBefore = (before.body.data as { rows: Array<Record<string, unknown>> }).rows.find((r) => r.id === inv.id);
		expect(rowBefore?.below_reorder).toBe(false);

		// Configure reorder_level 20 (13 ≤ 20) → flagged; drop to 5 → unflagged.
		const up = await api(`/api/entities/mro_inventory/${inv.id}`, {
			method: 'PUT',
			body: JSON.stringify({ reorder_level: 20 }),
		});
		expect(up.status).toBe(200);
		const low = await api('/api/mro/stock/onhand');
		expect(
			((low.body.data as { rows: Array<Record<string, unknown>> }).rows.find((r) => r.id === inv.id) as Record<string, unknown>)
				.below_reorder,
		).toBe(true);

		const down = await api(`/api/entities/mro_inventory/${inv.id}`, {
			method: 'PUT',
			body: JSON.stringify({ reorder_level: 5 }),
		});
		expect(down.status).toBe(200);
		const ok = await api('/api/mro/stock/onhand');
		expect(
			((ok.body.data as { rows: Array<Record<string, unknown>> }).rows.find((r) => r.id === inv.id) as Record<string, unknown>)
				.below_reorder,
		).toBe(false);
	});

	it('reports days_left + model_alert_days + alert on the expiry feed', async () => {
		// mandalay_store M_BATCH currently holds B-PAST (expired) + B-SOON (+10d);
		// the fixture model's expiry_alert_days is 30. Add a far (+120d) lot.
		const far = await inboundDraft(
			[{ item_model: M_BATCH, qty: 2, batch_no: 'B-FAR2', expiry_date: mmtToday(120) }],
			{ purchase_date: '2026-03-01' },
			'mandalay_store',
		);
		expect((await confirm('inbounds', far.id as string)).status).toBe(201);

		const res = await api('/api/mro/stock/expiring?days=120');
		expect(res.status).toBe(200);
		const data = res.body.data as {
			expired: Array<Record<string, unknown>>;
			expiring: Array<Record<string, unknown>>;
		};
		const soon = data.expiring.find((r) => r.ref === 'B-SOON');
		expect(soon).toBeTruthy();
		expect(soon?.alert).toBe(true); // +10d ≤ model window 30d
		expect(Number(soon?.days_left)).toBeLessThanOrEqual(10);
		expect(Number(soon?.model_alert_days)).toBe(30);
		const farRow = data.expiring.find((r) => r.ref === 'B-FAR2');
		expect(farRow).toBeTruthy(); // within the 120d horizon
		expect(farRow?.alert).toBe(false); // 120d > model window 30d
		expect(Number(farRow?.days_left)).toBe(120);
		const pastLot = data.expired.find((r) => r.ref === 'B-PAST');
		expect(pastLot?.alert).toBe(true); // already expired — always act
		const pastSerial = data.expired.find((r) => r.ref === 'TY-PAST');
		expect(pastSerial?.alert).toBe(true);

		// Outside the model window and the horizon → absent from a 10-day feed.
		const short = await api('/api/mro/stock/expiring?days=10');
		const shortData = short.body.data as { expiring: Array<Record<string, unknown>> };
		expect(shortData.expiring.some((r) => r.ref === 'B-FAR2')).toBe(false);
	});
});

describe('doc-level category read — orders whose lines carry a category', () => {
	const CAT = '91000000-0000-4000-8000-00000000000a';
	const GRP = '92000000-0000-4000-8000-00000000000b';
	const CAT_MODEL = '93000000-0000-4000-8000-00000000000c';
	const STORE = 'safety_store' as const;
	const TYPE = 'purchase' as const;
	let docId: string | null = null;
	let controlId: string | null = null;

	it('categorises a model via item_name → category and returns the doc', async () => {
		// Category + a part-group pointing at it + a fixture model linked to that group.
		await insert('cms_mro_item_categories', { id: CAT, name_en: 'Fixture Cats', name_mm: 'ဖစ်စ်' });
		await insert('cms_mro_item_name', { id: GRP, name_en: 'Fixture Part', category: CAT });
		await insert('cms_mro_item_model', {
			id: CAT_MODEL,
			name_en: 'Categorized Item',
			expiry_alert_days: 30,
			item_name: GRP,
		});

		// Two purchase inbounds at safety_store: one with the CATEGORIZED model,
		// one control line on an UNCATEGORIZED model (M_BATCH's item name carries
		// no category).
		const categorized = await inboundDraft([{ item_model: CAT_MODEL, qty: 3 }], {}, STORE);
		docId = categorized.id as string;
		const control = await inboundDraft([{ item_model: M_BATCH, qty: 1 }], {}, STORE);
		controlId = control.id as string;
		expect(docId).toBeTruthy();
		expect(controlId).toBeTruthy();
	});

	it('GET /api/mro/documents/category returns only matching doc headers', async () => {
		const res = await api(`/api/mro/documents/category?kind=inbounds&category=${CAT}&location=${STORE}&type=${TYPE}`);
		expect(res.status).toBe(200);
		const rows = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;
		const ids = rows.map((r) => r.id);
		expect(ids).toContain(docId);
		expect(ids).not.toContain(controlId);
		// The returned doc is a header in card projection (display_number present).
		const mine = rows.find((r) => r.id === docId);
		expect(mine?.display_number).toBeTruthy();
		expect(mine?.type).toBe(TYPE);
		expect('location' in (mine ?? {})).toBe(true);

		// No outbounds should match anything yet (no outbound with a categorized line).
		const out = await api(`/api/mro/documents/category?kind=outbounds&category=${CAT}&location=${STORE}&type=goods_issue`);
		const outData = out.body.data as { rows: Array<Record<string, unknown>> };
		expect(outData.rows.every((r) => r.id !== docId)).toBe(true);
	});

	it('rejects missing/invalid parameters', async () => {
		expect((await api(`/api/mro/documents/category?kind=inbounds&category=${CAT}&location=${STORE}`)).status).toBe(400);
		expect((await api('/api/mro/documents/category?kind=other&category=x&location=y&type=z')).status).toBe(400);
	});
});

describe('vehicle-bound issue — a goods-issue off a REQ that names a truck stamps each serial unit', () => {
	const loc = 'vehicle_store' as const;

	it('stamps vehicle on issued serials, clears on rollback, and never stamps non-vehicle issues', async () => {
		// A lone, unattributed request must NOT creep any vehicle onto the units.
		const plain = await requisitionDraft([{ item_model: M_SERIAL, qty: 1 }], {}, loc);
		expect((await confirm('requisitions', plain.id as string)).status).toBe(201);

		// Stock the loc with two serials we own for this test only.
		const beforeSeed = await onHandQty(M_SERIAL, loc);
		const seed = await inboundDraft([{ item_model: M_SERIAL, qty: 2, serials: ['TY-VH1', 'TY-VH2'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(beforeSeed + 2);

		// A request naming a truck (veh_fleets.V_FLEET).
		const req = await requisitionDraft([{ item_model: M_SERIAL, qty: 1 }], { vehicle: V_FLEET }, loc);
		expect((await confirm('requisitions', req.id as string)).status).toBe(201);

		// Issue one unit off that request → the unit is issued AND attributes TRK-X.
		const o = await outboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-VH1'] }], { request: req.id }, loc);
		expect((await confirm('outbounds', o.id as string, { issued_by: APPROVER })).status).toBe(201);
		const fitted = await row('cms_mro_stock_serials', "serial_no = 'TY-VH1' AND deleted_at IS NULL");
		expect(fitted?.status).toBe('issued');
		expect(fitted?.vehicle).toBe(V_FLEET);
		// The second serial was left in stock, unattributed.
		const loose = await row('cms_mro_stock_serials', "serial_no = 'TY-VH2' AND deleted_at IS NULL");
		expect(loose?.status).toBe('in_stock');
		expect(loose?.vehicle == null).toBe(true);

		// Issuing the second unit off a request WITHOUT a truck keeps it unattributed.
		const o2 = await outboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-VH2'] }], { request: plain.id }, loc);
		expect((await confirm('outbounds', o2.id as string, { issued_by: APPROVER })).status).toBe(201);
		const unattributed = await row('cms_mro_stock_serials', "serial_no = 'TY-VH2' AND deleted_at IS NULL");
		expect(unattributed?.status).toBe('issued');
		expect(unattributed?.vehicle == null).toBe(true);
	});
});

describe('goods-issue destination — the header NAMES the holder and the units land in it', () => {
	const loc = 'admin_store' as const;
	// A truck only this suite touches, so its holder register is exactly what this
	// test put there (no cross-suite row can make an assertion pass by accident).
	const V_DST = 'aaaaaaa5-5555-4555-a555-555555555555';

	it('hands units to a truck inventory or a person, refuses a nonsense destination, and lets the document override a request', async () => {
		await insert('cms_veh_fleets', { id: V_DST, plate_no: 'TRK-DST' });

		// Stock four units in a location only this suite touches.
		const before = await onHandQty(M_SERIAL, loc);
		const seed = await inboundDraft([{ item_model: M_SERIAL, qty: 4, serials: ['TY-DST-1', 'TY-DST-2', 'TY-DST-3', 'TY-DST-4'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 4);

		const serialId = async (no: string) =>
			String((await row('cms_mro_stock_serials', 'serial_no = ? AND deleted_at IS NULL', no))?.id ?? '');

		// 1) To a TRUCK — a STANDALONE issue (no request), so the destination on the
		//    header is the only thing that can decide the holder.
		const toTruck = await outboundDraft([{ item_model: M_SERIAL, qty: 2, serials: ['TY-DST-1', 'TY-DST-2'] }], { to_vehicle: V_DST }, loc);
		expect((await confirm('outbounds', toTruck.id as string, { issued_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 2);

		for (const no of ['TY-DST-1', 'TY-DST-2']) {
			const unit = await row('cms_mro_stock_serials', 'serial_no = ? AND deleted_at IS NULL', no);
			expect(unit?.status).toBe('issued');
			expect(unit?.vehicle).toBe(V_DST);
			// The truck's INVENTORY, not a wheel seat — the board fits it later.
			expect(unit?.slot == null).toBe(true);
			expect(unit?.employee == null).toBe(true);
		}

		// The truck's own registry read lists them as slot-less spares, display-ready.
		const truckRead = await api(`/api/mro/assets/holder?vehicle=${V_DST}`);
		expect(truckRead.status).toBe(200);
		const truckUnits = (truckRead.body.data as { rows: Array<Record<string, unknown>> }).rows;
		expect(truckUnits.map((r) => r.serial_no).sort()).toEqual(['TY-DST-1', 'TY-DST-2']);
		expect(truckUnits.every((r) => r.slot == null && r.plate_no === 'TRK-DST')).toBe(true);
		// `kind` is DERIVED (a new-tread baseline, or a wheel seat); this fixture's SKU
		// declares no baseline and the unit rides slot-less, so it is a generic asset —
		// a REAL tyre SKU carries `reference_tread_mm` and reads `tyre` off the same rule.
		expect(truckUnits.every((r) => r.kind === 'asset')).toBe(true);

		// ONE `fitted` history row per unit, attributed to the document + the issuer.
		const fittedEvents = await rows(
			'cms_mro_serial_events',
			"serial = ? AND event = 'fitted' AND deleted_at IS NULL",
			await serialId('TY-DST-1'),
		);
		expect(fittedEvents).toHaveLength(1);
		expect(fittedEvents[0]?.to_vehicle).toBe(V_DST);
		expect(fittedEvents[0]?.ref_kind).toBe('goods_issue');
		expect(fittedEvents[0]?.by_user).toBe(APPROVER);

		// 2) To an EMPLOYEE — the person TAKES CUSTODY, which is a DIFFERENT event.
		const toPerson = await outboundDraft([{ item_model: M_SERIAL, qty: 1, serials: ['TY-DST-3'] }], { to_employee: REPORTER }, loc);
		expect((await confirm('outbounds', toPerson.id as string, { issued_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 1);

		const held = await row('cms_mro_stock_serials', "serial_no = 'TY-DST-3' AND deleted_at IS NULL");
		expect(held?.status).toBe('issued');
		expect(held?.employee).toBe(REPORTER);
		expect(held?.vehicle == null).toBe(true);

		const empRead = await api(`/api/mro/assets/holder?employee=${REPORTER}`);
		expect(empRead.status).toBe(200);
		expect((empRead.body.data as { rows: Array<Record<string, unknown>> }).rows.map((r) => r.serial_no)).toContain('TY-DST-3');
		// The two destinies are EXCLUSIVE — a person's unit is on no truck.
		expect(truckUnits.map((r) => r.serial_no)).not.toContain('TY-DST-3');

		const issuedEvents = await rows(
			'cms_mro_serial_events',
			"serial = ? AND event = 'issued' AND deleted_at IS NULL",
			String(held?.id ?? ''),
		);
		expect(issuedEvents).toHaveLength(1);
		expect(issuedEvents[0]?.to_employee).toBe(REPORTER);
		expect(issuedEvents[0]?.to_vehicle == null).toBe(true);

		// 3) A destination where it cannot mean anything is REFUSED, not ignored: a
		//    write-off hands units to nobody, and one document names ONE destination.
		const scrapping = await outboundDraft(
			[{ item_model: M_SERIAL, qty: 1, serials: ['TY-DST-4'] }],
			{ type: 'write_offs', to_vehicle: V_DST },
			loc,
		);
		const badKind = await confirm('outbounds', scrapping.id as string, { issued_by: APPROVER });
		expect(badKind.status).toBe(400);
		expect(badKind.body?.error).toMatch(/goods issue/i);

		const both = await outboundDraft(
			[{ item_model: M_SERIAL, qty: 1, serials: ['TY-DST-4'] }],
			{ to_vehicle: V_DST, to_employee: REPORTER },
			loc,
		);
		const bothSet = await confirm('outbounds', both.id as string, { issued_by: APPROVER });
		expect(bothSet.status).toBe(400);
		expect(bothSet.body?.error).toMatch(/one destination/i);

		// Both refusals left the unit exactly where the store had it (no half-write).
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 1);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-DST-4' AND deleted_at IS NULL"))?.status).toBe('in_stock');

		// 4) An EXPLICIT destination BEATS the request's own truck: the more specific,
		//    more recent decision is the one the document shows, so a request-bound
		//    issue to a person does not silently go to the truck instead.
		const req = await requisitionDraft([{ item_model: M_SERIAL, qty: 1 }], { vehicle: V_DST }, loc);
		expect((await confirm('requisitions', req.id as string)).status).toBe(201);
		const overridden = await outboundDraft(
			[{ item_model: M_SERIAL, qty: 1, serials: ['TY-DST-4'] }],
			{ request: req.id, to_employee: REPORTER },
			loc,
		);
		expect((await confirm('outbounds', overridden.id as string, { issued_by: APPROVER })).status).toBe(201);
		const last = await row('cms_mro_stock_serials', "serial_no = 'TY-DST-4' AND deleted_at IS NULL");
		expect(last?.employee).toBe(REPORTER);
		expect(last?.vehicle == null).toBe(true);
		// All four units have left the store — nothing was issued twice or stranded.
		expect(await onHandQty(M_SERIAL, loc)).toBe(before);
	});
});

describe('asset holder — GET /api/mro/assets/holder is the one server-scoped asset read', () => {
	it('seats an issued unit through the real move route, then lists the holder assets display-ready', async () => {
		// TY-VH1 is issued on TRK-X (seeded by the vehicle-bound describe above but
		// NOT yet seated — a goods-issue stamps the truck, not a wheel position).
		const seated = await row('cms_mro_stock_serials', "serial_no = 'TY-VH1' AND deleted_at IS NULL");
		expect(seated?.status).toBe('issued');
		expect(seated?.vehicle).toBe(V_FLEET);

		// Seat it into a position through the REAL /move route (same truck → rotated).
		const fit = await api(`/api/mro/serials/${seated!.id as string}/move`, {
			method: 'POST',
			body: JSON.stringify({ to_vehicle: V_FLEET, to_slot: 'steer-l', actor_id: APPROVER, note: 'seat on board' }),
		});
		expect(fit.status, fit.body?.error ?? '').toBe(201);

		// The holder read = the truck's asset units; the seated one is the only one
		// carrying a slot (TY-VH2 etc. are tray spares).
		const res = await api(`/api/mro/assets/holder?vehicle=${V_FLEET}`);
		expect(res.status).toBe(200);
		const rows = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;
		const seatedRows = rows.filter((r) => r.slot != null);
		expect(seatedRows.map((r) => r.serial_no)).toEqual(['TY-VH1']);

		// Display-ready: SKU name + plate + item group resolved server-side — the
		// client needs no register walk and no catalog/plate join for the board.
		const unit = seatedRows[0] as Record<string, unknown>;
		expect(unit.id).toBe(seated?.id);
		expect(unit.model).toBe(M_SERIAL);
		expect(unit.model_name).toBe('Tyre 11R22.5');
		// A SKU with no photo yet reports null — the card then keeps its kind glyph,
		// so the column can never fabricate a URL the media route would 404 on.
		expect(unit.model_image).toBeNull();
		expect(unit.item_name).toBe(G_SERIAL);
		expect(unit.item_name_en).toBe('Tyre 11R22.5 Group');
		expect(unit.reference_tread_mm == null).toBe(true); // seeded model has none
		expect(unit.kind).toBe('tyre');
		expect(unit.vehicle).toBe(V_FLEET);
		expect(unit.plate_no).toBe('TRK-X');
		expect(unit.slot).toBe('steer-l');
		expect(unit.status).toBe('issued');
		expect(unit).toHaveProperty('location');
		expect(unit).toHaveProperty('condition');
	});
});

describe('tyre inspection — POST /api/mro/serials/:id/check records a measured reading', () => {
	const loc = 'admin_store' as const;

	it('measures tread/pressure on an issued tyre, writes a checked event, and guards misuse', async () => {
		// Seed + fit one vehicle-bound serial tyre through the REAL confirm flows
		// (the only legit writers) so it ends up issued on a truck.
		const seedIn = await inboundDraft([{ item_model: M_SERIAL, qty: 3, serials: ['TY-CHK-1', 'TY-CHK-2', 'TY-CHK-3'] }], {}, loc);
		expect((await confirm('inbounds', seedIn.id as string)).status, 'seed inbound').toBe(201);
		// A truck-named request authorises attributing the first two units.
		const req = await requisitionDraft([{ item_model: M_SERIAL, qty: 2 }], { vehicle: V_FLEET }, loc);
		expect((await confirm('requisitions', req.id as string)).status).toBe(201);
		const out = await outboundDraft([{ item_model: M_SERIAL, qty: 2, serials: ['TY-CHK-1', 'TY-CHK-2'] }], { request: req.id }, loc);
		expect((await confirm('outbounds', out.id as string, { issued_by: APPROVER })).status, 'issue two').toBe(201);

		const fitted = await row('cms_mro_stock_serials', "serial_no = 'TY-CHK-1' AND deleted_at IS NULL");
		const loose = await row('cms_mro_stock_serials', "serial_no = 'TY-CHK-3' AND deleted_at IS NULL");
		expect(fitted?.status).toBe('issued');

		// A legitimate reading — the unit is issued/fitted.
		const ok = await api(`/api/mro/serials/${fitted!.id as string}/check`, {
			method: 'POST',
			body: JSON.stringify({ tread_mm: 12.5, psi: 105, actor_id: APPROVER, note: 'monthly tyre check' }),
		});
		expect(ok.status, ok.body?.error ?? '').toBe(201);

		// The live snapshot advanced to exactly the measured value.
		const after = await row('cms_mro_stock_serials', "serial_no = 'TY-CHK-1' AND deleted_at IS NULL");
		expect(Number(after?.tread_mm)).toBe(12.5);
		expect(Number(after?.psi)).toBe(105);
		expect(after?.status).toBe('issued'); // reading never alters track/status

		// ONE immutable `checked` event with the measurement landed in history.
		const evs = await rows('cms_mro_serial_events', "serial = ? AND event = 'checked' AND deleted_at IS NULL", fitted!.id as string);
		expect(evs).toHaveLength(1);
		expect(Number(evs[0]?.tread_mm)).toBe(12.5);
		expect(Number(evs[0]?.psi)).toBe(105);

		// A second measurement records the LATEST reading (history keeps both). The
		// condition grade rides the same snapshot, so a jack/toolbox can be graded too.
		const ok2 = await api(`/api/mro/serials/${fitted!.id as string}/check`, {
			method: 'POST',
			body: JSON.stringify({ tread_mm: 11.2, condition: 'fair', actor_id: APPROVER }),
		});
		expect(ok2.status, ok2.body?.error ?? '').toBe(201);
		expect(Number((await row('cms_mro_stock_serials', "serial_no = 'TY-CHK-1' AND deleted_at IS NULL"))?.tread_mm)).toBe(11.2);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-CHK-1' AND deleted_at IS NULL"))?.condition).toBe('fair');
		expect(
			(await rows('cms_mro_serial_events', "serial = ? AND event = 'checked' AND deleted_at IS NULL", fitted!.id as string)).length,
		).toBe(2);

		// Guard: an in-stock (not issued) unit has no wear to measure → 409.
		const bad = await api(`/api/mro/serials/${loose!.id as string}/check`, {
			method: 'POST',
			body: JSON.stringify({ tread_mm: 12 }),
		});
		expect(bad.status, bad.body?.error ?? '').toBe(409);

		// Guard: a reading with NO tread/psi/condition value is rejected → 400.
		const empty = await api(`/api/mro/serials/${fitted!.id as string}/check`, {
			method: 'POST',
			body: JSON.stringify({ note: 'no numbers' }),
		});
		expect(empty.status, empty.body?.error ?? '').toBe(400);
	});

	it('refuses a reading thicker than the SKU’s new-tread baseline — and writes nothing', async () => {
		// A SKU that DECLARES its new-tread depth (15 mm). The ceiling is a property of
		// the catalog, so a SKU without a baseline (M_SERIAL above) has none to cap
		// against — this one does. Fresh serials keep the test independent of the
		// shared per-location balances the earlier describes leave behind.
		const CAP_MDL = '33333333-3333-4333-8333-33333333ca01';
		await insert('cms_mro_item_model', {
			id: CAP_MDL,
			name_en: 'Tyre 315/80R22.5',
			item_name: G_SERIAL,
			reference_tread_mm: 15,
		});
		const seed = await inboundDraft([{ item_model: CAP_MDL, qty: 1, serials: ['TY-CAP-1'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status, 'seed inbound').toBe(201);
		const out = await outboundDraft([{ item_model: CAP_MDL, qty: 1, serials: ['TY-CAP-1'] }], {}, loc);
		expect((await confirm('outbounds', out.id as string, { issued_by: APPROVER })).status, 'issue it').toBe(201);
		const unit = await row('cms_mro_stock_serials', "serial_no = 'TY-CAP-1' AND deleted_at IS NULL");
		expect(unit?.status).toBe('issued');

		// The baseline itself is a legal reading — a brand-new tyre measures exactly its
		// new-tread depth, so the ceiling is inclusive.
		const atCap = await api(`/api/mro/serials/${unit!.id as string}/check`, {
			method: 'POST',
			body: JSON.stringify({ tread_mm: 15, actor_id: APPROVER }),
		});
		expect(atCap.status, atCap.body?.error ?? '').toBe(201);

		// Thicker than brand new is impossible → 400, and NOTHING is written: the live
		// snapshot keeps the last legal reading and no new event is appended.
		const over = await api(`/api/mro/serials/${unit!.id as string}/check`, {
			method: 'POST',
			body: JSON.stringify({ tread_mm: 15.1, actor_id: APPROVER }),
		});
		expect(over.status, over.body?.error ?? '').toBe(400);
		expect(String(over.body?.error ?? '')).toMatch(/new-tread reading of 15 mm/);
		expect(Number((await row('cms_mro_stock_serials', "serial_no = 'TY-CAP-1' AND deleted_at IS NULL"))?.tread_mm)).toBe(15);
		expect(
			(await rows('cms_mro_serial_events', "serial = ? AND event = 'checked' AND deleted_at IS NULL", unit!.id as string)).length,
		).toBe(1);
	});
});

describe('parts movement — confirmed in/out/transfer lines feed the models + ledger reads', () => {
	const MV_GRP = '92000000-0000-4000-8000-0000000000d1';
	const MV_MODEL = '93000000-0000-4000-8000-0000000000d2';

	it('seeds a categorised model + in/out/transfer movement (plus a control)', async () => {
		// A part-group + one model under it; M_STD stays out of the group (control).
		await insert('cms_mro_item_name', { id: MV_GRP, name_en: 'Movement Part' });
		await insert('cms_mro_item_model', {
			id: MV_MODEL,
			name_en: 'Movement Item',
			item_name: MV_GRP,
		});

		// IN 10 at main_store → TRF 3 main→admin → OUT 2 from main (leaves 5/3).
		const inb = await inboundDraft([{ item_model: MV_MODEL, qty: 10, unit_price: 1000 }], { purchase_date: '2026-09-01' });
		expect((await confirm('inbounds', inb.id as string)).status).toBe(201);
		const trf = await transferDraft([{ item_model: MV_MODEL, qty: 3 }], {}, 'main_store', 'admin_store');
		expect((await confirm('transfers', trf.id as string, { approved_by: APPROVER })).status).toBe(201);
		const out = await outboundDraft([{ item_model: MV_MODEL, qty: 2 }]);
		expect((await confirm('outbounds', out.id as string)).status).toBe(201);

		// Control movement — a model OUTSIDE the group must never match group reads.
		const ctrl = await inboundDraft([{ item_model: M_STD, qty: 1 }]);
		expect((await confirm('inbounds', ctrl.id as string)).status).toBe(201);
	});

	it('GET /api/mro/movement/models returns only the group model with direction totals', async () => {
		const res = await api(`/api/mro/movement/models?group=${MV_GRP}`);
		expect(res.status).toBe(200);
		const rows = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;
		expect(rows).toHaveLength(1);
		expect(rows[0]?.model).toBe(MV_MODEL);
		expect(rows[0]?.model_name).toBe('Movement Item');
		expect(Number(rows[0]?.total_in)).toBe(10);
		expect(Number(rows[0]?.total_out)).toBe(2);
		expect(Number(rows[0]?.total_trf)).toBe(3);
		expect(Number(rows[0]?.doc_count)).toBe(3);
		expect(Number(rows[0]?.line_count)).toBe(3);
		expect(rows[0]?.last_date).toBeTruthy();

		// Direction tabs narrow the model SET — every direction still matches.
		for (const direction of ['in', 'out', 'trf']) {
			const narrow = await api(`/api/mro/movement/models?group=${MV_GRP}&direction=${direction}`);
			const narrowRows = (narrow.body.data as { rows: Array<Record<string, unknown>> }).rows;
			expect(narrow.status).toBe(200);
			expect(narrowRows.map((r) => r.model)).toEqual([MV_MODEL]);
		}

		// Store scope — admin_store matches only the TRF line; the control model
		// (main_store) is excluded either way.
		const admin = await api(`/api/mro/movement/models?group=${MV_GRP}&location=admin_store`);
		const adminRows = (admin.body.data as { rows: Array<Record<string, unknown>> }).rows;
		expect(adminRows).toHaveLength(1);
		expect(Number(adminRows[0]?.total_trf)).toBe(3);
		expect(Number(adminRows[0]?.total_in)).toBe(0);

		// A group with no movement is empty; bad params 400.
		expect(((await api(`/api/mro/movement/models?group=${M_STD}`)).body.data as { rows: unknown[] }).rows).toEqual([]);
		expect((await api(`/api/mro/movement/models?group=${MV_GRP}&direction=sideways`)).status).toBe(400);
		expect((await api('/api/mro/movement/models')).status).toBe(400);

		// The row set is KEYSET-PAGED like every other movement register: a page
		// carries its own `nextCursor` (null once the group is drained) and a
		// malformed cursor is refused instead of silently ignored (which would
		// re-serve page 1 forever).
		const first = res.body.data as { rows: unknown[]; nextCursor: string | null };
		expect(first).toHaveProperty('nextCursor');
		expect(first.nextCursor).toBeNull(); // one SKU only — nothing more to page
		expect((await api(`/api/mro/movement/models?group=${MV_GRP}&cursor=notacursor`)).status).toBe(400);
	});

	it('GET /api/mro/movement/ledger pages the model lines newest-first with scope summary', async () => {
		const res = await api(`/api/mro/movement/ledger?model=${MV_MODEL}`);
		expect(res.status).toBe(200);
		const data = res.body.data as { rows: Array<Record<string, unknown>>; nextCursor: string | null; summary: Record<string, unknown> };
		expect(data.rows).toHaveLength(3);
		expect(data.nextCursor).toBeNull();
		// The doc creator's name rides on every line (null when the user is gone).
		expect(data.rows[0]).toHaveProperty('created_name');

		const byDirection = Object.fromEntries(data.rows.map((r) => [r.direction, r]));
		expect(byDirection['in']?.doc_no).toMatch(/^INB-/);
		// Every line also carries its source DOC's id — the tap target that opens the
		// document instead of leaving the row a dead end (`doc_no` alone cannot route).
		for (const line of data.rows) {
			expect(typeof line.doc_id).toBe('string');
			expect(String(line.doc_id).length).toBeGreaterThan(0);
		}
		expect(byDirection['in']?.date).toBe('2026-09-01');
		expect(byDirection['in']?.unit_price).toBe(1000);
		expect(byDirection['out']?.doc_no).toMatch(/^OUT-/);
		expect(byDirection['trf']?.doc_no).toMatch(/^TRF-/);
		expect(byDirection['trf']?.from_location).toBe('main_store');
		expect(byDirection['trf']?.to_location).toBe('admin_store');
		expect(byDirection['trf']?.location).toBeNull();
		expect(byDirection['trf']?.kind).toBe('transfer');

		// Newest-first ordering — both today docs (out/trf) precede the 09-01 inbound.
		const dates = data.rows.map((r) => String(r.date));
		expect([...dates].sort().reverse()).toEqual(dates);

		// The summary covers the SAME scope (all stores) and on-hand matches the
		// live inventory rows (5 main + 3 admin).
		expect(Number(data.summary.total_in)).toBe(10);
		expect(Number(data.summary.total_out)).toBe(2);
		expect(Number(data.summary.total_trf)).toBe(3);
		expect(Number(data.summary.doc_count)).toBe(3);
		expect(Number(data.summary.line_count)).toBe(3);
		expect(Number(data.summary.on_hand)).toBe(8);

		// Direction + store filters narrow the ledger and its summary together.
		const onlyIn = await api(`/api/mro/movement/ledger?model=${MV_MODEL}&direction=in`);
		const inData = onlyIn.body.data as { rows: Array<Record<string, unknown>>; summary: Record<string, unknown> };
		expect(inData.rows.map((r) => r.direction)).toEqual(['in']);
		expect(Number(inData.summary.total_out)).toBe(0);

		const atAdmin = await api(`/api/mro/movement/ledger?model=${MV_MODEL}&location=admin_store`);
		const adminData = atAdmin.body.data as { rows: Array<Record<string, unknown>>; summary: Record<string, unknown> };
		expect(adminData.rows.map((r) => r.direction)).toEqual(['trf']);
		expect(Number(adminData.summary.on_hand)).toBe(3);

		expect((await api(`/api/mro/movement/ledger?model=${MV_MODEL}&direction=nope`)).status).toBe(400);
		expect((await api('/api/mro/movement/ledger')).status).toBe(400);
		expect((await api(`/api/mro/movement/ledger?model=${MV_MODEL}&cursor=garbage~nope`)).status).toBe(200);
		expect((await api(`/api/mro/movement/ledger?model=${MV_MODEL}&cursor=badcursor`)).status).toBe(400);
	});

	it('names a line’s creator from the EMPLOYEE — the same way for a Telegram and a web sign-in', async () => {
		// One employee, two ways in. A Telegram identity's link IS its `tg-<id>`
		// address (`hrm_employees.etg_id`); a WEB account links through
		// `_users.employee_id`. Each login row carries a DIFFERENT `full_name` from the
		// directory's, so a read that fell back to the login row's own name could not
		// pass — and the SAME act must read the same name whichever way they signed in.
		const EMP = '94000000-0000-4000-8000-0000000000e1';
		const TG_ID = '994001';
		const TG_USER = '94000000-0000-4000-8000-0000000000e2';
		const WEB_USER = '94000000-0000-4000-8000-0000000000e3';
		const LEGACY_USER = '94000000-0000-4000-8000-0000000000e4';
		await insert('cms_hrm_employees', { id: EMP, name_en: 'Directory English', name_mm: 'ဒါရိုက်တာ', etg_id: TG_ID });
		await insert('_users', {
			id: TG_USER,
			email: `tg-${TG_ID}@telegram.local`,
			full_name: 'Stale Telegram Name',
			password_hash: 'x',
			status: 'active',
		});
		await insert('_users', {
			id: WEB_USER,
			email: 'web.actor@test.local',
			full_name: 'Admin Typed Name',
			password_hash: 'x',
			status: 'active',
			employee_id: EMP,
		});
		// An account with NEITHER link (a machine key / legacy row) keeps its own name
		// rather than rendering blank.
		await insert('_users', {
			id: LEGACY_USER,
			email: 'legacy.actor@test.local',
			full_name: 'Legacy Actor',
			password_hash: 'x',
			status: 'active',
		});

		// Re-point each confirmed document at one account. Raw SQL on purpose: the READ
		// is what is under test, not the write path.
		const repoint = async (lineTable: string, docTable: string, userId: string) => {
			const line = await row(lineTable, 'item_model = ?', MV_MODEL);
			expect(line?.parent_id, `${lineTable} is seeded by the test above`).toBeTruthy();
			await env.DB.prepare(`UPDATE ${docTable} SET created_by = ? WHERE id = ?`).bind(userId, line?.parent_id).run();
		};
		await repoint('cms_mro_inbound_lines', 'cms_mro_inbounds', TG_USER);
		await repoint('cms_mro_outbound_lines', 'cms_mro_outbounds', WEB_USER);
		await repoint('cms_mro_transfer_lines', 'cms_mro_transfers', LEGACY_USER);

		const res = await api(`/api/mro/movement/ledger?model=${MV_MODEL}`);
		expect(res.status).toBe(200);
		const data = res.body.data as { rows: Array<Record<string, unknown>> };
		const byDirection = Object.fromEntries(data.rows.map((r) => [r.direction, r]));

		// Both sign-in kinds resolve to the SAME employee, named from the directory.
		expect(byDirection['in']?.created_name, 'a Telegram session').toBe('ဒါရိုက်တာ');
		expect(byDirection['out']?.created_name, 'a web session for the same employee').toBe('ဒါရိုက်တာ');
		// Neither login row's own name leaks through.
		expect(byDirection['in']?.created_name).not.toBe('Stale Telegram Name');
		expect(byDirection['out']?.created_name).not.toBe('Admin Typed Name');
		// No link at all → the login row's own name, never blank.
		expect(byDirection['trf']?.created_name).toBe('Legacy Actor');
	});

	it('GET /api/mro/movement/lines returns the group line feed with model names', async () => {
		const res = await api(`/api/mro/movement/lines?group=${MV_GRP}`);
		expect(res.status).toBe(200);
		const data = res.body.data as { rows: Array<Record<string, unknown>>; nextCursor: string | null };
		expect(data.rows).toHaveLength(3);
		expect(data.nextCursor).toBeNull();
		expect(data.rows.every((r) => r.model_name === 'Movement Item')).toBe(true);
		expect(data.rows.map((r) => r.direction)).toEqual(expect.arrayContaining(['in', 'out', 'trf']));

		// Direction + store narrowing behave like the single-model ledger.
		const onlyIn = await api(`/api/mro/movement/lines?group=${MV_GRP}&direction=in`);
		const inRows = (onlyIn.body.data as { rows: Array<Record<string, unknown>> }).rows;
		expect(inRows).toHaveLength(1);
		expect(inRows[0]?.direction).toBe('in');

		const atAdmin = await api(`/api/mro/movement/lines?group=${MV_GRP}&location=admin_store`);
		const adminRows = (atAdmin.body.data as { rows: Array<Record<string, unknown>> }).rows;
		expect(adminRows).toHaveLength(1);
		expect(adminRows[0]?.direction).toBe('trf');

		// A group without movement is an empty feed; a missing group 400s.
		expect((await api(`/api/mro/movement/lines?group=${M_STD}`)).body.data).toEqual({ rows: [], nextCursor: null });
		expect((await api('/api/mro/movement/lines')).status).toBe(400);
	});

	it('GET /api/mro/movement/groups lists only item-name masters that have confirmed movement', async () => {
		// A control master + model with NO movement — never appears in the directory.
		const quietGroup = '92000000-0000-4000-8000-0000000000f1';
		const quietModel = '93000000-0000-4000-8000-0000000000f2';
		await insert('cms_mro_item_name', { id: quietGroup, name_en: 'Quiet Master' });
		await insert('cms_mro_item_model', { id: quietModel, name_en: 'Quiet Item', item_name: quietGroup });

		const res = await api('/api/mro/movement/groups');
		expect(res.status).toBe(200);
		const data = res.body.data as { rows: Array<Record<string, unknown>>; nextCursor: string | null };
		expect(data.nextCursor).toBeNull();
		expect(data.rows.length).toBeGreaterThanOrEqual(1);
		// The seeded moving master is listed; the no-movement control is not.
		expect(data.rows.map((r) => r.id)).toContain(MV_GRP);
		expect(data.rows.map((r) => r.id)).not.toContain(quietGroup);
		// The directory is name-sorted and carries the display-name columns.
		expect(data.rows[0]).toHaveProperty('name_en');
		expect(data.rows[0]).toHaveProperty('name_mm');

		// A malformed cursor 400s; an unknown/bogus cursor is caught server-side.
		expect((await api('/api/mro/movement/groups?cursor=bad')).status).toBe(400);
		expect((await api('/api/mro/movement/groups?cursor=a%20b~nope')).status).toBe(200);
	});

	it('GET /api/mro/movement/groups?search= narrows the kiosk type-ahead server-side', async () => {
		const idsOf = async (query: string): Promise<string[]> => {
			const res = await api(`/api/mro/movement/groups?search=${encodeURIComponent(query)}`);
			expect(res.status).toBe(200);
			return (res.body.data as { rows: Array<Record<string, unknown>> }).rows.map((r) => String(r.id));
		};

		// The group's OWN name matches (case-insensitively — SQLite LIKE is ASCII-CI).
		expect(await idsOf('Movement Part')).toContain(MV_GRP);
		expect(await idsOf('movement part')).toContain(MV_GRP);
		expect(await idsOf('Movement')).toContain(MV_GRP);

		// A MODEL name under the group matches too — a full-SKU fragment still finds
		// the group that SKU belongs to.
		expect(await idsOf('Movement Item')).toContain(MV_GRP);

		// A name match on a group with NO movement is never returned.
		expect(await idsOf('Quiet Master')).not.toContain('92000000-0000-4000-8000-0000000000f1');

		// No match is an empty page (not an error); a blank term is ignored.
		expect(await idsOf('zzzznomatch')).toEqual([]);
		expect((await api('/api/mro/movement/groups?search=')).status).toBe(200);

		// LIKE wildcards in the term are escaped — '%' matches literally, not everything.
		expect(await idsOf('%')).not.toContain(MV_GRP);
	});
});

describe('catalogue directory — GET /api/mro/catalog/groups lists masters with live SKUs + counts', () => {
	// Runs AFTER the parts-movement fixtures above (same worker, sequential) so
	// the moving group/quiet group the movement tests seeded are already live.
	const CAT_GRP = '92000000-0000-4000-8000-0000000000e1';
	const CAT_MODEL_A = '93000000-0000-4000-8000-0000000000e2';
	const CAT_MODEL_B = '93000000-0000-4000-8000-0000000000e3';
	const CAT_EMPTY = '92000000-0000-4000-8000-0000000000e4';

	it('returns every master (counted + name-sorted), including SKU-less masters', async () => {
		// One master with TWO SKUs + a master with NO SKUs (the SKU-less control).
		// The SKU-less master must STILL be listed (count 0) — the hub is the only
		// place a group is managed, so a freshly created group may not vanish.
		await insert('cms_mro_item_name', { id: CAT_GRP, name_en: 'AA Catalog Group' });
		await insert('cms_mro_item_model', {
			id: CAT_MODEL_A,
			name_en: 'Cat Item A',
			item_name: CAT_GRP,
		});
		await insert('cms_mro_item_model', {
			id: CAT_MODEL_B,
			name_en: 'Cat Item B',
			item_name: CAT_GRP,
		});
		await insert('cms_mro_item_name', { id: CAT_EMPTY, name_en: 'Empty Master' });

		const res = await api('/api/mro/catalog/groups');
		expect(res.status).toBe(200);
		const rows = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;

		// The seeded master carries its LIVE-SKU count; the no-SKU master is listed too.
		const seeded = rows.find((r) => r.id === CAT_GRP);
		expect(seeded).toBeTruthy();
		expect(Number(seeded?.count)).toBe(2);
		expect(seeded?.name).toBe('AA Catalog Group');
		expect(seeded?.name_en).toBe('AA Catalog Group');
		const empty = rows.find((r) => r.id === CAT_EMPTY);
		expect(empty).toBeTruthy();
		expect(Number(empty?.count)).toBe(0);

		// A whole-catalogue directory (unlike the movement-scoped one): the moving
		// group AND its quiet (no-movement) control both appear — each has live SKUs.
		const ids = rows.map((r) => r.id);
		expect(ids).toContain('92000000-0000-4000-8000-0000000000d1');
		expect(ids).toContain('92000000-0000-4000-8000-0000000000f1');

		// Every row carries a NON-NEGATIVE count (SKU-less groups read 0) and the
		// display-name columns. The order is the hub's CATEGORY-major contract: an
		// uncategorised group sorts LAST, then category name ASC, then the group's own
		// name ASC, then id — mirroring the server's ORDER BY, so the mini app can fold
		// the trailing run into its "Uncategorized" section without re-sorting.
		for (const row of rows) expect(Number(row.count)).toBeGreaterThanOrEqual(0);
		expect(rows[0]).toHaveProperty('name');
		expect(rows[0]).toHaveProperty('name_mm');
		const keyed = rows.map((r) => ({
			uncategorised: r.category_name_en == null ? 1 : 0,
			category: r.category_name_en == null ? '' : String(r.category_name_en).toLowerCase(),
			name: r.name_en == null ? '' : String(r.name_en).toLowerCase(),
			id: String(r.id),
		}));
		const sorted = [...keyed].sort(
			(a, b) =>
				a.uncategorised - b.uncategorised ||
				(a.category < b.category ? -1 : a.category > b.category ? 1 : 0) ||
				(a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
				(a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
		);
		expect(keyed).toEqual(sorted);
	});
});

describe('tyre kiosk chore — fit / swap / return / scrap writers log the whole wheel lifecycle', () => {
	const loc = 'safety_store' as const;
	// A second truck, so the same-truck-only swap guard can be exercised end-to-end.
	const V_FLEET2 = 'aaaaaaa2-2222-4222-a222-222222222222';

	// A return is a CUSTODY change, so it goes through the approval gate: file as the
	// operator, decide + execute as their recorded superior (the shared harness above).
	beforeAll(mintReturnActors);

	it('seats store tyres, rotates two on one truck, refuses a cross-truck swap, returns one and scraps another — each with history', async () => {
		await insert('cms_veh_fleets', { id: V_FLEET2, plate_no: 'TRK-Y' });

		// Stock FOUR serials we own, in a location only this test touches.
		const before = await onHandQty(M_SERIAL, loc);
		const seed = await inboundDraft([{ item_model: M_SERIAL, qty: 4, serials: ['TY-KSK-1', 'TY-KSK-2', 'TY-KSK-3', 'TY-KSK-4'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 4);

		const serialId = async (no: string) =>
			String((await row('cms_mro_stock_serials', 'serial_no = ? AND deleted_at IS NULL', no))?.id ?? '');
		const k1 = await serialId('TY-KSK-1');
		const k2 = await serialId('TY-KSK-2');
		const k3 = await serialId('TY-KSK-3');
		const k4 = await serialId('TY-KSK-4');
		const eventsOf = async (sid: string, kind?: string) =>
			rows('cms_mro_serial_events', `serial = ? AND deleted_at IS NULL${kind ? " AND event = '" + kind + "'" : ''}`, sid);

		// Fit from store: balance leaves the store, unit is issued + seated.
		// (TRK-X steer-l is already taken by TY-VH1 from the fitment test above.)
		const fitSeat = (sid: string, to_vehicle: string, to_slot: string, note: string, event_date?: string) =>
			api(`/api/mro/serials/${sid}/fit`, {
				method: 'POST',
				body: JSON.stringify({ to_vehicle, to_slot, actor_id: APPROVER, note, event_date }),
			});
		const first = await fitSeat(k1, V_FLEET, 'drive-l', 'new fit', '2026-08-15');
		expect(first.status, first.body?.error ?? '').toBe(201);
		// Balance dropped by exactly one fit.
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 3);
		const seated = await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-1' AND deleted_at IS NULL");
		expect(seated?.status).toBe('issued');
		expect(seated?.vehicle).toBe(V_FLEET);
		expect(seated?.slot).toBe('drive-l');
		expect((await eventsOf(k1, 'fitted')).length).toBe(1);
		// The operator-chosen physical wear date lands on the fitted event — the
		// back-dated SSOT the lifecycle timeline reads (not just created_at).
		expect((await eventsOf(k1, 'fitted'))[0]?.event_date).toBe('2026-08-15');
		// A malformed date never reaches the history.
		const badDate = await fitSeat(k4, V_FLEET, 'drive-l', 'bad date', '2026-13-40');
		expect(badDate.status, badDate.body?.error ?? '').toBe(400);

		// A second tyre fits a DIFFERENT seat on the same truck; fitting onto a
		// filled seat is a hard 409 and leaves the spare in stock.
		expect((await fitSeat(k2, V_FLEET, 'drive-r', 'second fit')).status).toBe(201);
		expect((await fitSeat(k3, V_FLEET2, 'steer-l', 'third fit')).status).toBe(201);
		const double = await fitSeat(k4, V_FLEET, 'drive-l', 'occupied');
		expect(double.status, double.body?.error ?? '').toBe(409);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-4' AND deleted_at IS NULL"))?.status).toBe('in_stock');

		// SAME-TRUCK swap → both tyres get a `rotated` event + the other's seat.
		const swap = (a: string, b: string, note: string) =>
			api('/api/mro/serials/swap', {
				method: 'POST',
				body: JSON.stringify({ serial_a: a, serial_b: b, actor_id: APPROVER, note }),
			});
		const rot = await swap(k1, k2, 'rotate fronts');
		expect(rot.status, rot.body?.error ?? '').toBe(201);
		expect((rot.body.data as Record<string, unknown>).event).toBe('rotated');
		const k1a = await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-1' AND deleted_at IS NULL");
		const k2a = await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-2' AND deleted_at IS NULL");
		expect(k1a?.vehicle).toBe(V_FLEET);
		expect(k1a?.slot).toBe('drive-r');
		expect(k2a?.vehicle).toBe(V_FLEET);
		expect(k2a?.slot).toBe('drive-l');
		expect((await eventsOf(k1, 'rotated')).length).toBe(1);
		expect((await eventsOf(k2, 'rotated')).length).toBe(1);

		// CROSS-TRUCK swap is REFUSED — a tyre reaches another truck only through an
		// approval-gated transfer request, so neither unit moves and neither logs.
		const refit = await swap(k1, k3, 'move to TRK-Y');
		expect(refit.status, refit.body?.error ?? '').toBe(400);
		expect(refit.body?.error).toMatch(/SAME truck/i);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-1' AND deleted_at IS NULL"))?.vehicle).toBe(V_FLEET);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-1' AND deleted_at IS NULL"))?.slot).toBe('drive-r');
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-3' AND deleted_at IS NULL"))?.vehicle).toBe(V_FLEET2);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-3' AND deleted_at IS NULL"))?.slot).toBe('steer-l');
		expect((await eventsOf(k1, 'refitted')).length).toBe(0);
		expect((await eventsOf(k3, 'refitted')).length).toBe(0);
		expect((await eventsOf(k1, 'rotated')).length).toBe(1);

		// Guards: swapping needs TWO seated tyres and two distinct ids.
		const notSeated = await swap(k2, k4, 'loose tyre');
		expect(notSeated.status, notSeated.body?.error ?? '').toBe(409);
		const sameId = await swap(k2, k2, 'self');
		expect(sameId.status, sameId.body?.error ?? '').toBe(400);

		// Return a seated tyre to store is GOVERNED: the direct route refuses it, and an
		// approved return request (filed by the operator, decided + executed by their
		// recorded superior) is what actually sends it back. The execute pins the unit to
		// the source the request recorded.
		const directReturn = await api(`/api/mro/serials/${k2}/return`, {
			method: 'POST',
			body: JSON.stringify({ to_location: loc, actor_id: APPROVER, note: 'spare again' }),
		});
		expect(directReturn.status, directReturn.body?.error ?? '').toBe(403);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-2' AND deleted_at IS NULL"))?.status).toBe('issued');
		const back = await returnToStore(k2, { vehicle: V_FLEET, slot: 'drive-l' }, loc);
		expect(back.status, back.body?.error ?? '').toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 2);
		const k2b = await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-2' AND deleted_at IS NULL");
		expect(k2b?.status).toBe('in_stock');
		expect(k2b?.vehicle == null).toBe(true);
		expect(k2b?.slot == null).toBe(true);
		expect(k2b?.location).toBe(loc);
		expect((await eventsOf(k2, 'returned')).length).toBe(1);

		// Write a seated tyre off is GOVERNED like the return above: the direct route
		// refuses it, and an approved write-off request (filed by the operator, decided +
		// executed by their recorded superior) is what scraps it — seat cleared, NO
		// balance change (issued units are already out of every store's stock).
		const directScrap = await api(`/api/mro/serials/${k3}/scrap`, {
			method: 'POST',
			body: JSON.stringify({ actor_id: APPROVER, note: 'blowout — scrap' }),
		});
		expect(directScrap.status, directScrap.body?.error ?? '').toBe(403);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-3' AND deleted_at IS NULL"))?.status).toBe('issued');
		const write = await writeOffUnit(k3, { vehicle: V_FLEET2, slot: 'steer-l' });
		expect(write.status, write.body?.error ?? '').toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 2);
		const k3b = await row('cms_mro_stock_serials', "serial_no = 'TY-KSK-3' AND deleted_at IS NULL");
		expect(k3b?.status).toBe('scrapped');
		expect(k3b?.vehicle == null).toBe(true);
		expect(k3b?.slot == null).toBe(true);
		expect((await eventsOf(k3, 'written_off')).length).toBe(1);

		// Post-move guards: an in-stock unit can't return/scrap, a scrapped unit
		// can't fit, a seated unit can't double-fit, an unknown id 404s.
		const looseReturn = await api(`/api/mro/serials/${k4}/return`, { method: 'POST', body: JSON.stringify({}) });
		expect(looseReturn.status, looseReturn.body?.error ?? '').toBe(409);
		const looseScrap = await api(`/api/mro/serials/${k4}/scrap`, { method: 'POST', body: JSON.stringify({}) });
		expect(looseScrap.status, looseScrap.body?.error ?? '').toBe(409);
		const scrapFit = await fitSeat(k3, V_FLEET, 'drive-r', 'from scrap');
		expect(scrapFit.status, scrapFit.body?.error ?? '').toBe(409);
		const seatedFit = await fitSeat(k1, V_FLEET, 'drive-r', 'already seated');
		expect(seatedFit.status, seatedFit.body?.error ?? '').toBe(409);
		const unknownFit = await fitSeat('99999999-9999-4999-8999-999999999999', V_FLEET, 'drive-r', 'ghost');
		expect(unknownFit.status, unknownFit.body?.error ?? '').toBe(404);

		// History reads narrate the whole lifecycle NEWEST-FIRST, ordered by the DAY
		// each row PRINTS: k1's wear was back-dated to 2026-08-15 (the operator's
		// physical date), so it reads in its OWN place under today's receipt and
		// rotation instead of sitting on top of them while saying "last month".
		// k3's wear carries no date, so its three rows follow the record order.
		const events = async (sid: string) => {
			const r = await api(`/api/mro/serials/${sid}/events`);
			expect(r.status).toBe(200);
			return (r.body.data as { rows: Array<Record<string, unknown>> }).rows.map((e) => e.event);
		};
		expect(await events(k1)).toEqual(['rotated', 'purchased', 'fitted']);
		expect(await events(k3)).toEqual(['written_off', 'fitted', 'purchased']);

		// The holder read now reflects only the survivors that are truly seated.
		const mounted = await api('/api/mro/assets/holder');
		expect(mounted.status).toBe(200);
		const mountedNos = (mounted.body.data as { rows: Array<Record<string, unknown>> }).rows
			.filter((r) => r.slot != null)
			.map((r) => r.serial_no);
		expect(mountedNos).toContain('TY-KSK-1');
		expect(mountedNos).not.toContain('TY-KSK-2');
		expect(mountedNos).not.toContain('TY-KSK-3');
		expect(mountedNos).not.toContain('TY-KSK-4');
	});
});

describe('tyre truck inventory (tray) — stage a spare, unseat a wheel, fit from the tray, tray reads', () => {
	const loc = 'admin_store' as const;
	// A second truck so per-truck scoping can be exercised (seeded by the kiosk
	// chore describe above; a stage into an unknown truck also stays legal).
	const V_FLEET2 = 'aaaaaaa2-2222-4222-a222-222222222222';

	// The return below is governed — the shared request harness supplies the actors.
	beforeAll(mintReturnActors);

	it('stages a store tyre into a truck tray, unseats a seated wheel into the tray, returns a tray spare to store, and fits a tray spare back onto a wheel', async () => {
		const before = await onHandQty(M_SERIAL, loc);
		const seed = await inboundDraft([{ item_model: M_SERIAL, qty: 3, serials: ['TY-TRAY-1', 'TY-TRAY-2', 'TY-TRAY-3'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 3);

		const serialId = async (no: string) =>
			String((await row('cms_mro_stock_serials', 'serial_no = ? AND deleted_at IS NULL', no))?.id ?? '');
		const tr1 = await serialId('TY-TRAY-1');
		const tr2 = await serialId('TY-TRAY-2');
		const tr3 = await serialId('TY-TRAY-3');
		const eventsOf = async (sid: string, kind: string) =>
			rows('cms_mro_serial_events', `serial = ? AND deleted_at IS NULL AND event = '${kind}'`, sid);
		// fit WITHOUT to_slot = place the tyre into the truck's inventory tray.
		const stage = (sid: string, to_vehicle: string, note: string) =>
			api(`/api/mro/serials/${sid}/fit`, {
				method: 'POST',
				body: JSON.stringify({ to_vehicle, actor_id: APPROVER, note }),
			});
		const fitSeat = (sid: string, to_vehicle: string, to_slot: string, note: string) =>
			api(`/api/mro/serials/${sid}/fit`, {
				method: 'POST',
				body: JSON.stringify({ to_vehicle, to_slot, actor_id: APPROVER, note }),
			});

		// 1) STAGE a store tyre into TRK-X's tray — no wheel, one balance leaves.
		const staged = await stage(tr1, V_FLEET, 'stage a spare');
		expect(staged.status, staged.body?.error ?? '').toBe(201);
		expect((staged.body.data as Record<string, unknown>).slot == null).toBe(true);
		const tray1 = await row('cms_mro_stock_serials', "serial_no = 'TY-TRAY-1' AND deleted_at IS NULL");
		expect(tray1?.status).toBe('issued');
		expect(tray1?.vehicle).toBe(V_FLEET);
		expect(tray1?.slot == null).toBe(true);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 2);
		expect((await eventsOf(tr1, 'fitted')).length).toBe(1);

		// 2) A second unit seats on a wheel normally. `drive-l` is ONE physical seat on a
		// SHARED truck, so clear whatever an earlier suite left there before claiming it.
		const occupant = await row(
			'cms_mro_stock_serials',
			'vehicle = ? AND slot = ? AND status = ? AND deleted_at IS NULL',
			V_FLEET,
			'drive-l',
			'issued',
		);
		if (occupant) {
			const freed = await api(`/api/mro/serials/${occupant.id}/unseat`, {
				method: 'POST',
				body: JSON.stringify({ actor_id: APPROVER, note: 'free the seat for this suite' }),
			});
			expect(freed.status, freed.body?.error ?? '').toBe(201);
		}
		expect((await fitSeat(tr2, V_FLEET, 'drive-l', 'fit a wheel')).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 1);

		// 3) UNSEAT it off the wheel → back into the SAME truck's tray.
		const unseat = await api(`/api/mro/serials/${tr2}/unseat`, {
			method: 'POST',
			body: JSON.stringify({ actor_id: APPROVER, note: 'wheel change' }),
		});
		expect(unseat.status, unseat.body?.error ?? '').toBe(201);
		const tray2 = await row('cms_mro_stock_serials', "serial_no = 'TY-TRAY-2' AND deleted_at IS NULL");
		expect(tray2?.status).toBe('issued');
		expect(tray2?.vehicle).toBe(V_FLEET);
		expect(tray2?.slot == null).toBe(true);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 1);
		expect((await eventsOf(tr2, 'unseated')).length).toBe(1);

		// 4) The holder read's slot-less units are the truck's standby spares —
		// never a SEATED tyre.
		const holderOf = async (vehicle: string) => {
			const r = await api(`/api/mro/assets/holder?vehicle=${vehicle}`);
			expect(r.status).toBe(200);
			return (r.body.data as { rows: Array<Record<string, unknown>> }).rows;
		};
		const sparesOf = async (vehicle: string) => (await holderOf(vehicle)).filter((r) => r.slot == null).map((r) => r.serial_no);
		const sparesFleet = await sparesOf(V_FLEET);
		expect(sparesFleet).toContain('TY-TRAY-1');
		expect(sparesFleet).toContain('TY-TRAY-2');
		expect(sparesFleet).not.toContain('TY-VH1');
		const sparesOther = await sparesOf(V_FLEET2);
		expect(sparesOther).not.toContain('TY-TRAY-1');
		expect(sparesOther).not.toContain('TY-TRAY-2');

		// 5) Guards: a tray spare can't be staged again / unseated again.
		const doubleStage = await stage(tr1, V_FLEET, 'again');
		expect(doubleStage.status, doubleStage.body?.error ?? '').toBe(409);
		const unseatLoose = await api(`/api/mro/serials/${tr1}/unseat`, { method: 'POST', body: JSON.stringify({}) });
		expect(unseatLoose.status, unseatLoose.body?.error ?? '').toBe(409);

		// 6) RETURN a tray spare to the store (issued truck spare → in_stock) — GOVERNED:
		// the direct route refuses it and an approved return request performs it.
		const directReturn = await api(`/api/mro/serials/${tr1}/return`, {
			method: 'POST',
			body: JSON.stringify({ to_location: loc, actor_id: APPROVER, note: 'store it again' }),
		});
		expect(directReturn.status, directReturn.body?.error ?? '').toBe(403);
		const back = await returnToStore(tr1, { vehicle: V_FLEET }, loc);
		expect(back.status, back.body?.error ?? '').toBe(201);
		const stored = await row('cms_mro_stock_serials', "serial_no = 'TY-TRAY-1' AND deleted_at IS NULL");
		expect(stored?.status).toBe('in_stock');
		expect(stored?.location).toBe(loc);
		expect(stored?.vehicle == null).toBe(true);
		expect(stored?.slot == null).toBe(true);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 2);
		expect((await eventsOf(tr1, 'returned')).length).toBe(1);

		// 7) A spare for ANOTHER truck stages to THAT truck — re-staging it here is a 409.
		expect((await stage(tr3, V_FLEET2, 'spare for TRK-Y')).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 1);
		const crossStage = await stage(tr3, V_FLEET, 'move across');
		expect(crossStage.status, crossStage.body?.error ?? '').toBe(409);

		// 8) FIT FROM TRAY → same truck's vacant wheel (drive-l, emptied in step 3).
		const refit = await fitSeat(tr2, V_FLEET, 'drive-l', 'fit from tray');
		expect(refit.status, refit.body?.error ?? '').toBe(201);
		const seated2 = await row('cms_mro_stock_serials', "serial_no = 'TY-TRAY-2' AND deleted_at IS NULL");
		expect(seated2?.status).toBe('issued');
		expect(seated2?.vehicle).toBe(V_FLEET);
		expect(seated2?.slot).toBe('drive-l');
		expect((await eventsOf(tr2, 'fitted')).length).toBe(2);

		// 9) Final separation: seated units carry a slot; spares do not.
		const mountedAll = await api('/api/mro/assets/holder');
		const mountedNos = (mountedAll.body.data as { rows: Array<Record<string, unknown>> }).rows
			.filter((r) => r.slot != null)
			.map((r) => r.serial_no);
		expect(mountedNos).toContain('TY-TRAY-2');
		expect(mountedNos).not.toContain('TY-TRAY-1');
		expect(mountedNos).not.toContain('TY-TRAY-3');
		const sparesOtherAfter = await sparesOf(V_FLEET2);
		expect(sparesOtherAfter).toContain('TY-TRAY-3');
	});
});

describe('employee custody — issue an asset to a person, move custody, return and write it off', () => {
	const loc = 'vehicle_store' as const;
	// A truck only this suite touches, so truck↔person hops never fight other seats.
	const V_FLEET3 = 'aaaaaaa3-3333-4333-a333-333333333333';

	// Both ends of custody are approval-gated (a return AND a write-off), so this suite
	// needs the shared harness' operator + recorded superior sessions.
	beforeAll(mintReturnActors);

	it('issues store assets to an employee, moves custody between people and trucks, and returns/scraps from a person', async () => {
		await insert('cms_veh_fleets', { id: V_FLEET3, plate_no: 'TRK-Z' });

		// Seed the store with three serial units we own (the `assets`-flagged group).
		const before = await onHandQty(M_SERIAL, loc);
		const seed = await inboundDraft([{ item_model: M_SERIAL, qty: 3, serials: ['TY-EMP-1', 'TY-EMP-2', 'TY-EMP-3'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 3);

		const serialId = async (no: string) =>
			String((await row('cms_mro_stock_serials', 'serial_no = ? AND deleted_at IS NULL', no))?.id ?? '');
		const e1 = await serialId('TY-EMP-1');
		const e2 = await serialId('TY-EMP-2');
		const eventsOf = async (sid: string) => rows('cms_mro_serial_events', 'serial = ? AND deleted_at IS NULL', sid);

		// 1) ISSUE a store unit to a person: balance leaves, status issued, custodian set.
		const issue = await api(`/api/mro/serials/${e1}/issue`, {
			method: 'POST',
			body: JSON.stringify({ to_employee: APPROVER, actor_id: REPORTER, note: 'hand to operator' }),
		});
		expect(issue.status, issue.body?.error ?? '').toBe(201);
		expect(await onHandQty(M_SERIAL, loc)).toBe(before + 2);
		const held = await row('cms_mro_stock_serials', "serial_no = 'TY-EMP-1' AND deleted_at IS NULL");
		expect(held?.status).toBe('issued');
		expect(held?.employee).toBe(APPROVER);
		expect(held?.vehicle == null).toBe(true);
		expect((await eventsOf(e1)).filter((x) => x.event === 'issued')).toHaveLength(1);

		// The employee register surfaces it display-ready; the truck read stays empty.
		const empRead = await api(`/api/mro/assets/holder?employee=${APPROVER}`);
		expect(empRead.status).toBe(200);
		const unit = (empRead.body.data as { rows: Array<Record<string, unknown>> }).rows.find((r) => r.serial_no === 'TY-EMP-1');
		expect(unit?.employee_name).toBe('Approving Operator');
		expect(unit?.vehicle == null).toBe(true);
		const truckRead = await api(`/api/mro/assets/holder?vehicle=${V_FLEET3}`);
		expect((truckRead.body.data as { rows: unknown[] }).rows).toHaveLength(0);

		// Guards: a repeat issue is a 409; a missing person is a 400; unknown id 404s.
		const again = await api(`/api/mro/serials/${e1}/issue`, {
			method: 'POST',
			body: JSON.stringify({ to_employee: APPROVER }),
		});
		expect(again.status, again.body?.error ?? '').toBe(409);
		const noEmployee = await api(`/api/mro/serials/${e2}/issue`, { method: 'POST', body: JSON.stringify({}) });
		expect(noEmployee.status).toBe(400);
		const ghost = await api('/api/mro/serials/99999999-9999-4999-8999-999999999999/issue', {
			method: 'POST',
			body: JSON.stringify({ to_employee: APPROVER }),
		});
		expect(ghost.status).toBe(404);

		// 2) A truck↔person hop is NEVER a direct write — the unit changes hands
		// through the store, so both shapes are refused here (the custody rule).
		const toTruck = await api(`/api/mro/serials/${e1}/move`, {
			method: 'POST',
			body: JSON.stringify({ to_vehicle: V_FLEET3, to_slot: 'steer-l', actor_id: REPORTER }),
		});
		expect(toTruck.status, toTruck.body?.error ?? '').toBe(403);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-EMP-1' AND deleted_at IS NULL"))?.employee).toBe(APPROVER);

		// 3) PERSON → PERSON is the approval-gated shape: the direct route refuses it and
		// only an approved request relocates custody. Issue a second unit first, so the
		// two custodians are genuinely two different people.
		const issued2 = await api(`/api/mro/serials/${e2}/issue`, {
			method: 'POST',
			body: JSON.stringify({ to_employee: REPORTER, actor_id: APPROVER }),
		});
		expect(issued2.status, issued2.body?.error ?? '').toBe(201);
		const reassign = await api(`/api/mro/serials/${e1}/move`, {
			method: 'POST',
			body: JSON.stringify({ to_employee: REPORTER, actor_id: APPROVER }),
		});
		expect(reassign.status, reassign.body?.error ?? '').toBe(403);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-EMP-1' AND deleted_at IS NULL"))?.employee).toBe(APPROVER);

		// 4) Guard: naming BOTH a truck and a person is a hard 400 (one holder only).
		const both = await api(`/api/mro/serials/${e1}/move`, {
			method: 'POST',
			body: JSON.stringify({ to_vehicle: V_FLEET3, to_employee: APPROVER, actor_id: REPORTER }),
		});
		expect(both.status, both.body?.error ?? '').toBe(400);

		// 5) RETURN from a person to store is governed too — the direct route refuses it.
		const directReturn = await api(`/api/mro/serials/${e1}/return`, {
			method: 'POST',
			body: JSON.stringify({ to_location: loc, actor_id: APPROVER, note: 'hand back' }),
		});
		expect(directReturn.status, directReturn.body?.error ?? '').toBe(403);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-EMP-1' AND deleted_at IS NULL"))?.employee).toBe(APPROVER);

		// 6) WRITE OFF a person-held asset: GOVERNED — the direct route refuses it, and an
		// approved write-off request (filed by the operator, decided + executed by their
		// recorded superior) is what scraps it: scrapped, custodian cleared, no balance
		// move. The custody rule leaves a write-off alone — an owner decision, not a move.
		const balBeforeScrap = await onHandQty(M_SERIAL, loc);
		const directScrap = await api(`/api/mro/serials/${e2}/scrap`, {
			method: 'POST',
			body: JSON.stringify({ actor_id: APPROVER, note: 'lost by holder' }),
		});
		expect(directScrap.status, directScrap.body?.error ?? '').toBe(403);
		expect((await row('cms_mro_stock_serials', "serial_no = 'TY-EMP-2' AND deleted_at IS NULL"))?.employee).toBe(REPORTER);
		const scrap = await writeOffUnit(e2, { employee: REPORTER });
		expect(scrap.status, scrap.body?.error ?? '').toBe(201);
		const scrapped = await row('cms_mro_stock_serials', "serial_no = 'TY-EMP-2' AND deleted_at IS NULL");
		expect(scrapped?.status).toBe('scrapped');
		expect(scrapped?.employee == null).toBe(true);
		expect(await onHandQty(M_SERIAL, loc)).toBe(balBeforeScrap);

		// 7) The refused unit still belongs to its custodian; the written-off one is gone.
		const stillHeld = await api(`/api/mro/assets/holder?employee=${APPROVER}`);
		const heldRows = (stillHeld.body.data as { rows: Array<Record<string, unknown>> }).rows;
		expect(heldRows.map((r) => r.serial_no)).toContain('TY-EMP-1');
		const timeline = (await eventsOf(e1)).map((x) => x.event);
		expect(timeline).toEqual(expect.arrayContaining(['purchased', 'issued']));
		expect(timeline).not.toContain('fitted');
	});
});

describe('backend hardening — scoped asset reads, auto expiry horizon, expired exclusion, asset-flag gating', () => {
	// Isolated fixtures: their own serial-tracked group/SKU + batch group/SKU, in
	// locations no other suite touches, so these assertions never fight other state.
	const SER_GRP = 'b1000000-0000-4000-8000-000000000001';
	const SER_MDL = 'b1000000-0000-4000-8000-000000000002';
	const EXP_GRP = 'b1000000-0000-4000-8000-000000000003';
	const EXP_MDL = 'b1000000-0000-4000-8000-000000000004';
	const OH_MDL = 'b1000000-0000-4000-8000-000000000005';
	const OH_GRP = 'b1000000-0000-4000-8000-000000000006';
	const TRUCK_A = 'b1a00000-0000-4000-8000-00000000000a';
	const TRUCK_B = 'b1a00000-0000-4000-8000-00000000000b';

	it('GET /api/mro/assets/holder?vehicle= scopes the read to ONE truck', async () => {
		await insert('cms_mro_item_name', { id: SER_GRP, name_en: 'Scoped Serial Part', tracking: 'serial', assets: 1 });
		await insert('cms_mro_item_model', { id: SER_MDL, name_en: 'Scoped Serial SKU', item_name: SER_GRP });
		await insert('cms_mro_stock_serials', {
			id: 'b1a00000-0000-4000-8000-0000000000c1',
			model: SER_MDL,
			location: 'safety_store',
			serial_no: 'SCOPE-A',
			status: 'issued',
			vehicle: TRUCK_A,
			slot: 'drive-l',
		});
		await insert('cms_mro_stock_serials', {
			id: 'b1a00000-0000-4000-8000-0000000000c2',
			model: SER_MDL,
			location: 'safety_store',
			serial_no: 'SCOPE-B',
			status: 'issued',
			vehicle: TRUCK_B,
			slot: 'drive-l',
		});

		const scoped = await api(`/api/mro/assets/holder?vehicle=${TRUCK_A}`);
		expect(scoped.status).toBe(200);
		const scopedNos = (scoped.body.data as { rows: Array<Record<string, unknown>> }).rows.map((r) => r.serial_no);
		expect(scopedNos).toContain('SCOPE-A');
		expect(scopedNos).not.toContain('SCOPE-B');

		// Omitting `vehicle` stays the fleet-wide read (both trucks' units).
		const all = await api('/api/mro/assets/holder');
		const allNos = (all.body.data as { rows: Array<Record<string, unknown>> }).rows.map((r) => r.serial_no);
		expect(allNos).toContain('SCOPE-A');
		expect(allNos).toContain('SCOPE-B');
	});

	it('GET /api/mro/stock/expiring (no ?days) derives the horizon from the widest per-model alert window', async () => {
		await insert('cms_mro_item_name', { id: EXP_GRP, name_en: 'Wide Alert Part', tracking: 'batch' });
		await insert('cms_mro_item_model', { id: EXP_MDL, name_en: 'Wide Alert SKU', item_name: EXP_GRP, expiry_alert_days: 60 });
		await insert('cms_mro_stock_lots', {
			id: 'b1a00000-0000-4000-8000-0000000000e1',
			model: EXP_MDL,
			location: 'safety_store',
			batch_no: 'WIDE-B1',
			expiry_date: mmtToday(45),
			remaining_qty: 5,
			status: 'active',
		});

		// The 45-day lot sits OUTSIDE a blanket 30-day window but INSIDE this model's
		// own 60-day alert window — the auto horizon must find it (and flag `alert`).
		const auto = await api('/api/mro/stock/expiring');
		expect(auto.status).toBe(200);
		const autoRow = (auto.body.data as { expiring: Array<Record<string, unknown>> }).expiring.find(
			(r) => r.id === 'b1a00000-0000-4000-8000-0000000000e1',
		);
		expect(autoRow).toBeTruthy();
		expect(autoRow?.alert).toBe(true);

		// An explicit 30-day horizon still hides it (the old, over-narrow behaviour).
		const narrow = await api('/api/mro/stock/expiring?days=30');
		const narrowIds = (narrow.body.data as { expiring: Array<Record<string, unknown>> }).expiring.map((r) => r.id);
		expect(narrowIds).not.toContain('b1a00000-0000-4000-8000-0000000000e1');
	});

	it('on-hand subtracts EXPIRED stock from available, so below_reorder reflects what can actually be issued', async () => {
		// 12 units on the shelf, but 5 already expired: only 7 are issuable, which is
		// below the reorder level of 10. The old read counted all 12 and stayed quiet.
		await insert('cms_mro_item_name', { id: OH_GRP, name_en: 'Reorder Part', tracking: 'batch' });
		await insert('cms_mro_item_model', { id: OH_MDL, name_en: 'Reorder SKU', item_name: OH_GRP });
		await insert('cms_mro_inventory', {
			id: 'b1a00000-0000-4000-8000-0000000000f1',
			model: OH_MDL,
			location: 'mandalay_store',
			qty_on_hand: 12,
			reorder_level: 10,
		});
		await insert('cms_mro_stock_lots', {
			id: 'b1a00000-0000-4000-8000-0000000000f2',
			model: OH_MDL,
			location: 'mandalay_store',
			batch_no: 'OH-EXP',
			expiry_date: mmtToday(-5),
			remaining_qty: 5,
			status: 'active',
		});
		await insert('cms_mro_stock_lots', {
			id: 'b1a00000-0000-4000-8000-0000000000f3',
			model: OH_MDL,
			location: 'mandalay_store',
			batch_no: 'OH-OK',
			expiry_date: mmtToday(90),
			remaining_qty: 7,
			status: 'active',
		});

		const res = await api('/api/mro/stock/onhand');
		expect(res.status).toBe(200);
		const row0 = (res.body.data as { rows: Array<Record<string, unknown>> }).rows.find(
			(r) => r.model === OH_MDL && r.location === 'mandalay_store',
		);
		expect(row0).toBeTruthy();
		expect(Number(row0?.derived_qty)).toBe(12);
		expect(Number(row0?.expired_qty)).toBe(5);
		expect(row0?.below_reorder).toBe(true);
	});

	it('GET /api/mro/assets/holder lists only `assets`-flagged units and derives the holder', async () => {
		// A tyre (an `assets` group) seated on the truck, and a serial-tracked but
		// NOT-asset part on the same truck: only the flagged unit may surface, which
		// proves the flag — not `tracking` — is what makes a physical unit a register
		// asset. The holder (vehicle + plate) is DERIVED server-side, never stored.
		const ASSET_GRP = 'b1b00000-0000-4000-8000-000000000001';
		const ASSET_MDL = 'b1b00000-0000-4000-8000-000000000002';
		const PLAIN_GRP = 'b1b00000-0000-4000-8000-000000000003';
		const PLAIN_MDL = 'b1b00000-0000-4000-8000-000000000004';
		await insert('cms_veh_fleets', { id: TRUCK_A, plate_no: 'SCOPE-A1' });
		await insert('cms_mro_item_name', { id: ASSET_GRP, name_en: 'Holder Asset Part', tracking: 'serial', assets: 1 });
		await insert('cms_mro_item_model', {
			id: ASSET_MDL,
			name_en: 'Holder Asset SKU',
			item_name: ASSET_GRP,
			reference_tread_mm: 18,
			// The SKU's photo — a public `/api/media/<key>` URL the register card paints.
			image: '/api/media/holder-sku.jpg',
		});
		await insert('cms_mro_item_name', { id: PLAIN_GRP, name_en: 'Plain Serial Part', tracking: 'serial', assets: 0 });
		await insert('cms_mro_item_model', { id: PLAIN_MDL, name_en: 'Plain Serial SKU', item_name: PLAIN_GRP });
		await insert('cms_mro_stock_serials', {
			id: 'b1b00000-0000-4000-8000-0000000000c1',
			model: ASSET_MDL,
			location: 'safety_store',
			serial_no: 'HOLDER-A',
			status: 'issued',
			vehicle: TRUCK_A,
			slot: 'drive-l',
			tread_mm: 14,
			condition: 'good',
		});
		await insert('cms_mro_stock_serials', {
			id: 'b1b00000-0000-4000-8000-0000000000c2',
			model: PLAIN_MDL,
			location: 'safety_store',
			serial_no: 'PLAIN-A',
			status: 'issued',
			vehicle: TRUCK_A,
			slot: 'drive-r',
		});

		const res = await api(`/api/mro/assets/holder?vehicle=${TRUCK_A}`);
		expect(res.status).toBe(200);
		const rows = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;
		const nos = rows.map((r) => r.serial_no);
		expect(nos).toContain('HOLDER-A');
		expect(nos).not.toContain('PLAIN-A');

		const tyre = rows.find((r) => r.serial_no === 'HOLDER-A');
		expect(tyre?.kind).toBe('tyre');
		expect(tyre?.item_name_en).toBe('Holder Asset Part');
		expect(tyre?.plate_no).toBe('SCOPE-A1');
		expect(tyre?.vehicle).toBe(TRUCK_A);
		// The SKU's photo travels WITH the row (the card's face), resolved from the
		// same model join the name came from — no second catalog read on the client.
		expect(tyre?.model_image).toBe('/api/media/holder-sku.jpg');
	});

	it('write policy: the generic API cannot reach a service-only / append-only table', async () => {
		// schema-defs.json marks every stock trace + ledger table
		// `policies.writes.mode: service` (the trace/ledger tables also
		// `append_only`), so the confirm services are the SOLE writers — a generic
		// REST write can never move live state, nor forge/strip a history row,
		// without its matching ledger event. The mirror collections above carry the
		// same policies, and the caller here is an ADMIN — which proves the rbac
		// admin bypass cannot reach these tables either.
		const GRP = 'b1c00000-0000-4000-8000-000000000001';
		const MDL = 'b1c00000-0000-4000-8000-000000000002';
		const SERIAL = 'b1c00000-0000-4000-8000-000000000003';
		const EVENT = 'b1c00000-0000-4000-8000-000000000004';
		await insert('cms_mro_item_name', { id: GRP, name_en: 'Locked Part', tracking: 'serial', assets: 1 });
		await insert('cms_mro_item_model', { id: MDL, name_en: 'Locked SKU', item_name: GRP });
		await insert('cms_mro_stock_serials', {
			id: SERIAL,
			model: MDL,
			location: 'safety_store',
			serial_no: 'LOCK-1',
			status: 'in_stock',
		});
		await insert('cms_mro_serial_events', { id: EVENT, serial: SERIAL, event: 'purchased' });

		// mode: service ⇒ create / update / soft-delete are all rejected.
		const create = await api('/api/entities/mro_stock_serials', {
			method: 'POST',
			body: JSON.stringify({ model: MDL, location: 'safety_store', serial_no: 'LOCK-FORGE' }),
		});
		const update = await api(`/api/entities/mro_stock_serials/${SERIAL}`, {
			method: 'PUT',
			body: JSON.stringify({ location: 'admin_store' }),
		});
		const remove = await api(`/api/entities/mro_stock_serials/${SERIAL}`, { method: 'DELETE' });
		expect(create.status, 'create').toBe(403);
		expect(update.status, 'update').toBe(403);
		expect(remove.status, 'delete').toBe(403);

		// append_only ⇒ the ledger row can neither be updated nor soft-deleted.
		const evUpdate = await api(`/api/entities/mro_serial_events/${EVENT}`, {
			method: 'PUT',
			body: JSON.stringify({ note: 'tampered' }),
		});
		const evDelete = await api(`/api/entities/mro_serial_events/${EVENT}`, { method: 'DELETE' });
		expect(evUpdate.status, 'event update').toBe(403);
		expect(evDelete.status, 'event delete').toBe(403);

		// Nothing moved: the live row and the ledger row are exactly as seeded.
		expect((await row('cms_mro_stock_serials', 'id = ?', SERIAL))?.location).toBe('safety_store');
		expect((await row('cms_mro_serial_events', 'id = ?', EVENT))?.deleted_at ?? null).toBeNull();
		expect(await row('cms_mro_stock_serials', "serial_no = 'LOCK-FORGE'")).toBeNull();
	});

	it('binds creator-attribution fields to the session identity (two-person rule cannot be forged)', async () => {
		// `mro_adjustments` declares `policies.actor_fields: ['reported_by']` — the
		// engine stamps the reporter from the SIGNED TOKEN, so a non-admin operator
		// cannot file a correction while blaming someone else (which would defeat the
		// approver != reporter rule). A non-admin session is a real JWT whose
		// `employee_id` is REPORTER.
		const ROLE = 'b1d00000-0000-4000-8000-000000000001';
		const USER = 'b1d00000-0000-4000-8000-000000000002';
		const PERM = 'b1d00000-0000-4000-8000-000000000003';
		await insert('_roles', { id: ROLE, name: 'Storekeeper', is_system: 0 });
		await insert('_users', {
			id: USER,
			email: 'tg-900001@telegram.local',
			full_name: 'Storekeeper',
			password_hash: 'x',
			role_id: ROLE,
			status: 'active',
		});
		await insert('_role_permissions', {
			id: PERM,
			role_id: ROLE,
			collection_slug: 'mro_adjustments',
			can_read: 1,
			can_write: 1,
			can_create: 1,
		});
		const jwtSecret = (env as unknown as Record<string, string>).JWT_SECRET;
		const token = await new AuthService(new D1Client(env.DB)).generateToken(USER, jwtSecret, REPORTER);

		const res = await api('/api/entities/mro_adjustments', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				location: 'safety_store',
				adjustment_date: '2026-01-01',
				reported_by: APPROVER,
				approved_by: APPROVER,
			}),
		});
		expect(res.status, res.body.error).toBe(201);
		const created = res.body.data as Record<string, unknown>;
		// Stamped to the SESSION employee, never the forged body value.
		expect(created.reported_by).toBe(REPORTER);
		expect(created.reported_by).not.toBe(APPROVER);
	});
});

describe('asset transfer requests — file (requester), decide (superior), execute (atomic move)', () => {
	// The truck→truck governance gate: a move is FILED as a request, DECIDED by a
	// recorded superior of the requester, then EXECUTED as one atomic guarded move
	// pinned to the recorded source. Every identity below is a real JWT whose
	// `employee_id` is signed in, so session-binding (not a payload field) is what
	// the assertions actually prove.
	const TRUCK_SRC = 'c1a00000-0000-4000-8000-00000000000a';
	const TRUCK_DST = 'c1a00000-0000-4000-8000-00000000000b';
	const TRUCK_ALT = 'c1a00000-0000-4000-8000-00000000000c';
	const OTHER = 'c1c00000-0000-4000-8000-000000000001'; // a peer — never a superior
	const ROLE = 'c1d00000-0000-4000-8000-000000000001';
	const U_REQ = 'c1d00000-0000-4000-8000-000000000002';
	const U_SUP = 'c1d00000-0000-4000-8000-000000000003';
	const U_OTH = 'c1d00000-0000-4000-8000-000000000004';
	const PERM = 'c1d00000-0000-4000-8000-000000000005';
	let reqToken = '';
	let supToken = '';
	let othToken = '';

	beforeAll(async () => {
		await insert('cms_veh_fleets', { id: TRUCK_SRC, plate_no: 'ATR-SRC' });
		await insert('cms_veh_fleets', { id: TRUCK_DST, plate_no: 'ATR-DST' });
		await insert('cms_veh_fleets', { id: TRUCK_ALT, plate_no: 'ATR-ALT' });
		await insert('cms_hrm_employees', { id: OTHER, name_en: 'Peer Operator' });
		// The APPROVER→REPORTER reporting edge is seeded in the top-level beforeAll.

		await insert('_roles', { id: ROLE, name: 'Transfer Ops', is_system: 0 });
		await insert('_role_permissions', {
			id: PERM,
			role_id: ROLE,
			collection_slug: 'mro_asset_requests',
			can_read: 1,
			can_write: 1,
			can_create: 1,
		});
		for (const [id, email] of [
			[U_REQ, 'tg-900010@telegram.local'],
			[U_SUP, 'tg-900011@telegram.local'],
			[U_OTH, 'tg-900012@telegram.local'],
		] as const) {
			await insert('_users', { id, email, full_name: 'Transfer Ops', password_hash: 'x', role_id: ROLE, status: 'active' });
		}
		const secret = (env as unknown as Record<string, string>).JWT_SECRET;
		const auth = new AuthService(new D1Client(env.DB));
		reqToken = await auth.generateToken(U_REQ, secret, REPORTER);
		supToken = await auth.generateToken(U_SUP, secret, APPROVER);
		othToken = await auth.generateToken(U_OTH, secret, OTHER);
	});

	const as = (token: string) => ({ Authorization: `Bearer ${token}` });
	const file = (token: string, body: Record<string, unknown>) =>
		api('/api/entities/mro_asset_requests', { method: 'POST', headers: as(token), body: JSON.stringify(body) });
	const decide = (id: string, verb: 'approve' | 'reject' | 'execute', token: string, body: Record<string, unknown> = {}) =>
		api(`/api/mro/asset-requests/${id}/${verb}`, { method: 'POST', headers: as(token), body: JSON.stringify(body) });
	const seat = (id: string, serialNo: string, vehicle: string) =>
		insert('cms_mro_stock_serials', {
			id,
			model: M_SERIAL,
			location: 'safety_store',
			serial_no: serialNo,
			status: 'issued',
			vehicle,
			slot: 'drive-l',
		});

	it('files with a session-stamped requester, refuses a peer/self decision, then executes one atomic move', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-000000000001';
		await seat(SERIAL, 'ATR-TY-1', TRUCK_SRC);

		// FILE — a peer cannot smuggle the decision fields, nor name the requester.
		const filed = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			to_vehicle: TRUCK_DST,
			to_slot: 'drive-l',
			status: 'approved',
			approved_by: OTHER,
			requested_by: OTHER,
		});
		expect(filed.status, filed.body.error).toBe(201);
		const req = filed.body.data as Record<string, unknown>;
		expect(req.status).toBe('requested'); // forbidden status could not be written
		expect(req.approved_by == null).toBe(true); // nor a forged decider
		expect(req.requested_by).toBe(REPORTER); // stamped from the session
		expect(String(req.display_number)).toMatch(/^ATR-\d{5}$/);
		const id = String(req.id);

		// A generic PUT cannot advance the workflow either (frozen fields stripped).
		const put = await api(`/api/entities/mro_asset_requests/${id}`, {
			method: 'PUT',
			headers: as(reqToken),
			body: JSON.stringify({ note: 'bump', status: 'approved', approved_by: OTHER }),
		});
		expect(put.status, put.body.error).toBe(200);
		const afterPut = await row('cms_mro_asset_requests', 'id = ?', id);
		expect(afterPut?.status).toBe('requested');
		expect(afterPut?.note).toBe('bump');

		// A peer (no reporting line) cannot decide it — even naming the superior.
		const peer = await decide(id, 'approve', othToken, { actor_id: APPROVER });
		expect(peer.status, peer.body.error).toBe(403);
		// The requester cannot wave their own request through (two-person rule).
		expect((await decide(id, 'approve', reqToken)).status).toBe(409);

		// The recorded superior approves — a sign-off only, nothing moves yet.
		const ok = await decide(id, 'approve', supToken);
		expect(ok.status, ok.body.error).toBe(201);
		expect((await row('cms_mro_stock_serials', 'id = ?', SERIAL))?.vehicle).toBe(TRUCK_SRC);
		expect((await row('cms_mro_asset_requests', 'id = ?', id))?.status).toBe('approved');
		expect((await decide(id, 'approve', supToken)).status).toBe(409); // decided twice

		// EXECUTE — the move and the request flip commit in ONE batch.
		const exec = await decide(id, 'execute', supToken);
		expect(exec.status, exec.body.error).toBe(201);
		expect((exec.body.data as Record<string, unknown>).status).toBe('executed');
		const moved = await row('cms_mro_stock_serials', 'id = ?', SERIAL);
		expect(moved?.vehicle).toBe(TRUCK_DST);
		expect(moved?.slot).toBe('drive-l');
		const reqRow = await row('cms_mro_asset_requests', 'id = ?', id);
		expect(reqRow?.status).toBe('executed');
		expect(reqRow?.executed_at).toBeTruthy();

		// The serial's lifecycle names the document that authorised the move.
		const ev = (await rows('cms_mro_serial_events', 'serial = ? AND deleted_at IS NULL', SERIAL)).filter((e) => e.ref_kind === 'ATR');
		expect(ev).toHaveLength(1);
		expect(ev[0].ref_doc).toBe(req.display_number);
		expect(ev[0].from_vehicle).toBe(TRUCK_SRC);
		expect(ev[0].to_vehicle).toBe(TRUCK_DST);
		expect(ev[0].event).toBe('refitted');

		// Double execute is a 409 (the request is no longer approved).
		expect((await decide(id, 'execute', supToken)).status).toBe(409);
	});

	it('pins execute to the recorded source — a unit that moved since approval is never silently relocated', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-000000000002';
		await seat(SERIAL, 'ATR-TY-2', TRUCK_SRC);
		const filed = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			to_vehicle: TRUCK_DST,
			to_slot: 'drive-l',
		});
		const id = String((filed.body.data as Record<string, unknown>).id);
		expect((await decide(id, 'approve', supToken)).status).toBe(201);

		// A truck→truck move is now GOVERNED itself, so no direct writer can drift a unit
		// behind an approved request — that is the point of the custody gate.
		const hop = await api(`/api/mro/serials/${SERIAL}/move`, {
			method: 'POST',
			body: JSON.stringify({ to_vehicle: TRUCK_ALT, to_slot: 'spare', actor_id: REPORTER }),
		});
		expect(hop.status, hop.body.error).toBe(403);

		// Drift it the only way that still exists: execute a SECOND approved request for
		// the same unit, from the same recorded source, into the third truck.
		const second = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			to_vehicle: TRUCK_ALT,
		});
		const secondId = String((second.body.data as Record<string, unknown>).id);
		expect((await decide(secondId, 'approve', supToken)).status).toBe(201);
		expect((await decide(secondId, 'execute', supToken)).status).toBe(201);
		expect((await row('cms_mro_stock_serials', 'id = ?', SERIAL))?.vehicle).toBe(TRUCK_ALT);

		// Execute refuses rather than relocating it from wherever it now sits.
		const exec = await decide(id, 'execute', supToken);
		expect(exec.status).toBe(409);
		expect(String(exec.body.error)).toContain('no longer at the requested source');
		expect((await row('cms_mro_stock_serials', 'id = ?', SERIAL))?.vehicle).toBe(TRUCK_ALT);
		expect((await row('cms_mro_asset_requests', 'id = ?', id))?.status).toBe('approved');
	});

	it('executes a truck→truck request that names NO wheel position — the unit lands in the destination tray', async () => {
		// The tgapp filer's shape: a destination TRUCK, never a seat. The unit joins the
		// receiving truck's inventory (slot null) and is worn there later from its own
		// fitment picker, so execute must NOT require a seat.
		const SERIAL = 'c1b00000-0000-4000-8000-000000000006';
		await seat(SERIAL, 'ATR-TY-6', TRUCK_SRC);
		const filed = await file(reqToken, { serial: SERIAL, from_vehicle: TRUCK_SRC, from_slot: 'drive-l', to_vehicle: TRUCK_DST });
		expect(filed.status, filed.body.error).toBe(201);
		const id = String((filed.body.data as Record<string, unknown>).id);

		expect((await decide(id, 'approve', supToken)).status).toBe(201);
		const exec = await decide(id, 'execute', supToken);
		expect(exec.status, exec.body.error).toBe(201);

		// A TRAY spare on the destination — held by the truck, on no wheel.
		const moved = await row('cms_mro_stock_serials', 'id = ?', SERIAL);
		expect(moved?.vehicle).toBe(TRUCK_DST);
		expect(moved?.slot == null).toBe(true);
		expect(moved?.status).toBe('issued');

		// The destination truck's holder read shows it among its slot-less spares.
		const holder = await api(`/api/mro/assets/holder?vehicle=${TRUCK_DST}`);
		expect(holder.status).toBe(200);
		const units = (holder.body.data as { rows: Array<Record<string, unknown>> }).rows;
		expect(units.some((u) => u.serial_no === 'ATR-TY-6' && u.slot == null)).toBe(true);

		const ev = (await rows('cms_mro_serial_events', 'serial = ? AND deleted_at IS NULL', SERIAL)).filter((e) => e.ref_kind === 'ATR');
		expect(ev).toHaveLength(1);
		expect(ev[0].event).toBe('refitted');
		expect(ev[0].to_vehicle).toBe(TRUCK_DST);
		expect(ev[0].to_slot == null).toBe(true);
	});

	it('executes a RETURN request (`to_location`) — the holder lets go and the store takes the unit back', async () => {
		// A return is a custody change too: the direct `/return` route refuses it and the
		// request is the only way back, so the store balance and the holder clear in the
		// SAME guarded batch as the request's own status flip.
		const SERIAL = 'c1b00000-0000-4000-8000-000000000007';
		await seat(SERIAL, 'ATR-TY-7', TRUCK_SRC);

		// The direct route is refused — the holder cannot let go on their own.
		const direct = await api(`/api/mro/serials/${SERIAL}/return`, {
			method: 'POST',
			body: JSON.stringify({ to_location: 'safety_store', actor_id: REPORTER }),
		});
		expect(direct.status, direct.body.error).toBe(403);
		expect((await row('cms_mro_stock_serials', 'id = ?', SERIAL))?.status).toBe('issued');

		// FILE the return — its KIND is the `to_location` field, not a mode flag.
		const filed = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			to_location: 'safety_store',
			note: 'worn out of spec — send back',
		});
		expect(filed.status, filed.body.error).toBe(201);
		const id = String((filed.body.data as Record<string, unknown>).id);
		expect((filed.body.data as Record<string, unknown>).to_location).toBe('safety_store');

		expect((await decide(id, 'approve', supToken)).status).toBe(201);
		const exec = await decide(id, 'execute', supToken);
		expect(exec.status, exec.body.error).toBe(201);

		const back = await row('cms_mro_stock_serials', 'id = ?', SERIAL);
		expect(back?.status).toBe('in_stock');
		expect(back?.location).toBe('safety_store');
		expect(back?.vehicle == null).toBe(true);
		expect(back?.slot == null).toBe(true);
		expect((await row('cms_mro_asset_requests', 'id = ?', id))?.status).toBe('executed');

		// The lifecycle cites the document, and the event is a RETURN, not a move.
		const ev = (await rows('cms_mro_serial_events', 'serial = ? AND deleted_at IS NULL', SERIAL)).filter((e) => e.ref_kind === 'ATR');
		expect(ev).toHaveLength(1);
		expect(ev[0].event).toBe('returned');
		expect(ev[0].from_vehicle).toBe(TRUCK_SRC);
		expect(ev[0].to_location).toBe('safety_store');
	});

	it('lets the superior reject with a reason, and a rejected request can never execute', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-000000000003';
		await seat(SERIAL, 'ATR-TY-3', TRUCK_SRC);
		const filed = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			to_vehicle: TRUCK_DST,
			to_slot: 'drive-l',
		});
		const id = String((filed.body.data as Record<string, unknown>).id);

		const rejected = await decide(id, 'reject', supToken, { reason: 'no spare at destination' });
		expect(rejected.status, rejected.body.error).toBe(201);
		const refused = await row('cms_mro_asset_requests', 'id = ?', id);
		expect(refused?.status).toBe('rejected');
		expect(refused?.rejected_reason).toBe('no spare at destination');
		expect(refused?.approved_by).toBe(APPROVER);

		// Never moves, never executes.
		expect((await decide(id, 'execute', supToken)).status).toBe(409);
		expect((await row('cms_mro_stock_serials', 'id = ?', SERIAL))?.vehicle).toBe(TRUCK_SRC);
	});

	it('lets an admin decide a request even without a recorded reporting line', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-000000000004';
		await seat(SERIAL, 'ATR-TY-4', TRUCK_SRC);
		const filed = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			to_vehicle: TRUCK_DST,
			to_slot: 'drive-l',
		});
		const id = String((filed.body.data as Record<string, unknown>).id);

		// The trusted root may name the decider; the two-person rule still holds.
		const byAdmin = await decide(id, 'approve', 'dev-token', { actor_id: APPROVER });
		expect(byAdmin.status, byAdmin.body.error).toBe(201);
		expect((await row('cms_mro_asset_requests', 'id = ?', id))?.approved_by).toBe(APPROVER);
	});

	it('feeds an approver only the requests they may decide, and tracks them by status', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-000000000005';
		await seat(SERIAL, 'ATR-FEED-1', TRUCK_SRC);
		const filed = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			to_vehicle: TRUCK_DST,
			to_slot: 'drive-l',
		});
		const id = String((filed.body.data as Record<string, unknown>).id);
		const feed = (query: string, token: string) => api(`/api/mro/asset-requests${query}`, { headers: as(token) });
		const feedRows = (body: unknown) => (body as { data: { rows: Array<Record<string, unknown>> } }).data.rows;

		// The recorded superior sees the decide queue, display-ready (no client join).
		const sup = await feed('?status=requested', supToken);
		expect(sup.status, sup.body.error).toBe(200);
		const supRow = feedRows(sup.body).find((r) => r.id === id);
		expect(supRow).toBeTruthy();
		expect(supRow?.serial_no).toBe('ATR-FEED-1');
		expect(supRow?.from_plate).toBe('ATR-SRC');
		expect(supRow?.to_plate).toBe('ATR-DST');
		expect(supRow?.requested_by).toBe(REPORTER);
		expect(supRow?.requested_by_name).toBe('Report Operator');

		// A peer with no reporting line gets nothing — deny-by-default, not an error.
		const peer = await feed('?status=requested', othToken);
		expect(peer.status, peer.body.error).toBe(200);
		expect(feedRows(peer.body)).toHaveLength(0);

		// Server-side search by serial narrows to it.
		const found = await feed('?status=requested&search=ATR-FEED-1', supToken);
		expect(feedRows(found.body).some((r) => r.id === id)).toBe(true);

		// Approved → it leaves the decide queue and surfaces in the tracking set.
		expect((await decide(id, 'approve', supToken)).status).toBe(201);
		expect(feedRows((await feed('?status=requested', supToken)).body).some((r) => r.id === id)).toBe(false);
		const trackingRow = feedRows((await feed('?status=approved,executed', supToken)).body).find((r) => r.id === id);
		expect(trackingRow?.status).toBe('approved');
		expect(trackingRow?.approved_by_name).toBe('Approving Operator');

		// The admin (trusted root) sees every request regardless of reporting line.
		const admin = await feed('?status=approved,executed', 'dev-token');
		expect(feedRows(admin.body).some((r) => r.id === id)).toBe(true);
	});

	it('files a WRITE-OFF (no destination) and scraps the unit only when the superior executes it', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-00000000000b';
		await seat(SERIAL, 'ATR-WO-1', TRUCK_SRC);

		// FILE — a write-off names NO destination, so the kind guard lets it through and
		// nothing changes yet: the unit is still on its seat.
		const filed = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			write_off: true,
			note: 'sidewall cut — beyond repair',
		});
		expect(filed.status, filed.body.error).toBe(201);
		const id = String((filed.body.data as Record<string, unknown>).id);
		expect((await row('cms_mro_asset_requests', 'id = ?', id))?.status).toBe('requested');
		const seated = await row('cms_mro_stock_serials', 'id = ?', SERIAL);
		expect(seated?.status).toBe('issued');
		expect(seated?.vehicle).toBe(TRUCK_SRC);

		// The feed states the KIND, so the approver's card can name what it authorises —
		// a write-off, not a move some other row would then run differently.
		const feedRows = (body: unknown) => (body as { data: { rows: Array<Record<string, unknown>> } }).data.rows;
		const queue = feedRows((await api('/api/mro/asset-requests?status=requested', { headers: as(supToken) })).body);
		const feedRow = queue.find((r) => r.id === id);
		expect(feedRow?.write_off).toBe(true);
		expect(feedRow?.to_plate == null && feedRow?.to_employee == null && feedRow?.to_location == null).toBe(true);

		// Two-person: the requester decides nothing, not even their own write-off.
		expect((await decide(id, 'approve', reqToken)).status).toBe(409);
		expect((await decide(id, 'execute', supToken)).status).toBe(409); // not approved yet
		expect((await decide(id, 'approve', supToken)).status).toBe(201);

		// EXECUTE — the unit leaves the truck in that ONE batch (seat + holder cleared,
		// no store balance touched) and the request flips to executed.
		const executed = await decide(id, 'execute', supToken);
		expect(executed.status, executed.body.error).toBe(201);
		const gone = await row('cms_mro_stock_serials', 'id = ?', SERIAL);
		expect(gone?.status).toBe('scrapped');
		expect(gone?.vehicle == null).toBe(true);
		expect(gone?.slot == null).toBe(true);
		expect((await row('cms_mro_asset_requests', 'id = ?', id))?.status).toBe('executed');

		// …and the history names the document that authorised the write-off.
		const events = await api(`/api/mro/serials/${SERIAL}/events`, { headers: as(supToken) });
		const newest = (events.body.data as { rows: Array<Record<string, unknown>> }).rows[0];
		expect(newest.event).toBe('written_off');
		expect(newest.ref_kind).toBe('ATR');
		expect(String(newest.ref_doc)).toBe(String((filed.body.data as Record<string, unknown>).display_number));
	});

	it('refuses a write-off that also names a destination — at create AND on update', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-00000000000c';
		await seat(SERIAL, 'ATR-WO-2', TRUCK_SRC);

		// Both shapes at once: a destination would make the execute relocate a unit the
		// requester filed for scrap — the compiled kind guard owns that contradiction.
		const both = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			write_off: true,
			to_vehicle: TRUCK_DST,
		});
		expect(both.status, both.body.error ?? '').toBe(400);
		expect(both.body.error).toMatch(/names no destination/i);

		// …and the same through an UPDATE: a live transfer cannot be turned into one.
		const filed = await file(reqToken, {
			serial: SERIAL,
			from_vehicle: TRUCK_SRC,
			from_slot: 'drive-l',
			to_vehicle: TRUCK_DST,
		});
		const id = String((filed.body.data as Record<string, unknown>).id);
		const sneaky = await api(`/api/entities/mro_asset_requests/${id}`, {
			method: 'PUT',
			headers: as(reqToken),
			body: JSON.stringify({ write_off: true }),
		});
		expect(sneaky.status, sneaky.body.error ?? '').toBe(400);
		expect(Boolean((await row('cms_mro_asset_requests', 'id = ?', id))?.write_off)).toBe(false);
	});

	it('refuses to write off a unit that left the source the request recorded', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-00000000000d';
		await seat(SERIAL, 'ATR-WO-3', TRUCK_SRC);
		const filed = await file(reqToken, { serial: SERIAL, from_vehicle: TRUCK_SRC, from_slot: 'drive-l', write_off: true });
		const id = String((filed.body.data as Record<string, unknown>).id);
		expect((await decide(id, 'approve', supToken)).status).toBe(201);

		// The wheel moved after the sign-off (a rotation nobody filed through THIS
		// request) — the pin refuses rather than scrapping the unit from its new seat.
		await env.DB.prepare('UPDATE cms_mro_stock_serials SET slot = ? WHERE id = ?').bind('drive-r', SERIAL).run();
		const stale = await decide(id, 'execute', supToken);
		expect(stale.status, stale.body.error ?? '').toBe(409);
		const untouched = await row('cms_mro_stock_serials', 'id = ?', SERIAL);
		expect(untouched?.status).toBe('issued');
		expect(untouched?.slot).toBe('drive-r');
	});

	it('notifies the requester’s superior on file and the requester on decide', async () => {
		const SERIAL = 'c1b00000-0000-4000-8000-00000000000e';
		await seat(SERIAL, 'ATR-NOTIFY', TRUCK_SRC);
		const filed = await file(reqToken, { serial: SERIAL, from_vehicle: TRUCK_SRC, from_slot: 'drive-l', to_vehicle: TRUCK_DST });
		expect(filed.status, filed.body.error).toBe(201);
		const id = String((filed.body.data as Record<string, unknown>).id);

		// FILED rides a fire-and-forget hook — poll for the superior's durable row.
		let filedRows: Array<Record<string, unknown>> = [];
		for (let attempt = 0; attempt < 40 && filedRows.length === 0; attempt++) {
			filedRows = await rows('cms_hr_notifications', 'reference_id = ?', id);
			if (filedRows.length === 0) await new Promise((resolve) => setTimeout(resolve, 25));
		}
		const toSuperior = filedRows.find((r) => r.tg_id === 'atr-approver');
		expect(toSuperior, 'superior notified on file').toBeTruthy();
		expect(toSuperior?.type).toBe('approval');
		// The requester is NOT told they filed their own request.
		expect(filedRows.some((r) => r.tg_id === 'atr-reporter')).toBe(false);

		// DECIDED is awaited by the route — the row is present when it returns.
		expect((await decide(id, 'approve', supToken)).status).toBe(201);
		const decided = await rows('cms_hr_notifications', 'reference_id = ?', id);
		const toRequester = decided.find((r) => r.tg_id === 'atr-reporter');
		expect(toRequester, 'requester notified on decide').toBeTruthy();
		expect(toRequester?.type).toBe('info');
		expect(String(toRequester?.title)).toContain('✅');
	});
});

describe('serial lifecycle history — complete lineage, never a silently truncated window', () => {
	it('returns EVERY event for a serial, newest first (no 200-row cap)', async () => {
		const SERIAL = 'd1b00000-0000-4000-8000-000000000001';
		await insert('cms_mro_stock_serials', {
			id: SERIAL,
			model: M_SERIAL,
			location: 'safety_store',
			serial_no: 'LINEAGE-1',
			status: 'issued',
			vehicle: V_FLEET,
			slot: 'drive-l',
		});
		// 205 inspections — PAST the old hard `LIMIT 200`, which silently dropped the
		// oldest events from the immutable history (a tyre accumulates a decade of
		// check readings). The order key is (created_at, id), so each i is unique and
		// strictly newer than the last.
		const TOTAL = 205;
		for (let i = 0; i < TOTAL; i += 15) {
			const chunk = Array.from({ length: Math.min(15, TOTAL - i) }, (_, k) => {
				const n = i + k;
				const at = new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
				return {
					id: `d1e00000-0000-4000-8000-${String(n).padStart(12, '0')}`,
					serial: SERIAL,
					event: 'checked',
					created_at: at,
					updated_at: at,
				};
			});
			const cols = Object.keys(chunk[0]);
			const values = chunk.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
			await env.DB.prepare(`INSERT INTO cms_mro_serial_events (${cols.join(', ')}) VALUES ${values}`)
				.bind(...chunk.flatMap((r) => cols.map((c) => (r as Record<string, unknown>)[c] as never)))
				.run();
		}

		const res = await api(`/api/mro/serials/${SERIAL}/events`);
		expect(res.status, res.body.error).toBe(200);
		const list = (res.body.data as { rows: Array<Record<string, unknown>> }).rows;
		// The whole lineage, not the newest 200 — nothing silently lost.
		expect(list).toHaveLength(TOTAL);
		expect(list[0].created_at).toBe(new Date(Date.UTC(2026, 0, 1, 0, 0, TOTAL - 1)).toISOString());
		expect(list[list.length - 1].created_at).toBe(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)).toISOString());
	});
});

// ── Enterprise search modes (generic ?search=) ──────────────────────────────
// A large, searched collection opts into the INDEX-BACKED `prefix` shape (SAP/Odoo
// type-ahead); every other collection keeps substring `contains`. Both modes escape
// the term, so a literal `%`/`_` is never a wildcard. The mro_stock_serials mirror
// above declares `search: { mode: 'prefix', fields: ['serial_no'] }` (schema-defs.json).
describe('enterprise search modes — index-backed prefix vs substring contains', () => {
	const putSearch = (patch: Record<string, unknown>) =>
		api('/api/collections/mro_stock_serials/policies', { method: 'PUT', body: JSON.stringify({ search: patch }) });

	const searchList = async (term: string) => {
		const res = await api(`/api/entities/mro_stock_serials?search=${encodeURIComponent(term)}&limit=50`);
		expect(res.status, res.body.error).toBe(200);
		return res.body.data as Array<Record<string, unknown>>;
	};

	it('prefix matches only the anchored prefix; contains finds mid-string; a literal % is never a wildcard', async () => {
		// Three serials: two share the searched prefix, one carries it mid-string only.
		const seeds: Array<[string, string]> = [
			['d15e0000-0000-4000-8000-000000000001', 'QRY-ALPHA-1'],
			['d15e0000-0000-4000-8000-000000000002', 'QRY-ALPHA-2'],
			['d15e0000-0000-4000-8000-000000000003', 'ZZZ-QRY-ALPHA-3'],
		];
		for (const [id, serial_no] of seeds) {
			await insert('cms_mro_stock_serials', { id, model: M_SERIAL, location: 'safety_store', serial_no, status: 'in_stock' });
		}

		// Declared mode is `prefix` over the indexed `serial_no` — the mid-string unit
		// is OUT (its row cannot sit in the index range), which is exactly what makes
		// the type-ahead a bounded seek instead of a full scan.
		const prefix = await searchList('QRY-ALPHA');
		expect(prefix.map((r) => r.serial_no).sort()).toEqual(['QRY-ALPHA-1', 'QRY-ALPHA-2']);

		// Flip to `contains` through the same control plane — no redeploy, the very next
		// read reflects it — and the mid-string unit matches. The two modes are independent.
		const toContains = await putSearch({ mode: 'contains' });
		expect(toContains.status, toContains.body.error).toBe(200);
		const contains = await searchList('QRY-ALPHA');
		expect(contains.map((r) => r.serial_no).sort()).toEqual(['QRY-ALPHA-1', 'QRY-ALPHA-2', 'ZZZ-QRY-ALPHA-3']);

		// A literal `%` is data, not a wildcard: unescaped it would match EVERY row
		// (a silently-wrong authoritative result), and `ALPHA%2` would spuriously match
		// `QRY-ALPHA-2`. Both now match nothing because neither serial contains those bytes.
		expect(await searchList('%')).toHaveLength(0);
		expect(await searchList('ALPHA%2')).toHaveLength(0);

		// Restore the declared policy so the shared fixture is left exactly as mirrored.
		const restore = await putSearch({ mode: 'prefix', fields: ['serial_no'] });
		expect(restore.status, restore.body.error).toBe(200);
	});

	it('rejects a malformed search patch at the control plane instead of storing it', async () => {
		expect((await putSearch({ mode: 'fuzzy' })).status).toBe(400);
		expect((await putSearch({ fields: ['serial_no', ''] })).status).toBe(400);
		// The rejected patches were never written — the declared policy still holds.
		const current = await api('/api/collections/mro_stock_serials/policies/resolved');
		expect((current.body.data as { search: unknown }).search).toEqual({ mode: 'prefix', fields: ['serial_no'] });
	});
});

// ── F6 — posted documents are immutable through the generic API ──────────────
// A confirmed header is frozen (`writes.freeze_when` on doc_status=confirmed) and
// its lines are document-owned (`writes.mode: service`) — the ERP rule: you REVERSE
// a posted document, you never edit it. Drafts stay fully editable.
describe('posted-document immutability — confirmed headers and their lines are frozen', () => {
	it('blocks generic edits to a confirmed header and its lines, but a draft stays editable', async () => {
		const d = await inboundDraft([{ item_model: M_STD, qty: 2 }]);
		const headerId = d.id as string;
		expect(d.doc_status).toBe('draft');

		// A DRAFT header is still editable through the generic API.
		const draftEdit = await api(`/api/entities/mro_inbounds/${headerId}`, { method: 'PUT', body: JSON.stringify({ note: 'draft note' }) });
		expect(draftEdit.status, draftEdit.body.error).toBe(200);

		expect((await confirm('inbounds', headerId, { approved_by: APPROVER })).status).toBe(201);
		const line = (await rows('cms_mro_inbound_lines', 'parent_id = ?', headerId))[0];
		expect(line).toBeTruthy();

		// Confirmed header: update / delete are refused (frozen state), even for an admin.
		expect(
			(await api(`/api/entities/mro_inbounds/${headerId}`, { method: 'PUT', body: JSON.stringify({ note: 'tampered' }) })).status,
		).toBe(403);
		expect((await api(`/api/entities/mro_inbounds/${headerId}`, { method: 'DELETE' })).status).toBe(403);

		// Its lines are document-owned: the generic line API can neither edit, add nor delete.
		const lineId = line.id as string;
		expect((await api(`/api/entities/mro_inbound_lines/${lineId}`, { method: 'PUT', body: JSON.stringify({ qty: 999 }) })).status).toBe(
			403,
		);
		expect(
			(
				await api('/api/entities/mro_inbound_lines', {
					method: 'POST',
					body: JSON.stringify({ parent_id: headerId, item_model: M_STD, qty: 1 }),
				})
			).status,
		).toBe(403);
		expect((await api(`/api/entities/mro_inbound_lines/${lineId}`, { method: 'DELETE' })).status).toBe(403);

		// The recorded line is untouched — the write never reached D1.
		expect(Number((await row('cms_mro_inbound_lines', 'id = ?', lineId))?.qty)).toBe(2);
	});

	it('a document-owned child line is refused even while its parent is still a draft', async () => {
		const d = await inboundDraft([{ item_model: M_STD, qty: 1 }]);
		const line = (await rows('cms_mro_inbound_lines', 'parent_id = ?', d.id as string))[0];
		// The parent is a draft, but the LINE is document-owned regardless of state —
		// it is only ever written through the parent's `lines` field or by the service.
		expect(
			(await api(`/api/entities/mro_inbound_lines/${line.id as string}`, { method: 'PUT', body: JSON.stringify({ qty: 5 }) })).status,
		).toBe(403);
	});

	it('rejects a malformed writes.freeze_when at the control plane', async () => {
		const emptyValues = await api('/api/collections/mro_inbounds/policies', {
			method: 'PUT',
			body: JSON.stringify({ writes: { freeze_when: { field: 'doc_status', values: [] } } }),
		});
		expect(emptyValues.status).toBe(400);
		const noField = await api('/api/collections/mro_inbounds/policies', {
			method: 'PUT',
			body: JSON.stringify({ writes: { freeze_when: { values: ['confirmed'] } } }),
		});
		expect(noField.status).toBe(400);
	});
});

describe('confirm audit identity — received_by', () => {
	// Own model + store cell so no other test's exact balance assertions move.
	const loc = 'mandalay_store' as const;
	const M_RECEIVER = 'dddd0000-0000-4000-8000-0000000000b1';

	beforeAll(async () => {
		await insert('cms_mro_item_model', { id: M_RECEIVER, name_en: 'Receiver Probe', item_name: G_STD });
	});

	it('stamps the confirming actor on the inbound header and never rewrites it on replay', async () => {
		const d = await inboundDraft([{ item_model: M_RECEIVER, qty: 3 }], {}, loc);
		expect((await row('cms_mro_inbounds', 'id = ?', d.id))?.received_by).toBeNull();

		const confirmed = await confirm('inbounds', d.id as string, { received_by: APPROVER });
		expect(confirmed.status).toBe(201);
		expect((await row('cms_mro_inbounds', 'id = ?', d.id))?.received_by).toBe(APPROVER);

		// Replay is a no-op — a second confirm can never overwrite WHO booked it in.
		await confirm('inbounds', d.id as string, { received_by: REPORTER });
		expect((await row('cms_mro_inbounds', 'id = ?', d.id))?.received_by).toBe(APPROVER);
	});
});

describe('inbound counterparty — a vendor for a purchase, an employee otherwise', () => {
	// Own model + store cell so no other test's exact balance assertions move.
	const loc = 'vehicle_store' as const;
	const M_PARTY = 'dddd0000-0000-4000-8000-0000000000b2';

	beforeAll(async () => {
		await insert('cms_mro_item_model', { id: M_PARTY, name_en: 'Party Probe', item_name: G_STD });
	});

	/** POST a header directly (the helper asserts 201 — this checks the status). */
	const draft = (body: Record<string, unknown>) =>
		api('/api/entities/mro_inbounds', {
			method: 'POST',
			body: JSON.stringify({ purchase_date: mmtToday(), type: 'purchase', location: loc, lines: [], ...body }),
		});

	it('requires the supplier for a purchase, and files it with the vendor recorded', async () => {
		const missing = await draft({ type: 'purchase' });
		expect(missing.status).toBe(400);
		expect(String(missing.body.error)).toMatch(/supplier/i);

		const filed = await draft({ type: 'purchase', supplier: SUP });
		expect(filed.status).toBe(201);
		expect((filed.body.data as Record<string, unknown>).supplier).toBe(SUP);
	});

	it('requires the EMPLOYEE for a return / opening balance, not a supplier', async () => {
		for (const type of ['return', 'legacy'] as const) {
			const missing = await draft({ type });
			expect(missing.status, `${type} without handed_by`).toBe(400);
			expect(String(missing.body.error)).toMatch(/handed_by/i);
		}

		// A person, no vendor — the receiving store is NOT the counterparty.
		const ret = await draft({ type: 'return', handed_by: REPORTER });
		expect(ret.status).toBe(201);
		const retRow = await row('cms_mro_inbounds', 'id = ?', (ret.body.data as Record<string, unknown>).id);
		expect(retRow?.handed_by).toBe(REPORTER);
		expect(retRow?.supplier).toBeNull();

		const opening = await draft({ type: 'legacy', handed_by: APPROVER });
		expect(opening.status).toBe(201);
		expect((await row('cms_mro_inbounds', 'id = ?', (opening.body.data as Record<string, unknown>).id))?.handed_by).toBe(APPROVER);
	});
});

describe('inbound payment ledger — the receipt mirrors what the ledger says', () => {
	// Own model + store cell: the money assertions must not depend on any other
	// test's document.
	const loc = 'safety_store' as const;
	const M_PAY = 'dddd0000-0000-4000-8000-0000000000b3';

	beforeAll(async () => {
		await insert('cms_mro_item_model', { id: M_PAY, name_en: 'Pay Probe', item_name: G_STD });
	});

	/** A CONFIRMED purchase of `qty × 1000` — the only state that can be paid. */
	async function confirmedReceipt(qty = 3) {
		const draftRow = await inboundDraft([{ item_model: M_PAY, qty, unit_price: 1000 }], {}, loc);
		const id = draftRow.id as string;
		expect((await confirm('inbounds', id)).status, 'confirm').toBeLessThan(300);
		return id;
	}

	const pay = (body: Record<string, unknown>) =>
		api('/api/entities/mro_inbound_payments', {
			method: 'POST',
			body: JSON.stringify({ method: 'cash', ...body }),
		});

	const mirrorOf = (id: string) => row('cms_mro_inbounds', 'id = ?', id);

	/**
	 * The mirror is written by a FIRE-AND-FORGET hook on the generic write path, so
	 * it lands a tick after the response — poll until the expected state shows (and
	 * return the last read so a failing assertion prints the real value). The
	 * DEDICATED route (`POST /api/mro/inbounds/:id/payments`) awaits it instead;
	 * both are exercised below.
	 */
	async function mirrorUntil(id: string, ready: (row: Record<string, unknown>) => boolean): Promise<Record<string, unknown> | null> {
		for (let attempt = 0; attempt < 40; attempt++) {
			const current = await mirrorOf(id);
			if (current && ready(current)) return current;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		return mirrorOf(id);
	}

	it('starts fully unpaid, goes partial, then settles — stamping the day it settled', async () => {
		const id = await confirmedReceipt(3); // 3,000 Ks
		const fresh = await mirrorOf(id);
		expect(fresh?.total_amount).toBe(3000);
		expect(Number(fresh?.paid_amount ?? 0)).toBe(0);
		expect(fresh?.payment_status).toBe('unpaid');
		expect(fresh?.fully_paid_on).toBeNull();

		// 1st instalment — half the invoice.
		const first = await pay({ parent_id: id, paid_on: '2026-09-05', amount: 1500 });
		expect(first.status, 'first payment').toBe(201);
		const partial = await mirrorOf(id);
		expect(Number(partial?.paid_amount)).toBe(1500);
		expect(partial?.payment_status).toBe('partial');
		expect(partial?.fully_paid_on, 'not settled yet').toBeNull();

		// 2nd instalment — clears it: the day it SETTLED is that payment's day.
		const second = await pay({ parent_id: id, paid_on: '2026-09-20', amount: 1500, method: 'bank', reference: 'TRF-77' });
		expect(second.status, 'second payment').toBe(201);
		const settled = await mirrorOf(id);
		expect(Number(settled?.paid_amount)).toBe(3000);
		expect(settled?.payment_status).toBe('paid');
		expect(settled?.fully_paid_on).toBe('2026-09-20');
		expect(Number(settled?.updated_at ? 1 : 0)).toBe(1);

		// The ledger itself answers "which day did we pay how much".
		const ledger = await api(`/api/entities/mro_inbound_payments?filter[parent_id]=${id}&sort=paid_on`);
		expect(ledger.status).toBe(200);
		const rows = (ledger.body.data as Array<Record<string, unknown>>) ?? [];
		expect(rows.map((r) => [r.paid_on, Number(r.amount)])).toEqual([
			['2026-09-05', 1500],
			['2026-09-20', 1500],
		]);
	});

	it('un-settles the receipt when the entry that cleared it is removed', async () => {
		const id = await confirmedReceipt(2); // 2,000 Ks
		await pay({ parent_id: id, paid_on: '2026-09-02', amount: 1000 });
		const last = await pay({ parent_id: id, paid_on: '2026-09-09', amount: 1000 });
		// Trash / restore are AWAITED by the engine, so the mirror is already stepped
		// back when the delete response lands — no polling needed below.
		expect((await mirrorUntil(id, (r) => r.payment_status === 'paid'))?.payment_status).toBe('paid');
		const lastId = (last.body.data as Record<string, unknown>).id as string;

		// Trash the final entry — a soft delete, and the mirror steps back with it.
		const removed = await api(`/api/entities/mro_inbound_payments/${lastId}`, { method: 'DELETE' });
		expect(removed.status).toBe(200);
		const after = await mirrorOf(id);
		expect(Number(after?.paid_amount)).toBe(1000);
		expect(after?.payment_status).toBe('partial');
		expect(after?.fully_paid_on, 'no longer settled').toBeNull();

		// Restoring it settles the receipt again, on the same day — the mirror is a
		// function of the LIVE ledger, not of a write ever having happened.
		expect((await api(`/api/entities/mro_inbound_payments/${lastId}/restore`, { method: 'POST' })).status).toBe(200);
		expect((await mirrorOf(id))?.fully_paid_on).toBe('2026-09-09');
	});

	it('lets a receipt-writer remove an entry through the domain route, with NO delete grant on the ledger', async () => {
		// The reported bug: the generic DELETE is RBAC-gated on the LEDGER collection,
		// and no operational role carries `can_delete` there (the standard grant set is
		// read/write/create/submit — see `scripts/reconcile-storekeeper-role.mjs`, where
		// the ledger is deliberately read-only), so a storekeeper met
		//   `You do not have "delete" permission on "mro_inbound_payments"`.
		// The domain route gates on `write` for the RECEIPT whose money changes.
		const id = await confirmedReceipt(2); // 2,000 Ks
		const filed = await pay({ parent_id: id, paid_on: '2026-09-04', amount: 1000 });
		const paymentId = (filed.body.data as Record<string, unknown>).id as string;
		await pay({ parent_id: id, paid_on: '2026-09-12', amount: 1000 });
		expect((await mirrorUntil(id, (r) => r.payment_status === 'paid'))?.payment_status).toBe('paid');

		// A storekeeper-like role: write on the receipt, READ-ONLY on its ledger.
		const role = crypto.randomUUID();
		const user = crypto.randomUUID();
		await env.DB.prepare('INSERT INTO _roles (id, name, description, is_system) VALUES (?, ?, ?, 0)')
			.bind(role, `ReceiptPay-${role.slice(0, 8)}`, 'test')
			.run();
		const grant = env.DB.prepare(
			'INSERT INTO _role_permissions (id, role_id, collection_slug, can_read, can_write, can_create, can_delete, can_approve, can_submit) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
		);
		// mro_inbounds: read/write/create/submit, no delete (the confirm + payment gate).
		await grant.bind(crypto.randomUUID(), role, 'mro_inbounds', 1, 1, 1, 0, 1).run();
		// mro_inbound_payments: READ only — `can_delete` stays 0, like every real role.
		await grant.bind(crypto.randomUUID(), role, 'mro_inbound_payments', 1, 0, 0, 0, 0).run();
		await env.DB.prepare("INSERT INTO _users (id, email, full_name, password_hash, role_id, status) VALUES (?, ?, ?, 'x', ?, 'active')")
			.bind(user, `receiptpay-${user.slice(0, 8)}@test.local`, 'Receipt Pay Probe', role)
			.run();
		const token = await new AuthService(new D1Client(env.DB)).generateToken(
			user,
			(env as unknown as Record<string, string>).JWT_SECRET,
			APPROVER,
		);
		const asOperator = { Authorization: `Bearer ${token}` };

		// 1. The generic delete is REFUSED — the exact message the operator reported.
		const generic = await api(`/api/entities/mro_inbound_payments/${paymentId}`, { method: 'DELETE', headers: asOperator });
		expect(generic.status).toBe(403);
		expect(String(generic.body.error)).toMatch(/do not have "delete" permission on "mro_inbound_payments"/);
		expect((await row('cms_mro_inbound_payments', 'id = ?', paymentId))?.deleted_at ?? null).toBeNull();

		// 2. The domain route removes it AND steps the mirror back in the SAME response.
		const removed = await api(`/api/mro/inbounds/${id}/payments/${paymentId}`, { method: 'DELETE', headers: asOperator });
		expect(removed.status, JSON.stringify(removed.body)).toBe(200);
		expect((removed.body.data as { payment: { paidAmount: number; status: string } }).payment).toMatchObject({
			paidAmount: 1000,
			status: 'partial',
		});
		expect((await row('cms_mro_inbound_payments', 'id = ?', paymentId))?.deleted_at).toBeTruthy();
		expect(Number((await mirrorOf(id))?.paid_amount)).toBe(1000);
		expect((await mirrorOf(id))?.fully_paid_on, 'no longer settled').toBeNull();

		// 3. The receipt is part of the row's IDENTITY: another receipt's payment is
		//    refused, because there the mirror of the WRONG document would be derived.
		const other = await confirmedReceipt(1);
		const elsewhere = await api(`/api/mro/inbounds/${other}/payments/${paymentId}`, { method: 'DELETE', headers: asOperator });
		expect(elsewhere.status).toBe(409);

		// 4. A replay (or a double tap) is a no-op that still answers with the receipt's
		//    CURRENT money state — never a stale one, and never a second delete.
		const replay = await api(`/api/mro/inbounds/${id}/payments/${paymentId}`, { method: 'DELETE', headers: asOperator });
		expect(replay.status).toBe(200);
		expect((replay.body.data as { payment: { paidAmount: number } }).payment.paidAmount).toBe(1000);

		// 5. An id that never existed is a plain 404 (nothing was derived).
		const missing = await api(`/api/mro/inbounds/${id}/payments/${crypto.randomUUID()}`, {
			method: 'DELETE',
			headers: asOperator,
		});
		expect(missing.status).toBe(404);
	});

	it('files the receipt’s ONE payment when the draft said paid at receipt', async () => {
		// A counter sale: the money arrives WITH the goods, so the draft says so and the
		// CONFIRM files the ledger entry. The client never sends money — the amount is
		// the total the confirm itself computes.
		const draftRow = await inboundDraft(
			[{ item_model: M_PAY, qty: 3, unit_price: 1200 }],
			{ paid_at_receipt: true, purchase_date: '2026-09-16' },
			loc,
		);
		const id = draftRow.id as string;

		const confirmed = await api(`/api/mro/inbounds/${id}/confirm`, {
			method: 'POST',
			body: JSON.stringify({ received_by: APPROVER }),
		});
		expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(201);
		// The response already carries the settled mirror — the route AWAITS the
		// derivation, so a screen that refreshes on the response is never stale.
		expect((confirmed.body.data as { payment: { paidAmount: number; status: string; fullyPaidOn: string } }).payment).toMatchObject({
			paidAmount: 3600,
			status: 'paid',
			fullyPaidOn: '2026-09-16',
		});

		// ONE ledger entry: the total, the receipt day, the confirming actor, and its
		// own explanation (the sheet shows the note under the amount).
		const ledger = await rows('cms_mro_inbound_payments', 'parent_id = ?', id);
		expect(ledger).toHaveLength(1);
		expect(Number(ledger[0].amount)).toBe(3600);
		expect(String(ledger[0].paid_on).slice(0, 10)).toBe('2026-09-16');
		expect(ledger[0].recorded_by).toBe(APPROVER);
		expect(String(ledger[0].note)).toMatch(/paid in full at receipt/i);

		// …so the header reads settled with nothing left, and no second step at the counter.
		const mirrored = await mirrorOf(id);
		expect(Number(mirrored?.paid_amount)).toBe(3600);
		expect(mirrored?.payment_status).toBe('paid');
		expect(mirrored?.fully_paid_on).toBe('2026-09-16');

		// A replay of the confirm is a no-op — it can never file a SECOND entry.
		expect((await api(`/api/mro/inbounds/${id}/confirm`, { method: 'POST', body: JSON.stringify({}) })).status).toBe(201);
		expect(await rows('cms_mro_inbound_payments', 'parent_id = ?', id)).toHaveLength(1);
	});

	it('refuses paid-at-receipt where it would file a payment nothing justifies', async () => {
		// An opening balance owes nobody — the flag is refused, and the draft does not move.
		const legacy = await inboundDraft(
			[{ item_model: M_PAY, qty: 1, unit_price: 500 }],
			{ type: 'legacy', handed_by: APPROVER, paid_at_receipt: true },
			loc,
		);
		const refusedKind = await api(`/api/mro/inbounds/${legacy.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
		expect(refusedKind.status).toBe(400);
		expect(String(refusedKind.body.error)).toMatch(/only a purchase receipt/i);
		expect((await row('cms_mro_inbounds', 'id = ?', legacy.id as string))?.doc_status).toBe('draft');

		// A purchase with no unit prices has no total for a payment to settle.
		const unpriced = await inboundDraft([{ item_model: M_PAY, qty: 2 }], { paid_at_receipt: true }, loc);
		const refusedTotal = await api(`/api/mro/inbounds/${unpriced.id}/confirm`, { method: 'POST', body: JSON.stringify({}) });
		expect(refusedTotal.status).toBe(400);
		expect(String(refusedTotal.body.error)).toMatch(/needs a total/i);
		expect((await row('cms_mro_inbounds', 'id = ?', unpriced.id as string))?.doc_status).toBe('draft');
	});

	it('stamps the recorder from the session and freezes the money columns', async () => {
		const id = await confirmedReceipt(1); // 1,000 Ks
		const filed = await pay({ parent_id: id, paid_on: '2026-09-11', amount: 400, recorded_by: APPROVER });
		expect(filed.status).toBe(201);
		const paymentId = (filed.body.data as Record<string, unknown>).id as string;
		// An ADMIN may file on behalf of a named employee (the engine's actor binding
		// steps aside for an admin); every other caller gets the SESSION's employee
		// id and cannot name someone else — the mini app never sends the field.
		expect((await row('cms_mro_inbound_payments', 'id = ?', paymentId))?.recorded_by).toBe(APPROVER);

		// The amount is IMMUTABLE — a generic edit can never rewrite what was paid,
		// and the refusal names the correction path; the mirror is untouched.
		const edited = await api(`/api/entities/mro_inbound_payments/${paymentId}`, {
			method: 'PUT',
			body: JSON.stringify({ amount: 9999 }),
		});
		expect(edited.status).toBe(400);
		expect(String(edited.body.error)).toMatch(/cannot be edited/i);
		expect(Number((await row('cms_mro_inbound_payments', 'id = ?', paymentId))?.amount)).toBe(400);
		expect(Number((await mirrorOf(id))?.paid_amount)).toBe(400);

		// Only the free text stays correctable — the note may be reworded in place.
		const noted = await api(`/api/entities/mro_inbound_payments/${paymentId}`, {
			method: 'PUT',
			body: JSON.stringify({ note: 'handed to the driver' }),
		});
		expect(noted.status).toBe(200);
		expect((await row('cms_mro_inbound_payments', 'id = ?', paymentId))?.note).toBe('handed to the driver');
	});

	it('rejects a payment before the receipt has a value (a draft is not owed yet)', async () => {
		const draftRow = await inboundDraft([{ item_model: M_PAY, qty: 2, unit_price: 1000 }], {}, loc);
		const id = draftRow.id as string;
		// The ledger accepts the row (no business rule is broken), but the receipt has
		// no total yet, so the mirror stays `unpaid` with no settlement day — the UI
		// only offers the payment sheet on a confirmed receipt for exactly this reason.
		expect((await pay({ parent_id: id, paid_on: mmtToday(), amount: 500 })).status).toBe(201);
		const mirror = await mirrorOf(id);
		expect(Number(mirror?.paid_amount)).toBe(500);
		expect(mirror?.payment_status).toBe('unpaid');
		expect(mirror?.fully_paid_on).toBeNull();
	});

	it('keeps an unconfirmed receipt unpayable through the sheet but preserves an over-payment as `paid`', async () => {
		const id = await confirmedReceipt(1); // 1,000 Ks
		// The ledger records what actually left the till, so paying MORE than the
		// invoice settles it (left becomes 0) instead of corrupting the derivation.
		await pay({ parent_id: id, paid_on: '2026-09-30', amount: 1200 });
		const mirror = await mirrorOf(id);
		expect(Number(mirror?.paid_amount)).toBe(1200);
		expect(mirror?.payment_status).toBe('paid');
		expect(mirror?.fully_paid_on).toBe('2026-09-30');
	});

	it('starts fully unpaid, goes partial, then settles — stamping the day it settled', async () => {
		const id = await confirmedReceipt(3); // 3,000 Ks
		// A new/confirmed receipt takes its mirror from the header events — `unpaid`.
		const fresh = await mirrorUntil(id, (r) => r.payment_status === 'unpaid');
		expect(fresh?.total_amount).toBe(3000);
		expect(Number(fresh?.paid_amount ?? 0)).toBe(0);
		expect(fresh?.payment_status).toBe('unpaid');
		expect(fresh?.fully_paid_on).toBeNull();

		// 1st instalment — half the invoice.
		const first = await pay({ parent_id: id, paid_on: '2026-09-05', amount: 1500 });
		expect(first.status, 'first payment').toBe(201);
		const partial = await mirrorUntil(id, (r) => r.payment_status === 'partial');
		expect(Number(partial?.paid_amount)).toBe(1500);
		expect(partial?.payment_status).toBe('partial');
		expect(partial?.fully_paid_on, 'not settled yet').toBeNull();

		// 2nd instalment — clears it: the day it SETTLED is that payment's day.
		const second = await pay({ parent_id: id, paid_on: '2026-09-20', amount: 1500, method: 'bank', reference: 'TRF-77' });
		expect(second.status, 'second payment').toBe(201);
		const settled = await mirrorUntil(id, (r) => r.payment_status === 'paid');
		expect(Number(settled?.paid_amount)).toBe(3000);
		expect(settled?.payment_status).toBe('paid');
		expect(settled?.fully_paid_on).toBe('2026-09-20');

		// The ledger itself answers "which day did we pay how much".
		const ledger = await api(`/api/entities/mro_inbound_payments?filter[parent_id]=${id}&sort=paid_on`);
		expect(ledger.status).toBe(200);
		const rows = (ledger.body.data as Array<Record<string, unknown>>) ?? [];
		expect(rows.map((r) => [r.paid_on, Number(r.amount)])).toEqual([
			['2026-09-05', 1500],
			['2026-09-20', 1500],
		]);
	});

	it('records through the service route with the mirror already settled in the response', async () => {
		// The route is the mini app's path: same engine write, but the derivation is
		// AWAITED, so `data.payment` is the receipt's post-write state — no polling.
		const draftRow = await inboundDraft([{ item_model: M_PAY, qty: 4, unit_price: 1000 }], {}, loc);
		const id = draftRow.id as string;
		expect((await confirm('inbounds', id)).status).toBeLessThan(300);

		const half = await api(`/api/mro/inbounds/${id}/payments`, {
			method: 'POST',
			body: JSON.stringify({ paid_on: '2026-09-07', amount: 2500, method: 'cheque', reference: 'CHQ-1' }),
		});
		expect(half.status, 'route payment').toBe(201);
		expect((half.body.data as { payment: { status: string; paidAmount: number } }).payment).toMatchObject({
			paidAmount: 2500,
			status: 'partial',
		});

		const rest = await api(`/api/mro/inbounds/${id}/payments`, {
			method: 'POST',
			body: JSON.stringify({ paid_on: '2026-09-18', amount: 1500 }),
		});
		expect(rest.status).toBe(201);
		expect((rest.body.data as { payment: { status: string; fullyPaidOn: string } }).payment).toMatchObject({
			paidAmount: 4000,
			status: 'paid',
			fullyPaidOn: '2026-09-18',
		});
		const mirrored = await mirrorOf(id);
		expect(mirrored?.payment_status, 'the header agrees with the response').toBe('paid');
		expect(mirrored?.fully_paid_on).toBe('2026-09-18');

		// A payment with no date / a non-positive amount is refused up front.
		const bad = await api(`/api/mro/inbounds/${id}/payments`, {
			method: 'POST',
			body: JSON.stringify({ paid_on: '', amount: 0 }),
		});
		expect(bad.status).toBe(400);
	});

	it('repairs a stale / NULL mirror through the admin sweep, and is a no-op afterwards', async () => {
		// The pre-feature shape: the ledger is right, the header's three money columns
		// were never backfilled (NULL, which the client reads as `unpaid`). A report
		// reading the COLUMN directly deserves the truth, so the sweep re-derives it.
		const id = await confirmedReceipt(3); // 3,000 Ks
		await pay({ parent_id: id, paid_on: '2026-09-01', amount: 1000 });
		await pay({ parent_id: id, paid_on: '2026-09-15', amount: 2000 });
		expect((await mirrorUntil(id, (r) => r.payment_status === 'paid'))?.payment_status).toBe('paid');

		// Raw SQL on purpose: it fires NO hook, so the sweep is the only writer below.
		await env.DB.prepare('UPDATE cms_mro_inbounds SET paid_amount = NULL, payment_status = NULL, fully_paid_on = NULL WHERE id = ?')
			.bind(id)
			.run();
		expect((await mirrorOf(id))?.payment_status).toBeNull();

		const sweep = await api('/api/mro/inbounds/relink-payments', { method: 'POST' });
		expect(sweep.status).toBe(200);
		expect(Number((sweep.body.data as { relinked: number }).relinked)).toBeGreaterThanOrEqual(1);

		const healed = await mirrorOf(id);
		expect(Number(healed?.paid_amount)).toBe(3000);
		expect(healed?.payment_status).toBe('paid');
		expect(healed?.fully_paid_on, 'the day the last instalment cleared it').toBe('2026-09-15');

		// Idempotent — a second sweep on a correct receipt writes nothing.
		const stamp = healed?.updated_at;
		expect((await api('/api/mro/inbounds/relink-payments', { method: 'POST' })).status).toBe(200);
		expect((await mirrorOf(id))?.updated_at, 'a correct mirror is left byte-identical').toBe(stamp);

		// Admin-gated repair route — no session is a 401, never a silent rewrite.
		const anon = await SELF.fetch(`${BASE_URL}/api/mro/inbounds/relink-payments`, { method: 'POST' });
		expect(anon.status).toBe(401);
	});
});

describe('document cancellation — ONE verb, the DOCUMENT decides', () => {
	// A draft flips; a POSTED document is REVERSED in the same atomic batch; an
	// already-cancelled one is an idempotent no-op. The point of ONE verb is that a
	// client cannot pick the wrong one — and `cancelled` cannot mean "stock still
	// stands" to one screen and "stock put back" to another.
	//
	// Every assertion below is a BEFORE/AFTER pair on a balance cell this suite owns
	// (own models), so no other test's fixtures can move a number here.
	const loc = 'mandalay_store' as const;
	const M_CAN_STD = 'dddd0000-0000-4000-8000-0000000001a1';
	const M_CAN_REQ = 'dddd0000-0000-4000-8000-0000000001a2';
	const M_CAN_ADJ = 'dddd0000-0000-4000-8000-0000000001a3';
	const M_CAN_BATCH = 'dddd0000-0000-4000-8000-0000000001a4';
	const M_CAN_SERIAL = 'dddd0000-0000-4000-8000-0000000001a5';
	// The TRANSFER documents' own models — a move is the fourth stock document, and it
	// must not drink from the balance cells of the three above.
	const M_TRF_STD = 'dddd0000-0000-4000-8000-0000000001b1';
	const M_TRF_BATCH = 'dddd0000-0000-4000-8000-0000000001b2';
	const M_TRF_SERIAL = 'dddd0000-0000-4000-8000-0000000001b3';
	// A second store the moves land in — distinct from the shared `main_store` the
	// transfer suite uses, so these balance cells belong to this block alone.
	const TRF_DEST = 'admin_store' as const;

	// The truck-held issue below needs the governed return to move a unit on.
	beforeAll(mintReturnActors);

	beforeAll(async () => {
		await insert('cms_mro_item_model', { id: M_CAN_STD, name_en: 'Cancel Std', item_name: G_STD });
		await insert('cms_mro_item_model', { id: M_CAN_REQ, name_en: 'Cancel Req', item_name: G_STD });
		await insert('cms_mro_item_model', { id: M_CAN_ADJ, name_en: 'Cancel Adj', item_name: G_STD });
		await insert('cms_mro_item_model', { id: M_CAN_BATCH, name_en: 'Cancel Batch', item_name: G_BATCH });
		await insert('cms_mro_item_model', { id: M_CAN_SERIAL, name_en: 'Cancel Serial', item_name: G_SERIAL });
		await insert('cms_mro_item_model', { id: M_TRF_STD, name_en: 'Cancel Transfer Std', item_name: G_STD });
		await insert('cms_mro_item_model', { id: M_TRF_BATCH, name_en: 'Cancel Transfer Batch', item_name: G_BATCH });
		await insert('cms_mro_item_model', { id: M_TRF_SERIAL, name_en: 'Cancel Transfer Serial', item_name: G_SERIAL });
	});

	const cancel = (kind: 'inbounds' | 'outbounds' | 'transfers' | 'adjustments', id: string, body: Record<string, unknown> = {}) =>
		api(`/api/mro/${kind}/${id}/cancel`, { method: 'POST', body: JSON.stringify(body) });

	const serialRow = (serialNo: string) => row('cms_mro_stock_serials', 'serial_no = ? AND deleted_at IS NULL', serialNo);
	const serialEvents = (serialId: string) =>
		rows('cms_mro_serial_events', 'serial = ? AND deleted_at IS NULL ORDER BY created_at', serialId);
	const livePayments = (docId: string) => rows('cms_mro_inbound_payments', 'parent_id = ? AND deleted_at IS NULL', docId);

	it('cancels a DRAFT as a pure lifecycle flip — stamped, stock-free, and a replay is a no-op', async () => {
		const d = await inboundDraft([{ item_model: M_CAN_STD, qty: 4, unit_price: 7 }], {}, loc);
		const id = d.id as string;
		expect(await onHandQty(M_CAN_STD, loc)).toBe(0);

		const first = await cancel('inbounds', id, { cancelled_by: APPROVER });
		expect(first.status).toBe(201);
		const body = first.body.data as Record<string, unknown>;
		expect(body.doc_status).toBe('cancelled');
		expect(body.reversed, 'a draft never moved stock, so there was nothing to reverse').toBe(false);
		expect(body.cancelled_by).toBe(APPROVER);
		const stamped = await row('cms_mro_inbounds', 'id = ?', id);
		expect(stamped?.cancelled_at).toBeTruthy();
		expect(await onHandQty(M_CAN_STD, loc), 'nothing moved').toBe(0);

		// A replay answers with the document's REAL state — the ORIGINAL stamp, never a
		// fresh one — so a double tap (or a retried request) can neither fail nor lie.
		const again = await cancel('inbounds', id, { cancelled_by: REPORTER });
		expect(again.status).toBe(201);
		expect((again.body.data as Record<string, unknown>).already).toBe(true);
		const after = await row('cms_mro_inbounds', 'id = ?', id);
		expect(after?.cancelled_at).toBe(stamped?.cancelled_at);
		expect(after?.cancelled_by, 'a replay never re-stamps the actor').toBe(APPROVER);

		// …and a cancelled stock document is FINAL: never confirmed again, never
		// reopened to draft, never deleted. The engine's `cancelled → draft` reopen
		// (allowed on an ordinary collection) is refused here on purpose, so a document
		// can never read `draft`/`confirmed` while still carrying a cancel stamp.
		expect((await confirm('inbounds', id)).status).toBe(409);
		const reopen = await api(`/api/entities/mro_inbounds/${id}`, { method: 'PUT', body: JSON.stringify({ doc_status: 'draft' }) });
		expect(reopen.status, 'a cancelled document is not reopened').toBe(403);
		const remove = await api(`/api/entities/mro_inbounds/${id}`, { method: 'DELETE' });
		expect(remove.status, 'nor discarded').toBe(403);

		// The stamp itself is unforgeable: a generic PUT naming it is STRIPPED (the column
		// is `frozen_fields` — only the /cancel batch writes it). A legitimate field in
		// the same payload still lands, so the strip is silent, not a whole-write failure.
		const draft2 = await inboundDraft([{ item_model: M_CAN_STD, qty: 1 }], {}, loc);
		const forged = await api(`/api/entities/mro_inbounds/${draft2.id}`, {
			method: 'PUT',
			body: JSON.stringify({ cancelled_by: APPROVER, cancelled_at: new Date().toISOString(), note: 'free text' }),
		});
		expect(forged.status).toBe(200);
		const untouched = await row('cms_mro_inbounds', 'id = ?', draft2.id);
		expect(untouched?.cancelled_by).toBeNull();
		expect(untouched?.cancelled_at).toBeNull();
		expect(untouched?.doc_status).toBe('draft');
		expect(untouched?.note, 'the rest of the payload still applies').toBe('free text');
	});

	it('REVERSES a posted BATCH receipt — the balance and the lot it created both go away', async () => {
		const before = await onHandQty(M_CAN_BATCH, loc);
		const d = await inboundDraft([{ item_model: M_CAN_BATCH, qty: 5, batch_no: 'CAN-B1', unit_price: 10 }], {}, loc);
		const id = d.id as string;
		expect((await confirm('inbounds', id)).status).toBe(201);
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(before + 5);
		expect(Number((await lotOf('CAN-B1', loc))?.remaining_qty)).toBe(5);

		const res = await cancel('inbounds', id);
		expect(res.status).toBe(201);
		const body = res.body.data as Record<string, unknown>;
		expect(body.reversed).toBe(true);
		expect(body.reversed_qty).toBe(5);
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(before);
		// The lot left no corpse: a lot that should never have existed is REMOVED, so the
		// stock report cannot keep counting a receipt that was undone.
		expect(await lotOf('CAN-B1', loc)).toBeNull();
		expect((await row('cms_mro_inbounds', 'id = ?', id))?.doc_status).toBe('cancelled');

		const again = await cancel('inbounds', id);
		expect((again.body.data as Record<string, unknown>).already).toBe(true);
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(before);
	});

	it('REVERSES a posted SERIAL receipt — the units and their purchase history go with it', async () => {
		const before = await onHandQty(M_CAN_SERIAL, loc);
		const d = await inboundDraft([{ item_model: M_CAN_SERIAL, qty: 2, serials: ['CAN-S1', 'CAN-S2'] }], {}, loc);
		const id = d.id as string;
		expect((await confirm('inbounds', id)).status).toBe(201);
		const unit = await serialRow('CAN-S1');
		const unitId = String(unit?.id);
		expect(unit?.status).toBe('in_stock');
		expect(unit?.location).toBe(loc);
		expect((await serialEvents(unitId)).map((e) => e.event)).toEqual(['purchased']);
		expect(await onHandQty(M_CAN_SERIAL, loc)).toBe(before + 2);

		expect((await cancel('inbounds', id)).status).toBe(201);
		expect(await serialRow('CAN-S1')).toBeNull();
		expect(await serialRow('CAN-S2')).toBeNull();
		// The receipt's OWN history is withdrawn with it — no orphan events pointing at
		// a unit that no longer exists (the unit never was a physical fact).
		expect(await serialEvents(unitId)).toEqual([]);
		expect(await onHandQty(M_CAN_SERIAL, loc)).toBe(before);
	});

	it('REFUSES to reverse a receipt whose stock was already issued — and leaves it posted, never half-undone', async () => {
		const before = await onHandQty(M_CAN_STD, loc);
		const receipt = await inboundDraft([{ item_model: M_CAN_STD, qty: 10, unit_price: 3 }], {}, loc);
		const receiptId = receipt.id as string;
		expect((await confirm('inbounds', receiptId)).status).toBe(201);

		// 3 of the 10 leave the store through a real goods issue.
		const issue = await outboundDraft([{ item_model: M_CAN_STD, qty: 3 }], {}, loc);
		const issueId = issue.id as string;
		expect((await confirm('outbounds', issueId)).status).toBe(201);
		expect(await onHandQty(M_CAN_STD, loc)).toBe(before + 7);

		const refused = await cancel('inbounds', receiptId);
		expect(refused.status).toBe(409);
		expect(String(refused.body.error)).toMatch(/already issued|not enough stock/i);
		// NOTHING partial: the balance is untouched and the receipt is STILL POSTED, so
		// the operator unwinds in the right order instead of the ledger quietly dropping
		// below zero.
		expect(await onHandQty(M_CAN_STD, loc)).toBe(before + 7);
		expect((await row('cms_mro_inbounds', 'id = ?', receiptId))?.doc_status).toBe('confirmed');

		// Right order: reverse the issue first, then the receipt — both clean.
		expect((await cancel('outbounds', issueId)).status).toBe(201);
		expect(await onHandQty(M_CAN_STD, loc)).toBe(before + 10);
		expect((await cancel('inbounds', receiptId)).status).toBe(201);
		expect(await onHandQty(M_CAN_STD, loc)).toBe(before);
	});

	it('withdraws the confirm’s own paid-at-receipt entry, but REFUSES while real money stands', async () => {
		// (a) paid at receipt: the CONFIRM filed the one ledger entry, so the un-post
		// takes its own entry back and the receipt's money mirror returns to unpaid.
		const paid = await inboundDraft([{ item_model: M_CAN_STD, qty: 2, unit_price: 1000 }], { paid_at_receipt: true }, loc);
		const paidId = paid.id as string;
		expect((await confirm('inbounds', paidId)).status).toBe(201);
		expect(await livePayments(paidId)).toHaveLength(1);
		expect(Number((await row('cms_mro_inbounds', 'id = ?', paidId))?.paid_amount)).toBe(2000);

		expect((await cancel('inbounds', paidId)).status).toBe(201);
		expect(await livePayments(paidId), 'the confirm’s own entry goes with the receipt').toEqual([]);
		const mirrored = await row('cms_mro_inbounds', 'id = ?', paidId);
		expect(Number(mirrored?.paid_amount ?? 0)).toBe(0);
		expect(mirrored?.payment_status ?? 'unpaid').toBe('unpaid');

		// (b) money a PERSON recorded is never erased by a stock reversal.
		const owing = await inboundDraft([{ item_model: M_CAN_STD, qty: 1, unit_price: 500 }], {}, loc);
		const owingId = owing.id as string;
		expect((await confirm('inbounds', owingId)).status).toBe(201);
		const filed = await api(`/api/mro/inbounds/${owingId}/payments`, {
			method: 'POST',
			body: JSON.stringify({ paid_on: mmtToday(), amount: 500 }),
		});
		expect(filed.status).toBe(201);

		const refused = await cancel('inbounds', owingId);
		expect(refused.status).toBe(409);
		expect(String(refused.body.error)).toMatch(/payment\(s\) recorded/i);
		expect(await livePayments(owingId)).toHaveLength(1);
		expect((await row('cms_mro_inbounds', 'id = ?', owingId))?.doc_status).toBe('confirmed');

		// The correction path is remove-then-reverse — and then it goes through.
		const [payment] = await livePayments(owingId);
		expect((await api(`/api/mro/inbounds/${owingId}/payments/${String(payment.id)}`, { method: 'DELETE' })).status).toBeLessThan(300);
		expect((await cancel('inbounds', owingId)).status).toBe(201);
	});

	it('REVERSES a posted goods issue and recomputes the source request’s fulfilment', async () => {
		const before = await onHandQty(M_CAN_REQ, loc);
		const seed = await inboundDraft([{ item_model: M_CAN_REQ, qty: 10 }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);

		const req = await requisitionDraft([{ item_model: M_CAN_REQ, qty: 10 }], { requested_by: REPORTER }, loc);
		const reqId = req.id as string;
		expect((await confirm('requisitions', reqId, { approved_by: APPROVER })).status).toBe(201);

		const issue = await outboundDraft([{ item_model: M_CAN_REQ, qty: 4 }], { request: reqId }, loc);
		const issueId = issue.id as string;
		expect((await confirm('outbounds', issueId)).status).toBe(201);
		expect(await onHandQty(M_CAN_REQ, loc)).toBe(before + 6);
		expect((await row('cms_mro_requisitions', 'id = ?', reqId))?.requisition_status).toBe('partially_issued');
		expect(Number((await row('cms_mro_requisitions', 'id = ?', reqId))?.issued_qty)).toBe(4);

		const res = await cancel('outbounds', issueId);
		expect(res.status).toBe(201);
		expect((res.body.data as Record<string, unknown>).reversed).toBe(true);
		expect((res.body.data as Record<string, unknown>).issued_qty).toBe(0);
		expect(await onHandQty(M_CAN_REQ, loc)).toBe(before + 10);
		// The request goes back to exactly what it was BEFORE this issue — not "fulfilled".
		const after = await row('cms_mro_requisitions', 'id = ?', reqId);
		expect(Number(after?.issued_qty)).toBe(0);
		expect(after?.requisition_status).toBe('approved');
	});

	it('returns stock to a store request that was closed in the meantime WITHOUT reopening it', async () => {
		const before = await onHandQty(M_CAN_REQ, loc);
		const seed = await inboundDraft([{ item_model: M_CAN_REQ, qty: 6 }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		const req = await requisitionDraft([{ item_model: M_CAN_REQ, qty: 6 }], { requested_by: REPORTER }, loc);
		const reqId = req.id as string;
		expect((await confirm('requisitions', reqId, { approved_by: APPROVER })).status).toBe(201);

		const issue = await outboundDraft([{ item_model: M_CAN_REQ, qty: 2 }], { request: reqId }, loc);
		const issueId = issue.id as string;
		expect((await confirm('outbounds', issueId)).status).toBe(201);
		expect(await onHandQty(M_CAN_REQ, loc)).toBe(before + 4);

		// The keeper closes the request before the issue is cancelled.
		expect((await reject(reqId, { close_reason: 'stock_low' })).status).toBe(201);
		expect((await row('cms_mro_requisitions', 'id = ?', reqId))?.requisition_status).toBe('cancelled');

		// The STOCK comes back; the request's closure does not reopen. Its bookkeeping is
		// left exactly as the keeper set it — a reversal may not silently re-open a
		// request somebody decided to close.
		expect((await cancel('outbounds', issueId)).status).toBe(201);
		expect(await onHandQty(M_CAN_REQ, loc)).toBe(before + 6);
		const after = await row('cms_mro_requisitions', 'id = ?', reqId);
		expect(after?.requisition_status).toBe('cancelled');
		expect(Number(after?.issued_qty)).toBe(2);
	});

	it('REVERSES a truck goods issue — and REFUSES once the unit has moved on', async () => {
		const before = await onHandQty(M_CAN_SERIAL, loc);
		const seed = await inboundDraft([{ item_model: M_CAN_SERIAL, qty: 1, serials: ['CAN-S9'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		const unitId = String((await serialRow('CAN-S9'))?.id);

		const issue = await outboundDraft([{ item_model: M_CAN_SERIAL, qty: 1, serials: ['CAN-S9'] }], { to_vehicle: V_FLEET }, loc);
		const issueId = issue.id as string;
		expect((await confirm('outbounds', issueId)).status).toBe(201);
		expect((await serialRow('CAN-S9'))?.status).toBe('issued');
		expect((await serialRow('CAN-S9'))?.vehicle).toBe(V_FLEET);
		expect(await onHandQty(M_CAN_SERIAL, loc)).toBe(before);

		const back = await cancel('outbounds', issueId);
		expect(back.status).toBe(201);
		const unit = await serialRow('CAN-S9');
		expect(unit?.status).toBe('in_stock');
		expect(unit?.vehicle, 'the holder seam is cleared, not half-cleared').toBeNull();
		expect(unit?.location, 'back in the store it left').toBe(loc);
		expect(await onHandQty(M_CAN_SERIAL, loc)).toBe(before + 1);

		// Re-issue, then let the unit MOVE ON (the governed return to store). The
		// reversal must refuse rather than yank a unit out of somebody's hands.
		const again = await outboundDraft([{ item_model: M_CAN_SERIAL, qty: 1, serials: ['CAN-S9'] }], { to_vehicle: V_FLEET }, loc);
		const againId = again.id as string;
		expect((await confirm('outbounds', againId)).status).toBe(201);
		expect((await returnToStore(unitId, { vehicle: V_FLEET }, loc)).status).toBe(201);
		expect((await serialRow('CAN-S9'))?.status).toBe('in_stock');

		const refused = await cancel('outbounds', againId);
		expect(refused.status).toBe(409);
		expect(String(refused.body.error)).toMatch(/moved on since this issue|no longer/i);
		expect(await onHandQty(M_CAN_SERIAL, loc), 'no double stock from a refused reversal').toBe(before + 1);
	});

	it('REVERSES an approved adjustment — the added lot back whole, the balance down, a scrapped unit un-scrapped', async () => {
		const beforeBatch = await onHandQty(M_CAN_BATCH, loc);

		// (a) add · batch — the lot this line CREATED is taken back whole.
		const add = await adjustmentDraft([{ item_model: M_CAN_BATCH, direction: 'add', qty: 3, batch_no: 'CAN-ADJ' }], {}, loc);
		const addId = add.id as string;
		expect((await confirm('adjustments', addId, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(beforeBatch + 3);
		expect(Number((await lotOf('CAN-ADJ', loc))?.remaining_qty)).toBe(3);
		expect(await rows('cms_mro_adjustment_lots', 'adjustment_id = ?', addId)).toHaveLength(1);

		const reversed = await cancel('adjustments', addId);
		expect(reversed.status).toBe(201);
		expect((reversed.body.data as Record<string, unknown>).reversed).toBe(true);
		expect(await lotOf('CAN-ADJ', loc)).toBeNull();
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(beforeBatch);
		// The trace that claims the effect is withdrawn with the effect.
		expect(await rows('cms_mro_adjustment_lots', 'adjustment_id = ?', addId)).toEqual([]);
		expect((await cancel('adjustments', addId)).status).toBe(201);
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(beforeBatch);

		// (b) add · standard — only the balance moved, and only the balance moves back.
		const beforeStd = await onHandQty(M_CAN_ADJ, loc);
		const bumped = await adjustmentDraft([{ item_model: M_CAN_ADJ, direction: 'add', qty: 4 }], {}, loc);
		const bumpedId = bumped.id as string;
		expect((await confirm('adjustments', bumpedId, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_CAN_ADJ, loc)).toBe(beforeStd + 4);
		const line = (await rows('cms_mro_adjustment_lines', 'parent_id = ?', bumpedId))[0];
		expect(Number(line.expected_qty)).toBe(beforeStd);
		expect(Number(line.diff_qty)).toBe(4);

		expect((await cancel('adjustments', bumpedId)).status).toBe(201);
		expect(await onHandQty(M_CAN_ADJ, loc)).toBe(beforeStd);
		// The confirm-written audit is cleared: the document no longer claims it applied.
		const cleared = (await rows('cms_mro_adjustment_lines', 'parent_id = ?', bumpedId))[0];
		expect(cleared.expected_qty).toBeNull();
		expect(cleared.diff_qty).toBeNull();

		// (c) remove · serial — the unit un-scraps and re-enters stock, and its own
		// `adjusted` event is withdrawn with the document.
		const beforeSerial = await onHandQty(M_CAN_SERIAL, loc);
		const seed = await inboundDraft([{ item_model: M_CAN_SERIAL, qty: 1, serials: ['CAN-A1'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		const removed = await adjustmentDraft([{ item_model: M_CAN_SERIAL, direction: 'remove', qty: 1, serials: ['CAN-A1'] }], {}, loc);
		const removedId = removed.id as string;
		expect((await confirm('adjustments', removedId, { approved_by: APPROVER })).status).toBe(201);
		expect((await serialRow('CAN-A1'))?.status).toBe('scrapped');
		expect(await onHandQty(M_CAN_SERIAL, loc)).toBe(beforeSerial);

		expect((await cancel('adjustments', removedId)).status).toBe(201);
		expect((await serialRow('CAN-A1'))?.status).toBe('in_stock');
		expect(await onHandQty(M_CAN_SERIAL, loc)).toBe(beforeSerial + 1);
		const unitId = String((await serialRow('CAN-A1'))?.id);
		expect((await serialEvents(unitId)).map((e) => e.event)).toEqual(['purchased']);
		expect(await rows('cms_mro_adjustment_serials', 'adjustment_id = ?', removedId)).toEqual([]);
	});

	it('REFUSES to reverse an adjustment whose added stock has already been used', async () => {
		const before = await onHandQty(M_CAN_BATCH, loc);
		const add = await adjustmentDraft([{ item_model: M_CAN_BATCH, direction: 'add', qty: 5, batch_no: 'CAN-ADJ2' }], {}, loc);
		const addId = add.id as string;
		expect((await confirm('adjustments', addId, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(before + 5);

		// Somebody draws on the lot the adjustment added.
		const issue = await outboundDraft([{ item_model: M_CAN_BATCH, qty: 2 }], {}, loc);
		const issueId = issue.id as string;
		expect((await confirm('outbounds', issueId)).status).toBe(201);
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(before + 3);

		const refused = await cancel('adjustments', addId);
		expect(refused.status).toBe(409);
		expect(String(refused.body.error)).toMatch(/already used|clear the remainder/i);
		// The adjustment stays approved and the balance untouched — a refusal, not a
		// half-applied correction.
		expect((await row('cms_mro_adjustments', 'id = ?', addId))?.doc_status).toBe('confirmed');
		expect(await onHandQty(M_CAN_BATCH, loc)).toBe(before + 3);
		expect(Number((await lotOf('CAN-ADJ2', loc))?.remaining_qty)).toBe(3);
	});

	it('refuses an adjustment reversal when a unit it removed has since been put in service', async () => {
		const seed = await inboundDraft([{ item_model: M_CAN_SERIAL, qty: 1, serials: ['CAN-A2'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		const removed = await adjustmentDraft([{ item_model: M_CAN_SERIAL, direction: 'remove', qty: 1, serials: ['CAN-A2'] }], {}, loc);
		const removedId = removed.id as string;
		expect((await confirm('adjustments', removedId, { approved_by: APPROVER })).status).toBe(201);

		// The unit is scrapped, not `in_stock` — so it cannot be re-received by a later
		// inbound either. What makes the cancellation refusable is a unit whose state is
		// no longer `scrapped` (it went back into use some other way).
		await env.DB.prepare("UPDATE cms_mro_stock_serials SET status = 'issued', vehicle = ? WHERE serial_no = 'CAN-A2'").bind(V_FLEET).run();

		const refused = await cancel('adjustments', removedId);
		expect(refused.status).toBe(409);
		expect(String(refused.body.error)).toMatch(/not scrapped|in service/i);
		expect((await row('cms_mro_adjustments', 'id = ?', removedId))?.doc_status).toBe('confirmed');
	});

	it('refuses any cancel for a document that is neither a draft nor posted', async () => {
		// A `submitted` document is a state these three collections do not use — it is
		// reachable generically (draft → submitted), and the cancel verb must refuse it
		// rather than guess which of the two paths applies.
		const d = await inboundDraft([{ item_model: M_CAN_STD, qty: 1 }], {}, loc);
		const id = d.id as string;
		expect(
			(await api(`/api/entities/mro_inbounds/${id}`, { method: 'PUT', body: JSON.stringify({ doc_status: 'submitted' }) })).status,
		).toBe(200);

		const res = await cancel('inbounds', id);
		expect(res.status).toBe(409);
		expect(String(res.body.error)).toMatch(/cannot be cancelled/i);
		expect((await row('cms_mro_inbounds', 'id = ?', id))?.doc_status).toBe('submitted');
	});

	it('is gated on write permission and never acts anonymously', async () => {
		const d = await inboundDraft([{ item_model: M_CAN_STD, qty: 1 }], {}, loc);
		const id = d.id as string;
		const anon = await SELF.fetch(`${BASE_URL}/api/mro/inbounds/${id}/cancel`, { method: 'POST' });
		expect(anon.status).toBe(401);
		expect((await row('cms_mro_inbounds', 'id = ?', id))?.doc_status).toBe('draft');
		expect(await cancel('inbounds', id)).toBeTruthy();
	});

	it('takes no money against a cancelled receipt — through EITHER writer', async () => {
		const d = await inboundDraft([{ item_model: M_CAN_STD, qty: 1, unit_price: 100 }], {}, loc);
		const id = d.id as string;
		expect((await confirm('inbounds', id)).status).toBe(201);
		expect((await cancel('inbounds', id)).status).toBe(201);

		// The mini app never offers the sheet on a cancelled receipt, but the GENERIC
		// create (Studio / CLI / import) and the service route are both refused server-
		// side: a void document must not be able to describe money again.
		const generic = await api('/api/entities/mro_inbound_payments', {
			method: 'POST',
			body: JSON.stringify({ parent_id: id, paid_on: mmtToday(), amount: 100 }),
		});
		expect(generic.status).toBe(400);
		expect(String(generic.body.error)).toMatch(/cancelled/i);
		const route = await api(`/api/mro/inbounds/${id}/payments`, {
			method: 'POST',
			body: JSON.stringify({ paid_on: mmtToday(), amount: 100 }),
		});
		expect(route.status).toBe(400);
		expect(await livePayments(id)).toEqual([]);
	});

	// ── Transfers — the FOURTH stock document, the same ONE verb ───────────────

	it('cancels a DRAFT transfer as a pure flip, and the frozen `cancelled` state is final', async () => {
		const d = await transferDraft([{ item_model: M_TRF_STD, qty: 3 }], {}, loc, TRF_DEST);
		const id = d.id as string;
		expect(await onHandQty(M_TRF_STD, loc), 'a draft moved nothing').toBe(0);

		const first = await cancel('transfers', id, { cancelled_by: APPROVER });
		expect(first.status).toBe(201);
		const body = first.body.data as Record<string, unknown>;
		expect(body.doc_status).toBe('cancelled');
		expect(body.reversed).toBe(false);
		expect(body.cancelled_by).toBe(APPROVER);
		const stamped = await row('cms_mro_transfers', 'id = ?', id);
		expect(stamped?.cancelled_at).toBeTruthy();

		// A replay answers with the document's REAL state (the ORIGINAL stamp).
		const again = await cancel('transfers', id, { cancelled_by: REPORTER });
		expect(again.status).toBe(201);
		expect((again.body.data as Record<string, unknown>).already).toBe(true);
		const after = await row('cms_mro_transfers', 'id = ?', id);
		expect(after?.cancelled_at).toBe(stamped?.cancelled_at);
		expect(after?.cancelled_by, 'a replay never re-stamps the actor').toBe(APPROVER);

		// Final: never confirmed again, never reopened to draft, never deleted.
		expect((await confirm('transfers', id, { approved_by: APPROVER })).status).toBe(409);
		const reopen = await api(`/api/entities/mro_transfers/${id}`, { method: 'PUT', body: JSON.stringify({ doc_status: 'draft' }) });
		expect(reopen.status, 'a cancelled transfer is not reopened').toBe(403);
		const remove = await api(`/api/entities/mro_transfers/${id}`, { method: 'DELETE' });
		expect(remove.status, 'nor discarded').toBe(403);

		// The stamp is unforgeable: a generic PUT naming it is STRIPPED, while a
		// legitimate field in the same payload still lands.
		const d2 = await transferDraft([{ item_model: M_TRF_STD, qty: 1 }], {}, loc, TRF_DEST);
		const forged = await api(`/api/entities/mro_transfers/${d2.id}`, {
			method: 'PUT',
			body: JSON.stringify({ cancelled_by: APPROVER, cancelled_at: new Date().toISOString(), note: 'free text' }),
		});
		expect(forged.status).toBe(200);
		const untouched = await row('cms_mro_transfers', 'id = ?', d2.id);
		expect(untouched?.cancelled_by).toBeNull();
		expect(untouched?.cancelled_at).toBeNull();
		expect(untouched?.doc_status).toBe('draft');
		expect(untouched?.note, 'the rest of the payload still applies').toBe('free text');
	});

	it('REVERSES a posted BATCH transfer — source lots restored, destination lots drawn back down', async () => {
		const a = await inboundDraft(
			[{ item_model: M_TRF_BATCH, qty: 10, batch_no: 'CANT-A', expiry_date: mmtToday(90) }],
			{ purchase_date: '2026-06-01' },
			loc,
		);
		const b = await inboundDraft(
			[{ item_model: M_TRF_BATCH, qty: 6, batch_no: 'CANT-B', expiry_date: mmtToday(30) }],
			{ purchase_date: '2026-06-15' },
			loc,
		);
		const tgt = await inboundDraft(
			[{ item_model: M_TRF_BATCH, qty: 4, batch_no: 'CANT-A', expiry_date: mmtToday(90) }],
			{ purchase_date: '2026-06-20' },
			TRF_DEST,
		);
		expect((await confirm('inbounds', a.id as string)).status).toBe(201);
		expect((await confirm('inbounds', b.id as string)).status).toBe(201);
		expect((await confirm('inbounds', tgt.id as string)).status).toBe(201);
		const srcBefore = await onHandQty(M_TRF_BATCH, loc);
		const dstBefore = await onHandQty(M_TRF_BATCH, TRF_DEST);

		const trf = await transferDraft([{ item_model: M_TRF_BATCH, qty: 12 }], {}, loc, TRF_DEST);
		const id = trf.id as string;
		expect((await confirm('transfers', id, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_TRF_BATCH, loc)).toBe(srcBefore - 12);
		expect(await onHandQty(M_TRF_BATCH, TRF_DEST)).toBe(dstBefore + 12);
		// FEFO drained CANT-B first (then 6 of CANT-A); at the destination CANT-A merged
		// into the existing lot and CANT-B was created fresh.
		expect(Number((await lotOf('CANT-B', loc))?.remaining_qty)).toBe(0);
		expect(Number((await lotOf('CANT-A', TRF_DEST))?.remaining_qty)).toBe(10);

		const res = await cancel('transfers', id);
		expect(res.status).toBe(201);
		expect((res.body.data as Record<string, unknown>).reversed).toBe(true);
		expect((res.body.data as Record<string, unknown>).reversed_qty).toBe(12);
		// Both balance cells are back to exactly what they were BEFORE the move.
		expect(await onHandQty(M_TRF_BATCH, loc)).toBe(srcBefore);
		expect(await onHandQty(M_TRF_BATCH, TRF_DEST)).toBe(dstBefore);
		// Source lots restored — the drained one revived from `empty`.
		expect(Number((await lotOf('CANT-B', loc))?.remaining_qty)).toBe(6);
		expect((await lotOf('CANT-B', loc))?.status).toBe('active');
		expect(Number((await lotOf('CANT-A', loc))?.remaining_qty)).toBe(10);
		// Destination: the merged lot drops back to its own 4; the created lot is inert.
		expect(Number((await lotOf('CANT-A', TRF_DEST))?.remaining_qty)).toBe(4);
		expect(Number((await lotOf('CANT-B', TRF_DEST))?.remaining_qty)).toBe(0);
		// The trace that claims the move is withdrawn with the move.
		expect(await rows('cms_mro_transfer_lots', 'transfer_id = ?', id)).toEqual([]);
		expect((await row('cms_mro_transfers', 'id = ?', id))?.doc_status).toBe('cancelled');

		// A replay is a harmless no-op — no second restore.
		const again = await cancel('transfers', id);
		expect((again.body.data as Record<string, unknown>).already).toBe(true);
		expect(await onHandQty(M_TRF_BATCH, loc)).toBe(srcBefore);
		expect(Number((await lotOf('CANT-A', TRF_DEST))?.remaining_qty)).toBe(4);
	});

	it('REVERSES a posted SERIAL transfer — the units go home, and its own event leaves with it', async () => {
		const seed = await inboundDraft([{ item_model: M_TRF_SERIAL, qty: 2, serials: ['CANT-S1', 'CANT-S2'] }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		const srcBefore = await onHandQty(M_TRF_SERIAL, loc);
		const dstBefore = await onHandQty(M_TRF_SERIAL, TRF_DEST);
		const unitId = String((await serialRow('CANT-S1'))?.id);

		const trf = await transferDraft([{ item_model: M_TRF_SERIAL, qty: 2, serials: ['CANT-S1', 'CANT-S2'] }], {}, loc, TRF_DEST);
		const id = trf.id as string;
		expect((await confirm('transfers', id, { approved_by: APPROVER })).status).toBe(201);
		expect((await serialRow('CANT-S1'))?.location).toBe(TRF_DEST);
		expect((await serialEvents(unitId)).map((e) => e.event)).toEqual(['purchased', 'store_transferred']);

		const res = await cancel('transfers', id);
		expect(res.status).toBe(201);
		expect((res.body.data as Record<string, unknown>).reversed).toBe(true);
		expect((await serialRow('CANT-S1'))?.location).toBe(loc);
		expect((await serialRow('CANT-S2'))?.location).toBe(loc);
		expect(await onHandQty(M_TRF_SERIAL, loc)).toBe(srcBefore);
		expect(await onHandQty(M_TRF_SERIAL, TRF_DEST)).toBe(dstBefore);
		// The move's OWN event is withdrawn; the receipt that put the unit in stock stays.
		expect((await serialEvents(unitId)).map((e) => e.event)).toEqual(['purchased']);
		expect(await rows('cms_mro_transfer_serials', 'transfer_id = ?', id)).toEqual([]);

		// A second move, then the unit MOVES ON again — the reversal must REFUSE rather
		// than yank a unit out of wherever it now is.
		const trf2 = await transferDraft([{ item_model: M_TRF_SERIAL, qty: 1, serials: ['CANT-S1'] }], {}, loc, TRF_DEST);
		const id2 = trf2.id as string;
		expect((await confirm('transfers', id2, { approved_by: APPROVER })).status).toBe(201);
		const trf3 = await transferDraft([{ item_model: M_TRF_SERIAL, qty: 1, serials: ['CANT-S1'] }], {}, TRF_DEST, 'safety_store');
		expect((await confirm('transfers', trf3.id as string, { approved_by: APPROVER })).status).toBe(201);
		expect((await serialRow('CANT-S1'))?.location).toBe('safety_store');

		const refused = await cancel('transfers', id2);
		expect(refused.status).toBe(409);
		expect(String(refused.body.error)).toMatch(/moved on since this transfer|no longer in stock/i);
		expect((await row('cms_mro_transfers', 'id = ?', id2))?.doc_status, 'a refusal leaves it posted').toBe('confirmed');
		expect(await onHandQty(M_TRF_SERIAL, TRF_DEST), 'no phantom stock from a refused reversal').toBe(dstBefore);
	});

	it('REFUSES to reverse a transfer once the destination has drawn on the moved stock', async () => {
		const seed = await inboundDraft([{ item_model: M_TRF_STD, qty: 10 }], {}, loc);
		expect((await confirm('inbounds', seed.id as string)).status).toBe(201);
		const srcBefore = await onHandQty(M_TRF_STD, loc);
		const dstBefore = await onHandQty(M_TRF_STD, TRF_DEST);

		const trf = await transferDraft([{ item_model: M_TRF_STD, qty: 6 }], {}, loc, TRF_DEST);
		const id = trf.id as string;
		expect((await confirm('transfers', id, { approved_by: APPROVER })).status).toBe(201);
		expect(await onHandQty(M_TRF_STD, TRF_DEST)).toBe(dstBefore + 6);

		// Somebody draws 2 of the 6 back out of the destination store.
		const issue = await outboundDraft([{ item_model: M_TRF_STD, qty: 2 }], {}, TRF_DEST);
		expect((await confirm('outbounds', issue.id as string)).status).toBe(201);
		expect(await onHandQty(M_TRF_STD, TRF_DEST)).toBe(dstBefore + 4);

		const refused = await cancel('transfers', id);
		expect(refused.status).toBe(409);
		expect(String(refused.body.error)).toMatch(/drawn on|clear the remainder/i);
		// NOTHING partial: both balances untouched and the transfer STILL posted, so the
		// operator unwinds in the right order instead of the ledger quietly going negative.
		expect(await onHandQty(M_TRF_STD, loc)).toBe(srcBefore - 6);
		expect(await onHandQty(M_TRF_STD, TRF_DEST)).toBe(dstBefore + 4);
		expect((await row('cms_mro_transfers', 'id = ?', id))?.doc_status).toBe('confirmed');
	});
});

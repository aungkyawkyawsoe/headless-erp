import { describe, expect, it } from 'vitest';
import type { D1Client } from '@mmbix/core';
import { GuardedBatch } from '@/domain-modules/mro/inventory/guarded-batch';
import type { Op } from '@/domain-modules/mro/inventory/guarded-batch';
import type { Tables } from '@/domain-modules/mro/inventory/types';

/**
 * GuardedBatch — the atomic write engine's ROLLBACK semantics.
 *
 * The engine runs one batch and, if a guarded statement matched no row, reverses
 * everything the batch did. The reversal is the ONLY thing standing between a lost
 * guard and rows that are already written, so each op's mirror must be the EXACT
 * opposite of the statement it undoes — a mirror that points the wrong way turns a
 * clean refusal into silent corruption (a lot inflated, or a restored lot emptied
 * and re-drained). These tests pin the direction of the lot ops, which is the shape
 * the stock reversals depend on:
 *
 *   confirm-side  lot_deduct  undoes a DEDUCT  → rollback ADDS back
 *   reversal-side lot_merge   undoes an ADD    → rollback DEDUCTS (and restores the
 *                              status the reversal revived)
 */

const TABLES = {
	lots: 'cms_mro_stock_lots',
	inv: 'cms_mro_inventory',
	serials: 'cms_mro_stock_serials',
	events: 'cms_mro_serial_events',
	payments: 'cms_mro_inbound_payments',
	outLots: 'cms_mro_outbound_lots',
	outSerials: 'cms_mro_outbound_serials',
	adjustmentLots: 'cms_mro_adjustment_lots',
	adjustmentSerials: 'cms_mro_adjustment_serials',
} as unknown as Tables;

type Statement = { sql: string; bindings: unknown[] };

/**
 * A D1Client stub that records every batch and answers a scripted `changes` count
 * for the FIRST batch (so a chosen guard can be made to "match 0 rows"); the engine's
 * own rollback batch then reports 1 row each. Nothing touches a database.
 */
function stubDb(firstBatchChanges: number[]) {
	const batches: Statement[][] = [];
	const db = {
		batch: async (statements: Statement[]) => {
			batches.push(statements);
			const isRollback = batches.length > 1;
			return statements.map((_, i) => ({ meta: { changes: isRollback ? 1 : (firstBatchChanges[i] ?? 1) } }));
		},
	};
	return { db: db as unknown as D1Client, batches };
}

/** The undo statement that targets the lots table (there is exactly one per op here). */
function lotUndo(undo: Statement[]): Statement {
	const hit = undo.find((s) => s.sql.startsWith(`UPDATE ${TABLES.lots} `));
	if (!hit) throw new Error(`no lots undo statement in: ${undo.map((s) => s.sql).join(' | ')}`);
	return hit;
}

/**
 * Run a ONE-op batch whose SECOND (dummy) guard loses, and return the rollback It
 * always produces — the shape every test below is really about. The op's `stmt` is
 * 0 (the statement that landed); index 1 is the guard that lost.
 */
async function rollbackOf(statement: Statement, op: Op): Promise<Statement[]> {
	const { db, batches } = stubDb([1, 0]);
	const batch = new GuardedBatch(db, TABLES);
	const statements: Statement[] = [statement, { sql: `UPDATE ${TABLES.inv} SET updated_at = ?1 WHERE id = ?2`, bindings: ['now', 'D'] }];
	const guardIndex = new Map<number, string>([[1, 'lost']]);
	expect(await batch.runGuarded(statements, guardIndex, [op], 'default')).toBe('lost');
	expect(batches).toHaveLength(2);
	return batches[1];
}

/** The first undo statement whose SQL begins with `prefix` (each op emits exactly one). */
function undoStarting(undo: Statement[], prefix: string): Statement {
	const hit = undo.find((s) => s.sql.startsWith(prefix));
	if (!hit) throw new Error(`no undo starting with \`${prefix}\` in: ${undo.map((s) => s.sql).join(' | ')}`);
	return hit;
}

describe('GuardedBatch rollback — each op is the exact mirror of its statement', () => {
	it('undoes a reversal’s lot RESTORE by DEDUCTING the qty back and restoring the status', async () => {
		// A reversal put 5 back into a lot that had emptied (`remaining_qty + 5`,
		// `empty → active`) — the mirror of the transfer/outbound/adjustment cancels.
		const { db, batches } = stubDb([1, 0]); // the header flip (index 1) lost the race
		const batch = new GuardedBatch(db, TABLES);
		const statements: Statement[] = [
			{
				sql: `UPDATE ${TABLES.lots} SET remaining_qty = remaining_qty + ?1,
				 status = CASE WHEN status = 'empty' THEN 'active' ELSE status END, updated_at = ?2
				 WHERE id = ?3 AND deleted_at IS NULL`,
				bindings: [5, 'now', 'L1'],
			},
			{
				sql: `UPDATE cms_mro_transfers SET doc_status = 'cancelled' WHERE id = ?3 AND doc_status = 'confirmed'`,
				bindings: ['now', 'actor', 'T1'],
			},
		];
		const guardIndex = new Map<number, string>([[1, 'Transfer was already reversed or cancelled — retry']]);
		const ops: Op[] = [
			{ kind: 'lot_merge', lotId: 'L1', qty: 5, stmt: 0, restoreStatus: 'empty' },
			{ kind: 'doc_unflip', table: 'cms_mro_transfers', docId: 'T1', fromStatus: 'confirmed', stmt: 1 },
		];

		const failed = await batch.runGuarded(statements, guardIndex, ops, 'default');
		expect(failed).toBe('Transfer was already reversed or cancelled — retry');
		expect(batches).toHaveLength(2); // the batch, then the rollback

		const undo = lotUndo(batches[1]);
		expect(undo.sql, 'a directed reversal must DEDUCT what the statement added').toContain('remaining_qty - ?1');
		expect(undo.sql).not.toContain('remaining_qty + ?1');
		expect(undo.bindings[0]).toBe(5);
		expect(undo.bindings[1], 'and put the status back where it found it').toBe('empty');
	});

	it('leaves a lot’s status alone when the statement never changed it (the confirm’s own merge)', async () => {
		// `lot_merge` with no `restoreStatus` is the confirm's destination merge: the
		// rollback deducts, and status is untouched (`COALESCE(NULL, status) = status`).
		const { db, batches } = stubDb([1, 0]);
		const batch = new GuardedBatch(db, TABLES);
		const statements: Statement[] = [
			{
				sql: `UPDATE ${TABLES.lots} SET remaining_qty = remaining_qty + ?1, updated_at = ?2 WHERE id = ?3 AND status = 'active'`,
				bindings: [4, 'now', 'L2'],
			},
			{
				sql: `UPDATE cms_mro_transfers SET doc_status = 'confirmed' WHERE id = ?3 AND COALESCE(doc_status, '') IN ('', 'draft')`,
				bindings: ['now', 'qty', 'T2'],
			},
		];
		const guardIndex = new Map<number, string>([[1, 'lost']]);
		const ops: Op[] = [
			{ kind: 'lot_merge', lotId: 'L2', qty: 4, stmt: 0 },
			{ kind: 'doc_unflip', table: 'cms_mro_transfers', docId: 'T2', fromStatus: 'draft', stmt: 1 },
		];

		expect(await batch.runGuarded(statements, guardIndex, ops, 'default')).toBe('lost');
		const undo = lotUndo(batches[1]);
		expect(undo.sql).toContain('remaining_qty - ?1');
		expect(undo.sql).toContain('status = COALESCE(?2, status)');
		expect(undo.bindings[1]).toBeNull();
	});

	it('undoes a confirm’s lot DEDUCTION by ADDING the take back (the confirm-side mirror)', async () => {
		// The opposite shape on purpose: `lot_deduct` undoes a `remaining_qty - take`.
		// Getting THIS one backwards would drop stock out of a lot the caller never
		// touched, so it is pinned alongside its mirror.
		const { db, batches } = stubDb([1, 0]); // the lot deduct LANDED; the flip (index 1) lost
		const batch = new GuardedBatch(db, TABLES);
		const statements: Statement[] = [
			{
				sql: `UPDATE ${TABLES.lots} SET remaining_qty = remaining_qty - ?1,
				 status = CASE WHEN remaining_qty - ?1 <= 0 THEN 'empty' ELSE status END, updated_at = ?2
				 WHERE id = ?3 AND status = 'active' AND remaining_qty >= ?1`,
				bindings: [3, 'now', 'L3'],
			},
			{ sql: `UPDATE cms_mro_transfers SET doc_status = 'confirmed' WHERE id = ?3`, bindings: ['now', 'qty', 'T3'] },
		];
		const guardIndex = new Map<number, string>([[1, 'lost']]);
		const ops: Op[] = [
			{ kind: 'lot_deduct', lotId: 'L3', qty: 3, stmt: 0 },
			{ kind: 'doc_unflip', table: 'cms_mro_transfers', docId: 'T3', fromStatus: 'draft', stmt: 1 },
		];

		expect(await batch.runGuarded(statements, guardIndex, ops, 'default')).toBe('lost');
		const undo = lotUndo(batches[1]);
		expect(undo.sql, 'a confirmation’s deduction is undone by ADDING back').toContain('remaining_qty + ?1');
		expect(undo.bindings[0]).toBe(3);
	});
});

/**
 * The REST of the vocabulary, pinned the same way. Every chore/reversal writer
 * plans one of these ops, so a mirror that points the wrong way is silent
 * corruption on the one path nobody can retry safely (a guard lost mid-batch).
 * Tested op-by-op because the fix for the lot bug was exactly a wrong-kind op —
 * this is the regression guard for that whole class, not one instance of it.
 */
describe('GuardedBatch rollback — the rest of the op vocabulary mirrors its statement', () => {
	it('lot_deduct carrying a fromStatus adds the take back AND restores the emptied status (the transfer cancel’s destination)', async () => {
		const undo = await rollbackOf(
			{
				sql: `UPDATE ${TABLES.lots} SET remaining_qty = remaining_qty - ?1, status = CASE WHEN remaining_qty - ?1 <= 0 THEN 'empty' ELSE status END, updated_at = ?2 WHERE id = ?3 AND remaining_qty >= ?1`,
				bindings: [2, 'now', 'L1'],
			},
			{ kind: 'lot_deduct', lotId: 'L1', qty: 2, stmt: 0, fromStatus: 'active' },
		);
		const s = undoStarting(undo, `UPDATE ${TABLES.lots} `);
		expect(s.sql).toContain('remaining_qty + ?1');
		expect(s.sql, 'the status the reversal emptied goes back with the qty').toContain('status = ?2');
		expect(s.bindings[0]).toBe(2);
		expect(s.bindings[1]).toBe('active');
	});

	it('bal_up undoes an ADD by DEDUCTING, and bal_down undoes a DEDUCT by ADDING', async () => {
		const up = await rollbackOf(
			{
				sql: `UPDATE ${TABLES.inv} SET qty_on_hand = qty_on_hand + ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL`,
				bindings: [7, 'now', 'I1'],
			},
			{ kind: 'bal_up', invId: 'I1', qty: 7, stmt: 0 },
		);
		const upUndo = undoStarting(up, `UPDATE ${TABLES.inv} `);
		expect(upUndo.sql).toContain('qty_on_hand - ?1');
		expect(upUndo.sql).not.toContain('qty_on_hand + ?1');
		expect(upUndo.bindings[0]).toBe(7);

		const down = await rollbackOf(
			{
				sql: `UPDATE ${TABLES.inv} SET qty_on_hand = qty_on_hand - ?1, updated_at = ?2 WHERE id = ?3 AND qty_on_hand >= ?1`,
				bindings: [3, 'now', 'I2'],
			},
			{ kind: 'bal_down', invId: 'I2', qty: 3, stmt: 0 },
		);
		const downUndo = undoStarting(down, `UPDATE ${TABLES.inv} `);
		expect(downUndo.sql).toContain('qty_on_hand + ?1');
		expect(downUndo.bindings[0]).toBe(3);
	});

	it('serial_flip clears the fit it implied; fit_change restores the exact holder seam', async () => {
		const flip = await rollbackOf(
			{ sql: `UPDATE ${TABLES.serials} SET status = 'issued' WHERE id = ?1 AND status = 'in_stock'`, bindings: ['S1'] },
			{ kind: 'serial_flip', serialId: 'S1', fromStatus: 'in_stock', stmt: 0, hadVehicle: true, employeeReset: true },
		);
		const flipUndo = undoStarting(flip, `UPDATE ${TABLES.serials} `);
		expect(flipUndo.bindings[0]).toBe('in_stock');
		expect(flipUndo.sql, 'a half-issued unit must never survive the rollback').toContain('vehicle = NULL');
		expect(flipUndo.sql).toContain('employee = NULL');

		const fit = await rollbackOf(
			{ sql: `UPDATE ${TABLES.serials} SET vehicle = ?1, slot = ?2 WHERE id = ?3`, bindings: ['V2', 'A1-L', 'S2'] },
			{ kind: 'fit_change', serialId: 'S2', fromVehicle: 'V9', fromSlot: 'A1-R', fromEmployee: 'E9', stmt: 0 },
		);
		const fitUndo = undoStarting(fit, `UPDATE ${TABLES.serials} `);
		expect(fitUndo.sql).toContain('vehicle = ?1');
		expect(fitUndo.sql).toContain('slot = ?2');
		expect(fitUndo.bindings.slice(0, 3)).toEqual(['V9', 'A1-R', 'E9']);
	});

	it('serial_move / return_flip / check_reading / serial_restore each put back exactly what they touched', async () => {
		const move = await rollbackOf(
			{ sql: `UPDATE ${TABLES.serials} SET location = ?1 WHERE id = ?2`, bindings: ['admin_store', 'S3'] },
			{ kind: 'serial_move', serialId: 'S3', fromLocation: 'main_store', stmt: 0 },
		);
		const moveUndo = undoStarting(move, `UPDATE ${TABLES.serials} `);
		expect(moveUndo.sql).toContain('location = ?1');
		expect(moveUndo.bindings[0]).toBe('main_store');

		const ret = await rollbackOf(
			{ sql: `UPDATE ${TABLES.serials} SET status = 'in_stock', location = ?1 WHERE id = ?2`, bindings: ['vehicle_store', 'S4'] },
			{ kind: 'return_flip', serialId: 'S4', fromStatus: 'issued', fromLocation: 'main_store', stmt: 0 },
		);
		const retUndo = undoStarting(ret, `UPDATE ${TABLES.serials} `);
		expect(retUndo.sql).toContain('status = ?1');
		expect(retUndo.sql).toContain('location = ?2');
		expect(retUndo.bindings.slice(0, 2)).toEqual(['issued', 'main_store']);

		const check = await rollbackOf(
			{ sql: `UPDATE ${TABLES.serials} SET tread_mm = ?1 WHERE id = ?2`, bindings: [8, 'S5'] },
			{ kind: 'check_reading', serialId: 'S5', treadMm: 11.2, psi: 98, condition: 'worn', stmt: 0 },
		);
		const checkUndo = undoStarting(check, `UPDATE ${TABLES.serials} `);
		expect(checkUndo.bindings.slice(0, 3)).toEqual([11.2, 98, 'worn']);

		const restore = await rollbackOf(
			{ sql: `UPDATE ${TABLES.serials} SET status = 'in_stock' WHERE id = ?1`, bindings: ['S6'] },
			{
				kind: 'serial_restore',
				serialId: 'S6',
				status: 'issued',
				location: 'main_store',
				vehicle: 'V1',
				slot: 'A1-L',
				employee: null,
				stmt: 0,
			},
		);
		const restoreUndo = undoStarting(restore, `UPDATE ${TABLES.serials} `);
		expect(restoreUndo.bindings.slice(0, 5)).toEqual(['issued', 'main_store', 'V1', 'A1-L', null]);
	});

	it('doc_unflip restores a custom lifecycle column, not always doc_status', async () => {
		const undo = await rollbackOf(
			{ sql: `UPDATE cms_mro_asset_requests SET status = 'executed' WHERE id = ?1 AND status = 'approved'`, bindings: ['R1'] },
			{ kind: 'doc_unflip', table: 'cms_mro_asset_requests', docId: 'R1', fromStatus: 'approved', stmt: 0, column: 'status' },
		);
		const s = undoStarting(undo, 'UPDATE cms_mro_asset_requests ');
		expect(s.sql).toContain('SET status = ?1');
		expect(s.sql).not.toContain('doc_status');
		expect(s.bindings[0]).toBe('approved');
	});

	it('the delete ops UNDO an insert by removing exactly those rows', async () => {
		const events = await rollbackOf(
			{ sql: `INSERT INTO ${TABLES.events} (id) VALUES (?1)`, bindings: ['EV1'] },
			{ kind: 'delete_events', eventIds: ['EV1', 'EV2'], stmt: null },
		);
		const evUndo = undoStarting(events, `DELETE FROM ${TABLES.events} `);
		expect(evUndo.bindings).toEqual(['EV1', 'EV2']);

		const inv = await rollbackOf(
			{ sql: `INSERT INTO ${TABLES.inv} (id) VALUES (?1)`, bindings: ['I3'] },
			{ kind: 'delete_inv', invId: 'I3', stmt: null },
		);
		expect(undoStarting(inv, `DELETE FROM ${TABLES.inv} `).bindings).toEqual(['I3']);

		const payment = await rollbackOf(
			{ sql: `INSERT INTO ${TABLES.payments} (id) VALUES (?1)`, bindings: ['P1'] },
			{ kind: 'delete_payment', paymentId: 'P1', stmt: null },
		);
		expect(undoStarting(payment, `DELETE FROM ${TABLES.payments} `).bindings).toEqual(['P1']);
	});

	it('the reverse-side ops UNDO a delete by re-inserting the EXACT rows that were removed', async () => {
		const rows = [{ id: 'OL1', outbound_id: 'O1', lot_id: 'L1', qty: 5, created_at: 'then', updated_at: 'then' }];
		const traced = await rollbackOf(
			{ sql: `DELETE FROM ${TABLES.outLots} WHERE outbound_id = ?1`, bindings: ['O1'] },
			{ kind: 'restore_rows', table: TABLES.outLots, rows, stmt: 0 },
		);
		const traceUndo = undoStarting(traced, `INSERT INTO ${TABLES.outLots} `);
		expect(traceUndo.sql).toContain('outbound_id');
		expect(traceUndo.bindings).toEqual(['OL1', 'O1', 'L1', 5, 'then', 'then']);

		const lotRow = {
			id: 'L9',
			model: 'M1',
			location: 'main_store',
			remaining_qty: 5,
			status: 'active',
			created_at: 'then',
			updated_at: 'then',
		};
		const lot = await rollbackOf(
			{ sql: `DELETE FROM ${TABLES.lots} WHERE id = ?1`, bindings: ['L9'] },
			{ kind: 'restore_lot', row: lotRow, stmt: 0 },
		);
		const lotUndoStmt = undoStarting(lot, `INSERT INTO ${TABLES.lots} `);
		expect(lotUndoStmt.bindings[0]).toBe('L9');
		expect(lotUndoStmt.bindings[3]).toBe(5);
	});
});

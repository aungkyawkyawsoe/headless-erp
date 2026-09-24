import type { D1Client } from '@mmbix/core';
import { changesOf, nowIso } from './codecs';
import { MroError } from './types';
import type { Tables } from './types';

/** A guarded statement batch a writer can MERGE into its own (e.g. a request's status
 *  flip riding along with the move/return it authorises) — one shape, both writers. */
export interface GuardedBatchFragment {
	statements: { sql: string; bindings: unknown[] }[];
	guards: Array<{ index: number; message: string }>;
	ops: Op[];
}

export function insertSql(table: string, row: Record<string, unknown>): { sql: string; bindings: unknown[] } {
	const cols = Object.keys(row);
	return {
		sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `?${i + 1}`).join(', ')})`,
		bindings: cols.map((c) => row[c]),
	};
}

export function insertManySql(table: string, rows: Array<Record<string, unknown>>): { sql: string; bindings: unknown[] } {
	if (rows.length === 0) throw new Error('insertManySql: empty rows');
	const cols = Object.keys(rows[0]);
	const binds: unknown[] = [];
	const valueSets = rows.map((row, r) => {
		const offset = r * cols.length;
		cols.forEach((c) => binds.push(row[c]));
		return `(${cols.map((_, i) => `?${offset + i + 1}`).join(', ')})`;
	});
	return { sql: `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${valueSets.join(', ')}`, bindings: binds };
}

/**
 * A planned confirm side effect + how to undo it.
 * `stmt` = index of the guarded statement this op corresponds to (null for
 * unguarded inserts). On conflict, ops whose guarded statement matched 0 rows
 * never wrote and are skipped; everything else is reversed.
 */
export type Op =
	| { kind: 'delete_lot'; lotId: string; stmt: null }
	| { kind: 'delete_serials'; serialIds: string[]; stmt: null }
	| { kind: 'delete_events'; eventIds: string[]; stmt: null }
	| { kind: 'return_flip'; serialId: string; fromStatus: string; fromLocation: string | null; stmt: number }
	| {
			kind: 'fit_change';
			serialId: string;
			fromVehicle: string | null;
			fromSlot: string | null;
			fromEmployee?: string | null;
			stmt: number;
	  }
	| {
			kind: 'lot_deduct';
			lotId: string;
			qty: number;
			stmt: number;
			/** The status the lot must be put BACK to when the take is undone (a reversal
			 *  restores `empty` where it found it; the confirm's own rollback leaves the
			 *  default `active`). */ fromStatus?: string;
	  }
	| { kind: 'serial_flip'; serialId: string; fromStatus: string; stmt: number; hadVehicle?: boolean; employeeReset?: boolean }
	| { kind: 'serial_move'; serialId: string; fromLocation: string; stmt: number }
	| {
			kind: 'lot_merge';
			lotId: string;
			qty: number;
			stmt: number;
			/** The status the lot held BEFORE an ADDITIVE write (a reversal putting stock back into a lot it took from). The confirm's own destination merge passes none — it only added to a lot whose status it did not touch. Set it and the rollback also puts the status back (`empty → active`), so a lost guard mid-reversal leaves no revived lot behind. */ restoreStatus?: string;
	  }
	| { kind: 'bal_up'; invId: string; qty: number; stmt: number }
	| { kind: 'delete_inv'; invId: string; stmt: null }
	// A paid-at-receipt confirm's ledger entry — undone when the header flip lost.
	| { kind: 'delete_payment'; paymentId: string; stmt: null }
	| { kind: 'bal_down'; invId: string; qty: number; stmt: number }
	| { kind: 'line_restore'; lineId: string; expectedQty: number | null; diffQty: number | null; stmt: null }
	| { kind: 'delete_links'; table: string; column: string; docId: string; stmt: null }
	| { kind: 'check_reading'; serialId: string; treadMm: number | null; psi: number | null; condition: string | null; stmt: number }
	| { kind: 'doc_unflip'; table: string; docId: string; fromStatus: string | null; stmt: number; column?: string }
	| { kind: 'requisition_restore'; table: string; docId: string; issuedQty: number | null; requisitionStatus: string | null; stmt: number }
	// Reverse-side rollback ops — undo a DELETE by re-inserting the exact row(s) the
	// reversal removed (the confirm-side ops above are the mirror: they undo inserts).
	| { kind: 'restore_lot'; row: Record<string, unknown>; stmt: number }
	| { kind: 'restore_serials'; rows: Record<string, unknown>[]; stmt: number }
	// Undo a reversal's OWN write by putting a unit back on the exact seam it had
	// before (status + store + holder), so a guard that lost mid-reversal leaves no
	// half-restored unit behind.
	| {
			kind: 'serial_restore';
			serialId: string;
			status: string | null;
			location: string | null;
			vehicle: string | null;
			slot: string | null;
			employee: string | null;
			stmt: number;
	  }
	// Undo a trace-row delete (an outbound/adjustment lot/serial trace, or a ledger
	// entry) by re-inserting the exact rows that were removed.
	| { kind: 'restore_rows'; table: string; rows: Record<string, unknown>[]; stmt: number };

/**
 * The atomic write engine: run one batch, and if a GUARDED statement matched no
 * row, reverse everything the batch did and report why. Stateless per call — it
 * holds only the db handle and the resolved table names it is constructed with.
 */
export class GuardedBatch {
	constructor(
		private readonly db: D1Client,
		private readonly tables: Tables,
	) {}

	async runGuarded(
		statements: { sql: string; bindings: unknown[] }[],
		guardIndex: Map<number, string>,
		ops: Op[],
		defaultMessage: string,
	): Promise<string | null> {
		let results: Array<{ meta?: { changes?: number } }>;
		try {
			results = await this.db.batch(statements);
		} catch (err) {
			console.error('[mro] confirm batch failed', err);
			throw new MroError(500, 'Nothing was changed — try again');
		}
		const failedGuards = [...guardIndex.entries()].filter(([i]) => changesOf(results[i]) === 0);
		if (failedGuards.length === 0) return null;

		const failed = new Set(failedGuards.map(([i]) => i));
		const now = nowIso();
		const undo: { sql: string; bindings: unknown[] }[] = [];
		for (const op of ops) {
			if (op.stmt !== null && failed.has(op.stmt)) continue; // that op never wrote
			switch (op.kind) {
				case 'delete_lot':
					undo.push({ sql: `DELETE FROM ${this.tables.lots} WHERE id = ?1`, bindings: [op.lotId] });
					break;
				case 'delete_serials':
					if (op.serialIds.length > 0) {
						const binds = op.serialIds.map((_, i) => `?${i + 1}`);
						undo.push({ sql: `DELETE FROM ${this.tables.serials} WHERE id IN (${binds.join(', ')})`, bindings: op.serialIds });
					}
					break;
				case 'delete_events':
					if (op.eventIds.length > 0) {
						const binds = op.eventIds.map((_, i) => `?${i + 1}`);
						undo.push({ sql: `DELETE FROM ${this.tables.events} WHERE id IN (${binds.join(', ')})`, bindings: op.eventIds });
					}
					break;
				case 'return_flip':
					undo.push({
						sql: `UPDATE ${this.tables.serials} SET status = ?1, location = ?2, updated_at = ?3 WHERE id = ?4`,
						bindings: [op.fromStatus, op.fromLocation, now, op.serialId],
					});
					break;
				case 'lot_deduct':
					undo.push({
						sql: `UPDATE ${this.tables.lots} SET remaining_qty = remaining_qty + ?1, status = ?2, updated_at = ?3 WHERE id = ?4`,
						bindings: [op.qty, op.fromStatus ?? 'active', now, op.lotId],
					});
					break;
				case 'serial_flip':
					undo.push({
						// A fitted unit (stamped with a vehicle at issue) is restored to plain
						// in-stock on rollback — clear the fit so it never lingers half-issued.
						sql: `UPDATE ${this.tables.serials} SET status = ?1, updated_at = ?2${op.hadVehicle ? ', vehicle = NULL' : ''}${op.employeeReset ? ', employee = NULL' : ''} WHERE id = ?3`,
						bindings: [op.fromStatus, now, op.serialId],
					});
					break;
				case 'fit_change':
					// Restore the previous holder seam (vehicle + slot + employee) on a failed move.
					undo.push({
						sql: `UPDATE ${this.tables.serials} SET vehicle = ?1, slot = ?2, employee = ?3, updated_at = ?4 WHERE id = ?5`,
						bindings: [op.fromVehicle, op.fromSlot, op.fromEmployee ?? null, now, op.serialId],
					});
					break;
				case 'check_reading':
					// Restore the previous tread/pressure/condition snapshot when a check guard lost
					// (the serial moved / was removed while we were reading it).
					undo.push({
						sql: `UPDATE ${this.tables.serials} SET tread_mm = ?1, psi = ?2, condition = ?3, updated_at = ?4 WHERE id = ?5`,
						bindings: [op.treadMm, op.psi, op.condition, now, op.serialId],
					});
					break;
				case 'bal_up':
					undo.push({
						sql: `UPDATE ${this.tables.inv} SET qty_on_hand = qty_on_hand - ?1, updated_at = ?2 WHERE id = ?3`,
						bindings: [op.qty, now, op.invId],
					});
					break;
				case 'delete_inv':
					undo.push({ sql: `DELETE FROM ${this.tables.inv} WHERE id = ?1`, bindings: [op.invId] });
					break;
				case 'delete_payment':
					undo.push({ sql: `DELETE FROM ${this.tables.payments} WHERE id = ?1`, bindings: [op.paymentId] });
					break;
				case 'bal_down':
					undo.push({
						sql: `UPDATE ${this.tables.inv} SET qty_on_hand = qty_on_hand + ?1, updated_at = ?2 WHERE id = ?3`,
						bindings: [op.qty, now, op.invId],
					});
					break;
				case 'serial_move':
					undo.push({
						sql: `UPDATE ${this.tables.serials} SET location = ?1, updated_at = ?2 WHERE id = ?3`,
						bindings: [op.fromLocation, now, op.serialId],
					});
					break;
				case 'lot_merge':
					undo.push({
						// Deduct what the statement added; when the statement also REVIVED the lot
						// (`restoreStatus`), put that status back too, so a reversal rolled back after a
						// later guard lost leaves the lot exactly as it found it.
						sql: `UPDATE ${this.tables.lots} SET remaining_qty = remaining_qty - ?1, status = COALESCE(?2, status), updated_at = ?3 WHERE id = ?4`,
						bindings: [op.qty, op.restoreStatus ?? null, now, op.lotId],
					});
					break;
				case 'line_restore':
					undo.push({
						sql: `UPDATE ${this.tables.adjustmentLines} SET expected_qty = ?1, diff_qty = ?2 WHERE id = ?3`,
						bindings: [op.expectedQty, op.diffQty, op.lineId],
					});
					break;
				case 'delete_links':
					undo.push({ sql: `DELETE FROM ${op.table} WHERE ${op.column} = ?1`, bindings: [op.docId] });
					break;
				case 'doc_unflip':
					// `column` defaults to doc_status; a custom lifecycle column (e.g. the
					// asset-request `status`) passes its own name — an internal constant, never
					// user input.
					undo.push({
						sql: `UPDATE ${op.table} SET ${op.column ?? 'doc_status'} = ?1, updated_at = ?2 WHERE id = ?3`,
						bindings: [op.fromStatus, now, op.docId],
					});
					break;
				case 'requisition_restore':
					// Undo the issued_qty/status the request picked up from a reversed issue.
					undo.push({
						sql: `UPDATE ${op.table} SET issued_qty = ?1, requisition_status = ?2, updated_at = ?3 WHERE id = ?4`,
						bindings: [op.issuedQty, op.requisitionStatus, now, op.docId],
					});
					break;
				case 'restore_lot':
					undo.push(insertSql(this.tables.lots, op.row));
					break;
				case 'restore_serials':
					if (op.rows.length > 0) undo.push(insertManySql(this.tables.serials, op.rows));
					break;
				case 'serial_restore':
					undo.push({
						sql: `UPDATE ${this.tables.serials} SET status = ?1, location = ?2, vehicle = ?3, slot = ?4, employee = ?5, updated_at = ?6 WHERE id = ?7`,
						bindings: [op.status, op.location, op.vehicle, op.slot, op.employee, now, op.serialId],
					});
					break;
				case 'restore_rows':
					if (op.rows.length > 0) undo.push(insertManySql(op.table, op.rows));
					break;
			}
		}
		if (undo.length > 0) {
			try {
				await this.db.batch(undo);
			} catch (err) {
				// The reversal is the ONLY thing standing between a guard that lost and a batch
				// that already wrote. Swallowing this would let the caller report "nothing was
				// changed" over rows that ARE changed — the one answer a stock ledger must
				// never give, because the document still reads draft while the stock effect
				// stands. Fail loudly and point at the integrity report instead of letting a
				// half-applied effect pass as a clean refusal.
				console.error('[mro] confirm reversal FAILED — rows stayed applied', err);
				throw new MroError(
					500,
					'This update could not be completed or cleanly reversed — it may be partially applied. Do not retry blindly: run the stock reconciliation report (GET /api/mro/stock/reconcile) first.',
				);
			}
		}
		const msg = failedGuards.map(([i]) => guardIndex.get(i)).find(Boolean);
		return msg ?? defaultMessage;
	}
}

/**
 * Fully-uniform immutable serial-event row. The engine timestamps are added by
 * `planEventInserts` (created_at/updated_at/_meta), so every call site must only
 * fill the identity + lifecycle columns below. Keeping the SAME column set on
 * every event lets one `insertManySql` carry them in a single atomic batch, and
 * the whole set is registered as one reversible `delete_events` op so a failed
 * confirm never leaves phantom history rows.
 */
export type SerialEventSeed = {
	id: string;
	serial: string;
	event: string;
	from_vehicle?: string | null;
	to_vehicle?: string | null;
	from_employee?: string | null;
	to_employee?: string | null;
	from_slot?: string | null;
	to_slot?: string | null;
	from_location?: string | null;
	to_location?: string | null;
	ref_kind?: string | null;
	ref_doc?: string | null;
	by_user?: string | null;
	note?: string | null;
	/** The physical day a back-dated fit/un-seat happened (`YYYY-MM-DD`). Empty
	 *  for every other event, whose history date stays the engine `created_at`. */
	event_date?: string | null;
};

/** Appends one atomic INSERT batch for the given serial events + its reversal op. */
export function planEventInserts(
	table: string,
	events: SerialEventSeed[],
	statements: { sql: string; bindings: unknown[] }[],
	ops: Op[],
	createdAt: string,
): void {
	if (events.length === 0) return;
	const rows = events.map((a) => ({
		id: a.id,
		serial: a.serial,
		event: a.event,
		from_vehicle: a.from_vehicle ?? null,
		to_vehicle: a.to_vehicle ?? null,
		from_employee: a.from_employee ?? null,
		to_employee: a.to_employee ?? null,
		from_slot: a.from_slot ?? null,
		to_slot: a.to_slot ?? null,
		from_location: a.from_location ?? null,
		to_location: a.to_location ?? null,
		ref_kind: a.ref_kind ?? null,
		ref_doc: a.ref_doc ?? null,
		by_user: a.by_user ?? null,
		note: a.note ?? null,
		event_date: a.event_date ?? null,
		_meta: '{}',
		created_at: createdAt,
		updated_at: createdAt,
	}));
	statements.push(insertManySql(table, rows));
	ops.push({ kind: 'delete_events', eventIds: rows.map((r) => String(r.id)), stmt: null });
}

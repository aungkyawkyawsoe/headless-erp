import {
	MRO_LOCATION_LABELS,
	type MroCompositionBalance,
	type MroCompositionLot,
	type MroCompositionSerial,
	type MroItemComposition,
	type MroTracking,
} from '@/shared/mro';
import { formatEnglishDateLabel } from '@/shared/time/myanmar';

import { fmtQty } from '../components/display';

/**
 * The stock item page's line list, as a PURE mapping — the composition read
 * (`GET /api/mro/stock/items/:modelId`) in, the rows to draw out. Kept free of
 * React so the three policies (and the empty set) are unit-testable without
 * mounting anything, and so the page only ever renders lines it is handed.
 *
 * The page is "what is behind this SKU's balance?", so the lines follow the
 * item's OWN tracking policy: a `batch` item lists its FEFO lots, a `serial`
 * item its in-stock units, a plain item its per-store balances. Every store the
 * SKU sits in shows up, each line labelled with its store — that is the whole
 * point of a dedicated page (the compact card it was opened from can only show
 * one store's number).
 */

export type StockLineKind = 'balance' | 'lot' | 'serial';

/** Tone for a line's qty — amber "act soon", red "already bad". */
export type StockLineTone = 'neutral' | 'warning' | 'danger';

export interface StockLine {
	/** Stable React key (the row id, or the store for a balance line). */
	key: string;
	kind: StockLineKind;
	/** The line's identity — batch no / serial no / (balance) the store label. */
	primary: string;
	/** The muted detail under the primary (store, expiry, holder, ledger drift);
	 *  null when this line has nothing more to say. */
	secondary: string | null;
	/** The right-hand quantity, already formatted — every line has one (a serial
	 *  unit is one each, so it reads `1`). The column is therefore never empty. */
	qty: string | null;
	tone: StockLineTone;
	/** Set on a serial unit line — the unit's own `mro_stock_serials` id (kept on
	 *  the row for callers that need the identity; the list itself is a read-out). */
	serialId?: string;
}

/** A lot/serial inside this many days of expiry is worth flagging amber. */
const EXPIRY_WARN_DAYS = 30;

/** The MRO store label, falling back to the raw value for a store this build
 *  has not heard of. */
function storeLabel(location: string): string {
	return MRO_LOCATION_LABELS[location] ?? location;
}

/** "Expires 12-Oct-2026 · 28d" / "Expired 12-Oct-2026" — null with no date. */
function expiryText(date: string | null, daysLeft: number | null): string | null {
	const label = formatEnglishDateLabel(date);
	if (!label) return null;
	if (daysLeft == null) return `Expires ${label}`;
	if (daysLeft < 0) return `Expired ${label}`;
	return `Expires ${label} · ${daysLeft}d`;
}

/** One store's balance line. `derived_qty ?? qty_on_hand` is the SAME sum the
 *  composition's `totals.on_hand` uses, so a line can never disagree with the
 *  header above it. */
function balanceLines(balances: readonly MroCompositionBalance[]): StockLine[] {
	return balances.map((b) => {
		// An orphan row (stock with no balance row of its own) carries no ledger,
		// so it says so instead of pretending a stored 0 is the truth.
		const isOrphan = b.id === null;
		const drifted = b.drift === true;
		const secondary = [
			isOrphan ? 'No balance row' : null,
			drifted ? `Ledger ${fmtQty(b.qty_on_hand)}` : null,
			// Expired stock is physically here but never issuable — say so instead of
			// letting the on-hand number read as available (batch/serial only; a
			// standard model has no dates to expire).
			b.expired_qty > 0 ? `${fmtQty(b.expired_qty)} expired` : null,
		]
			.filter(Boolean)
			.join(' · ');
		return {
			key: `balance:${b.location}`,
			kind: 'balance',
			primary: storeLabel(b.location),
			secondary: secondary || null,
			qty: fmtQty(b.derived_qty ?? b.qty_on_hand),
			tone: b.expired_qty > 0 ? 'danger' : b.below_reorder ? 'warning' : 'neutral',
		};
	});
}

/** One lot line, FEFO order preserved from the server (soonest expiry first). */
function lotLines(lots: readonly MroCompositionLot[]): StockLine[] {
	return lots.map((lot) => {
		const secondary = [storeLabel(lot.location), expiryText(lot.expiry_date, lot.days_left)].filter(Boolean).join(' · ');
		return {
			key: `lot:${lot.id}`,
			kind: 'lot',
			primary: lot.batch_no?.trim() || 'No batch no.',
			secondary: secondary || null,
			qty: fmtQty(lot.remaining_qty),
			tone: lot.expired ? 'danger' : lot.days_left != null && lot.days_left <= EXPIRY_WARN_DAYS ? 'warning' : 'neutral',
		};
	});
}

/** Where a serial unit currently is: the person holding it, else the truck (with
 *  its wheel position), else the store it sits in. */
function holderText(unit: MroCompositionSerial): string | null {
	if (unit.employee) return unit.employee_name ?? 'Employee';
	if (unit.plate_no) return unit.slot ? `${unit.plate_no} · ${unit.slot}` : unit.plate_no;
	return null;
}

/** One serial unit line. The serial number IS the identity; the facts that
 *  matter to whoever holds the unit ride underneath — where it is, its
 *  EXPIRY (the same wording a lot line uses) and the live tyre readings — while
 *  the right-hand column carries its quantity (a unit is one each). */
function serialLines(serials: readonly MroCompositionSerial[]): StockLine[] {
	return serials.map((unit) => {
		const readings = [unit.tread_mm != null ? `${fmtQty(unit.tread_mm)}mm` : null, unit.psi != null ? `${fmtQty(unit.psi)} psi` : null]
			.filter(Boolean)
			.join(' · ');
		const secondary = [holderText(unit), storeLabel(unit.location), expiryText(unit.expiry_date, unit.days_left), readings]
			.filter(Boolean)
			.join(' · ');
		return {
			key: `serial:${unit.id}`,
			kind: 'serial',
			primary: unit.serial_no?.trim() || '—',
			secondary: secondary || null,
			qty: fmtQty(1),
			tone: unit.expired
				? 'danger'
				: unit.days_left != null && unit.days_left <= EXPIRY_WARN_DAYS
					? 'warning'
					: unit.condition === 'poor' || unit.condition === 'damaged'
						? 'warning'
						: 'neutral',
			serialId: unit.id,
		};
	});
}

/**
 * The lines for one composition, chosen by the model's OWN tracking policy:
 * `batch` → its lots, `serial` → its units, `standard` → the per-store balances.
 * Read-only; no policy is re-derived from the rows.
 */
export function linesOf(composition: MroItemComposition): StockLine[] {
	const tracking: MroTracking = composition.model.tracking;
	if (tracking === 'batch') return lotLines(composition.lots);
	if (tracking === 'serial') return serialLines(composition.serials);
	return balanceLines(composition.balances);
}

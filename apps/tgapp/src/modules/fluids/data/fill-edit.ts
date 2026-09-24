import type { FluidDraft } from '../components/fluid-section';
import type { FluidFillRow } from './types';

/**
 * The fluid record-edit screen's pure wiring: a stored fill row back to the
 * operator's form draft, and the draft's interval forward to the absolute due
 * the row stores. Create and correct share this derivation, so the displayed
 * interval and the stored `next_due_odo` can never drift.
 */

/** A fill row → the edit form's draft (the stored absolute due is turned back
 *  into the interval the operator typed: `next_due_odo − odo_at_fill`). */
export function fillEditDraft(fill: Pick<FluidFillRow, 'date' | 'odo_at_fill' | 'next_due_odo' | 'qty_liters' | 'note'>): FluidDraft {
	const interval = fill.odo_at_fill != null && fill.next_due_odo != null ? fill.next_due_odo - fill.odo_at_fill : null;
	return {
		date: fill.date ?? '',
		odo: fill.odo_at_fill != null ? String(fill.odo_at_fill) : '',
		nextInterval: interval != null ? String(interval) : '',
		qty: fill.qty_liters != null ? String(fill.qty_liters) : '',
		note: fill.note ?? '',
	};
}

/** The absolute `next_due_odo` an interval implies — the inverse of
 *  `fillEditDraft`. */
export function dueFromInterval(odoAtFill: number, intervalKm: number): number {
	return odoAtFill + intervalKm;
}

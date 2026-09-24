import { Check, Pencil } from 'lucide-react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';

import type { FluidFillHistoryModel } from '../data/types';
import { canConfirmFill, canEditFill, FILL_STATUS_META, fillStatusOf } from '../data/status';
import { kmValueLabel } from '@/modules/fleets/data/status';

/**
 * The Fluid HISTORY view's row card — ONE fill as its own compact card:
 * the effective-date (English day-month, e.g. "7 Sep" — falling back to
 * `created_at` for rows recorded before the date column existed) with the
 * row's status badge top-right (Pending / Confirmed / Cancelled), the fill
 * odo, and the NEXT-service odo that fill set (plus qty) trailing right.
 *
 * Actions follow the STATUS, never just the caller's intent: a PENDING row that
 * can still be confirmed carries its Confirm action (the engine's `doc_status`
 * ladder — the page opens the confirm sheet), and the correction (Edit) shows
 * only while the row is still PENDING (`canEditFill`). A CONFIRMED row is a
 * posted fact — it shows no action at all, exactly one glance per state, so a
 * caller that passes `onEdit` for the newest fill cannot surface Edit on a
 * posted one.
 */
export function FluidFillRowCard({
	fill,
	onConfirm,
	onEdit,
}: {
	fill: FluidFillHistoryModel;
	onConfirm?: (fill: FluidFillHistoryModel) => void;
	/** Renders the correction action — supplied only for the NEWEST fill of the
	 *  kind; older fills stay read-only history. */
	onEdit?: (fill: FluidFillHistoryModel) => void;
}) {
	const status = fillStatusOf(fill.docStatus);
	const statusMeta = FILL_STATUS_META[status];
	const confirmable = status === 'pending' && canConfirmFill(fill.docStatus);
	// The correction shows only for a not-yet-posted row — a CONFIRMED fill is
	// history, so the caller's `onEdit` (newest fill) is not enough on its own.
	const editable = onEdit != null && canEditFill(fill.docStatus);
	const dueText =
		fill.nextDueOdo != null
			? `due ${fill.nextDueOdo.toLocaleString()} km${fill.qtyLiters != null ? ` · ${fill.qtyLiters} L` : ''}`
			: 'due —';

	return (
		<li className={`${DENSE_CARD_FRAME} px-3.5 py-2.5`}>
			<div className="flex items-start justify-between gap-3">
				<p className="min-w-0 flex-1 truncate text-sm font-semibold leading-myanmar text-foreground">{fill.createdLabel ?? '—'}</p>
				<span
					className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase leading-none tracking-wide ${statusMeta.className}`}
				>
					{statusMeta.label}
				</span>
			</div>

			<div className="mt-1.5 flex items-baseline justify-between gap-3">
				<p className="text-xs font-medium tabular-nums leading-myanmar text-foreground/80">{kmValueLabel(fill.odo)}</p>
				<p className="shrink-0 text-meta font-medium tabular-nums leading-myanmar text-muted-foreground">{dueText}</p>
			</div>

			{/* Row actions — the correction (PENDING + newest fill) beside the
				Confirm action (PENDING rows only); a confirmed/cancelled row shows
				nothing. */}
			{(editable || (confirmable && onConfirm)) && (
				<div className="mt-2 flex items-center justify-end gap-2 border-t border-border/60 pt-2">
					{editable && onEdit && (
						<button
							type="button"
							onClick={() => onEdit(fill)}
							className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-meta font-semibold leading-myanmar text-foreground transition-colors duration-150 active:scale-95"
						>
							<Pencil className="size-3.5" strokeWidth={2.2} aria-hidden />
							Edit
						</button>
					)}
					{confirmable && onConfirm && (
						<button
							type="button"
							onClick={() => onConfirm(fill)}
							className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-meta font-semibold leading-myanmar text-primary transition-colors duration-150 active:scale-95"
						>
							<Check className="size-3.5" strokeWidth={2.2} aria-hidden />
							Confirm
						</button>
					)}
				</div>
			)}
		</li>
	);
}

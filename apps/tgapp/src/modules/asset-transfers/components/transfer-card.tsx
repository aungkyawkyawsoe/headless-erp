import { ArrowRight, ArrowRightLeft, Check, Trash2, X } from 'lucide-react';
import { CARD_FRAME } from '@/shared/components/card';

import { formatCompactRelativeTime } from '@/shared/time/myanmar';
import { MRO_LOCATION_LABELS, type MroLocation } from '@/shared/mro';
import { TRANSFER_STATUS_META, requestKindOf, transferStatusOf, type AssetTransferRow } from '../data/types';

/** A holder as the card shows it — a truck (`plate` + seat, or "spare"), a
 *  person, or an em dash for a loose/absent holder. */
function holderLabel(plate: string | null, slot: string | null, person: string | null, absent: string): string {
	if (plate?.trim()) return slot?.trim() ? `${plate} · ${slot}` : `${plate} · ${absent}`;
	if (person?.trim()) return person;
	return '—';
}

/** The store a RETURN row names, as its label (`main_store` → `Main store`). */
function storeLabel(location: string): string {
	return MRO_LOCATION_LABELS[location as MroLocation] ?? location;
}

/**
 * ONE row of the asset-request approval feed — the "game inventory trade
 * request" card: which unit (serial + ATR number), the change it asks for
 * (source → destination, or source → written off), who filed it and when, and the
 * decision controls for the row's lifecycle stage.
 *
 * ONE card serves all THREE governed shapes, because ONE table does: a row
 * carrying `to_location` is a RETURN (the destination reads as its store), a row
 * carrying `write_off` is a WRITE-OFF (the unit ends where it sits — there is no
 * destination to name), and a row carrying a vehicle/person is a TRANSFER. The
 * shape decides the executor's button too ("Execute return" / "Execute move" /
 * "Execute write-off") — an approver should never have to infer which of the three
 * writes they are authorising.
 *
 *   requested → Approve / Reject (two round icon buttons, the HR card's pattern)
 *   approved  → Execute … (the atomic change; approve ≠ execute)
 *   executed / rejected → the recorded decision (no further action)
 */
export function TransferCard({
	row,
	busy,
	onApprove,
	onReject,
	onExecute,
}: {
	row: AssetTransferRow;
	busy: boolean;
	onApprove: (row: AssetTransferRow) => void;
	onReject: (row: AssetTransferRow) => void;
	onExecute: (row: AssetTransferRow) => void;
}) {
	const status = transferStatusOf(row.status);
	const meta = TRANSFER_STATUS_META[status];
	const from = holderLabel(row.from_plate, row.from_slot, row.from_employee_name, 'spare');
	// WHAT the request asks for, from the SAME derivation the execute dispatches on:
	// a store for a return, a holder for a transfer, and — for a write-off — nothing
	// to move, because the unit is scrapped where it sits.
	const kind = requestKindOf(row);
	const isWriteOff = kind === 'write-off';
	const to =
		kind === 'return' ? storeLabel((row.to_location ?? '').trim()) : holderLabel(row.to_plate, row.to_slot, row.to_employee_name, 'spare');

	return (
		<li>
			<article className={`${CARD_FRAME} p-3 shadow-card`}>
				<div className="flex items-start justify-between gap-2">
					<div className="min-w-0">
						<p className="font-mono text-[10px] font-semibold tracking-wide text-muted-foreground">{row.display_number ?? 'ATR'}</p>
						<p className="mt-0.5 truncate text-sm font-bold leading-myanmar text-foreground">{row.serial_no ?? 'Asset unit'}</p>
					</div>
					<span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold leading-myanmar ${meta.className}`}>
						{meta.label}
					</span>
				</div>

				{/* The requested change — source → destination, or source → written off. */}
				<div className="mt-2 flex items-center gap-2 rounded-xl bg-muted/40 px-2.5 py-2">
					<span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-myanmar text-foreground">{from}</span>
					{isWriteOff ? (
						<Trash2 className="size-3.5 shrink-0 text-status-danger" aria-hidden />
					) : (
						<ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
					)}
					<span
						className={`min-w-0 flex-1 truncate text-right text-[12px] font-semibold leading-myanmar ${
							isWriteOff ? 'text-status-danger' : 'text-foreground'
						}`}
					>
						{isWriteOff ? 'Write off' : to}
					</span>
				</div>

				{row.note ? <p className="mt-2 line-clamp-2 text-meta leading-snug text-muted-foreground">“{row.note}”</p> : null}

				{status === 'rejected' && row.rejected_reason ? (
					<p className="mt-2 rounded-lg bg-status-danger-soft px-2.5 py-1.5 text-meta leading-snug text-status-danger">
						{row.rejected_reason}
					</p>
				) : null}

				{/* Decision line — never for an undecided request (its footer shows the filer). */}
				{status === 'approved' && row.approved_by_name ? (
					<p className="mt-2 text-meta leading-snug text-muted-foreground">
						Approved by <span className="font-semibold text-foreground">{row.approved_by_name}</span>
						{row.approved_at ? ` · ${formatCompactRelativeTime(row.approved_at)}` : ''}
					</p>
				) : null}
				{status === 'rejected' && row.approved_by_name ? (
					<p className="mt-1 text-meta leading-snug text-muted-foreground">
						Rejected by <span className="font-semibold text-foreground">{row.approved_by_name}</span>
						{row.approved_at ? ` · ${formatCompactRelativeTime(row.approved_at)}` : ''}
					</p>
				) : null}
				{status === 'executed' ? (
					<p className="mt-2 text-meta leading-snug text-muted-foreground">
						{kind === 'write-off' ? 'Write-off executed' : kind === 'return' ? 'Return executed' : 'Move executed'}
						{row.executed_at ? ` · ${formatCompactRelativeTime(row.executed_at)}` : ''}
					</p>
				) : null}

				<div className="mt-2.5 flex items-center justify-between gap-2">
					<p className="min-w-0 truncate text-meta leading-myanmar text-muted-foreground">
						{row.requested_by_name ?? 'Unknown requester'}
						{row.created_at ? ` · ${formatCompactRelativeTime(row.created_at)}` : ''}
					</p>

					{status === 'requested' ? (
						<div className="flex shrink-0 items-center gap-1.5">
							<button
								type="button"
								disabled={busy}
								onClick={() => onReject(row)}
								className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-50"
							>
								<X className="size-3.5" strokeWidth={2.2} aria-hidden />
								Reject
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={() => onApprove(row)}
								className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-3.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-50"
							>
								<Check className="size-3.5" strokeWidth={2.2} aria-hidden />
								Approve
							</button>
						</div>
					) : status === 'approved' ? (
						<button
							type="button"
							disabled={busy}
							onClick={() => onExecute(row)}
							className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-xs font-bold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-50"
						>
							<ArrowRightLeft className="size-3.5" aria-hidden />
							{kind === 'write-off' ? 'Execute write-off' : kind === 'return' ? 'Execute return' : 'Execute move'}
						</button>
					) : (
						<span className="shrink-0" aria-hidden />
					)}
				</div>
			</article>
		</li>
	);
}

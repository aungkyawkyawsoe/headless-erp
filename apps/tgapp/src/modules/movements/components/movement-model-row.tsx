import { memo } from 'react';
import { ChevronRight, Package } from 'lucide-react';

import { formatCount, MOVEMENT_LINE_META, dateLabel } from '../data/meta';
import type { MovementLineDirection, MovementModelRow } from '../data/types';
import { CARD_FRAME } from '@/shared/components/card';

/** The totals a model row shows, in the ledger's own order (IN / OUT / TRF). */
const TOTALS: ReadonlyArray<{ direction: MovementLineDirection; pick: (row: MovementModelRow) => number }> = [
	{ direction: 'in', pick: (row) => row.total_in },
	{ direction: 'out', pick: (row) => row.total_out },
	{ direction: 'trf', pick: (row) => row.total_trf },
];

/**
 * ONE SKU of the group on Screen 2's DEFAULT list — the group's register, read as
 * MODELS instead of a flat dump of every line:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [◫] Bolt M10                               › │
 *   │     IN +120   OUT −40   TRF −10              │  ← only the directions it moved
 *   │     12 lines · 5 docs · last 5 Sep 2026      │
 *   └──────────────────────────────────────────────┘
 *
 * The chips are the SAME per-direction meta the ledger cards and the summary use
 * (label + sign + tone), so a figure reads identically on both screens — and a
 * direction the SKU never moved IN is omitted rather than printed as a `+0`
 * (data-ink: a zero says nothing about a part that only ever came in).
 *
 * Tapping the row opens that SKU's own line ledger (Screen 3) — the register is
 * the navigation, not a summary that dead-ends.
 */
const MovementModelRowCard = memo(function MovementModelRowCard({ row, onOpen }: { row: MovementModelRow; onOpen?: () => void }) {
	const moved = TOTALS.map((total) => ({ ...total, qty: total.pick(row) })).filter((total) => total.qty !== 0);
	const meta = [`${formatCount(row.line_count)} lines`, `${formatCount(row.doc_count)} docs`];
	if (row.last_date) meta.push(`last ${dateLabel(row.last_date)}`);

	const body = (
		<>
			<span className="flex min-w-0 items-start gap-2.5">
				<span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<Package className="size-4" strokeWidth={2} aria-hidden />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block font-display text-key font-bold leading-tight tracking-tight text-foreground">
						{row.model_name?.trim() || 'Deleted SKU'}
					</span>
					<span className="mt-1 flex flex-wrap items-center gap-1.5">
						{moved.map((total) => {
							const chip = MOVEMENT_LINE_META[total.direction];
							return (
								<span
									key={total.direction}
									className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-bold leading-myanmar tabular-nums ${chip.chipClass}`}
								>
									<span>{chip.label}</span>
									<span>
										{chip.sign}
										{formatCount(total.qty)}
									</span>
								</span>
							);
						})}
					</span>
					<span className="mt-1 block truncate text-meta leading-myanmar text-muted-foreground">{meta.join(' · ')}</span>
				</span>
			</span>
			{onOpen ? <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground" strokeWidth={2} aria-hidden /> : null}
		</>
	);

	return (
		<li className={`${CARD_FRAME} shadow-card transition-colors duration-150 ${onOpen ? 'hover:bg-muted/20 active:bg-muted/30' : ''}`}>
			{onOpen ? (
				<button
					type="button"
					onClick={onOpen}
					aria-label={`${row.model_name?.trim() || 'Model'} — open its movement ledger`}
					className="flex w-full items-start gap-2 rounded-2xl p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
				>
					{body}
				</button>
			) : (
				<div className="flex w-full items-start gap-2 p-4">{body}</div>
			)}
		</li>
	);
});

export { MovementModelRowCard };

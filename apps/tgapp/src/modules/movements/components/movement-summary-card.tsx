import { memo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';

import { formatCount, MOVEMENT_LINE_META } from '../data/meta';
import type { MovementLineDirection, MovementSummary } from '../data/types';

/** The three summary chips, in display order. */
const SUMMARY_DIRECTIONS: readonly MovementLineDirection[] = ['in', 'out', 'trf'];

interface MovementSummaryCardProps {
	/** The model's display name — null while the master read is unresolved. */
	name: string | null;
	/** The scope summary the ledger's first page returned. */
	summary: MovementSummary;
}

/**
 * The Screen 3 header card — the model's name over its scope summary chips:
 *
 *  ┌──────────────────────────────────────────┐
 *  │ Bulb H4 12V                              │
 *  │ [IN 24] [OUT 6] [TRF 0]   On-hand 51     │
 *  │ 8 doc(s) · 30 line(s)                    │
 *  └──────────────────────────────────────────┘
 *
 * The chips are the server's totals over the ACTIVE scope (the direction tabs
 * + store filter narrow the summary with the rows), with the current on-hand
 * as the trailing muted chip and the doc/line counts as the caption.
 */
export const MovementSummaryCard = memo(function MovementSummaryCard({ name, summary }: MovementSummaryCardProps) {
	const onHand = summary.on_hand != null && Number.isFinite(summary.on_hand) ? formatCount(summary.on_hand) : '—';

	return (
		<div className={`${CARD_FRAME} p-4 shadow-card`}>
			<p className="font-display text-key font-bold leading-tight tracking-tight text-foreground">{name ?? '—'}</p>

			<div className="mt-2 flex flex-wrap items-center gap-1.5">
				{SUMMARY_DIRECTIONS.map((direction) => (
					<span
						key={direction}
						className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta font-bold leading-myanmar tabular-nums ${MOVEMENT_LINE_META[direction].chipClass}`}
					>
						<span>{MOVEMENT_LINE_META[direction].label}</span>
						<span>
							{MOVEMENT_LINE_META[direction].sign}
							{formatCount(direction === 'in' ? summary.total_in : direction === 'out' ? summary.total_out : summary.total_trf)}
						</span>
					</span>
				))}
				<span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-meta font-bold leading-myanmar text-muted-foreground tabular-nums">
					<span>On-hand</span>
					<span>{onHand}</span>
				</span>
			</div>

			<p className="mt-1.5 text-meta font-medium leading-myanmar text-muted-foreground">
				{summary.doc_count} doc(s) · {summary.line_count} line(s)
			</p>
		</div>
	);
});

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { hapticSelection } from '@/shared/platform/haptics';

/**
 * The **ledger** — ONE bordered card of hairline-separated record rows.
 *
 * This is the read-out list a truck's file uses (License / Insurance / ODO /
 * Maintenance), borrowed from the stock-item page: a record is NOT its own
 * floating card. A card per record costs ~150px with its 12px gap; a flush
 * `divide-y` row costs ~56px, so a screenful shows 2–3× more history — and the
 * whole file reads as ONE connected series instead of a stack of unrelated
 * slabs (Gestalt proximity is what tells the eye these belong together).
 *
 * The frame owns the border/rounding/dividers; a `LedgerRow` owns only its own
 * content, exactly like `ErpRow` does for the dense document grid.
 */

/** Tone for a row's transition delta. */
export type LedgerDeltaTone = 'neutral' | 'positive' | 'warn' | 'danger';

const DELTA_CLASS: Record<LedgerDeltaTone, string> = {
	neutral: 'text-muted-foreground',
	positive: 'text-status-success',
	warn: 'text-status-warning',
	danger: 'text-status-danger',
};

/** The TRANSITION line — what changed from the previous record. */
export interface LedgerDelta {
	/** e.g. `+700 km`, `premium +70,000`. */
	label: string;
	tone?: LedgerDeltaTone;
}

interface LedgerListProps {
	/** The section caption (e.g. "History"). */
	caption?: ReactNode;
	/** Right-aligned count/qualifier on the caption line (e.g. "12 records"). */
	count?: ReactNode;
	className?: string;
	children: ReactNode;
}

/** The framed ledger container — one card, hairline dividers, no inter-row gap. */
export function LedgerList({ caption, count, className, children }: LedgerListProps) {
	return (
		<section className={className}>
			{caption ? (
				<p className="mb-1.5 flex items-baseline justify-between gap-3 px-1">
					<span className="text-meta font-bold uppercase tracking-[0.14em] leading-none text-muted-foreground">{caption}</span>
					{count != null ? <span className="text-meta font-medium leading-myanmar text-muted-foreground">{count}</span> : null}
				</p>
			) : null}
			<ul className="list-window divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card shadow-card">
				{children}
			</ul>
		</section>
	);
}

interface LedgerRowProps {
	/** L1 — the row's anchor (period year, date, license no, job name). */
	anchor: ReactNode;
	/** L2 — the identity/facts line under the anchor. */
	secondary?: ReactNode;
	/** The right-hand headline figure (km, total). */
	value?: ReactNode;
	/** A status pill at the right (renewal urgency, expired…). */
	pill?: { label: string; className: string };
	/** A CUSTOM status node at the right — for a badge component that already owns
	 *  its tint (the licence/insurance remaining-days pill). Use ONE of
	 *  `pill` / `status`. */
	status?: ReactNode;
	/** The transition from the PREVIOUS record — the ledger's whole point. */
	delta?: LedgerDelta;
	/** Always-visible trailing content (e.g. a pencil action button).
	 *  MUST NOT be interactive when `onOpen` is set (a button inside a button is
	 *  invalid and unreliable) — put actions in `details` instead. */
	trailing?: ReactNode;
	/** Revealed on tap (progressive disclosure). Presence adds the chevron and
	 *  makes the row header a toggle. */
	details?: ReactNode;
	/** Tap → open/act (used when the row has no `details`). */
	onOpen?: () => void;
	ariaLabel?: string;
}

/**
 * ONE ledger row — the 3-scale record row:
 *
 *   2025/26   AYA SOMPO            [214d]
 *   ↑ premium +70,000
 *
 * The anchor is the thing a scan lands on, `secondary` carries the facts, the
 * right slot carries the figure/pill, and `delta` states the TRANSITION from the
 * previous record (a renewal delta, a km jump) — the line that turns a list of
 * snapshots into a series with momentum.
 */
export function LedgerRow({ anchor, secondary, value, pill, status, delta, trailing, details, onOpen, ariaLabel }: LedgerRowProps) {
	const [open, setOpen] = useState(false);
	const expandable = details != null;
	// A toggle wins over a tap action: with details there IS something to reveal,
	// and the row's own action belongs inside it (the maintenance pattern).
	const interactive = expandable || onOpen != null;

	const content = (
		<>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-baseline gap-2">
					<span className="min-w-0 truncate text-sub font-semibold leading-tight text-foreground">{anchor}</span>
					{value != null ? (
						<span className="ml-auto shrink-0 text-sub font-bold leading-none tabular-nums text-foreground">{value}</span>
					) : null}
				</span>
				{secondary != null ? <span className="truncate text-meta leading-myanmar text-muted-foreground">{secondary}</span> : null}
				{delta ? (
					<span className={`truncate text-meta font-medium leading-myanmar tabular-nums ${DELTA_CLASS[delta.tone ?? 'neutral']}`}>
						{delta.label}
					</span>
				) : null}
			</span>
			<span className="flex shrink-0 items-center gap-1.5 pt-0.5">
				{trailing}
				{status}
				{pill ? (
					<span className={`rounded-full px-2 py-0.5 text-meta font-semibold leading-myanmar ${pill.className}`}>{pill.label}</span>
				) : null}
				{expandable ? (
					<ChevronDown
						className={`size-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
						aria-hidden
					/>
				) : null}
			</span>
		</>
	);

	const rowClass = 'flex w-full items-start gap-3 px-3.5 py-3 text-left outline-none';

	return (
		<li>
			{interactive ? (
				<button
					type="button"
					onClick={() => {
						if (expandable) {
							hapticSelection();
							setOpen((v) => !v);
						} else {
							onOpen?.();
						}
					}}
					aria-expanded={expandable ? open : undefined}
					aria-label={ariaLabel}
					className={`${rowClass} transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
				>
					{content}
				</button>
			) : (
				<div className={rowClass}>{content}</div>
			)}
			{expandable && open ? <div className="border-t border-dashed border-border/70 px-3.5 pt-3 pb-3.5">{details}</div> : null}
		</li>
	);
}

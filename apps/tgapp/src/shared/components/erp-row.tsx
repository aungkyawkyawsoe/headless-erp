import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { hapticSelection } from '@/shared/platform/haptics';

/** One tertiary fact, revealed by the row's disclosure toggle. */
export interface ErpRowMeta {
	label: string;
	value: ReactNode;
	/** Span the full width and WRAP the value instead of truncating it — for a long
	 *  free text (a description / note) that must stay readable behind the toggle. */
	wide?: boolean;
}

/** A compact status pill config — the caller supplies the label + tone classes
 *  (the module's own status meta), so colour stays module-owned. */
export interface ErpRowStatus {
	label: string;
	className: string;
}

interface ErpRowProps {
	/** Extra classes merged onto the root `<li>` (e.g. card surface in comfortable density). */
	className?: string;
	/** L1 — the ANCHOR: document number, plate, serial. Bold, full-contrast.
	 *  This is the one string a scan must land on (REQ-00004, 6S-2439, TY-…). */
	anchor: ReactNode;
	/** L2 — the identity line: store / location / subject. */
	secondary?: ReactNode;
	/** L3 — a single tertiary line kept on the collapsed face (e.g. "Aung · 12 Jan").
	 *  Anything richer belongs in `meta` (progressive disclosure). */
	tertiary?: ReactNode;
	/** A document VALUE (amount, grand total) shown bold at the top-right, ABOVE the
	 *  status pill — the ERP habit of leading a financial row with its value.
	 *  The stock-document rows deliberately leave it unset: their status + ⋮ menu own
	 *  the top-right corner (a lifecycle you can scan without tapping), and their total
	 *  rides the disclosure facts instead of being read twice. */
	trailing?: ReactNode;
	/** Status on the top-right of the collapsed face — the row's lifecycle state. */
	status?: ErpRowStatus;
	/** A small leading chip/slot (qty, icon) — optional. */
	leading?: ReactNode;
	/** Inline operational actions (Approve / Issue / …). Reserved for the
	 *  Approval Center, where deciding IS the job — see the density rollout
	 *  decision: document lists stay lean navigation, never decision surfaces. */
	actions?: ReactNode;
	/**
	 * A row-level ⋮ actions menu, rendered LAST in the TOP-RIGHT cluster (beside the
	 * status pill, right of the disclosure chevron) — the home for a lifecycle action
	 * that is not the row's job (cancelling a posted document, whose reversal is
	 * destructive and final). Deliberately NOT `actions`: that slab is the row's bottom
	 * decision strip, this is the quiet corner affordance, and a destructive exit
	 * belongs behind a second gesture.
	 */
	menu?: ReactNode;
	/**
	 * Tertiary facts hidden behind the disclosure chevron. Progressive
	 * disclosure: the collapsed face carries only the anchor + status, so a
	 * power user scanning 10+ rows is not forced through every field. Absent ⇒
	 * no chevron and the whole row is the tap target.
	 */
	meta?: ErpRowMeta[];
	/** Extra always-visible content below the face (e.g. the child line items). */
	children?: ReactNode;
	/**
	 * Render `meta` ALWAYS open — no disclosure toggle, no chevron. For a row whose
	 * facts are always wanted (a short, fixed detail set). Default: collapsed behind
	 * the chevron (progressive disclosure).
	 */
	metaAlwaysVisible?: boolean;
	/** Tap → open the record (the detail page). */
	onOpen?: () => void;
}

/**
 * The dense ERP row — the shared presentation for every business record, so a
 * requisition, a leave request and a work order all scan the same way.
 *
 * Anatomy (phone, ~64px collapsed, flush with its neighbours — the LIST owns
 * the frame + hairline dividers, this owns only its content):
 *
 *   ┌───────────────────────────────────────────────┬──────────────┐
 *   │  REQ-00004                        ← L1 anchor │  [Requested] │  ← status, top-right
 *   │  Main Store                       ← L2 identity│              │
 *   │  Aung · 12 Jan · 3 lines          ← L3 tertiary│      ⌄       │  ← disclosure
 *   └───────────────────────────────────────────────┴──────────────┘
 *   Requested By   Aung Kyaw          ← revealed on ⌄ (progressive disclosure)
 *   Approved By    —
 *
 * Three deliberate ERP properties:
 *  - **3-scale typography** — anchor / identity / meta are named tokens
 *    (`text-key` / `text-sub` / `text-meta`), never ad-hoc pixel values, so
 *    hierarchy is identical on every screen (Z-pattern scanning).
 *  - **Density** — `py-2.5` + hairline dividers instead of a floating card with
 *    a drop shadow: roughly 2–3× the records per screen.
 *  - **Mistake-proofing** — the row is inert unless `onOpen`/`actions` are
 *    given; high-stakes decisions are NOT implicit in a tap anywhere, they sit
 *    on an explicit labelled control.
 */
export function ErpRow({
	className,
	anchor,
	secondary,
	tertiary,
	trailing,
	status,
	leading,
	actions,
	menu,
	meta,
	children,
	metaAlwaysVisible = false,
	onOpen,
}: ErpRowProps) {
	const [expanded, setExpanded] = useState(false);
	const hasMeta = meta != null && meta.length > 0;
	// `metaAlwaysVisible` skips the disclosure entirely (no chevron): the facts are
	// always on screen, so the toggle would be a no-op.
	const showMeta = hasMeta && (metaAlwaysVisible || expanded);

	return (
		<li className={`relative ${className ?? ''}`}>
			<div className="flex min-h-14 items-start gap-2.5 px-3 py-2.5">
				{leading ? <span className="mt-0.5 shrink-0">{leading}</span> : null}

				{onOpen ? (
					<button
						type="button"
						onClick={onOpen}
						className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left focus:outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
					>
						<ErpRowFace anchor={anchor} secondary={secondary} tertiary={tertiary} />
					</button>
				) : (
					<div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
						<ErpRowFace anchor={anchor} secondary={secondary} tertiary={tertiary} />
					</div>
				)}

				<div className="flex shrink-0 flex-col items-end gap-1">
					{trailing ? <span className="text-sub font-bold tabular-nums leading-none text-primary">{trailing}</span> : null}
					<div className="flex items-center gap-1">
						{status ? (
							<span className={`rounded-full px-2 py-0.5 text-meta font-semibold leading-myanmar ${status.className}`}>{status.label}</span>
						) : null}
						{hasMeta && !metaAlwaysVisible ? (
							<button
								type="button"
								aria-expanded={expanded}
								aria-label={expanded ? 'Hide details' : 'Show details'}
								onClick={() => {
									hapticSelection();
									setExpanded((prev) => !prev);
								}}
								// Visual is a compact chevron; the hit area stays 44px via
								// negative margins so the row does not grow (Fitts's Law). The
								// right bleed is dropped when a ⋮ follows: two adjacent
								// controls must never share a tap target.
								className={`-my-2 flex size-11 items-center justify-center rounded-full text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${menu ? '' : '-mr-1'}`}
							>
								<ChevronDown className={`size-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} aria-hidden />
							</button>
						) : null}
						{menu}
					</div>
				</div>
			</div>

			{showMeta ? (
				<dl className="mx-3 mb-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg bg-muted/40 px-3 py-2">
					{meta.map((row) => (
						<div key={row.label} className={`flex min-w-0 flex-col gap-0.5 ${row.wide ? 'col-span-2' : ''}`}>
							<dt className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">{row.label}</dt>
							<dd
								className={`text-sub font-semibold leading-myanmar text-foreground ${row.wide ? 'break-words whitespace-pre-wrap' : 'truncate'}`}
							>
								{row.value}
							</dd>
						</div>
					))}
				</dl>
			) : null}

			{children ? <div className="mx-3 mb-2.5 flex flex-col gap-2">{children}</div> : null}

			{actions ? <div className="flex items-center justify-end gap-1.5 px-3 pb-2.5">{actions}</div> : null}
		</li>
	);
}

/** The collapsed face — the same three registers in every module. */
function ErpRowFace({ anchor, secondary, tertiary }: Pick<ErpRowProps, 'anchor' | 'secondary' | 'tertiary'>) {
	return (
		<>
			<span className="w-full truncate text-key font-bold leading-tight tracking-tight text-foreground">{anchor}</span>
			{secondary ? <span className="w-full truncate text-sub font-semibold leading-snug text-muted-foreground">{secondary}</span> : null}
			{tertiary ? <span className="w-full truncate text-meta leading-myanmar text-muted-foreground">{tertiary}</span> : null}
		</>
	);
}

/**
 * The LIST frame for `ErpRow`s — renders the one bordered card each dense list
 * sits in, with hairline dividers between rows and no inter-row gap. Mirrors
 * the compact shape `ListPage` uses, and is available to any grouped/custom
 * body that wants the same density outside `ListPage`.
 */
export function ErpRowList({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<ul className={`divide-y divide-border overflow-hidden rounded-xl border border-border bg-card ${className ?? ''}`}>{children}</ul>
	);
}

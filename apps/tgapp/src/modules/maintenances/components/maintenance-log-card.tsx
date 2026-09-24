import { memo, useState } from 'react';
import { CARD_FRAME, DENSE_CARD_FRAME } from '@/shared/components/card';
import { Check, ChevronDown, Pencil } from 'lucide-react';

import { CONFIRMED_BADGE, VENDOR_TYPE_META } from '../data/status';
import type { MaintenanceLogCardModel } from '../data/types';

/**
 * ONE maintenance log card — the row language shared by a truck's file
 * (`/app/maintenances/vehicle/:id`), the register's search results and the
 * browse page's unassigned rows.
 *
 * An EXPANDABLE card: the header is one tap target that toggles the details
 * inline (the feed stays on screen), so every collapsed card is the SAME height
 * whether the job is priced or not.
 *
 *  ┌──────────────────────────────────────────────────┐
 *  │ Engine & Gearbox Service            ▼            │  ← title (2-line area) + chevron
 *  │ JOB-ENG • MMK 600,000                            │  ← the job code · the total
 *  │ ──────────────────────────────────────────────── │
 *  │ [9Q-5691] [HINO] [External Vendor]  20 Aug – 22 Aug · 3 days │
 *  ├──────────────────────────────────────────────────┤
 *  │ ┌─ Parts Cost (ပစ္စည်းဖိုး) ┐ ┌─ Labor Cost (လက်ခ) ─┐ │
 *  │ │ MMK 480,000            │ │ MMK 120,000        │ │
 *  │ └────────────────────────┘ └────────────────────┘ │
 *  │ Odometer                        231,800 km        │
 *  │ Driver                                U Hla Tun   │
 *  │ Technician / Workshop      Mandalay Diesel Shop   │
 *  │ ▏ Injector service + gearbox oil change…          │
 *  │ [ ✎ Edit record ]                                 │
 *  └──────────────────────────────────────────────────┘
 *
 *  - **Header** — the job as the headline over `code • total`, with the truck
 *    plate + brand + vendor badges and the job window on the identity row;
 *  - **Details** (expanded) — the parts/labor breakdown, the odometer, the
 *    driver and technician facts, the note as a quote, and the Edit action.
 *
 * Editing is one deliberate step INSIDE — `onOpen` renders the details' Edit
 * button that opens the log's prefilled form (`/app/maintenances/log/:id`).
 */
export const MaintenanceLogCard = memo(function MaintenanceLogCard({
	log,
	kmSincePrevious,
	onOpen,
	onConfirm,
	confirming = false,
}: {
	log: MaintenanceLogCardModel;
	/** The odometer gained since the NEXT-newer job (readings arrive newest-first).
	 *  Absent/null ⇒ no transition line. Keeps the card's file readable as a
	 *  service-INTERVAL series rather than a stack of separate receipts. */
	kmSincePrevious?: number | null;
	/** Opens this log's edit form — rendered as the details' Edit action. Omitted,
	 *  the card is read-only (its details still expand). */
	onOpen?: (log: MaintenanceLogCardModel) => void;
	/** Confirms this draft log (posts it, then it is frozen). Only rendered while
	 *  the card is still a draft. */
	onConfirm?: (log: MaintenanceLogCardModel) => void;
	/** A confirm is in flight for THIS card — disables the action. */
	confirming?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const vendor = log.vendorType ? VENDOR_TYPE_META[log.vendorType] : null;
	const confirmed = log.docStatus === 'confirmed';
	const detailsId = `maintenance-details-${log.id}`;
	const heading = log.issueTypeName ?? 'Maintenance job';

	return (
		<li className={`overflow-hidden ${CARD_FRAME} shadow-card`}>
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-controls={detailsId}
				className="block w-full p-4 text-left outline-none transition-colors duration-150 hover:bg-muted/40 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			>
				{/* Headline — a FIXED two-line area while collapsed (short titles keep
					the row height uniform, long ones clamp at two); the full title shows
					once expanded. */}
				<span className="flex items-start justify-between gap-3">
					<span className={`min-w-0 flex-1 text-base font-semibold leading-snug text-foreground ${open ? '' : 'line-clamp-2 min-h-11'}`}>
						{heading}
					</span>
					<ChevronDown
						className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
						aria-hidden
					/>
				</span>

				{/* The job code · the engine-computed total. */}
				<span className="mt-1 flex items-center gap-2 text-xs">
					{log.jobCode && <span className="font-medium tracking-wide text-muted-foreground">{log.jobCode}</span>}
					{log.jobCode && log.totalLabel && (
						<span aria-hidden className="text-muted-foreground">
							•
						</span>
					)}
					{log.totalLabel ? (
						<span className="font-bold tabular-nums text-foreground">{log.totalLabel}</span>
					) : (
						<span className="font-medium text-muted-foreground">No cost recorded</span>
					)}
				</span>

				{/* Identity row — the truck plate + brand + vendor, with the job window. */}
				<span className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2">
					<span className="flex flex-wrap items-center gap-1.5">
						{log.plateNo && (
							<span className="rounded-md bg-muted px-2.5 py-1 text-xs font-bold leading-none tracking-wide text-foreground">
								{log.plateNo}
							</span>
						)}
						{log.brandLabel && (
							<span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold uppercase leading-none tracking-wide text-muted-foreground">
								{log.brandLabel}
							</span>
						)}
						{vendor && (
							<span className={`rounded border px-2 py-0.5 text-xs font-medium leading-myanmar ${vendor.className}`}>{vendor.label}</span>
						)}
						{confirmed && (
							<span className={`rounded border px-2 py-0.5 text-xs font-semibold leading-myanmar ${CONFIRMED_BADGE.className}`}>
								{CONFIRMED_BADGE.label}
							</span>
						)}
					</span>
					{log.rangeLabel && (
						<span className="text-xs font-medium text-muted-foreground">
							{log.rangeLabel}
							{log.durationLabel && (
								<>
									<span className="text-muted-foreground">{' · '}</span>
									<span className="font-semibold text-foreground/80">{log.durationLabel}</span>
								</>
							)}
						</span>
					)}
				</span>

				{kmSincePrevious != null && kmSincePrevious !== 0 && (
					<span className="mt-2 block text-meta font-medium leading-myanmar tabular-nums text-muted-foreground">
						{kmSincePrevious.toLocaleString()} km since the previous job
					</span>
				)}
			</button>

			{open && (
				<div id={detailsId} className="space-y-3 border-t border-dashed border-border/70 px-4 pt-3 pb-4 text-xs">
					{/* Parts vs labor — the cost breakdown. */}
					<div className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 bg-muted/40 p-3">
						<div className="min-w-0">
							<span className="block font-medium leading-myanmar text-muted-foreground">Parts Cost</span>
							<span className="mt-0.5 block text-sm font-bold tabular-nums text-foreground">{log.partsLabel ?? '—'}</span>
						</div>
						<div className="min-w-0 border-l border-border/60 pl-3">
							<span className="block font-medium leading-myanmar text-muted-foreground">Labor Cost</span>
							<span className="mt-0.5 block text-sm font-bold tabular-nums text-foreground">{log.laborLabel ?? '—'}</span>
						</div>
					</div>

					{/* Odometer + the people involved. */}
					{(log.odo || log.driverName || log.technician) && (
						<div className="space-y-2 px-1 pt-1 text-muted-foreground">
							{log.odo && (
								<div className="flex items-center justify-between gap-3">
									<span className="shrink-0">Odometer</span>
									<span className="text-right font-semibold tabular-nums text-foreground">{log.odo}</span>
								</div>
							)}
							{log.driverName && (
								<div className="flex items-center justify-between gap-3">
									<span className="shrink-0">Driver</span>
									<span className="min-w-0 text-right font-semibold leading-myanmar text-foreground">{log.driverName}</span>
								</div>
							)}
							{log.technician && (
								<div className="flex items-center justify-between gap-3">
									<span className="shrink-0">Technician / Workshop</span>
									<span className="min-w-0 text-right font-semibold leading-myanmar text-foreground">{log.technician}</span>
								</div>
							)}
						</div>
					)}

					{/* The note — a quote. */}
					{log.note && (
						<p className="rounded-r-lg border-l-2 border-border bg-muted/40 p-2.5 leading-relaxed text-muted-foreground italic">
							{log.note}
						</p>
					)}

					{/* A draft is correctable; confirming posts it and locks it. */}
					{confirmed ? (
						<p className="rounded-xl border border-status-success/20 bg-status-success-soft/50 px-3 py-2 text-xs font-medium leading-myanmar text-status-success">
							Confirmed — this job is locked. Ask the office to reopen it if a correction is needed.
						</p>
					) : (
						(onOpen || onConfirm) && (
							<div className="flex gap-2">
								{onOpen ? (
									<button
										type="button"
										onClick={() => onOpen(log)}
										className={`flex flex-1 items-center justify-center gap-2 ${DENSE_CARD_FRAME} py-3 text-xs font-bold leading-myanmar text-foreground shadow-sm transition-transform duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
									>
										<Pencil className="size-3.5" strokeWidth={2.2} aria-hidden />
										Edit record
									</button>
								) : null}
								{onConfirm ? (
									<button
										type="button"
										disabled={confirming}
										onClick={() => onConfirm(log)}
										className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-xs font-bold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
									>
										<Check className="size-3.5" strokeWidth={2.4} aria-hidden />
										{confirming ? 'Confirming…' : 'Confirm'}
									</button>
								) : null}
							</div>
						)
					)}
				</div>
			)}
		</li>
	);
});

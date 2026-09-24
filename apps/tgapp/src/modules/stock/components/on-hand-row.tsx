import { AlertTriangle, Boxes, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';
import type { MroOnHandRow } from '@/shared/mro';

import { MRO_LOCATION_LABELS } from '@/shared/mro';
import { fmtQty, itemNameMmOf, itemNameOf, reorderRowAnchor } from './display';

/**
 * One လက်ကျန် (on-hand) row — the stock-list card anatomy shared by the kiosk
 * search results (`/app/stocks`) and the alert dashboard (`/app/stocks/browse`):
 *
 *   ┌──────┐  Air Filter AF-1001                      35  ›
 *   │ img  │  လေစစ်ဇကာ
 *   └──────┘  Main store  [Standard]
 *
 *  - **Left** — the SKU's R2 photo (`mro_item_model.image`, a `/api/media/<key>`
 *    URL) as a rounded tile sized to the card height; a muted package glyph
 *    stands in when the model has no picture yet.
 *  - **Middle** — the ITEM name (the part group) TOGETHER with the model, then
 *    the item name's Burmese label under it, then the store location. Both name
 *    lines WRAP rather than truncate (see `ItemCard`): the pair of names is the
 *    identity being hunted for, and an ellipsis hides what tells two SKUs apart.
 *    No tracking-policy badge — the policy is already stated by the item's own
 *    surfaces and by the LINE CAPTION on the drill-down page, which says what the
 *    lines below it ARE (lots / units / balances).
 *  - **Right** — the on-hand quantity, tinted amber when the balance sits at/below
 *    its reorder level and red at qty 0, and a chevron for the drill-down.
 *  - **Tapping the card** opens the SKU's stock-lines PAGE
 *    (`/app/stocks/item/:modelId`) — its inventory by tracking policy (per-store
 *    balances / FEFO lots / in-stock units), read-only. The item MASTER is a
 *    secondary link on that page; it is not what an operator came to a stock
 *    screen for.
 *  - **drift** — for batch/serial models the stored balance can disagree with
 *    the sum of the active lots / in-stock serials: a small amber line under
 *    the details notes the true (derived) count next to the stored one.
 *
 * Rows render INSIDE the page's shared list container (the white rounded card
 * with hairline dividers), so the row itself draws no border/shadow.
 */
export const OnHandRow = memo(function OnHandRow({
	row,
	alert,
	groupMm,
	showStore = true,
	showQty = true,
	onOpenModel,
}: {
	row: MroOnHandRow;
	/** An explicit alert state (Out of Stock / Reorder) — tints the qty. */
	alert?: 'reorder' | 'out';
	/** The item (group) name's Burmese label, resolved by the LIST from the shared
	 *  item-name directory — used when the report itself doesn't carry it. */
	groupMm?: string | null;
	/** Show the inventory-location line. The alert dashboard is store-SCOPED, so
	 *  it hides the repeated store; the cross-store kiosk shows it. */
	showStore?: boolean;
	/** Show the on-hand quantity. The alert dashboard's lists hide it (the state
	 *  is the tab), the kiosk shows the number. */
	showQty?: boolean;
	/** Card tap — open the SKU's stock-lines page (the ROW is handed back so the
	 *  page header can be seeded). Absent, or a row with no model, renders static.
	 *  Takes the row so the list can pass its STABLE callback (memo-friendly). */
	onOpenModel?: (row: MroOnHandRow) => void;
}) {
	const mode: 'reorder' | 'out' | 'none' = alert ?? (row.below_reorder ? 'reorder' : 'none');
	// A row with no store is the kiosk's not-yet-stocked marker (the item matched the
	// catalog but `mro_inventory` holds no balance for it) — say so rather than
	// rendering an empty store line.
	const storeLabel = row.location ? (MRO_LOCATION_LABELS[row.location] ?? row.location) : 'No stock yet';
	const name = itemNameOf(row);
	const nameMm = itemNameMmOf(row) ?? groupMm?.trim() ?? null;

	// A media asset can be missing (GC'd / not synced to this environment) — fall
	// back to the glyph instead of showing the browser's broken-image icon. Tracking
	// the failed SRC (not a boolean) lets a later image URL retry.
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const showImage = !!row.model_image && failedSrc !== row.model_image;

	const content = (
		<>
			{/* Photo — FLUSH to the card's left edge and stretched to the row height
			    (the list container clips its corners). Width is FIXED (self-stretch
			    alone would let a replaced element fall back to its intrinsic size);
			    a package glyph stands in when the model has no picture. */}
			{showImage ? (
				<img
					src={row.model_image ?? undefined}
					alt=""
					loading="lazy"
					onError={() => setFailedSrc(row.model_image ?? null)}
					className="w-20 shrink-0 self-stretch bg-muted/40 object-cover"
				/>
			) : (
				<span className="flex w-20 shrink-0 items-center justify-center self-stretch bg-muted/60 text-muted-foreground">
					<Boxes className="size-6" strokeWidth={2} aria-hidden />
				</span>
			)}

			{/* Details — the item (group) + model name, the item name's Burmese label,
				then the store (when shown). */}
			<div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-3.5">
				<p className="font-display text-key font-semibold leading-tight text-foreground">{name}</p>
				{nameMm ? <p className="text-xs leading-myanmar text-muted-foreground">{nameMm}</p> : null}
				{showStore ? (
					<p className="flex min-w-0 items-center gap-1.5 text-xs leading-myanmar text-muted-foreground">
						<span className="truncate">{storeLabel}</span>
					</p>
				) : null}

				{/* Drift — stored balance vs the real lot/serial total, subtle amber. */}
				{row.drift ? (
					<p className="mt-0.5 flex items-center gap-1 text-meta font-medium leading-myanmar text-status-warning">
						<AlertTriangle className="size-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
						<span className="truncate">
							drift — actual {fmtQty(row.derived_qty)} · ledger {fmtQty(row.qty_on_hand)}
						</span>
					</p>
				) : null}
			</div>

			{/* On-hand quantity (when shown) — tinted by its alert state — plus the
				chevron that marks the card as a drill-down. */}
			<div className="flex shrink-0 items-center gap-1.5 pr-4">
				{showQty ? (
					<span
						className={`text-lg font-semibold leading-none tabular-nums ${
							mode === 'out' ? 'text-status-danger' : mode === 'reorder' ? 'text-status-warning' : 'text-foreground'
						}`}
						// The tint says "low"/"out" at a glance; the accessible NAME carries the
						// same fact, so the alert is not conveyed by hue alone (colour-blind +
						// screen-reader users got a bare number before).
						aria-label={`On hand ${fmtQty(row.qty_on_hand)}${
							mode === 'out' ? ' — out of stock' : mode === 'reorder' ? ' — below reorder level' : ''
						}`}
					>
						{fmtQty(row.qty_on_hand)}
					</span>
				) : null}
				{onOpenModel ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
			</div>
		</>
	);

	// The reorder rows are the summary strip's scroll targets — the id exists ONLY
	// on flagged rows so the DOM stays clean.
	const anchorId = mode === 'reorder' ? reorderRowAnchor(row) : undefined;
	// `min-h-20` matches the 80px tile so a two-line row (no Burmese name) still
	// renders the photo as a square, not a squat landscape strip.
	const rowClass = 'flex w-full min-h-20 items-stretch gap-3';

	if (!onOpenModel || !row.model) {
		return (
			<article id={anchorId} className={rowClass}>
				{content}
			</article>
		);
	}

	return (
		<article id={anchorId} className="transition-colors duration-150">
			<button
				type="button"
				onClick={() => onOpenModel(row)}
				aria-label={`${name} — open stock lines`}
				className={`${rowClass} text-left outline-none transition-colors duration-150 hover:bg-muted/30 active:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
			>
				{content}
			</button>
		</article>
	);
});

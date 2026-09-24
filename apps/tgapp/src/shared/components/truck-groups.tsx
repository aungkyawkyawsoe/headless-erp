import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Per-truck document sections — the shared grouping used by the vehicle-document
 * list pages (လိုင်စင် `/app/licenses`, အာမခံ `/app/insurances`) and the
 * accidents register (မှတ်တမ်း `/app/incidents/browse`): a flat list of
 * vehicle-bound records is regrouped under ONE card per truck. What a card shows
 * under its identity row is the caller's choice:
 *
 *  - IDENTITY ONLY (no `renderLine` — the incidents register): the truck's plate
 *    · brand · right slot and nothing else. The card is about the TRUCK, so a tap
 *    opens the truck's own file rather than putting one arbitrary (newest)
 *    record on it.
 *  - WITH A LINE (`renderLine` — licenses + insurances): the truck's CURRENT
 *    document (the newest record on file) as a line item. What the card does with
 *    the truck's EARLIER records (previous renewals — 2025, 2024…) depends on
 *    `onOpen`:
 *      - TAP (`onOpen`): the WHOLE CARD is the tap target — no disclosure, no
 *        footer row; the caller opens the truck's full-screen page (records
 *        fetched from the API on demand, so the list read never carries the
 *        history). `openLabel` names that destination in the card's label.
 *      - INLINE (no `onOpen` — the Unassigned fallback group, which has no truck
 *        to query): a "Show history" disclosure reveals the earlier loaded
 *        records as history lines right inside the card.
 *
 *  ┌────────────────────────────────────────────────────┐
 *  │ [TRK-1002]  FUSO                          [239 days] │
 *  │ MDY/26/102 · Expires May 4, 2027         [2026]     │
 *  └────────────────────────────────────────────────────┘
 *                     (tap the whole card)
 *
 * Only trucks that own at least one loaded record appear (these are record
 * lists — a truck with no license/policy is simply not on this page). Records
 * whose `vehicle` link is missing sink into a single trailing "Unassigned"
 * group so nothing silently disappears.
 */

/** The vehicle-ownership facts a row contributes to its truck group — every
 *  card model built from a `veh_fleets`-bound collection can map these from its
 *  `vehicle` m2o (modules name the fields differently: `plate`/`brand` vs
 *  `plateNo`/`brandLabel`). */
export interface VehicleOwnedRow {
	/** The owning `veh_fleets` id (the m2o id) — null when unlinked/unexpanded. */
	vehicleId?: string | null;
	/** The vehicle's plate — null when unlinked. */
	plate?: string | null;
	/** The vehicle brand display label (e.g. "HINO") — null when unset. */
	brand?: string | null;
	/** `created_at` (ISO) — the newest record is the card's CURRENT document. */
	createdAt?: string | null;
}

/** One truck section — the rows that belong to a single vehicle. */
export interface TruckGroup<T> {
	/** Stable grouping identity — the `veh_fleets` id, the plate, or the shared
	 *  `'unassigned'` fallback. Use as the React `key`. */
	key: string;
	/** The owning `veh_fleets` id — null for the Unassigned fallback group. */
	vehicleId: string | null;
	/** The truck's plate — null only for the Unassigned fallback. */
	plate: string | null;
	/** The truck's brand label — null when the fleet row carries none. */
	brand: string | null;
	/** The section's rows, in their input order (the page's flat order). */
	items: T[];
}

/** The fallback group for records with no truck link. */
export const UNASSIGNED_LABEL = 'Unassigned';

/**
 * Group vehicle-bound rows under their trucks. Group order follows the FIRST
 * appearance of each truck in `rows` (already ordered by the page — urgency /
 * recency — so the most urgent truck leads); streaming more cursor pages only
 * appends new sections, never reshuffles the ones on screen. Rows inside a
 * group keep their input order (pages sort them newest-first themselves).
 *
 * `vehicleOf` reads each row's truck fields (the default reads
 * `vehicleId`/`plate`/`brand`; insurance rows pass a selector mapping
 * `plateNo`/`brandLabel`).
 */
export function truckGroupsOf<T>(
	rows: readonly T[],
	vehicleOf: (row: T) => VehicleOwnedRow = (row) => row as VehicleOwnedRow,
): TruckGroup<T>[] {
	const groups: TruckGroup<T>[] = [];
	const byKey = new Map<string, TruckGroup<T>>();
	const unassigned: T[] = [];

	for (const row of rows) {
		const { vehicleId, plate: rawPlate, brand } = vehicleOf(row);
		// Key on the owning vehicle id; plate text is the fallback (a linked but
		// unexpanded row still groups with its truck); the rest sink to the
		// shared Unassigned group.
		const plate = rawPlate?.trim();
		const key = vehicleId ?? (plate ? `plate:${plate}` : UNASSIGNED_LABEL);
		if (key === UNASSIGNED_LABEL) {
			unassigned.push(row);
			continue;
		}
		let group = byKey.get(key);
		if (!group) {
			group = { key, vehicleId: vehicleId ?? null, plate: plate ?? null, brand: brand ?? null, items: [] };
			byKey.set(key, group);
			groups.push(group);
		}
		group.items.push(row);
	}

	if (unassigned.length > 0) {
		groups.push({ key: UNASSIGNED_LABEL, vehicleId: null, plate: null, brand: null, items: unassigned });
	}
	return groups;
}

/** Newest-record-first comparator — the card's CURRENT document is the one the
 *  truck most recently added (a row with no `created_at` sinks last). */
export function compareNewestCreated(a: { createdAt?: string | null }, b: { createdAt?: string | null }): number {
	return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
}

/**
 * Parse the record's period YEAR for its line chip — the year embedded in the
 * document number first (`YGN/26/100` → "2026", `YGN/2026/LIC-8085` → "2026" —
 * the annual-license naming convention), falling back to the `fallbackDate`
 * year only when the number carries no digits at all. Returns null when no
 * year can be read (the line then shows no chip).
 */
export function docYearLabel(number: string | null | undefined, fallbackDate?: string | null): string | null {
	const text = number?.trim();
	if (text && /\d/.test(text)) {
		const match = text.match(/(?:^|[/_-])(20\d{2}|\d{2})(?:[/_-]|$)/);
		if (match) {
			const value = Number(match[1]);
			const year = match[1].length === 4 ? value : 2000 + value;
			if (year >= 2000 && year <= 2100) return String(year);
		}
		return null;
	}
	const year = Number(fallbackDate?.slice(0, 4));
	return Number.isFinite(year) && year >= 2000 ? String(year) : null;
}

interface TruckGroupCardProps<T> {
	/** The truck's plate — the chip label; null renders the "Unassigned" chip. */
	plate: string | null;
	/** The truck's brand label — chip omitted when null. */
	brand: string | null;
	/** The section summary shown at the header's right — the CURRENT document's
	 *  remaining-days pill on the licenses/insurances truck cards, or a count for
	 *  the Unassigned bucket. OPTIONAL: the maintenance register drops it (the
	 *  tally was only the loaded rows, never the truck's true total). */
	countLabel?: ReactNode;
	/** The truck's records, NEWEST FIRST — `items[0]` is the CURRENT document
	 *  shown on the card; the earlier records open behind the disclosure. */
	items: T[];
	/**
	 * Renders ONE record line — used for the current card line AND the history
	 * lines (the same lean line language; the page keys each rendered line).
	 *
	 * OMIT it for an IDENTITY-ONLY truck card: the register shows the truck
	 * (plate · brand · the right slot) and nothing else, so a tap opens the
	 * truck's own file instead of putting one arbitrary record (usually the
	 * newest) on a card that is about the truck.
	 */
	renderLine?: (doc: T) => ReactNode;
	/**
	 * When set, the card is ONE tap target: the whole card is a button that calls
	 * back — the page opens what the tap means (the truck's full-screen page, or
	 * the records in a bottom sheet), so no history disclosure or footer row
	 * renders (a single-record truck is tappable too). Absent keeps the
	 * disclosure: history lines reveal inside the card from the already-loaded
	 * rows (the Unassigned fallback, which has no truck to query, stays in this
	 * inline mode).
	 */
	onOpen?: () => void;
	/**
	 * What the tap opens, in the card's accessible label — e.g. `"view all
	 * records"` (default). Ignored in inline mode.
	 */
	openLabel?: string;
}

/**
 * ONE truck section card — the identity row (plate chip + brand badge + the
 * page's right slot), sitting directly on the card surface in the fleet-card
 * style (no header band, no divider below it), over the truck's CURRENT
 * document when a `renderLine` is supplied. The plate chip uses the SAME scale
 * as the /app/fleets and flat card chips (text-base / py-1), with the brand as
 * a legible muted badge chip beside it. The page supplies the newest-first
 * items; with `onOpen` the whole card becomes the tap target; without it the
 * card keeps the inline history disclosure.
 */
export function TruckGroupCard<T>({
	plate,
	brand,
	countLabel,
	items,
	renderLine,
	onOpen,
	openLabel = 'view all records',
}: TruckGroupCardProps<T>) {
	const [open, setOpen] = useState(false);
	const [current, ...history] = items;
	const tapMode = onOpen != null;
	// Identity-only cards (no `renderLine`) show the truck alone — no divider, no line.
	const showCurrent = renderLine != null && current !== undefined;
	// The "Show history" disclosure needs BOTH a line renderer and earlier rows.
	const showHistory = renderLine != null && history.length > 0;

	// The card surface — shared by both modes (the inline card on the <li>, the
	// tap mode on the whole-card <button>).
	const cardSurface = 'overflow-hidden rounded-2xl py-1 border border-border bg-card shadow-card';

	// The identity row — plate chip + brand badge left, the page's right slot
	// (the license truck's remaining-days pill, or the insurance count) right.
	const identityRow = (
		<div className="flex items-center justify-between gap-3 px-4 py-2.5">
			<div className="flex min-w-0 flex-wrap items-center gap-2">
				{/* Plate chip — the FLEET/plate-card scale (text-base / py-1), the same
					chip the /app/fleets and flat license cards use, so the truck number
					reads as the card's primary identity instead of a tiny label. */}
				<span
					className={`inline-flex items-center rounded-md border px-2 py-1 text-base font-semibold leading-none tracking-wider ${
						plate ? 'border-border/70 bg-muted/40 text-foreground' : 'border-dashed border-border text-muted-foreground'
					}`}
				>
					{plate ?? UNASSIGNED_LABEL}
				</span>
				{/* Brand — promoted from tiny floating text to a legible muted badge chip. */}
				{brand && (
					<span className="inline-flex items-center rounded-md border border-border/60 bg-muted/50 px-2 h-5 pt-px text-meta font-semibold uppercase leading-none tracking-[0.14em] text-muted-foreground">
						{brand}
					</span>
				)}
			</div>
			{countLabel != null ? (
				<span className="shrink-0 text-meta font-medium leading-myanmar text-muted-foreground">{countLabel}</span>
			) : null}
		</div>
	);

	// Dashed hairline below the identity row — separates the header (plate +
	// brand + the page's right slot) from the document lines, so the truck
	// identity reads as its own band above the record rows.
	const headerDivider = <div aria-hidden className="border-t border-dashed border-border/70" />;

	// TAP mode — no disclosure and no footer row: the whole card is the tap
	// target, so the card surface moves onto one full-width button.
	if (tapMode) {
		return (
			<li>
				<button
					type="button"
					onClick={onOpen}
					aria-label={`${plate ?? UNASSIGNED_LABEL} — ${openLabel}`}
					className={`block w-full text-left ${cardSurface} transition-transform duration-150 active:scale-[0.99] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`}
				>
					{identityRow}
					{showCurrent && headerDivider}
					{showCurrent && renderLine(current)}
				</button>
			</li>
		);
	}

	// INLINE mode (the default) — the identity row over the current document,
	// with the "Show history" disclosure revealing the earlier loaded rows. An
	// identity-only card (no `renderLine`) has nothing to reveal, so it stops at
	// the identity row.
	return (
		<li className={cardSurface}>
			{identityRow}
			{showCurrent && (
				<>
					{headerDivider}
					<div className="divide-y divide-border/60">
						{renderLine(current)}
						{showHistory && (
							<button
								type="button"
								aria-expanded={open}
								onClick={() => setOpen((value) => !value)}
								className="flex w-full items-center justify-center gap-1 px-4 py-2 text-meta font-semibold leading-myanmar text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:bg-muted/50 active:bg-muted/40"
							>
								<span>{open ? 'Hide history' : `Show history (${history.length})`}</span>
								<ChevronDown className={`size-3.5 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} aria-hidden />
							</button>
						)}
						{open && history.map((doc) => renderLine?.(doc))}
					</div>
				</>
			)}
		</li>
	);
}

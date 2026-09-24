import { useEffect, useMemo, useRef, useState } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';

import { LoadingRow } from '@/shared/components/loading-row';

import { OnHandRow } from './on-hand-row';
import { Shimmer } from '@/shared/components/skeletons';
import { useMroItemNames } from '@/shared/hooks/use-mro-masters';
import type { MroOnHandRow } from '@/shared/mro';

/**
 * Shared stock-list building blocks for the စတော့ screens — the loading
 * skeleton, the balance-row list container, and the centered read-error state.
 * Shared by the alert dashboard (`/app/stocks/browse`) and the search-first
 * kiosk landing (`/app/stocks`), so both render the rows in EXACTLY the same
 * reference-style container.
 */

/** Shimmer rows for the loading state — shaped like the loaded list so the first
 *  paint never reflows (image tile + two detail lines + the right-hand qty). */
export function StockListSkeleton({ rows }: { rows: number }) {
	return (
		<div className={`overflow-hidden ${DENSE_CARD_FRAME} shadow-card`} aria-hidden>
			<div className="divide-y divide-border/70">
				{[0, 1, 2].slice(0, rows).map((i) => (
					<div key={i} className="flex items-center gap-3.5 px-4 py-3.5">
						<Shimmer className="size-14 shrink-0 rounded-xl" />
						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<Shimmer className="h-4 w-2/3 rounded" />
							<Shimmer className="h-3 w-1/3 rounded" />
						</div>
						<Shimmer className="h-5 w-8 shrink-0 rounded" />
					</div>
				))}
			</div>
		</div>
	);
}

/** How many balance rows are mounted before the infinite-scroll sentinel streams
 *  the next chunk in as you scroll (keeps a large on-hand set to one page's DOM). */
const STOCK_PAGE_ROWS = 15;

/** The balance rows as ONE reference-style list container — a white rounded card
 *  with hairline dividers between the row cards. A long set is revealed CHUNKED
 *  via a bottom sentinel (like the MRO doc lists' infinite scroll), so thousands
 *  of balances never mount into one heavy paint; the chunk resets whenever the
 *  visible row set changes (tab / store / category / search). */
export function StockRowList({
	rows,
	onOpenModel,
	alert,
	showStore = true,
	showQty = true,
}: {
	rows: MroOnHandRow[];
	/** Card tap — open that SKU's stock-lines page (`/app/stocks/item/:id`). The
	 *  ROW is handed over so the caller can seed the page header with the name +
	 *  photo the card already holds. */
	onOpenModel?: (row: MroOnHandRow) => void;
	/** One alert for the whole list (the dashboard's Stock Out tab), or a per-row
	 *  resolver (the kiosk's mixed cross-store results, where a row's qty must
	 *  follow ITS OWN quantity). `undefined` falls back to the row's own
	 *  `below_reorder` tint. */
	alert?: 'reorder' | 'out' | ((row: MroOnHandRow) => 'reorder' | 'out' | undefined);
	/** Forwarded to each row — the store-scoped dashboard hides the store line. */
	showStore?: boolean;
	/** Forwarded to each row — the alert dashboard hides the qty number. */
	showQty?: boolean;
}) {
	const [shown, setShown] = useState(STOCK_PAGE_ROWS);

	// The item-name directory supplies each row's BURMESE name when the row itself
	// has none (the `/stock/onhand` report carries the group's English name only).
	// Keyed by the English name (`name_en` is UNIQUE on `mro_item_name`), so the join
	// is exact — and the read is SKIPPED entirely when every row already carries its
	// Burmese label (the kiosk's expanded entity read does), so that screen pays no
	// extra request.
	const needsDirectory = useMemo(() => rows.some((row) => !!row.group_name && !row.group_name_mm), [rows]);
	const itemNames = useMroItemNames({ enabled: needsDirectory });
	const nameMmByName = useMemo(() => {
		const map = new Map<string, string>();
		for (const name of itemNames.data ?? []) {
			if (name.name && name.nameMm) map.set(name.name, name.nameMm);
		}
		return map;
	}, [itemNames.data]);

	// A fresh set swaps the row SET — start over from the first page.
	const setKey = `${rows.length}:${rows[0]?.id ?? ''}:${rows[rows.length - 1]?.id ?? ''}`;

	// Back to page one whenever the visible set changes (search/store/category/tab).
	useEffect(() => {
		setShown(STOCK_PAGE_ROWS);
	}, [setKey]);

	// Reveal the next chunk while the sentinel stays visible. `rows.length` is the
	// final count (the report is fully measured), so intersecting can never ask for
	// more than exists — this only controls HOW MANY are MOUNTED, not fetched.
	const sentinelRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const el = sentinelRef.current;
		if (!el || rows.length <= shown) return;
		const reveal = () => setShown((current) => Math.min(current + STOCK_PAGE_ROWS, rows.length));
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) reveal();
			},
			{ rootMargin: '220px 0px' },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [rows, shown, setKey]);

	const visible = rows.slice(0, shown);
	const hasMore = rows.length > shown;

	return (
		<div className={`overflow-hidden ${DENSE_CARD_FRAME} shadow-card`}>
			<div className="divide-y divide-border/70">
				{visible.map((row) => (
					<OnHandRow
						key={row.id ?? `${row.location}:${row.model ?? 'unknown'}`}
						row={row}
						groupMm={row.group_name ? (nameMmByName.get(row.group_name.trim()) ?? null) : null}
						showStore={showStore}
						showQty={showQty}
						alert={typeof alert === 'function' ? alert(row) : alert}
						onOpenModel={onOpenModel}
					/>
				))}
				{hasMore ? (
					<div ref={sentinelRef} className="flex items-center justify-center gap-2 py-3" aria-hidden>
						<LoadingRow label="Loading…" />
					</div>
				) : null}
			</div>
		</div>
	);
}

/** A centered read error with a retry pill — shared by the loading paths. */
export function StockRetryState({ title, onRetry }: { title: string; onRetry: () => void }) {
	return (
		<div className="flex flex-col items-center gap-2.5 rounded-xl border border-border bg-card/50 px-4 py-8 text-center">
			<p className="text-sm font-medium leading-myanmar text-destructive">{title}</p>
			<p className="text-xs leading-myanmar text-muted-foreground">Check your connection and try again.</p>
			<button
				type="button"
				onClick={onRetry}
				className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
			>
				Try again
			</button>
		</div>
	);
}

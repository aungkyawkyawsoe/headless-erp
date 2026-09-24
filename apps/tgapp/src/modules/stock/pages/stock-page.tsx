import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LoaderCircle, Search, SearchX, X } from 'lucide-react';

import { StockListSkeleton, StockRetryState, StockRowList } from '../components/stock-list';
import { fetchInventoryForModels } from '../data/api';
import { STOCK_STALE_MS, qk } from '../data/query-keys';
import { EmptyState } from '@/shared/components/empty-state';
import { KioskBrowseLink } from '@/shared/components/kiosk-browse-link';
import { ModuleShell } from '@/shared/components/module-shell';
import { useMroItemModels, mroItemModelLabel, type MroItemModelDirectoryRow } from '@/shared/hooks/use-mro-item-models';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';
import { MRO_LOCATIONS, stockItemPath, type MroOnHandRow } from '@/shared/mro';
import { URL_PARAM, searchParam, useViewState } from '@/shared/url-state';

/** The combobox's dropdown size — enough to pick from, never a list. */
const SUGGESTION_COUNT = 6;

/** The kiosk's WHOLE URL view state — the one-shot `?q=` deep-link seed. */
const STOCK_LOOKUP_VIEW = {
	[URL_PARAM.search]: searchParam,
} as const;

/** The store order a cross-store result list sorts by (the MRO locations'
 *  canonical order — `MRO_LOCATIONS` order). Rows with an unknown store sink last. */
function locationOrderOf(location: string): number {
	const index = MRO_LOCATIONS.findIndex((store) => store.value === location);
	return index === -1 ? MRO_LOCATIONS.length : index;
}

/** The SKU's display name — English first, Burmese fallback, never empty. */
function directoryNameOf(model: MroItemModelDirectoryRow): string {
	return (model.name_en ?? model.name_mm ?? '').trim() || '—';
}

/** The item's SEARCHABLE text — its SKU name plus the PARENT item name it belongs
 *  to, so the operator's term "Tyre" (an item-name master) still finds its size
 *  SKUs instead of matching nothing. */
function searchTextOf(model: MroItemModelDirectoryRow): string {
	return [model.name_en, model.name_mm, model.group_name_en, model.group_name_mm]
		.filter((value): value is string => typeof value === 'string' && value.trim() !== '')
		.join(' ')
		.toLowerCase();
}

/** The not-yet-stocked marker for a matched item the balance table has no row for:
 *  an empty store (`No stock yet`) with a zero balance, so a search still FINDS
 *  the item it matched instead of silently dropping it. */
function notStockedRow(model: MroItemModelDirectoryRow): MroOnHandRow {
	return {
		id: null,
		model: model.id,
		model_name: directoryNameOf(model),
		model_image: null,
		location: '',
		tracking: model.tracking ?? 'standard',
		qty_on_hand: 0,
		reorder_level: null,
		derived_qty: null,
		drift: false,
		below_reorder: false,
		group_name: model.group_name_en ?? model.group_name_mm ?? null,
		group_name_mm: model.group_name_mm ?? null,
	};
}

/**
 * စတော့ — the MRO stock dashboard app (launcher tile `reports` → `/app/stocks`).
 *
 * Search-first, the SAME kiosk shape as the Fluid / odo / insurance apps, but
 * over ITEMS instead of trucks: the screen deliberately does NOT open as the
 * alert dashboard AND loads NO stock up front — it opens BLANK with a SINGLE
 * centred item-name search. Only once the operator types does the matching run
 * over the item CATALOG (the shared `useMroItemModels` directory — a cached
 * master read, so typing issues NOTHING), and the dropdown suggests the matching
 * items. Pressing search (or picking a suggestion) →
 *
 *  - the matched items' CURRENT balance rows, read STRAIGHT from `mro_inventory`
 *    and scoped to exactly those SKUs (`filter[model][_in]=…`, see
 *    `fetchInventoryForModels`) — never the whole-collection `/stock/onhand`
 *    report the kiosk used to download and filter client-side. An item that
 *    matches on the catalog but has no balance row still appears, marked
 *    `No stock yet`, so a search never hides an item merely because its stock is
 *    zero or not yet received;
 *  - several items match a partial name → every matching item's rows are listed
 *    to scan (each row keeps the current card anatomy, qty badge + store);
 *  - no match → a clear "not found" state.
 *
 * The full alert dashboard (In Stock · Reorder · Stock Out · Expiring Soon tabs,
 * store/category filters, refresh) is NOT gone — it stays reachable from the
 * idle stage's "Browse the stock dashboard" link, one tap away at
 * `/app/stocks/browse` (a real route with its own back arrow, so browsing + back
 * never loses its place). The dashboard keeps the full `/stock/onhand` report:
 * its tabs need the server-computed drift + reorder flags over EVERY balance,
 * which a scoped search answer deliberately does not pay for.
 */
export default function StockPage() {
	const navigate = useNavigate();

	// The lookup — a small state machine: idle (no query yet) → searching →
	// done (matches) / failed. When a SUGGESTION is picked, the chosen model's id
	// is kept alongside its name (`modelId`) so the answer is EXACTLY that SKU's
	// rows — never every model whose display name happens to match.
	const [query, setQuery] = useState('');
	const [submitted, setSubmitted] = useState<string | null>(null);
	const [modelId, setModelId] = useState<string | null>(null);

	// `?q=` — a cross-link seed (the item master's စတော့ လက်ကျန် shortcut) that runs the
	// SAME catalog search a typed term would, so arriving from a SKU lands on its
	// balances in one shot. A plain open has no `?q=` and stays a blank kiosk.
	const [view] = useViewState(STOCK_LOOKUP_VIEW);
	const { q: qParam } = view;
	useEffect(() => {
		const term = qParam?.trim();
		if (!term) return;
		setQuery(term);
		setSubmitted(term);
		setModelId(null);
	}, [qParam]);

	// The item CATALOG — the whole-set SKU directory (17 masters today), cached
	// under the app-wide master key the line pickers already share. It is what the
	// kiosk searches: an item exists here whether or not it has ever been stocked,
	// so "find an item" works on a blank warehouse.
	const directory = useMroItemModels();
	const directoryRows = useMemo(() => directory.data ?? [], [directory.data]);

	// ── Combobox suggestions (idle stage only) ───────────────────────────────
	// The settled fragment narrows the catalog client-side — prefix-first, capped.
	// Nothing fires while the box is empty and nothing is fetched per keystroke:
	// the directory is already in the cache. The right slot names the item's
	// TRACKING POLICY (Standard / Batch / Serial) — the one fact the catalog
	// carries without reading any balance.
	const suggestionsEnabled = submitted === null && query.trim().length > 0;

	const suggestions = useMemo(() => {
		if (!suggestionsEnabled) return [];
		const needle = query.trim().toLowerCase();
		return directoryRows
			.filter((model) => searchTextOf(model).includes(needle))
			.map((model) => ({ model, name: mroItemModelLabel(model) }))
			.sort((a, b) => {
				const aPref = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
				const bPref = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
				return aPref - bPref || a.name.localeCompare(b.name);
			})
			.slice(0, SUGGESTION_COUNT);
	}, [suggestionsEnabled, query, directoryRows]);

	// The items the submitted term stands for — the picked SKU when a suggestion
	// was chosen, else every catalog item whose name matches. Derived (never
	// stored), so the catalog is the single source of what "tyre" means here.
	const matchedModels = useMemo(() => {
		if (submitted === null) return [];
		if (modelId !== null) {
			const picked = directoryRows.find((model) => model.id === modelId);
			return picked ? [picked] : [];
		}
		const needle = submitted.toLowerCase();
		return directoryRows
			.filter((model) => searchTextOf(model).includes(needle))
			.sort((a, b) => mroItemModelLabel(a).localeCompare(mroItemModelLabel(b)));
	}, [submitted, modelId, directoryRows]);

	const matchedIds = useMemo(() => matchedModels.map((model) => model.id), [matchedModels]);

	// The answer — the matched items' balance rows, read from `mro_inventory` and
	// scoped to exactly those SKUs. Skipped entirely (no request) when nothing
	// matched, so a miss costs one catalog lookup and zero stock reads.
	const balances = useQuery({
		queryKey: qk.inventory(matchedIds),
		queryFn: () => fetchInventoryForModels(matchedIds),
		enabled: submitted !== null && matchedIds.length > 0,
		staleTime: STOCK_STALE_MS,
	});

	// One row list: each matched item's balances across every store, in the MRO
	// store order; an item with no balance row contributes its `No stock yet`
	// marker so it still answers the search.
	const rows = useMemo(() => {
		const byModel = new Map<string, MroOnHandRow[]>();
		for (const row of balances.data ?? []) {
			if (!row.model) continue;
			const list = byModel.get(row.model);
			if (list) list.push(row);
			else byModel.set(row.model, [row]);
		}
		return matchedModels.flatMap((model) => {
			const label = mroItemModelLabel(model);
			const modelRows = byModel.get(model.id);
			if (!modelRows || modelRows.length === 0) return [{ ...notStockedRow(model), model_name: label }];
			return [...modelRows]
				.sort((a, b) => locationOrderOf(a.location) - locationOrderOf(b.location))
				.map((row) => ({ ...row, model_name: label }));
		});
	}, [matchedModels, balances.data]);

	// A card tap — open that SKU's stock-lines page, seeding its header with the
	// name + photo the card already carries so it paints instantly (the page's own
	// read then reconciles).
	const openItem = useCallback(
		(row: MroOnHandRow) => {
			if (!row.model) return;
			hapticImpact('light');
			navigate(stockItemPath(row.model), { state: { name: row.model_name, image: row.model_image } });
		},
		[navigate],
	);

	// Stable per-row alert resolver — the mixed cross-store results tint by each
	// row's OWN quantity. Kept out of the render body so `OnHandRow`'s memo holds.
	const rowAlert = useCallback((row: MroOnHandRow) => (row.location && row.qty_on_hand === 0 ? ('out' as const) : undefined), []);

	const runSearch = useCallback((raw: string) => {
		const code = raw.trim();
		if (!code) return;
		setQuery(code);
		setSubmitted(code);
		setModelId(null);
	}, []);

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		runSearch(query);
	};

	const clearLookup = () => {
		setQuery('');
		setSubmitted(null);
		setModelId(null);
	};

	const chooseSuggestion = useCallback((model: string, name: string) => {
		hapticSelection();
		if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
		setQuery(name);
		setSubmitted(name);
		setModelId(model);
	}, []);

	// The rounded search pill — the SAME visual the tyre/Fluid kiosks use, with
	// the item-name placeholder. Parent-state-driven (never owns the query), so the
	// input keeps its text when the layout swaps between stages.
	//
	// Deliberate exception to the shared `SearchKiosk`: this kiosk's answer is NOT
	// one row per result — it is a nested per-store balance list assembled from a
	// SECOND scoped query (`fetchInventoryForModels`), and picking a suggestion
	// narrows to that SKU in place rather than navigating. That shape does not fit
	// `SearchKiosk`'s one-row-per-result contract.
	// eslint-disable-next-line no-restricted-syntax
	const searchPill = (autoFocus: boolean) => (
		<div className="flex h-12 items-center gap-1 rounded-full border border-input bg-card py-1.5 pr-1.5 pl-4 shadow-card transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/60">
			<Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			<input
				autoFocus={autoFocus}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Enter item name (e.g. Air Filter)"
				autoComplete="off"
				autoCorrect="off"
				spellCheck={false}
				enterKeyHint="search"
				role="combobox"
				aria-expanded={suggestionsEnabled && query.trim().length > 0}
				aria-controls="stock-item-suggestions"
				aria-autocomplete="list"
				aria-label="Item name"
				className="h-full min-w-0 flex-1 bg-transparent px-2 text-key font-semibold tracking-tight text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground"
			/>
			{query ? (
				<button
					type="button"
					onClick={clearLookup}
					aria-label="Clear search"
					className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted/70 text-muted-foreground transition-transform duration-150 active:scale-90 focus-visible:ring-2 focus-visible:ring-ring"
				>
					<X className="size-3.5" aria-hidden />
				</button>
			) : null}
			<button
				type="submit"
				disabled={!query.trim()}
				className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-semibold leading-none text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 disabled:opacity-50"
			>
				<Search className="size-3.5" aria-hidden />
				Search
			</button>
		</div>
	);

	// The suggestion dropdown — a compact listbox under the idle pill (see
	// `suggestions`: the catalog narrowed by the settled term). Each row is an item
	// — name + its tracking policy. Picking a row narrows the search to that item.
	const suggestionPanel =
		submitted === null && query.trim().length > 0 ? (
			<div
				id="stock-item-suggestions"
				role="listbox"
				aria-label="Matching items"
				className={`mt-2 w-full max-w-sm ${CARD_FRAME} p-1.5 shadow-lg`}
			>
				{directory.isPending ? (
					<div className="flex items-center gap-2 px-3 py-2.5 text-xs font-medium text-muted-foreground">
						<LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Searching items…
					</div>
				) : directory.isError ? (
					<p className="px-3 py-2.5 text-xs font-medium text-muted-foreground">Couldn’t load the item catalog — press Search to try.</p>
				) : suggestions.length === 0 ? (
					// This filter is CLIENT-side over the cached catalog, so there is no
					// minimum-character gate — the message names the term instead.
					<p className="px-3 py-2.5 text-xs font-medium text-muted-foreground">
						No item matches «{query.trim()}» — press Search to look it up.
					</p>
				) : (
					<ul className="flex flex-col">
						{suggestions.map((suggestion) => (
							<li key={suggestion.model.id}>
								<button
									type="button"
									role="option"
									aria-selected={false}
									onClick={() => chooseSuggestion(suggestion.model.id, suggestion.name)}
									className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left outline-none transition-colors focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/60"
								>
									<span className="min-w-0 flex-1 text-sub font-semibold leading-myanmar text-foreground">{suggestion.name}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		) : null;

	return (
		<ModuleShell title="Stock">
			<div className="flex flex-1 flex-col gap-3">
				{submitted === null ? (
					/* ── Idle: ONE centred search, nothing else. The dashboard is a
					   single muted link below — no fetch happens until the operator types. ── */
					<div className="flex flex-1 flex-col items-center justify-center px-1 pb-8">
						<p className="text-center text-[22px] font-light tracking-tight text-foreground">Find an item</p>
						<form onSubmit={handleSubmit} role="search" aria-label="Item search" className="mt-6 w-full max-w-sm">
							{searchPill(true)}
						</form>
						{suggestionPanel}
					</div>
				) : (
					/* ── An active lookup: the search stays on top, the answers below. ── */
					<>
						<form onSubmit={handleSubmit} role="search" aria-label="Item search" className="w-full">
							{searchPill(false)}
						</form>

						{directory.isPending ? (
							<StockListSkeleton rows={3} />
						) : directory.isError ? (
							<StockRetryState title="Couldn't read the item catalog" onRetry={() => void directory.refetch()} />
						) : matchedModels.length === 0 ? (
							<EmptyState title={`No item matches “${submitted}”`} hint="Check the item name and try again — e.g. Air Filter." />
						) : balances.isPending ? (
							<StockListSkeleton rows={3} />
						) : balances.isError ? (
							<StockRetryState title="Couldn't read the stock balances" onRetry={() => void balances.refetch()} />
						) : (
							<>
								<p className="text-meta font-semibold uppercase tracking-wide text-muted-foreground">
									{matchedModels.length} item{matchedModels.length === 1 ? '' : 's'} · {submitted}
								</p>
								{/* The answer — the CURRENT balance-row cards across every store (tap a
								   card to open the SKU's stock-lines page). An item with no balance row
								   renders its `No stock yet` marker rather than dropping out of the results. */}
								<StockRowList rows={rows} onOpenModel={openItem} alert={rowAlert} />
							</>
						)}

						{matchedModels.length > 0 && submitted !== null ? (
							<button
								type="button"
								onClick={clearLookup}
								className="mx-auto mt-1 flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm transition-transform duration-150 active:scale-95"
							>
								<SearchX className="size-3.5" aria-hidden /> New search
							</button>
						) : null}
					</>
				)}
				{submitted === null && query.trim().length === 0 ? (
					<KioskBrowseLink to="/app/stocks/browse" label="Browse the stock dashboard" />
				) : null}
			</div>
		</ModuleShell>
	);
}

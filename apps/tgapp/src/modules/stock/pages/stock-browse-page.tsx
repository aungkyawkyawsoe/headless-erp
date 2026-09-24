import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { ExpirySection } from '../components/expiry-section';
import { EXPIRY_WINDOW, fetchAlertingExpiry } from '../data/api';
import { StockListSkeleton as ListSkeleton, StockRetryState as RetryState, StockRowList as RowList } from '../components/stock-list';
import { qk, STOCK_STALE_MS } from '../data/query-keys';
import { partitionOnHand, STOCK_TABS, STOCK_TAB_VALUES, type StockTab } from '../data/tabs';
import {
	BottomActionBar,
	GLASS_ICON_BUTTON,
	GLASS_ICON_BUTTON_ACTIVE,
	GLASS_ICON_BUTTON_IDLE,
} from '@/shared/components/bottom-action-bar';
import { CategoryStrip, type CategoryTab } from '@/shared/components/category-strip';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { TwoPaneFilterTrigger } from '@/shared/components/two-pane-filter-trigger';
import { MRO_LOCATION_LABELS, MRO_LOCATIONS, stockItemPath, type MroLocation, type MroOnHandRow } from '@/shared/mro';
import { hapticImpact } from '@/shared/platform/haptics';
import { useMroCategories } from '@/shared/hooks/use-mro-masters';
import { useOnHandReport, ON_HAND_QUERY_KEY } from '@/shared/hooks/use-on-hand-report';
import { URL_PARAM, enumParam, stringOrEmptyParam, useViewState } from '@/shared/url-state';

/** The stock-state views — see `data/tabs.ts` for the vocabulary, the tab list
 *  and the disjoint partition rule (the pure half of this page). */
const TAB_PARAM = enumParam<StockTab>(STOCK_TAB_VALUES, 'reorder');

/** The store filter — ALWAYS one concrete MRO store (အားလုံး/all is not allowed;
 *  every view is scoped to a real location). Default = the first store. */
type StoreFilter = MroLocation;
const DEFAULT_STORE: StoreFilter = MRO_LOCATIONS[0].value;
const STORE_PARAM = enumParam<MroLocation>(
	MRO_LOCATIONS.map((location) => location.value),
	DEFAULT_STORE,
);

/** The category filter — SINGLE-select (the top strip): the `category` param is
 *  one `mro_item_categories` id, `''` = "All" (no narrowing). Rows match via the
 *  on-hand row's OWN `category` field (server-JOINed). */
const CATEGORY_PARAM = stringOrEmptyParam;

/** The browse screen's WHOLE URL view state, declared ONCE — the screen's single
 *  source of truth for "where am I in this view" (keys from `URL_PARAM`). */
const STOCK_BROWSE_VIEW = {
	[URL_PARAM.tab]: TAB_PARAM,
	[URL_PARAM.location]: STORE_PARAM,
	[URL_PARAM.category]: CATEGORY_PARAM,
} as const;

/**
 * စတော့ → Browse all (`/app/stocks/browse`, reached from the stock kiosk's
 * "Browse the stock dashboard" link).
 *
 * The launcher landing (`/app/stocks`) is the search-first kiosk: ONE centred
 * item-name search that answers with the CURRENT balance-row cards across every
 * store. This page is the full alert dashboard:
 *
 *   category  a horizontal strip of category tabs (`mro_item_categories`) narrows
 *             the whole page to one category (`?category=`), like the masters hub.
 *   state     the four stock states (In Stock · Reorder · Stock Out · Expiring
 *             Soon) are chosen in the filter SHEET, beside the Store pane — no
 *             top tab row. The on-hand report is split into the three quantity
 *             states; Expiring Soon is a separate lazy feed.
 *   rows      the active state's rows render in the shared reference card anatomy
 *             (photo/glyph, model name, store, qty). Tapping opens the item record.
 *
 * Reads the RAW `/api/mro/stock/*` report routes through the shared `mroApi`
 * helper. The category strip labels come from the shared `mro_item_categories`
 * directory (`useMroCategories`) — the on-hand report carries the id + an
 * English-first name, so the strip renders the Burmese label per the master.
 */
export default function StockBrowsePage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [view, setView] = useViewState(STOCK_BROWSE_VIEW);
	const { tab, location: store } = view;
	const category = view[URL_PARAM.category];
	const [q, setQ] = useState('');
	const [searchOpen, setSearchOpen] = useState(false);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	const onhand = useOnHandReport();
	// The `mro_item_categories` directory — the strip's tab list + Burmese labels.
	const categories = useMroCategories();

	const openItem = useCallback(
		(row: MroOnHandRow) => {
			if (!row.model) return;
			hapticImpact('light');
			navigate(stockItemPath(row.model), { state: { name: row.model_name, image: row.model_image } });
		},
		[navigate],
	);
	const openModel = useCallback(
		(modelId: string) => {
			hapticImpact('light');
			navigate(`/app/items/${modelId}`);
		},
		[navigate],
	);
	const expiry = useQuery({
		queryKey: qk.expiring(EXPIRY_WINDOW),
		queryFn: () => fetchAlertingExpiry(),
		enabled: tab === 'expiry',
		staleTime: STOCK_STALE_MS,
	});
	const onhandRows = useMemo(() => onhand.data ?? [], [onhand.data]);

	const byModel = useMemo(() => {
		const map: Record<string, string | undefined> = {};
		for (const row of onhandRows) {
			if (row.model != null) map[row.model] = row.category ?? undefined;
		}
		return map;
	}, [onhandRows]);

	// Rows in the ACTIVE store (the strip's category options come from here).
	const storeRows = useMemo(() => onhandRows.filter((row) => row.location === store), [onhandRows, store]);

	// The category strip — EVERY `mro_item_categories` master (stock or not): it is
	// a catalog filter, not a stock summary, so a category with nothing on hand is
	// still selectable (and shows its empty state). A row whose category is missing
	// from the directory still gets a tab (defensive); "All" leads.
	const categoryTabs = useMemo<CategoryTab[]>(() => {
		const byId = new Map<string, CategoryTab>();
		for (const master of categories.data ?? []) {
			byId.set(master.id, { id: master.id, nameEn: master.nameEn, nameMm: master.nameMm });
		}
		for (const row of storeRows) {
			if (row.category && !byId.has(row.category)) {
				byId.set(row.category, { id: row.category, nameEn: row.category_name ?? null, nameMm: row.category_name ?? null });
			}
		}
		const list = [...byId.values()].sort((a, b) => (a.nameEn ?? '').localeCompare(b.nameEn ?? ''));
		return [{ id: '', nameEn: 'All', nameMm: 'အားလုံး' }, ...list];
	}, [categories.data, storeRows]);

	// A stale `?category=` degrades to "All" rather than an empty list.
	const activeCategory = categoryTabs.some((c) => c.id === category) ? category : '';

	const needle = q.trim().toLowerCase();

	const inCategory = useCallback(
		(modelId: string | null | undefined): boolean => {
			if (!activeCategory) return true;
			if (!modelId) return false;
			return byModel[modelId] === activeCategory;
		},
		[activeCategory, byModel],
	);

	const storeTotal = useMemo(() => storeRows.filter((row) => inCategory(row.model)), [storeRows, inCategory]);
	const pre = useMemo(() => partitionOnHand(storeTotal), [storeTotal]);

	// The four state counts (for the filter sheet's Status pane + the active view).
	const statusCounts = useMemo<Record<StockTab, number | undefined>>(
		() => ({
			in: pre.in.length,
			reorder: pre.reorder.length,
			out: pre.out.length,
			expiry: expiry.isFetched ? alertingRowsAll(expiry.data ?? [], store).length : undefined,
		}),
		[pre, expiry.isFetched, expiry.data, store],
	);

	// The active state — the raw `?tab=` when renderable, else Reorder.
	const activeTab: StockTab = STOCK_TAB_VALUES.includes(tab) ? tab : 'reorder';

	const inList = useMemo(() => pre.in.filter((row) => !needle || (row.model_name ?? '').toLowerCase().includes(needle)), [pre, needle]);
	const reorderList = useMemo(
		() => pre.reorder.filter((row) => !needle || (row.model_name ?? '').toLowerCase().includes(needle)),
		[pre, needle],
	);
	const outList = useMemo(() => pre.out.filter((row) => !needle || (row.model_name ?? '').toLowerCase().includes(needle)), [pre, needle]);
	const alertingRows = useMemo(
		() =>
			alertingRowsAll(expiry.data ?? [], store)
				.filter((row) => inCategory(row.model))
				.filter((row) => !needle || (row.model_name ?? '').toLowerCase().includes(needle)),
		[expiry.data, store, inCategory, needle],
	);

	const storesOptions = MRO_LOCATIONS.map((location) => ({ value: location.value, label: location.label }));
	const statusOptions = STOCK_TABS.map((meta) => ({
		value: meta.value,
		label: statusCounts[meta.value] === undefined ? meta.label : `${meta.label} (${statusCounts[meta.value]})`,
	}));

	const applyFilter = useCallback(
		(next: { first: string; second: string }) => {
			// ONE batched URL write — the store + state change together.
			setView({ location: next.first as StoreFilter, tab: next.second as StockTab });
		},
		[setView],
	);

	const refreshing = onhand.isFetching || expiry.isFetching;
	const refresh = useCallback(async () => {
		hapticImpact('light');
		if (activeTab === 'expiry') {
			await queryClient.invalidateQueries({ queryKey: qk.expiring(EXPIRY_WINDOW) });
		} else {
			await queryClient.invalidateQueries({ queryKey: ON_HAND_QUERY_KEY });
		}
	}, [queryClient, activeTab]);

	const hasQuery = q.trim() !== '';
	const closeSearch = () => {
		hapticImpact('light');
		setQ('');
		setSearchOpen(false);
	};

	const toggleSearch = () => {
		hapticImpact('light');
		if (searchOpen) setQ('');
		setSearchOpen((open) => !open);
	};

	const searchButton = (
		<button
			type="button"
			onClick={toggleSearch}
			aria-label={searchOpen ? 'Close search' : 'Search items'}
			className={`${GLASS_ICON_BUTTON} ${searchOpen ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
		>
			{searchOpen ? <X className="size-5" aria-hidden /> : <Search className="size-5" aria-hidden />}
		</button>
	);
	const searchPanel = (
		<div className="flex w-full items-center gap-2">
			<div className="relative min-w-0 flex-1">
				<Search className="pointer-events-none absolute left-4 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
				<input
					ref={searchInputRef}
					type="search"
					value={q}
					onChange={(event) => setQ(event.target.value)}
					placeholder="Search item name"
					className="h-11 w-full rounded-full border border-border/60 bg-white/90 pl-11 pr-4 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring/60 dark:border-white/15 dark:bg-card/95"
				/>
			</div>
			<button
				type="button"
				onClick={closeSearch}
				aria-label="Close search"
				className={`relative flex size-11 items-center justify-center rounded-full border border-border/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 ${GLASS_ICON_BUTTON_ACTIVE}`}
			>
				<X className="size-5" aria-hidden />
			</button>
		</div>
	);

	useEffect(() => {
		if (!searchOpen) return;
		const input = searchInputRef.current;
		if (!input) return;
		const y = window.scrollY;
		input.focus({ preventScroll: true });
		const restore = () => {
			if (window.scrollY !== y) window.scrollTo(0, y);
		};
		const raf = window.requestAnimationFrame(restore);
		const settle = window.setTimeout(restore, 350);
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(settle);
		};
	}, [searchOpen]);

	// ── View bodies (store/category-scoped row lists) ────────────────────────
	const inTab = onhand.isPending ? (
		<ListSkeleton rows={3} />
	) : onhand.isError ? (
		<RetryState title="Couldn't read the report" onRetry={() => void refresh()} />
	) : inList.length === 0 ? (
		<div className="flex min-h-0 flex-1 flex-col pt-2">
			<EmptyState
				title={hasQuery ? `No "${q.trim()}" matches in stock` : 'No healthy stock here'}
				hint={hasQuery ? 'Try a cleaner search term.' : 'Every balance in this store is low, out, or unstocked.'}
				fill
			/>
		</div>
	) : (
		<RowList rows={inList} onOpenModel={openItem} showStore={false} showQty={false} />
	);

	const reorderTab = onhand.isPending ? (
		<ListSkeleton rows={3} />
	) : onhand.isError ? (
		<RetryState title="Couldn't read the report" onRetry={() => void refresh()} />
	) : reorderList.length === 0 ? (
		<div className="flex min-h-0 flex-1 flex-col pt-2">
			<EmptyState
				title={hasQuery ? `No "${q.trim()}" matches on hand` : 'No rows need reordering here'}
				hint={hasQuery ? 'Try a cleaner search term.' : 'Every balance in this store sits above its reorder level.'}
				fill
			/>
		</div>
	) : (
		<RowList rows={reorderList} onOpenModel={openItem} showStore={false} showQty={false} />
	);

	const outTab = onhand.isPending ? (
		<ListSkeleton rows={2} />
	) : onhand.isError ? (
		<RetryState title="Couldn't read the report" onRetry={() => void refresh()} />
	) : outList.length === 0 ? (
		<div className="flex min-h-0 flex-1 flex-col pt-2">
			<EmptyState
				title={hasQuery ? `No "${q.trim()}" is out of stock` : 'Nothing is out of stock here'}
				hint={hasQuery ? 'Try a cleaner search term.' : 'Every balance in this store has stock on hand.'}
				fill
			/>
		</div>
	) : (
		<RowList rows={outList} onOpenModel={openItem} alert="out" showStore={false} showQty={false} />
	);

	const expiryTab = expiry.isPending ? (
		<ExpirySection rows={[]} loading error={false} onRetry={() => void refresh()} onOpenDocument={(row) => openModel(row.model)} bare />
	) : expiry.isError ? (
		<ExpirySection rows={[]} loading={false} error onRetry={() => void refresh()} onOpenDocument={(row) => openModel(row.model)} bare />
	) : alertingRows.length === 0 && hasQuery ? (
		<EmptyState title={`No "${q.trim()}" is expiring soon`} hint="Try a cleaner search term." fill />
	) : (
		<ExpirySection
			rows={alertingRows}
			loading={false}
			error={false}
			onRetry={() => void refresh()}
			onOpenDocument={(row) => openModel(row.model)}
			bare
		/>
	);

	const body = activeTab === 'in' ? inTab : activeTab === 'out' ? outTab : activeTab === 'expiry' ? expiryTab : reorderTab;

	const storeLabel = MRO_LOCATION_LABELS[store] ?? store;
	const activeCategoryLabel = activeCategory
		? categoryTabs.find((c) => c.id === activeCategory)?.nameMm?.trim() || categoryTabs.find((c) => c.id === activeCategory)?.nameEn?.trim()
		: null;
	const centerLabel = activeCategoryLabel ? `${activeCategoryLabel} · ${storeLabel}` : storeLabel;

	return (
		<ModuleShell title="Stock" backTo="/app/stocks">
			<div className="flex flex-1 flex-col gap-3">
				{/* Category strip — narrows the whole dashboard to one category. */}
				<CategoryStrip tabs={categoryTabs} value={activeCategory} onChange={(id) => setView({ [URL_PARAM.category]: id })} />

				{/* The body owns the remaining height so an EMPTY view stretches its dashed
				    card to the pane instead of hugging a few lines at the top. */}
				<div className="mt-2 flex min-h-0 flex-1 flex-col">{body}</div>

				<div className="mt-6 h-24" aria-hidden />
			</div>

			<BottomActionBar
				left={
					<TwoPaneFilterTrigger
						value={{ first: store, second: activeTab }}
						onApply={applyFilter}
						paneLabels={['Store', 'Status']}
						firstOptions={storesOptions}
						secondOptions={statusOptions}
						reset={{ first: DEFAULT_STORE, second: 'reorder' }}
						hasActive={store !== DEFAULT_STORE || activeTab !== 'reorder'}
						sheetTitle="Filter stock"
						buttonLabel="Filter stocks"
					/>
				}
				center={centerLabel}
				panel={searchPanel}
				panelOpen={searchOpen}
				right={
					<div className="flex items-center gap-1.5">
						{searchButton}
						<button
							type="button"
							onClick={() => void refresh()}
							disabled={refreshing}
							aria-label="Refresh"
							className={`${GLASS_ICON_BUTTON} ${GLASS_ICON_BUTTON_IDLE} disabled:opacity-60`}
						>
							<RefreshCw className={`size-5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
						</button>
					</div>
				}
			/>
		</ModuleShell>
	);
}

/** Expiry rows for one store, alert-worthy. */
function alertingRowsAll<T extends { location: string }>(rows: T[], store: string): T[] {
	return rows.filter((row) => row.location === store);
}

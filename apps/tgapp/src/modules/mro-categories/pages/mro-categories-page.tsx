import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, RefreshCw, Search, SlidersHorizontal, Store, Wrench, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { MasterRow } from '../components/master-row';
import { GroupCard } from '../components/group-card';
import { CategoryStrip, type CategoryTab } from '@/shared/components/category-strip';
import { fetchMroGroups, fetchMroIssueTypes } from '../data/api';
import { MRO_GROUPS_STALE_MS, MRO_MASTERS_STALE_MS, qk } from '../data/query-keys';
import {
	BottomActionBar,
	GLASS_ICON_BUTTON,
	GLASS_ICON_BUTTON_ACTIVE,
	GLASS_ICON_BUTTON_IDLE,
	GLASS_PRIMARY_BUTTON,
} from '@/shared/components/bottom-action-bar';
import { ListSkeleton } from '@/shared/components/skeletons';
import { ModuleShell } from '@/shared/components/module-shell';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';
import { fetchMroSuppliers, useMroCategories } from '@/shared/hooks/use-mro-masters';
import { URL_PARAM, enumParam, stringOrEmptyParam, useViewState } from '@/shared/url-state';

/**
 * Masters hub (`/app/mro-categories`, launcher tile `item-categories`).
 *
 *  - Group      `mro_item_name` — the generic part name (Bulb, Clutch, Tyre…);
 *               every master with at least one SKU is a group card with its SKU
 *               count, tapping opens the item-model catalog filtered to that
 *               master (one aggregate `/api/mro/catalog/groups` read).
 *  - Supplier   `mro_suppliers` — the supplier directory (the GRN form's picker
 *               source); rows added here appear in the inbound form's picker.
 *  - Issue      `veh_issue_types` — the maintenance job catalog, READ-ONLY
 *               (curated in the Maintenance module, never here): each card shows
 *               the job's Myanmar name (`name_mm`) with the `mro_item_categories`
 *               it files under (`category`) as its sublabel.
 *
 * Anatomy: a horizontal strip of LARGE category tabs (`mro_item_categories` — the
 * item-name group's parent, and the issue type's `category` — Myanmar name +
 * glyph) narrows the list below on BOTH the groups and issues tabs. The tab list
 * comes from the whole `mro_item_categories` MASTER directory (the same shared
 * cache entry the stock browser reads), never from the loaded rows: the issue
 * list is cursor-paged, so a row-derived strip would be incomplete until every
 * page was fetched. The Groups strip shows every category; the Issues strip shows
 * only those flagged `issues_type` (a catalog-only category never belongs to a
 * maintenance job). The Item-Groups / Suppliers / Issues SCOPE switch lives in
 * the fixed bottom bar's filter (sliders) sheet, NOT a top tab row. The bar also
 * carries search (morphs into the field) and — for the two WRITABLE masters — the
 * scope's create (+); Issues is read-only, so its + is hidden.
 *
 * The supplier whole-set read + the item form's pickers share ONE cache entry
 * (`['mro','suppliers']`, see shared/hooks/use-mro-masters) — a row created
 * through a '+' flow or in the item quick-add invalidates it write-through.
 */

type MasterTab = 'groups' | 'suppliers' | 'issues';

const MASTER_TABS: { value: MasterTab; label: string; hint: string }[] = [
	{ value: 'groups', label: 'Item Groups', hint: 'ပစ္စည်းအုပ်စု — part families' },
	{ value: 'suppliers', label: 'Suppliers', hint: 'ရောင်းချသူ — vendors' },
	{ value: 'issues', label: 'Issues', hint: 'ပြဿနာအမျိုးအစား — job families' },
];

const TAB_TITLES: Record<MasterTab, string> = {
	groups: 'Item Groups',
	suppliers: 'Suppliers',
	issues: 'Issues',
};

const TAB_CENTER_NOUNS: Record<MasterTab, { singular: string; plural: string }> = {
	groups: { singular: 'item group', plural: 'item groups' },
	suppliers: { singular: 'supplier', plural: 'suppliers' },
	issues: { singular: 'issue type', plural: 'issue types' },
};

/** The scope's create (+) route — EMPTY for a read-only master (Issues), which
 *  hides the + button entirely: there is no issue-type edit surface here. */
const TAB_CREATE_ROUTES: Record<MasterTab, string> = {
	groups: '/app/mro-categories/+',
	suppliers: '/app/mro-categories/suppliers/+',
	issues: '',
};

const TAB_CREATE_LABELS: Record<MasterTab, string> = {
	groups: 'Add a new item group',
	suppliers: 'Add a new supplier',
	issues: '',
};

const TAB_PARAM = enumParam<MasterTab>(
	MASTER_TABS.map((tab) => tab.value),
	'groups',
);

/** The hub's WHOLE URL view state — the scope tab + the active category (`?category=`). */
const MRO_CATEGORIES_VIEW = {
	[URL_PARAM.tab]: TAB_PARAM,
	[URL_PARAM.category]: stringOrEmptyParam,
} as const;

/** The toolbar search field's per-tab placeholder (the tab's master noun). */
const TAB_SEARCH_PLACEHOLDERS: Record<MasterTab, string> = {
	groups: 'Search item groups',
	suppliers: 'Search suppliers',
	issues: 'Search issue types',
};

export default function MroCategoriesPage() {
	const navigate = useNavigate();
	const [view, setView] = useViewState(MRO_CATEGORIES_VIEW);
	const { tab } = view;
	const categoryId = view[URL_PARAM.category] ?? '';

	// The toolbar search — filters the loaded rows CLIENT-side (instant).
	const [searchOpen, setSearchOpen] = useState(false);
	const [query, setQuery] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);
	const q = query.trim().toLowerCase();

	// The scope switch sheet (bottom bar filter icon → Item Groups / Suppliers).
	const [scopeOpen, setScopeOpen] = useState(false);

	// Three masters: the group directory + the supplier directory + the issue-type
	// directory, each read only while its scope is selected.
	const groupsQuery = useQuery({
		queryKey: qk.groups(),
		queryFn: fetchMroGroups,
		staleTime: MRO_GROUPS_STALE_MS,
		enabled: tab === 'groups',
	});
	const suppliersQuery = useQuery({
		queryKey: qk.suppliers(),
		queryFn: fetchMroSuppliers,
		staleTime: MRO_MASTERS_STALE_MS,
		enabled: tab === 'suppliers',
	});
	const issueTypesQuery = useQuery({
		queryKey: qk.issueTypes(),
		queryFn: fetchMroIssueTypes,
		staleTime: MRO_MASTERS_STALE_MS,
		enabled: tab === 'issues',
	});
	// The `mro_item_categories` MASTER directory — the strip's tab list, shared
	// with the stock browser's category selector through ONE cache entry.
	const categoriesQuery = useMroCategories();

	const groups = groupsQuery.data ?? [];
	const suppliers = suppliersQuery.data ?? [];
	const issueTypes = issueTypesQuery.data ?? [];
	const categories = categoriesQuery.data ?? [];

	// The category strip — sourced from the whole `mro_item_categories` directory,
	// NOT from the loaded rows: the issue list is cursor-paged (it can run to
	// hundreds of rows), so deriving tabs from whatever pages happen to be loaded
	// would make tabs appear/vanishing as the list grows and hide a category whose
	// rows simply have not been fetched yet. The directory is a small bounded
	// master table, so the strip is complete and stable from first paint. Loaded
	// rows still UNION in any category the directory is somehow missing
	// (defensive); "All" leads. A row with NO category contributes no tab — it is
	// reachable under "All" only, and mapping null onto the All sentinel would
	// render a SECOND "All".
	const directoryIds = useMemo(() => new Set(categories.map((category) => category.id)), [categories]);

	// The Item-Groups strip — EVERY category (a part family may live under any).
	const categoryTabs = useMemo<CategoryTab[]>(() => {
		const byId = new Map<string, CategoryTab>();
		for (const master of categories) {
			byId.set(master.id, { id: master.id, nameEn: master.nameEn, nameMm: master.nameMm });
		}
		for (const group of groups) {
			if (group.categoryId && !byId.has(group.categoryId)) {
				byId.set(group.categoryId, { id: group.categoryId, nameEn: group.categoryNameEn, nameMm: group.categoryNameMm });
			}
		}
		const list = [...byId.values()].sort((a, b) => (a.nameEn ?? '').localeCompare(b.nameEn ?? ''));
		return [{ id: '', nameEn: 'All', nameMm: 'အားလုံး' }, ...list];
	}, [categories, groups]);

	// The Issues strip — ONLY the categories flagged `issues_type` (the maintenance
	// job families): a catalog-only category (Consumable Items, General, …) never
	// belongs here. A category absent from the directory still gets a tab
	// (defensive); one that IS in the directory but not an issue type stays out.
	const issueCategoryTabs = useMemo<CategoryTab[]>(() => {
		const byId = new Map<string, CategoryTab>();
		for (const master of categories) {
			if (master.issuesType) byId.set(master.id, { id: master.id, nameEn: master.nameEn, nameMm: master.nameMm });
		}
		for (const issue of issueTypes) {
			if (issue.categoryId && !directoryIds.has(issue.categoryId)) {
				byId.set(issue.categoryId, { id: issue.categoryId, nameEn: issue.categoryNameEn, nameMm: issue.categoryNameMm });
			}
		}
		const list = [...byId.values()].sort((a, b) => (a.nameEn ?? '').localeCompare(b.nameEn ?? ''));
		return [{ id: '', nameEn: 'All', nameMm: 'အားလုံး' }, ...list];
	}, [categories, directoryIds, issueTypes]);

	// A stale `?category=` (master renamed/removed, or a Groups-only category on the
	// Issues tab) degrades to "All" rather than an empty list. `?category=` is
	// shared across tabs, so each tab validates it against its OWN tab set.
	const activeCategory = categoryTabs.some((category) => category.id === categoryId) ? categoryId : '';
	const activeIssueCategory = issueCategoryTabs.some((category) => category.id === categoryId) ? categoryId : '';

	// The loaded rows narrowed to the active query (empty query = everything).
	const nameInQ = (name: string | null | undefined) => (name ?? '').toLowerCase().includes(q);
	const inCategory = (group: (typeof groups)[number]) => !activeCategory || (group.categoryId ?? '') === activeCategory;
	const visibleGroups = groups.filter(inCategory).filter((group) => !q || nameInQ(group.nameEn) || nameInQ(group.nameMm));
	const visibleSuppliers = q
		? suppliers.filter((supplier) => nameInQ(supplier.name) || nameInQ(supplier.mobile) || nameInQ(supplier.address))
		: suppliers;
	const visibleIssues = issueTypes
		.filter((issue) => !activeIssueCategory || (issue.categoryId ?? '') === activeIssueCategory)
		.filter((issue) => !q || nameInQ(issue.nameEn) || nameInQ(issue.nameMm));

	// The bar's center label names WHAT the list holds — the live row count.
	const visibleCount = tab === 'groups' ? visibleGroups.length : tab === 'suppliers' ? visibleSuppliers.length : visibleIssues.length;
	const centerNoun = TAB_CENTER_NOUNS[tab];
	const centerLabel = `${visibleCount} ${visibleCount === 1 ? centerNoun.singular : centerNoun.plural}`;

	const clearSearch = useCallback(() => {
		setQuery('');
		setSearchOpen(false);
	}, []);

	useEffect(() => {
		if (!searchOpen) return;
		const input = inputRef.current;
		if (!input) return;
		const y = window.scrollY;
		input.focus({ preventScroll: true });
		const restore = () => {
			if (window.scrollY !== y) window.scrollTo(0, y);
		};
		const raf = requestAnimationFrame(restore);
		const settle = setTimeout(restore, 350);
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(settle);
		};
	}, [searchOpen]);

	const openGroup = useCallback(
		(id: string) => {
			hapticImpact('light');
			navigate(`/app/items?${URL_PARAM.itemName}=${encodeURIComponent(id)}`);
		},
		[navigate],
	);

	const editGroup = useCallback(
		(id: string) => {
			hapticImpact('light');
			navigate(`/app/mro-categories/groups/${encodeURIComponent(id)}`);
		},
		[navigate],
	);

	const openCreate = () => {
		// The read-only Issues master has no create surface — the + is hidden, so
		// a stray call (never reachable) still no-ops here.
		if (!TAB_CREATE_ROUTES[tab]) return;
		hapticImpact('light');
		navigate(TAB_CREATE_ROUTES[tab]);
	};

	const openEdit = (id: string) => {
		hapticImpact('light');
		navigate(`/app/mro-categories/suppliers/${encodeURIComponent(id)}`);
	};

	const renderError = (retry: () => void) => (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
			<p className="text-xs font-medium leading-myanmar text-status-danger">Couldn't load the list</p>
			<button
				type="button"
				onClick={retry}
				className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
			>
				<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
				Try again
			</button>
		</div>
	);

	const renderEmpty = (message: string) => (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
			<p className="text-xs font-medium leading-myanmar text-muted-foreground">{message}</p>
		</div>
	);

	const renderNoMatch = () => (
		<div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-10 text-center">
			<p className="text-xs font-medium leading-myanmar text-muted-foreground">
				No {TAB_TITLES[tab]} match «{query.trim()}»
			</p>
		</div>
	);

	// The bar's 🔍 capsule (morphs the pill into the search field below it).
	const searchToggle = (
		<button
			type="button"
			onClick={() => {
				hapticImpact('light');
				if (searchOpen) clearSearch();
				else setSearchOpen(true);
			}}
			aria-label={searchOpen ? 'Close search' : 'Search'}
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
					ref={inputRef}
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={TAB_SEARCH_PLACEHOLDERS[tab]}
					className="h-11 w-full rounded-full border border-border/60 bg-white/90 pl-11 pr-4 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring/60 dark:border-white/15 dark:bg-card/95"
				/>
			</div>
			<button
				type="button"
				onClick={() => {
					hapticImpact('light');
					clearSearch();
				}}
				aria-label="Close search"
				className={`relative flex size-11 items-center justify-center rounded-full border border-border/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 ${GLASS_ICON_BUTTON_ACTIVE}`}
			>
				<X className="size-5" aria-hidden />
			</button>
		</div>
	);

	// The filter (sliders) capsule — opens the SCOPE sheet; tinted when the scope
	// is off its default (Suppliers) so the bar shows a narrowing is applied.
	const scopeActive = tab !== 'groups';

	return (
		<ModuleShell title={TAB_TITLES[tab]}>
			<div className="flex flex-1 flex-col gap-3">
				{tab === 'groups' ? (
					<>
						<CategoryStrip tabs={categoryTabs} value={activeCategory} onChange={(id) => setView({ [URL_PARAM.category]: id })} />
						{groupsQuery.isPending ? (
							<ListSkeleton variant="category" count={3} />
						) : groupsQuery.isError ? (
							renderError(() => void groupsQuery.refetch())
						) : groups.length === 0 ? (
							renderEmpty('No item groups yet — tap the + button below to add your first group.')
						) : visibleGroups.length === 0 ? (
							renderNoMatch()
						) : (
							<ul className="flex flex-col gap-3">
								{visibleGroups.map((group) => (
									<GroupCard key={group.id} group={group} onOpen={() => openGroup(group.id)} onEdit={() => editGroup(group.id)} />
								))}
							</ul>
						)}
					</>
				) : tab === 'suppliers' ? (
					suppliersQuery.isPending ? (
						<ListSkeleton variant="category" count={3} />
					) : suppliersQuery.isError ? (
						renderError(() => void suppliersQuery.refetch())
					) : suppliers.length === 0 ? (
						renderEmpty('No suppliers yet — tap + to add your first supplier.')
					) : visibleSuppliers.length === 0 ? (
						renderNoMatch()
					) : (
						<ul className="flex flex-col gap-3">
							{visibleSuppliers.map((supplier) => (
								<MasterRow
									key={supplier.id}
									name={supplier.name}
									detail={[supplier.mobile, supplier.address].filter((part): part is string => Boolean(part?.trim())).join(' · ')}
									icon={Store}
									onOpen={() => openEdit(supplier.id)}
								/>
							))}
						</ul>
					)
				) : (
					<>
						{/* The Issues strip — categories flagged `issues_type` only. */}
						<CategoryStrip tabs={issueCategoryTabs} value={activeIssueCategory} onChange={(id) => setView({ [URL_PARAM.category]: id })} />
						{issueTypesQuery.isPending ? (
							<ListSkeleton variant="category" count={3} />
						) : issueTypesQuery.isError ? (
							renderError(() => void issueTypesQuery.refetch())
						) : issueTypes.length === 0 ? (
							renderEmpty('No issue types yet.')
						) : visibleIssues.length === 0 ? (
							renderNoMatch()
						) : (
							<ul className="flex flex-col gap-3">
								{visibleIssues.map((issue) => (
									<MasterRow
										key={issue.id}
										name={issue.nameMm?.trim() ? issue.nameMm : (issue.nameEn ?? null)}
										detail={issue.categoryNameMm ?? issue.categoryNameEn}
										icon={Wrench}
									/>
								))}
							</ul>
						)}
					</>
				)}

				<div className="h-24" aria-hidden />
			</div>

			{/* The fixed bottom bar — filter (scope sheet), center label, then
				search / create. While search is open the pill morphs into the field. */}
			<BottomActionBar
				left={
					<button
						type="button"
						aria-label="Scope"
						onClick={() => {
							hapticImpact('light');
							setScopeOpen(true);
						}}
						className={`${GLASS_ICON_BUTTON} ${scopeActive ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
					>
						<SlidersHorizontal className="size-5" aria-hidden />
						{scopeActive && <span className="absolute right-px top-px size-2 rounded-full bg-primary" aria-hidden />}
					</button>
				}
				center={centerLabel}
				panel={searchPanel}
				panelOpen={searchOpen}
				right={
					<div className="flex items-center gap-1.5">
						{searchToggle}
						{TAB_CREATE_ROUTES[tab] ? (
							<button type="button" onClick={openCreate} aria-label={TAB_CREATE_LABELS[tab]} className={GLASS_PRIMARY_BUTTON}>
								<Plus className="size-5" aria-hidden />
							</button>
						) : null}
					</div>
				}
			/>

			{/* Scope sheet — the retired top tab row, now a sheet off the bar. */}
			<Sheet open={scopeOpen} onOpenChange={setScopeOpen}>
				<SheetContent side="bottom">
					<SheetHeader className="pb-0">
						<SheetTitle>Show</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-0.5 px-4 pb-safe pt-2">
						{MASTER_TABS.map((option) => {
							const selected = option.value === tab;
							return (
								<button
									key={option.value}
									type="button"
									aria-pressed={selected}
									onClick={() => {
										hapticSelection();
										setView({ [URL_PARAM.tab]: option.value });
										setScopeOpen(false);
									}}
									className={`flex w-full items-center justify-between rounded-md px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
										selected ? 'bg-primary/8 text-foreground' : 'text-muted-foreground hover:bg-muted/60'
									}`}
								>
									<span className="flex min-w-0 flex-col">
										<span className="text-sm font-medium">{option.label}</span>
										<span className="truncate text-xs leading-myanmar text-muted-foreground">{option.hint}</span>
									</span>
									{selected ? (
										<span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-primary bg-primary text-primary-foreground">
											<Check className="size-3" strokeWidth={3} aria-hidden />
										</span>
									) : (
										<span className="size-5 shrink-0 rounded-full border border-muted-foreground/40" />
									)}
								</button>
							);
						})}
					</div>
				</SheetContent>
			</Sheet>
		</ModuleShell>
	);
}

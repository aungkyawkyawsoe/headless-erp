import { useCallback } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutList, Plus, RefreshCw } from 'lucide-react';

import { LicensePill, expiryLabel } from '../components/license-badge';
import { LicenseHistoryCard } from '../components/license-history-card';
import { fetchTruckIdentity, fetchTruckLicensePage, permitSummaryOf } from '../data/api';
import { LICENSE_STALE_MS, qk } from '../data/query-keys';
import { LICENSE_STATUS_LABELS } from '../data/status';
import type { LicenseCardModel, TruckCurrentPermit, TruckLicenseSelection } from '../data/types';
import {
	BottomActionBar,
	GLASS_ICON_BUTTON,
	GLASS_ICON_BUTTON_ACTIVE,
	GLASS_ICON_BUTTON_IDLE,
	GLASS_PRIMARY_BUTTON,
} from '@/shared/components/bottom-action-bar';
import { LedgerList } from '@/shared/components/ledger';
import { ModuleShell } from '@/shared/components/module-shell';
import { RecordHero } from '@/shared/components/record-hero';
import { SearchResultsList } from '@/shared/components/search-results-list';
import { Shimmer } from '@/shared/components/skeletons';
import { TruckImageCard } from '@/shared/components/truck-image-card';
import { useBarSearch } from '@/shared/hooks/use-bar-search';
import { useCursorList } from '@/shared/hooks/use-cursor-list';
import { popBack } from '@/shared/platform/history';
import { isNewestRecord } from '@/shared/records/newest';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/** The page's two views — the truck OVERVIEW (photo + current permit, the
 *  default) and the truck's full license HISTORY list. The bottom bar's list
 *  button toggles between them; its + NAVIGATES to the dedicated renewal page
 *  (`/app/licenses/:id/renew`), so the form is full-screen with no bar. */
type TruckView = 'overview' | 'history';

/** The view is URL state (`?tab=`), the sibling convention: a reload keeps the
 *  open view and the bar toggle replaces (no stray history entries). The default
 *  is the OVERVIEW (photo + hero); the permit list appears only when the bar's
 *  list button opens it. */
const TRUCK_VIEW = enumParam<TruckView>(['overview', 'history'], 'overview');

/** The truck screen's WHOLE URL view state, declared ONCE — the screen's single
 *  source of truth for "where am I in this view" (key from `URL_PARAM`). */
const LICENSE_TRUCK_VIEW = {
	[URL_PARAM.tab]: TRUCK_VIEW,
} as const;

/**
 * Licenses — ONE truck's full-screen page (`/app/licenses/:id`, reached by
 * tapping a truck card on `/app/licenses`), the SAME two-view anatomy as the
 * Fluid vehicle page (the bottom bar's list button swaps the views):
 *
 *  1. OVERVIEW (the default on open) — the truck PHOTO card, then the hero: the
 *     plate + the CURRENT permit's standing (tap → correct it). Nothing else is
 *     drawn until the list button asks for it.
 *  2. HISTORY (the bar's list toggle) — the truck's complete permit file as its
 *     own cards (one per permit, NEWEST first — the current license leads),
 *     CURSOR-PAGINATED and lazy-loaded; no photo, no hero. The bar search
 *     narrows the loaded permits.
 *
 * The bar's + NAVIGATES to the truck's dedicated RENEWAL page
 * (`/app/licenses/:id/renew`) instead of opening an in-page tab: that page is
 * full-screen with NO bottom toolbar and its Save is the native MainButton, and
 * it owns the renew gate (a still-valid permit renders the locked notice). The
 * current permit summary is handed over in router state so the gate costs no
 * read; a save lands back here on the HISTORY view (the form page replaces
 * itself, so Back never returns to it).
 *
 * Zero-extra-call opening: the tapped truck arrives through router STATE (it
 * holds the plate/brand the header needs — and the CURRENT permit summary, so
 * the renewal page can gate on the expiry without a read) and the permit-file
 * read stays OFF until the bar's List press opens the HISTORY view. The ONE
 * read that does run on every open is the shared `veh_fleets` identity, because
 * the truck PHOTO leads the page (the router state only shortens that first
 * paint, never substitutes the read). Deep links / refreshes carry no state, so
 * they additionally fall back to one lean current-permit read for the gate (see
 * `fetchTruckIdentity` / `fetchTruckCurrentPermit`).
 */
export default function LicenseTruckPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { id } = useParams<{ id: string }>();
	const [view, setView] = useViewState(LICENSE_TRUCK_VIEW);
	const { tab: activeView } = view;

	// The tapped truck — identity + CURRENT permit summary (plate/brand + the
	// carry-over number + renew-gate facts). Deep links carry none, so lean
	// fleet + current-permit reads back those. Preferring state over a fetch is
	// what removes the spurious reads on every card tap.
	const routed = (location.state as { row?: TruckLicenseSelection } | null)?.row ?? null;

	// The truck's identity — plate/brand for the header AND the PHOTO that leads
	// the page, so the read runs on EVERY open (a card tap only shortens the first
	// paint from router state, never substitutes the read). ONE lean `veh_fleets`
	// fetch, cached under the shared master key.
	const identity = useQuery({
		queryKey: qk.fleet(id ?? ''),
		queryFn: () => fetchTruckIdentity(id as string),
		enabled: id != null && id !== '',
	});

	// The truck's paged permit file — the page's ONLY read is the permit log
	// itself, loaded ONLY while the HISTORY view is open (the bar's List press
	// enables it, so the record screen never issues a request on the tap path).
	// Keyed per vehicle so each truck keeps its own pages; page 1 also feeds the
	// record view's current-status pill once visited (its rows stay in the cache
	// when the user returns to the form).
	const file = useCursorList({
		queryKey: qk.truck(id ?? ''),
		fetcher: (cursor) => fetchTruckLicensePage(id as string, cursor),
		enabled: id != null && id !== '',
		staleTime: LICENSE_STALE_MS,
	});

	// Identity — known the moment the tapped row lands, or after a deep-link
	// fleet read resolves. The app-bar title depends on it, so a loading id keeps
	// the page in its loading shell until ready.
	const identityReady = id != null && id !== '' && (routed != null || (identity.data != null && !identity.isPending));
	const plate = routed?.plate ?? identity.data?.plate ?? null;
	const title = identityReady && plate ? plate : 'Licenses';
	const vehicleId = id as string;

	// The truck's CURRENT permit facts — the renewal's carry-over number + the
	// renew gate + the bottom pill. Precedence: the loaded file's newest row
	// (once HISTORY was visited), else the ROUTED summary (the tap path — zero
	// reads), else the deep-link read above. `null` = no permit on file (a first
	// record is always allowed); `undefined` = the deep-link read is still
	// loading (the page holds its loading shell until it resolves).
	const fileRead = file.data != null;
	const fileCurrent = fileRead ? (file.rows[0] ?? null) : null;
	const current: TruckCurrentPermit | null | undefined = fileCurrent
		? permitSummaryOf(fileCurrent)
		: routed
			? (routed.current ?? null)
			: file.isPending
				? undefined
				: null;

	// A deep link holds the loading shell until the file resolves — otherwise the
	// gate would flash unlocked against an unknown permit.
	const currentLoading = routed == null && current === undefined;

	// The bottom bar's center pill — the CURRENT permit's urgency once it is
	// known ("Valid" / "Expiring" / "Overdue"), "No license" when the truck has
	// none on file, the neutral module label while facts are still loading.
	const statusLabel =
		current === undefined
			? fileRead && !file.isPending
				? 'No license'
				: 'Licenses'
			: current
				? LICENSE_STATUS_LABELS[current.tone]
				: 'No license';

	// The CORRECTION action — only the truck's NEWEST permit (the head of its
	// file) is editable; older rows are read-only history.
	const handleEdit = useCallback((license: LicenseCardModel) => navigate(`/app/licenses/permit/${license.id}`), [navigate]);
	const renderLicense = useCallback(
		(license: LicenseCardModel) => {
			// The head of the feed IS the current permit — the only row whose
			// urgency is meaningful (older rows render the Superseded chip) and the
			// only one offering the correction action.
			const isCurrent = isNewestRecord(file.rows, license.id);
			return <LicenseHistoryCard key={license.id} license={license} current={isCurrent} onEdit={isCurrent ? handleEdit : undefined} />;
		},
		[file.rows, handleEdit],
	);

	// Client-side search over the loaded file rows (the truck's file is read in
	// pages — the bar search narrows what is already read, like the Fluid page).
	const fetchSearch = useCallback(
		async (query: string) => {
			const q = query.toLowerCase();
			return file.rows.filter(
				(license) =>
					(license.licenseNo ?? '').toLowerCase().includes(q) ||
					(license.place ?? '').toLowerCase().includes(q) ||
					(license.expiryDate ?? '').toLowerCase().includes(q),
			);
		},
		[file.rows],
	);

	// The bar search narrows the loaded file rows (the truck's file is paged).
	const search = useBarSearch<LicenseCardModel>('Search license no / place', fetchSearch);

	const brand = routed?.brand ?? identity.data?.brand ?? null;
	const currentLabel = fileCurrent?.licenseNo ?? current?.licenseNo ?? 'No license on file';
	const progress =
		current?.remainingDays != null
			? {
					value: current.remainingDays / 365,
					tone: current.tone === 'alert' ? 'bg-status-danger' : current.tone === 'warn' ? 'bg-status-warning' : 'bg-status-success',
					caption: `${current.remainingDays} of 365 days`,
				}
			: null;

	if (!identityReady || currentLoading) {
		return (
			<ModuleShell title={title} backTo="/app/licenses">
				{routed == null && (identity.isPending || file.isPending) ? (
					<div aria-hidden className="flex flex-col gap-3">
						<div className={`${DENSE_CARD_FRAME} p-4 shadow-card`}>
							<Shimmer className="h-5 w-1/3 rounded" />
							<div className="mt-4 grid grid-cols-3 gap-2">
								<Shimmer className="h-9 rounded-xl" />
								<Shimmer className="h-9 rounded-xl" />
								<Shimmer className="h-9 rounded-xl" />
							</div>
							<div className="mt-3 grid grid-cols-2 gap-3">
								<Shimmer className="h-11 rounded-lg" />
								<Shimmer className="h-11 rounded-lg" />
							</div>
						</div>
					</div>
				) : (
					<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
						<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this truck.</p>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => {
									void identity.refetch();
									void file.refetch();
								}}
								className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
							>
								<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
								Retry
							</button>
							<button
								type="button"
								onClick={() => popBack(navigate, '/app/licenses')}
								className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
							>
								Back to list
							</button>
						</div>
					</div>
				)}
			</ModuleShell>
		);
	}

	// OVERVIEW (photo + hero) by default; the bar's + swaps in the renewal form
	// and the list toggle swaps in the permit ledger — each press again folds
	// back to the overview (the maintenance-style anatomy).
	return (
		<ModuleShell title={title} backTo="/app/licenses">
			{search.open && search.query ? (
				<SearchResultsList
					query={search.query}
					searching={search.searching}
					results={search.results}
					error={search.error}
					onClear={search.clear}
					compact
					renderItem={(license) => {
						const isCurrent = isNewestRecord(file.rows, license.id);
						return (
							<LicenseHistoryCard key={license.id} license={license} current={isCurrent} onEdit={isCurrent ? handleEdit : undefined} />
						);
					}}
				/>
			) : (
				<div className="flex flex-col gap-3">
					{activeView === 'overview' ? (
						<>
							{/* The truck photo — a square tile (see `TruckImageCard`), riding the
							   shared identity read (`veh_fleets.image`). */}
							<TruckImageCard image={identity.data?.image ?? null} alt={plate ?? 'Truck'} />

							{/* Hero — where the permit stands NOW. */}
							<RecordHero
								identity={plate ?? '—'}
								identitySub={brand}
								headline={currentLabel}
								status={current ? <LicensePill tone={current.tone} remainingDays={current.remainingDays} /> : undefined}
								facts={[{ label: 'Expires', value: current?.expiryDate ? expiryLabel(current.expiryDate) : '—' }]}
								progress={progress}
								onOpen={fileCurrent ? () => handleEdit(fileCurrent) : undefined}
								ariaLabel="Correct the current license"
							/>
						</>
					) : (
						<>
							{/* The truck's permit file — the LIST view draws ONLY these cards (no
							   photo, no hero), the same anatomy as the maintenance list. */}
							<LedgerList caption="License history" count={`${file.rows.length} permit${file.rows.length === 1 ? '' : 's'}`}>
								{file.rows.length === 0 ? (
									<li className="px-3.5 py-6 text-center text-xs leading-myanmar text-muted-foreground">
										No licenses yet — record the first one with the + button below.
									</li>
								) : (
									file.rows.map((license) => renderLicense(license))
								)}
							</LedgerList>

							{file.isError && file.rows.length === 0 ? (
								<button
									type="button"
									onClick={() => void file.refetch()}
									className="mx-auto rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm"
								>
									Try again
								</button>
							) : null}
						</>
					)}
				</div>
			)}

			{/* Room for the fixed bottom bar when the page is fully scrolled. */}
			<div className="h-24" aria-hidden />

			<BottomActionBar
				left={search.button}
				center={statusLabel}
				panel={search.panel}
				panelOpen={search.open}
				right={
					<div className="flex items-center gap-1.5">
						{/* + opens the dedicated RENEWAL page (full-screen, no bottom bar,
						   native MainButton Save) — the current permit summary rides along so
						   its gate costs no read. A still-valid permit keeps that page locked. */}
						<button
							type="button"
							onClick={() => navigate(`/app/licenses/${vehicleId}/renew`, { state: { plate, current } })}
							aria-label="Renew license"
							className={GLASS_PRIMARY_BUTTON}
						>
							<Plus className="size-5" aria-hidden />
						</button>
						{/* The list toggle — opens the truck's permit file (press again → overview). */}
						<button
							type="button"
							onClick={() => setView({ tab: activeView === 'history' ? 'overview' : 'history' })}
							aria-label="Show the license history"
							aria-pressed={activeView === 'history'}
							className={`${GLASS_ICON_BUTTON} ${activeView === 'history' ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
						>
							<LayoutList className="size-5" aria-hidden />
						</button>
					</div>
				}
			/>
		</ModuleShell>
	);
}

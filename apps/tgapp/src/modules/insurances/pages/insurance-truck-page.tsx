import { useCallback, useMemo } from 'react';
import { DENSE_CARD_FRAME } from '@/shared/components/card';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutList, Plus, RefreshCw } from 'lucide-react';

import { InsurancePill, endDateLabel } from '../components/insurance-badge';
import { InsuranceHistoryCard } from '../components/insurance-history-card';
import { fetchTruckIdentity, fetchTruckPolicyPage, insuranceCurrentOf } from '../data/api';
import { INSURANCE_STALE_MS, qk } from '../data/query-keys';
import { INSURANCE_STATUS_LABELS } from '../data/status';
import type { InsuranceCardModel, InsuranceCurrentState, TruckInsuranceSelection } from '../data/types';
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

/** The page's two views — the truck OVERVIEW (photo + current policy, the
 *  default) and the truck's full policy HISTORY list. The bottom bar's list
 *  button toggles between them; its + NAVIGATES to the dedicated renewal page
 *  (`/app/insurances/:id/renew`), so the form is full-screen with no bar. */
type TruckView = 'overview' | 'history';

/** The view is URL state (`?tab=`), the sibling convention: a reload keeps the
 *  open view and the bar toggle replaces (no stray history entries). The default
 *  is the OVERVIEW (photo + hero); the policy list appears only when the bar's
 *  list button opens it. */
const TRUCK_VIEW = enumParam<TruckView>(['overview', 'history'], 'overview');

/** The truck screen's WHOLE URL view state, declared ONCE — the screen's single
 *  source of truth for "where am I in this view" (key from `URL_PARAM`). */
const INSURANCE_TRUCK_VIEW = {
	[URL_PARAM.tab]: TRUCK_VIEW,
} as const;

/**
 * Insurances — ONE truck's full-screen page (`/app/insurances/:id`, reached by
 * tapping a truck card on `/app/insurances`), the SAME two-view anatomy as the
 * Fluid vehicle page (the bottom bar's list button swaps the views):
 *
 *  1. OVERVIEW (the default on open) — the truck PHOTO card, then the hero: the
 *     plate + the CURRENT policy's standing (tap → correct it). Nothing else is
 *     drawn until the list button asks for it.
 *  2. HISTORY (the bar's list toggle) — the truck's complete policy file as its
 *     own cards (one per policy, NEWEST first — the current policy leads),
 *     CURSOR-PAGINATED and lazy-loaded; no photo, no hero. The bar search
 *     narrows the loaded policies.
 *
 * The bar's + NAVIGATES to the truck's dedicated RENEWAL page
 * (`/app/insurances/:id/renew`) instead of opening an in-page tab: that page is
 * full-screen with NO bottom toolbar and its Save is the native MainButton, and
 * it owns the renew gate (a still-valid policy renders the locked notice). The
 * current policy summary is handed over in router state so the gate costs no
 * read; a save lands back here on the HISTORY view (the form page replaces
 * itself, so Back never returns to it).
 *
 * Zero-extra-call opening: the tapped truck arrives through router STATE (it
 * holds the plate/brand the header needs — and the CURRENT policy summary, so
 * the renewal page can gate without a read) and the policy-file read stays OFF
 * until the bar's List press opens the HISTORY view. The ONE read that does run
 * on every open is the shared `veh_fleets` identity, because the truck PHOTO
 * leads the page (the router state only shortens that first paint, never
 * substitutes the read). Deep links / refreshes carry no state, so they
 * additionally fall back to one lean current-policy read for the gate (see
 * `fetchTruckIdentity` / `fetchTruckCurrentPolicy`).
 */
export default function InsuranceTruckPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const { id } = useParams<{ id: string }>();
	const [view, setView] = useViewState(INSURANCE_TRUCK_VIEW);
	const { tab: activeView } = view;

	// The tapped truck — identity + CURRENT policy summary (plate/brand + the
	// renew-gate facts). Deep links carry none, so lean fleet + current-policy
	// reads back those. Preferring state over a fetch is what removes the
	// spurious reads on every card tap.
	const routed = (location.state as { row?: TruckInsuranceSelection } | null)?.row ?? null;

	// The truck's identity — plate/brand for the header AND the PHOTO that leads
	// the page, so the read runs on EVERY open (a card tap only shortens the first
	// paint from router state, never substitutes the read). ONE lean `veh_fleets`
	// fetch, cached under the shared master key.
	const identity = useQuery({
		queryKey: qk.fleet(id ?? ''),
		queryFn: () => fetchTruckIdentity(id as string),
		enabled: id != null && id !== '',
	});

	// The truck's paged policy file — the LEDGER, so it loads on open (the old
	// page only read it behind a History toggle, which meant the current state
	// and the history could never be seen together).
	const file = useCursorList({
		queryKey: qk.truck(id ?? ''),
		fetcher: (cursor) => fetchTruckPolicyPage(id as string, cursor),
		enabled: id != null && id !== '',
		staleTime: INSURANCE_STALE_MS,
	});

	// Identity — known the moment the tapped row lands, or after a deep-link
	// fleet read resolves. The app-bar title depends on it, so a loading id keeps
	// the page in its loading shell until ready.
	const identityReady = id != null && id !== '' && (routed != null || (identity.data != null && !identity.isPending));
	const plate = routed?.plate ?? identity.data?.plate ?? null;
	const title = identityReady && plate ? plate : 'Insurances';
	const vehicleId = id as string;

	// The truck's CURRENT policy facts — the renew gate + the bottom pill.
	// Precedence: the loaded file's newest row (once HISTORY was visited), else
	// the ROUTED summary (the tap path — zero reads), else the deep-link read
	// above. `null` = no policy on file (a first record is always allowed);
	// `undefined` = the deep-link read is still loading (the page holds its
	// loading shell until it resolves).
	const fileRead = file.data != null;
	const fileCurrent = fileRead ? (file.rows[0] ?? null) : null;
	const current: InsuranceCurrentState | null | undefined = fileCurrent
		? insuranceCurrentOf(fileCurrent)
		: routed
			? (routed.current ?? null)
			: file.isPending
				? undefined
				: null;

	// A deep link holds the loading shell until the file resolves — otherwise the
	// gate would flash unlocked against an unknown policy.
	const currentLoading = routed == null && current === undefined;

	// The bottom bar's center pill — the CURRENT policy's expiry status once it
	// is known ("Valid" / "Expiring" / "Expired"), "No policy" when the truck has
	// none on file, the neutral module label while facts are still loading.
	const statusLabel =
		current === undefined
			? fileRead && !file.isPending
				? 'No policy'
				: 'Insurances'
			: current
				? INSURANCE_STATUS_LABELS[current.status]
				: 'No policy';

	// Provider labels already on this truck's policy file — the record form's
	// searchable combo suggests them beside the predefined insurers, so a renewal
	// can re-pick the incumbent insurer (legacy provider rows included).
	const existingProviders = useMemo(
		() => Array.from(new Set(file.rows.map((policy) => policy.provider).filter((p): p is string => Boolean(p)))),
		[file.rows],
	);

	// The CORRECTION action — only the truck's NEWEST policy (the head of its
	// file) is editable; older rows are read-only history.
	const handleEdit = useCallback((policy: InsuranceCardModel) => navigate(`/app/insurances/policy/${policy.id}`), [navigate]);
	/** The premium step since the PREVIOUS period — the ledger's transition line. */
	const premiumDelta = useCallback(
		(index: number) => {
			const cur = file.rows[index];
			const prev = file.rows[index + 1];
			if (cur?.premiumAmount == null || prev?.premiumAmount == null) return undefined;
			const diff = cur.premiumAmount - prev.premiumAmount;
			if (diff === 0) return undefined;
			return {
				label: `premium ${diff > 0 ? '+' : '−'}${Math.abs(diff).toLocaleString()}`,
				tone: diff > 0 ? ('warn' as const) : ('positive' as const),
			};
		},
		[file.rows],
	);

	const renderPolicy = useCallback(
		(policy: InsuranceCardModel, index: number) => {
			// The head of the feed IS the current policy — the only row whose expiry
			// status is meaningful (older rows render the Superseded chip).
			const isCurrent = isNewestRecord(file.rows, policy.id);
			return (
				<InsuranceHistoryCard
					key={policy.id}
					insurance={policy}
					current={isCurrent}
					delta={premiumDelta(index)}
					onEdit={isCurrent ? handleEdit : undefined}
				/>
			);
		},
		[file.rows, handleEdit, premiumDelta],
	);

	// Client-side search over the loaded file rows (the truck's file is read in
	// pages — the bar search narrows what is already read, like the Fluid page).
	const fetchSearch = useCallback(
		async (query: string) => {
			const q = query.toLowerCase();
			return file.rows.filter(
				(policy) =>
					(policy.provider ?? '').toLowerCase().includes(q) ||
					(policy.policyNo ?? '').toLowerCase().includes(q) ||
					(policy.note ?? '').toLowerCase().includes(q),
			);
		},
		[file.rows],
	);

	// The bar search narrows the loaded file rows (the truck's file is paged).
	const search = useBarSearch<InsuranceCardModel>('Search provider / policy no', fetchSearch);

	const brand = routed?.brand ?? identity.data?.brand ?? null;
	const currentLabel = fileCurrent ? (fileCurrent.provider ?? fileCurrent.policyNo ?? 'Policy on file') : 'No policy on file';
	const progress =
		current?.remainingDays != null
			? {
					value: current.remainingDays / 365,
					tone:
						current.status === 'expired' ? 'bg-status-danger' : current.status === 'expiring' ? 'bg-status-warning' : 'bg-status-success',
					caption: `${current.remainingDays} of 365 days`,
				}
			: null;

	if (!identityReady || currentLoading) {
		return (
			<ModuleShell title={title} backTo="/app/insurances">
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
								onClick={() => popBack(navigate, '/app/insurances')}
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
	// and the list toggle swaps in the policy ledger — each press again folds
	// back to the overview (the maintenance-style anatomy).
	return (
		<ModuleShell title={title} backTo="/app/insurances">
			{search.open && search.query ? (
				<SearchResultsList
					query={search.query}
					searching={search.searching}
					results={search.results}
					error={search.error}
					onClear={search.clear}
					compact
					renderItem={(policy) => {
						const isCurrent = isNewestRecord(file.rows, policy.id);
						return (
							<InsuranceHistoryCard key={policy.id} insurance={policy} current={isCurrent} onEdit={isCurrent ? handleEdit : undefined} />
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

							{/* Hero — where the policy stands NOW. */}
							<RecordHero
								identity={plate ?? '—'}
								identitySub={brand}
								headline={currentLabel}
								status={current ? <InsurancePill status={current.status} remainingDays={current.remainingDays} /> : undefined}
								facts={[
									{ label: 'Expires', value: current?.expiryDate ? endDateLabel(current.expiryDate) : '—' },
									{
										label: 'Premium',
										value: fileCurrent?.premiumAmount != null ? `${fileCurrent.premiumAmount.toLocaleString()} Ks` : '—',
									},
								]}
								progress={progress}
								onOpen={fileCurrent ? () => handleEdit(fileCurrent) : undefined}
								ariaLabel="Correct the current policy"
							/>
						</>
					) : (
						<>
							{/* The truck's policy file — the LIST view draws ONLY these cards (no
							   photo, no hero), the same anatomy as the maintenance list. */}
							<LedgerList caption="Policy history" count={`${file.rows.length} polic${file.rows.length === 1 ? 'y' : 'ies'}`}>
								{file.rows.length === 0 ? (
									<li className="px-3.5 py-6 text-center text-xs leading-myanmar text-muted-foreground">
										No policies yet — record the first one with the + button below.
									</li>
								) : (
									file.rows.map((policy, index) => renderPolicy(policy, index))
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
						   native MainButton Save) — the current policy summary + the file's
						   provider labels ride along so its gate + combo cost no read. A
						   still-valid policy keeps that page locked. */}
						<button
							type="button"
							onClick={() => navigate(`/app/insurances/${vehicleId}/renew`, { state: { plate, current, existingProviders } })}
							aria-label="Renew policy"
							className={GLASS_PRIMARY_BUTTON}
						>
							<Plus className="size-5" aria-hidden />
						</button>
						{/* The list toggle — opens the truck's policy file (press again → overview). */}
						<button
							type="button"
							onClick={() => setView({ tab: activeView === 'history' ? 'overview' : 'history' })}
							aria-label="Show the policy history"
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

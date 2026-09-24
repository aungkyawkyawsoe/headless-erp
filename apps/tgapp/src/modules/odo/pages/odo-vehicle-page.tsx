import { useCallback, useMemo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutList, Plus, RefreshCw } from 'lucide-react';

import { OdoReadingRow, odoJumpsOf } from '../components/odo-section';
import { fetchOdoCurrent, fetchOdoFleetIdentity, fetchOdoReadings } from '../data/api';
import { qk } from '../data/query-keys';
import type { OdoBoardModel, OdoListModel, OdoReadingModel } from '../data/types';
import { kmValueLabel } from '@/modules/fleets/data/status';
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
import { useBarSearch } from '@/shared/hooks/use-bar-search';
import { popBack } from '@/shared/platform/history';
import { formatEnglishDayMonth } from '@/shared/time/myanmar';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/** The page's two views — the vehicle OVERVIEW (the current odo card, the
 *  default) and the month's reading HISTORY list. The bottom bar's + opens the
 *  separate RECORD page, its list button opens the ledger; each press again
 *  folds back to the overview. */
type VehicleView = 'overview' | 'history';

/** The view is URL state (`?tab=`), the sibling convention: a reload keeps the
 *  open view and the bar toggle replaces (no stray history entries). The default
 *  is the OVERVIEW (the odo card); the ledger appears only when the bar's list
 *  button opens it. (Old `?tab=record` deep links fall back here — the record
 *  form is its own route now.) */
const VEHICLE_VIEW = enumParam<VehicleView>(['overview', 'history'], 'overview');

/** The vehicle screen's WHOLE URL view state, declared ONCE (key from
 *  `URL_PARAM`). */
const ODO_VEHICLE_VIEW = {
	[URL_PARAM.tab]: VEHICLE_VIEW,
} as const;

/**
 * Daily ODO — ONE vehicle's full-screen odometer page (`/app/daily-odo/:id`,
 * reached by a plate search on the Daily ODO kiosk landing — a single match
 * opens it directly — or by tapping a row on the /browse register). The app bar
 * shows the VEHICLE PLATE (not "Daily ODO") so the page stays identifiable at a
 * glance.
 *
 * Two views, swapped by the bottom bar's list toggle (the same anatomy as the
 * Fluid / licence / insurance vehicle pages):
 *  1. OVERVIEW (default) — the odo card: plate, the current reading (the number
 *     IS the fact) with the last reading's date on its right; tap → correct it.
 *  2. HISTORY (the bar's list toggle) — the current MMT month's readings as a
 *     ledger (each row shows the transition since the previous reading). No card,
 *     matching the other files' list views.
 *
 * The bar's + does NOT open a view — it navigates to the separate RECORD PAGE
 * (`/app/daily-odo/:id/reading/new`), a full-page create form whose save is the
 * native Telegram MainButton (see `odo-reading-create-page.tsx`).
 *
 * Instant first paint: the tapped row arrives through router STATE (plate/brand
 * the header needs), while ONE lean board read supplies the current odo; the
 * month's readings load alongside so the history view + the bar search are ready.
 * Deep links / refreshes carry no state, so those fall back to ONE lean fleet
 * read for the header. Every save (made on the record page) appends a reading to
 * the vehicle's `veh_odo_months` month bucket, then invalidates this page's board
 * AND the month ledger AND the Daily ODO register AND the fleet / fluid lists —
 * the fleet cards' odo-derived care chips refresh the moment the user returns to
 * /app/fleets.
 */
export default function OdoVehiclePage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const location = useLocation();
	const [view, setView] = useViewState(ODO_VEHICLE_VIEW);
	const { tab: activeView } = view;

	// The tapped list row — identity only (plate/brand). Deep links carry none, so
	// a lean fleet read backs those.
	const routed = (location.state as { row?: OdoListModel } | null)?.row ?? null;

	// The vehicle's CURRENT odo + last reading's date — the card's fact.
	const current = useQuery({
		queryKey: qk.board(id ?? ''),
		queryFn: () => fetchOdoCurrent(id as string),
		enabled: id != null && id !== '',
	});

	// Deep-link identity — skipped on the tap path (a routed row backs the page);
	// a deep link falls back to one lean fleet read for the header.
	const fleetIdentity = useQuery({
		queryKey: qk.fleet(id ?? ''),
		queryFn: () => fetchOdoFleetIdentity(id as string),
		enabled: id != null && id !== '' && routed == null,
	});

	// The month's readings — the HISTORY view's ledger AND the bar search's rows,
	// so they load with the page (one lean read) rather than on a separate screen.
	const readingsQuery = useQuery({
		queryKey: qk.history(id ?? ''),
		queryFn: () => fetchOdoReadings(id as string),
		enabled: id != null && id !== '',
	});

	// Identity — known the moment the tapped row (state) lands, or after the
	// deep-link fleet read resolves. The app-bar title depends on it, so a loading
	// id keeps the page in its loading/error shell until ready.
	const identityReady = id != null && id !== '' && (routed != null || (fleetIdentity.data?.plateNo != null && !fleetIdentity.isPending));
	const plateNo = routed?.plateNo ?? fleetIdentity.data?.plateNo ?? '—';
	const brandLabel = routed?.brandLabel ?? fleetIdentity.data?.brandLabel ?? null;
	const title = identityReady ? plateNo : 'Daily ODO';

	// The CORRECTION action — the vehicle's newest reading's own edit screen.
	const handleEdit = useCallback(() => {
		if (id != null && id !== '') navigate(`/app/daily-odo/${id}/reading/edit`);
	}, [navigate, id]);

	// The bottom bar's + opens the RECORD PAGE — a real route, so the form owns
	// the whole screen (no floating bar to crowd it) and its save is the native
	// MainButton.
	const handleRecord = useCallback(() => {
		if (id != null && id !== '') navigate(`/app/daily-odo/${id}/reading/new`);
	}, [navigate, id]);

	// The month ledger — its rows + each reading's km transition. Declared ABOVE
	// the identity guard: a hook must not sit after an early return (Rules of
	// Hooks). The rows feed BOTH the bar search and the history view.
	const rows = useMemo(() => readingsQuery.data?.readings ?? [], [readingsQuery.data]);
	const jumps = useMemo(() => odoJumpsOf(rows), [rows]);
	const readingCountLabel = `${rows.length} reading${rows.length === 1 ? '' : 's'}`;

	// The bar search narrows the loaded month (there is no server-side reading
	// search — the ledger is small).
	const search = useBarSearch<OdoReadingModel>(
		'Search date / note / km',
		useCallback(
			async (query: string) => {
				const q = query.toLowerCase();
				return rows.filter(
					(reading) =>
						(reading.date ?? '').toLowerCase().includes(q) ||
						(reading.note ?? '').toLowerCase().includes(q) ||
						(reading.km != null && String(reading.km).includes(q)),
				);
			},
			[rows],
		),
	);

	if (!identityReady) {
		return (
			<ModuleShell title={title} backTo="/app/daily-odo">
				{routed == null && fleetIdentity.isPending ? (
					<OdoBoardShimmer />
				) : (
					<OdoErrorState onRetry={() => void current.refetch()} onBack={() => popBack(navigate, '/app/daily-odo')} />
				)}
			</ModuleShell>
		);
	}
	// The route param always names the vehicle — narrowed after the guard above
	// proved it is present.
	const vehicleId = id as string;

	// Once identity is known, only the lean current odo gates the body.
	const board: OdoBoardModel | null = current.data
		? {
				id: vehicleId,
				plateNo,
				brandLabel,
				currentOdo: current.data.currentOdo,
				latestOdoDate: current.data.latestOdoDate,
			}
		: null;

	if (board == null) {
		return (
			<ModuleShell title={title} backTo="/app/daily-odo">
				{current.isPending ? (
					<OdoBoardShimmer />
				) : (
					<OdoErrorState onRetry={() => void current.refetch()} onBack={() => popBack(navigate, '/app/daily-odo')} />
				)}
			</ModuleShell>
		);
	}

	// The odo alone is the fact — no label.
	const currentLabel = kmValueLabel(board.currentOdo);

	return (
		<ModuleShell title={title} backTo="/app/daily-odo">
			{search.open && search.query ? (
				<SearchResultsList
					query={search.query}
					searching={search.searching}
					results={search.results}
					error={search.error}
					onClear={search.clear}
					renderItem={(reading) => <OdoReadingRow key={reading.id} reading={reading} jump={jumps.get(reading.id)} />}
				/>
			) : (
				<div className="flex flex-col gap-3">
					{activeView === 'overview' ? (
						/* The current odo as the page's anchor (tap → correct it). */
						<RecordHero
							identity={board.plateNo}
							identitySub={board.brandLabel}
							headline={currentLabel}
							headlineRight={board.latestOdoDate ? formatEnglishDayMonth(board.latestOdoDate) : '—'}
							onOpen={board.currentOdo != null ? handleEdit : undefined}
							ariaLabel="Correct the last reading"
						/>
					) : (
						<>
							{/* The month's readings — the LIST view draws ONLY this ledger (no
							   card), the same anatomy as the maintenance/incident lists. */}
							<LedgerList caption="Daily records" count={readingCountLabel}>
								{rows.length === 0 ? (
									<li className="px-3.5 py-6 text-center text-xs leading-myanmar text-muted-foreground">
										No readings recorded yet this month — log the first one with the + button below.
									</li>
								) : (
									rows.map((reading) => <OdoReadingRow key={reading.id} reading={reading} jump={jumps.get(reading.id)} />)
								)}
							</LedgerList>

							{readingsQuery.isError && rows.length === 0 ? (
								<button
									type="button"
									onClick={() => void readingsQuery.refetch()}
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
				center={readingsQuery.isPending ? 'Daily ODO' : readingCountLabel}
				panel={search.panel}
				panelOpen={search.open}
				right={
					<div className="flex items-center gap-1.5">
						{/* + opens the RECORD PAGE (a real route — the form's save is the
						    native MainButton there). */}
						<button
							type="button"
							onClick={handleRecord}
							aria-label="Record a reading"
							className={GLASS_PRIMARY_BUTTON}
						>
							<Plus className="size-5" aria-hidden />
						</button>
						{/* The list toggle — opens the month ledger (press again → overview). */}
						<button
							type="button"
							onClick={() => setView({ tab: activeView === 'history' ? 'overview' : 'history' })}
							aria-label="Show the reading history"
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

/** The page's shared error fallback — a Retry back to the list, shown when the
 *  vehicle is missing or its readings could not be loaded. */
function OdoErrorState({ onRetry, onBack }: { onRetry: () => void; onBack: () => void }) {
	return (
		<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
			<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this vehicle's odometer.</p>
			<div className="flex items-center gap-2">
				<button
					type="button"
					onClick={onRetry}
					className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
				>
					<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
					Retry
				</button>
				<button
					type="button"
					onClick={onBack}
					className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
				>
					Back to list
				</button>
			</div>
		</div>
	);
}

/** The board's loading shimmer — one section card while the board loads. */
function OdoBoardShimmer() {
	return (
		<div aria-hidden className="flex flex-col gap-3">
			<div className={`${CARD_FRAME} p-3 shadow-card`}>
				<Shimmer className="h-4 w-1/3 rounded" />
				<Shimmer className="mt-2.5 h-6 w-1/2 rounded" />
				<Shimmer className="mt-2 h-3 w-3/4 rounded" />
			</div>
		</div>
	);
}

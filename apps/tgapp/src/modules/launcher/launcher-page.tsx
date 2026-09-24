import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';

import { getAppById, APPS, PINNED_APP_IDS, type AppDefinition } from './registry';
import { AppHeader } from '@/shared/components/app-header';
import { SpinnerGlyph } from '@/shared/components/page-spinner';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';
import { isTelegramApp, tg } from '@/shared/platform/telegram';
import { AppTile } from './app-icon';
import { createOpenGuard } from './open-guard';
import { prefetchApp, prefetchAppsOnIdle, stopIdleWarm } from './prefetch';
import { isAppAllowed } from '@/shared/app-access';
import { fetchMe, getCachedMe, subscribeMe, type MeUser } from '@/shared/auth';
import { URL_PARAM, pageParam, useViewState } from '@/shared/url-state';

const APPS_PER_PAGE = 16;

/**
 * The board mounts LAZILY and only when its page is actually on screen — the
 * module pulls the widgets data layer (the fleet pointers + the bounded to-do
 * feed), so an idle launcher on page 1 must never pay for it.
 */
const WidgetsBoard = lazy(() => import('@/modules/widgets/components/widgets-board'));

/**
 * How long a pending open may lock the launcher before we give up and re-enable
 * the grid. Router navigation is a transition that commits as soon as the lazy
 * chunk lands, so the lock normally lives for a frame — this only covers a
 * stalled/failed chunk so the home screen can never be bricked.
 */
const OPEN_TIMEOUT_MS = 10_000;

// Stable empty list so `browsable` keeps a constant identity while identity loads.
const EMPTY_APPS: AppDefinition[] = [];

/** The launcher's URL view state — the paged-grid index (the only state the
 *  screen owns; there is no search here any more). */
const LAUNCHER_VIEW = {
	[URL_PARAM.page]: pageParam,
} as const;

/**
 * The launcher grid, filtered to what this session's role may open (Design-B
 * role→app access).
 *
 * `/auth/me apps` is the DB `_roles.app_access` allow-list for the session's
 * role — the mini-app never keeps its own role→app table (single source of
 * truth: the `_roles` row). Semantics:
 *
 *   - admin, or `apps` null/absent (uncurated role)   → every tile
 *   - `apps` = a list                                  → only those registry ids
 *
 * The `needs` collections on each tile stay as documentation of what each app
 * reads; they are not the gate under Design-B but remain a safe fallback when a
 * pre-migration API omits `apps` (missing ⇒ show all, never lock a user out).
 */
export function allowedApps(me: MeUser): AppDefinition[] {
	return APPS.filter((app) => isAppAllowed(me, app.id));
}

function chunk<T>(items: T[], size: number): T[][] {
	const pages: T[][] = [];
	for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
	return pages;
}

const pill =
	'flex items-center rounded-full border border-input bg-secondary/95 px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * App launcher — the phone-style home screen.
 *
 * Layout (top → bottom): header, then the paged 4-column app grid (swipe or tap
 * the dots) with the WIDGETS BOARD as its trailing page. Every tile routes to
 * `/app/<path>`. There is deliberately NO search field: the grid is small,
 * role-filtered and swiped in a second — a text filter was one more control to
 * read and one more state to keep true. There is deliberately no bottom DOCK
 * either: the pinned apps (attendance / approval / settings) are ordinary tiles
 * in the grid, so a dock only repeated them and cost the board a band of
 * height on a phone.
 *
 * The header is launch-context aware:
 *  - inside Telegram the native fullscreen chrome already provides the close
 *    button, ⋮ menu and back chevron — rendering our own pills would DUPLICATE
 *    the real controls, so Telegram only gets a centered title;
 *  - a plain browser (dev/external) has no native chrome, so it keeps a Close
 *    pill and the centered MMBIX title.
 *
 * The shell is height-locked (`h-dvh overflow-hidden`): ONLY the grid scrolls —
 * the fixed app bar and the page dots stay pinned on every phone screen.
 */
export default function LauncherPage() {
	const navigate = useNavigate();
	const inTelegram = isTelegramApp();
	// URL-driven page index (`/app?page=N`): the launcher unmounts while an app is
	// open, so component state would reset to page 0 on back — the query param
	// survives the round-trip (nuqs `replace` history: dot taps add no entries).
	const [view, setView] = useViewState(LAUNCHER_VIEW);
	const { page } = view;
	// The apps this session may open. AuthGate validates the session server-side
	// BEFORE any route mounts, so the memoized `/auth/me` is already available —
	// seed the FIRST paint with the real tiles instead of a spinner that only
	// clears a tick later. (`null` is the defensive case: no memoized identity,
	// e.g. a gate that rendered without one.) A fetch failure degrades to ALL apps
	// so a transient `/auth/me` hiccup never hides a legitimate user's board.
	const [visible, setVisible] = useState<AppDefinition[] | null>(() => {
		const cached = getCachedMe();
		return cached ? allowedApps(cached) : null;
	});
	useEffect(() => {
		// Seeded from the auth memo — nothing left to fetch.
		if (visible !== null) return;
		let alive = true;
		fetchMe()
			.then((me) => alive && setVisible(allowedApps(me)))
			.catch(() => alive && setVisible(APPS));
		return () => {
			alive = false;
		};
	}, [visible]);
	// Re-derive the tiles whenever the session identity lands afresh — the
	// AuthGate re-reads `/auth/me` on resume, so a role changed in the employee
	// directory (e.g. promoted to Administrator) repaints the gallery WITHOUT a
	// reload. It listens to the memo only — no extra request.
	useEffect(() => subscribeMe((me) => setVisible(allowedApps(me))), []);
	// URL-driven paged-grid index (`/app?page=N`): the launcher unmounts while an
	// app is open, so component state would reset to page 0 on back — the query
	// param survives the round-trip (nuqs `replace` history: dot taps don't add
	// back-stack entries).
	const pagesRef = useRef<HTMLDivElement>(null);

	const browsable = useMemo(() => visible ?? EMPTY_APPS, [visible]);
	const pages = useMemo(() => chunk(browsable, APPS_PER_PAGE), [browsable]);
	// The widgets board rides AFTER the app-grid pages as the gallery's LAST
	// swipe page (iOS-style home). Its own lazy module decides visibility +
	// fetches, so an idle launcher never pays for it; the page itself carries no
	// search bar — a full-height iOS home.
	const WIDGETS_PAGE_OFFSET = 1;
	const totalPages = pages.length + WIDGETS_PAGE_OFFSET;
	const safePage = Math.min(page, totalPages - 1);
	const onWidgetsPage = safePage >= pages.length;
	// Nudge the scroll container to the URL/page state once the role-filtered
	// grid first resolves (pages.length transitions 0→N on mount). The guard ref
	// keeps the swipe/dot state in charge afterwards — user scrolls are never
	// clobbered by a re-run.
	const offsetOnce = useRef(false);
	useEffect(() => {
		if (!offsetOnce.current && pages.length > 0 && pagesRef.current) {
			offsetOnce.current = true;
			pagesRef.current.scrollTo({ left: safePage * pagesRef.current.clientWidth });
		}
	}, [pages.length, safePage]);

	// The pinned destinations this session may actually open. Nothing renders them
	// any more (the dock is gone) — the list exists ONLY to warm them below.
	const pinnedApps = useMemo(() => {
		const allowed = new Set(browsable.map((a) => a.id));
		return PINNED_APP_IDS.map(getAppById)
			.filter((app): app is AppDefinition => Boolean(app))
			.filter((app) => allowed.has(app.id))
			.filter((app, idx, arr) => arr.findIndex((a) => a.id === app.id) === idx);
	}, [browsable]);

	// Warm the most likely next destinations as soon as the home screen paints —
	// their lazy ROUTE CHUNKS only (see prefetch.ts). Gated on `pinnedApps` so a
	// role that cannot open an app never fetches it; `prefetchApp` is idempotent,
	// so the re-runs this array dep causes are free.
	useEffect(() => {
		for (const app of pinnedApps) prefetchApp(app.id);
	}, [pinnedApps]);

	// Warm the app chunks through the slow sequential queue — the tiles on the
	// CURRENT page first (so the very next tap needs no fetch), then the rest of
	// the board, so even a swipe-then-tap lands on a warm chunk. The queue runs one
	// idle frame at a time and is stopped the moment the launcher unmounts, so a
	// slow link's bandwidth is never taken from the screen the user actually wants.
	const warmedOnce = useRef(false);
	useEffect(() => {
		if (warmedOnce.current || browsable.length === 0) return;
		warmedOnce.current = true;
		// Only the page ON SCREEN plus the NEXT one — queuing all 21 chunks raced the
		// launcher's own critical reads on a slow link for screens the user may never
		// open. The `pointerdown` warm still covers a tap that beats the idle queue.
		const current = (pages[safePage] ?? []).map((app) => app.id);
		const next = (pages[safePage + 1] ?? []).map((app) => app.id);
		prefetchAppsOnIdle([...current, ...next]);
	}, [browsable, pages, safePage]);

	// Leaving the launcher (an app opened) must STOP the speculative warming —
	// otherwise the destination's own reads compete with chunk downloads for a slow
	// connection's bandwidth exactly when they matter most. The launcher unmounts
	// on commit, so this runs when the user actually lands somewhere.
	useEffect(() => stopIdleWarm, []);

	// Warm the widgets-board CHUNK (code only) while the launcher idles: swiping to
	// that page used to start the download at the swipe, so the board appeared a
	// beat late. The chunk is small and the DATA stays gated on `onWidgetsPage`.
	useEffect(() => {
		const timer = setTimeout(() => {
			void import('@/modules/widgets/components/widgets-board').catch(() => {});
		}, 400);
		return () => clearTimeout(timer);
	}, []);

	// One-open-at-a-time: a synchronous lock (the `guard`) plus the `openingId`
	// it mirrors for rendering. Without it a second tile tap lands while the
	// first navigation is still a pending transition — and wins.
	const [guard] = useState(createOpenGuard);
	const [openingId, setOpeningId] = useState<string | null>(null);

	const open = useCallback(
		(app: AppDefinition) => {
			if (!guard.begin(app.id)) return;
			// Feedback must be on screen BEFORE the (possibly slow) chunk lands, or the
			// tap reads as ignored and invites the second tap the guard then swallows.
			setOpeningId(app.id);
			hapticImpact('light');
			navigate(`/app/${app.path}`);
		},
		[guard, navigate],
	);

	// The launcher instance (and its guard) is discarded when the destination
	// commits, so the lock normally clears itself; this only unsticks a failed or
	// abandoned chunk.
	useEffect(() => {
		if (openingId === null) return;
		const timer = setTimeout(() => {
			guard.release();
			setOpeningId(null);
		}, OPEN_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [openingId, guard]);

	const handleScroll = () => {
		const el = pagesRef.current;
		if (!el) return;
		const next = Math.round(el.scrollLeft / el.clientWidth);
		setView({ page: Math.max(0, Math.min(totalPages - 1, next)) });
	};

	const goToPage = (index: number) => {
		hapticSelection();
		setView({ page: index });
		const el = pagesRef.current;
		el?.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
	};

	const closeApp = () => {
		hapticImpact('soft');
		tg.close();
	};

	return (
		// Height-locked shell: only the grid scrolls — the app bar and the page dots
		// stay pinned while scrolling, on every phone screen. `pb-safe` keeps the
		// bottom-most row clear of the phone's home indicator, which the dock used
		// to carry before it was removed.
		<div className="launcher-bg flex h-dvh flex-col overflow-hidden">
			<div className="mx-auto flex w-full max-w-md flex-1 flex-col pb-safe">
				{/* Fixed app bar — centered title ("MMBIX" = launcher default).
				 *    Browser: a Close pill; Telegram's native chrome owns the
				 *    controls, so Telegram gets the title only. */}
				<AppHeader
					title="MMBIX"
					left={
						inTelegram ? undefined : (
							<button type="button" onClick={closeApp} className={pill}>
								<X className="size-4 mr-px" aria-hidden />
								<span className="leading-none">Close</span>
							</button>
						)
					}
				/>

				{/* Role-filtered grid. While identity resolves keep a stable spinner; once
				    known, show the paged grid with the widgets board as its LAST swipe page
				    (dots only when there is more than one page), or a short "no apps assigned
				    to this role" note instead of an empty void. */}
				{visible === null ? (
					<main className="flex flex-1 items-center justify-center">
						<SpinnerGlyph className="size-7" />
					</main>
				) : pages.length === 0 ? (
					<main className="flex flex-1 items-center justify-center px-8">
						<p className="text-center text-sm leading-myanmar text-muted-foreground">
							No apps assigned to your account yet — contact an admin
						</p>
					</main>
				) : (
					<>
						{/* Paged grid — horizontal scroll-snap, one page at a time, the widgets
						    board as the trailing page. */}
						<main
							ref={pagesRef}
							onScroll={handleScroll}
							className="no-scrollbar flex flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-auto"
						>
							{/* Each page is exactly the scrollport width (no container padding), so a
							 * snapped page fully covers the viewport and neighboring pages' apps
							 * stay off-screen — no edges peeking in while swiping. */}
							{pages.map((pageApps, index) => (
							<section key={pageApps[0]?.id ?? index} className="w-full shrink-0 snap-start px-4">
								<div className="grid grid-cols-4 gap-x-1 gap-y-10 pt-10">
										{pageApps.map((app) => (
											<AppTile key={app.id} app={app} onOpen={() => open(app)} busy={openingId === app.id} locked={openingId !== null} />
										))}
									</div>
								</section>
							))}
							{/* The board MOUNTS ONLY when its page is actually on screen. Rendering
							    it unconditionally started its chunk download AND its 4–5 reads
							    (fleet pointer batch + up to 3 approval feeds + my-tasks) on the
							    app's FIRST screen, competing with the one read the launcher needs
							    (`/auth/me`) — the doc above claimed this gate existed but it did
							    not. The empty section is kept so the snap geometry is unchanged. */}
							<section key="widgets" className="w-full shrink-0 snap-start px-4">
								{onWidgetsPage ? (
									<Suspense
										fallback={
											<div className="flex h-[70vh] items-center justify-center">
												<SpinnerGlyph className="size-7" />
											</div>
										}
									>
										<WidgetsBoard />
									</Suspense>
								) : null}
							</section>
						</main>

						{/* Page dots (only needed when the gallery spans more than one page)
						    — and never on the widgets page, whose board speaks for itself. */}
						{totalPages > 1 && !onWidgetsPage && (
							// Plain buttons with aria-current — NOT role="tablist"/"tab": the
							// ARIA tab pattern promises a `tabpanel` and arrow-key navigation,
							// which this strip does not implement (semantics without the
							// behaviour misleads a screen reader). Each dot's VISUAL stays
							// 6px but its hit area is a full 44px (Fitts's Law) — the old 6px
							// button was effectively untappable on a phone.
							<nav className="flex items-center justify-center py-1" aria-label="Launcher pages">
								{Array.from({ length: totalPages }, (_, index) => {
									const isWidgets = index >= pages.length;
									return (
										<button
											key={index}
											type="button"
											aria-current={index === safePage ? 'page' : undefined}
											aria-label={isWidgets ? 'Widgets' : `Apps page ${index + 1} of ${pages.length}`}
											onClick={() => goToPage(index)}
											className="flex min-h-11 min-w-11 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<span
												aria-hidden
												className={`block h-1.5 rounded-full transition-all duration-200 ${
													index === safePage ? 'w-5 bg-foreground' : 'w-1.5 bg-foreground/25'
												}`}
											/>
										</button>
									);
								})}
							</nav>
						)}
					</>
				)}
			</div>
		</div>
	);
}

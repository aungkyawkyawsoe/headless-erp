import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Search, SlidersHorizontal, Users, X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { notifySaved } from '@/shared/save-feedback';

import { AttendanceCards } from '../components/attendance-cards';
import { AttendanceHeader } from '../components/attendance-header';
import { AttendanceHistory } from '../components/attendance-history';
import { PunchDialog } from '../components/punch-dialog';
import { TeamRoster } from '../components/team-roster';
import { ModuleShell } from '@/shared/components/module-shell';
import {
	BottomActionBar,
	GLASS_ICON_BUTTON,
	GLASS_ICON_BUTTON_ACTIVE,
	GLASS_ICON_BUTTON_IDLE,
} from '@/shared/components/bottom-action-bar';
import { QuickActions } from '../components/quick-actions';
import { MyTasksSection } from '@/modules/projects/components/my-tasks-section';
import { TASK_STATE_PARAM } from '@/modules/projects/data/meta';
import { useAppAccess } from '@/shared/app-access';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';
import {
	fetchAttendanceSummary,
	fetchEmployeeShifts,
	checkIn as apiCheckIn,
	checkOut as apiCheckOut,
	foldPunchIntoSummary,
} from '../data/api';
import { useActingEmployee } from '../hooks/use-acting-employee';
import { ATTENDANCE_STALE_MS, SUMMARY_DAYS, qk } from '../data/query-keys';
import { latestPunchesToday, latestCheckInPunch, todayWorkDate, formatPunchTime } from '../utils/time';

/**
 * ရုံးတက် — the attendance home (the app's own name stays Burmese).
 *
 *   header   profile card — avatar + name + eid  ·  live MMT clock + date
 *   metrics  Hours Today (+ Tasks Completed when the Projects app is available)
 *   cards    Check-in / Check-out — today's latest punches (--:--), the
 *            recorded direction filled
 *   actions  Early Leave / Leave / Overtime
 *   tasks    the signed-in employee's tasks from the Projects app — shown ONLY
 *            when the session's role may open that app (see `useAppAccess`)
 *   history  Attendance Records (today + the last 2 work days) — the FALLBACK
 *            when the task feed is not shown, never both at once
 *
 * Tapping a punch card opens PunchDialog — a bottom-sheet modal with Google Maps
 * tile layer, the live location, shift selector, and confirm button.
 * Location is requested ONLY when the dialog mounts, not on page load.
 */

// The summary window (`SUMMARY_DAYS`, shared with the launcher prefetch) covers
// the history list plus margin for the 4 AM work-day boundary. The card/"today"
// logic itself only ever reads the current day.

/** The dashboard's two scopes — my own card/history, or the team lookup. */
type AttendanceScope = 'mine' | 'team';

const SCOPES: AttendanceScope[] = ['mine', 'team'];

const SCOPE_META: Record<AttendanceScope, { label: string; hint: string }> = {
	mine: { label: 'My Attendance', hint: 'ကိုယ်တိုင် — your own punches' },
	team: { label: 'Team Tracking', hint: 'အဖွဲ့ — your reports’ attendance' },
};

/** The dashboard's whole URL view state — the task state filter (absent ⇒ All)
 *  and the scope (absent ⇒ My Attendance). */
const ATTENDANCE_VIEW = {
	[URL_PARAM.status]: TASK_STATE_PARAM,
	[URL_PARAM.scope]: enumParam<AttendanceScope>(SCOPES, 'mine'),
} as const;

export default function AttendancePage() {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [dialogType, setDialogType] = useState<'check-in' | 'check-out' | null>(null);
	const [view, setView] = useViewState(ATTENDANCE_VIEW);
	const scope = view.scope;
	// The scope switch sheet (bottom bar filter → My Attendance / Team Tracking).
	const [scopeOpen, setScopeOpen] = useState(false);
	// The Team scope's bottom-bar search — filters the roster CLIENT-side (the
	// list is small and already loaded), so a keystroke never hits the network.
	const [teamSearchOpen, setTeamSearchOpen] = useState(false);
	const [teamQuery, setTeamQuery] = useState('');
	const teamSearchRef = useRef<HTMLInputElement>(null);
	// Leaving Team drops its search so returning shows the whole roster again.
	useEffect(() => {
		if (scope === 'team') return;
		setTeamSearchOpen(false);
		setTeamQuery('');
	}, [scope]);
	useEffect(() => {
		if (!teamSearchOpen) return;
		teamSearchRef.current?.focus({ preventScroll: true });
	}, [teamSearchOpen]);
	// The 4 AM-boundary work date, re-evaluated every 30s so the cards auto-reset
	// to --:-- at 04:00 MMT without a manual refresh (setState bails on no-op).
	const [workDate, setWorkDate] = useState(todayWorkDate);
	useEffect(() => {
		const id = setInterval(() => {
			setWorkDate(todayWorkDate());
		}, 30_000);
		return () => clearInterval(id);
	}, []);

	// Design-B app access — gates the whole Projects task section (and its metric)
	// on the role's `_roles.app_access` allow-list; a denied role sees the plain
	// attendance workspace only.
	const appAccess = useAppAccess();
	const showTasks = appAccess.resolved && appAccess.canOpen('projects');

	// Who the session acts as — the header's name/eid/photo, the summary's scope and
	// the punch sheet's shifts all read this ONE answer. Resolution order and the
	// reason for it live in the hook (the reported bug: keying identity on the
	// Telegram id left every WEB sign-in unnamed). Deferred while the Team scope is
	// showing — the header/summary are not rendered there, so reading them is waste.
	const identity = useActingEmployee(scope === 'mine');
	// The acting employee's uuid — already fetched for the header above, so it is
	// threaded into the summary fetcher (which used to re-resolve
	// identity with its own extra /auth/me + employees?fields=id round-trips)
	// AND into the tasks feed below, which used to re-resolve it the same way.
	// `/auth/me` carries the directory row's id, so on a normal reload the id is
	// known SYNCHRONOUSLY (the AuthGate's boot populated the memo) and the summary
	// starts immediately, in PARALLEL with the header's employee read — instead of
	// waiting a full round trip for it.
	const employeeId = identity.employeeId;
	// The signed-in employee's tasks — shown only when the role may open Projects.
	// The punch records (+ approved leaves ONLY when the history list will actually
	// read them — see `ATTENDANCE_VIEW` below): punches invalidate this key after
	// every confirm, so a short stale window only guards against needless
	// refetches on re-mounts. `showTasks` is resolved from the (synchronously
	// cached) session, so it is a STABLE value for the life of the page — the key
	// can carry it without ever churning the cache identity.
	const summary = useQuery({
		queryKey: qk.attendanceSummary(SUMMARY_DAYS, !showTasks),
		queryFn: () => fetchAttendanceSummary(SUMMARY_DAYS, employeeId, undefined, !showTasks),
		enabled: employeeId !== null && scope === 'mine',
		staleTime: ATTENDANCE_STALE_MS,
	});

	// The employee's shift assignments (m2m) — feed the punch dialog's shift
	// selector. Deferred ON PURPOSE: they are only read once a card is tapped
	// and a punch sheet renders, so no shifts API call fires on a plain
	// dashboard visit. Keyed on the EMPLOYEE id, so a web sign-in's sheet offers
	// the same shifts a Telegram one does.
	const dialogOpen = dialogType !== null;
	const shifts = useQuery({
		queryKey: qk.shifts(employeeId ?? ''),
		queryFn: () => fetchEmployeeShifts(employeeId as string),
		enabled: dialogOpen && employeeId !== null,
		staleTime: ATTENDANCE_STALE_MS,
	});

	const { checkIn, checkOut } = useMemo(() => latestPunchesToday(summary.data?.attendance ?? [], workDate), [summary.data, workDate]);

	// Today's check-in punch row — its shift anchors the check-out dialog.
	const checkInPunch = useMemo(() => latestCheckInPunch(summary.data?.attendance ?? [], workDate), [summary.data, workDate]);

	// The shifts the punch dialog may offer: a check-out must continue the shift
	// picked at check-in, so only that shift card is shown. Falls back to the full
	// list when the check-in was shift-less or its shift no longer exists.
	const dialogShifts = useMemo(() => {
		const all = shifts.data ?? null;
		if (dialogType !== 'check-out' || !checkInPunch?.shift_id || !all) return all;
		const locked = all.filter((s) => s.id === checkInPunch.shift_id);
		return locked.length > 0 ? locked : all;
	}, [dialogType, checkInPunch, shifts.data]);

	// Identity resolved above (session employee first, then the tg → `etg_id` hop);
	// the hook reports whether it is still resolving or settled as NOBODY. A DISABLED
	// TanStack query reports `isPending` forever, so the summary's own `isPending`
	// alone would shimmer indefinitely for a session with no linked row — say so
	// instead. `employee_id` from `/auth/me` short-circuits the directory hop, so an
	// early id is NOT "loading" even while the header's row read is in flight.
	const headerLoading = identity.loading;
	const identityLoading = employeeId === null && headerLoading;
	const hasNoEmployee = identity.hasNoEmployee;
	const summaryLoading = identityLoading || (!hasNoEmployee && summary.isPending);

	const handleConfirm = useCallback(
		async (params: { lat: number; lng: number; accuracy: number; shiftId?: string }) => {
			// The punch identity + time are stamped SERVER-side from the signed session
			// (`POST /api/hr/attendances/punch`), so the card read and the stored row can
			// never disagree about WHO or WHEN — only the GPS fix rides in from the device.
			const punch = dialogType === 'check-in' ? await apiCheckIn(params) : await apiCheckOut(params);
			// WRITE-THROUGH the punch the server just stamped — the response carries
			// the row id + TIMESTAMP, so the Check In / Check Out cards paint the
			// time the instant the dialog closes instead of one summary-refetch
			// round trip later (the `--:--` lag). Both summary variants fold.
			if (punch.id && (punch.type === 'check-in' || punch.type === 'check-out')) {
				foldPunchIntoSummary(queryClient, {
					id: punch.id,
					type: punch.type,
					timestamp: punch.timestamp ?? null,
					shift_id: punch.shift_id ?? null,
				});
			}
			// Success toast — the dialog slides away right after, so this is the
			// visible confirmation that the punch was recorded (with its MMT time).
			notifySaved(
				dialogType === 'check-in' ? 'Checked in' : 'Checked out',
				punch.timestamp ? `Recorded at ${formatPunchTime(punch.timestamp)}` : undefined,
			);
			// Invalidate the whole summary PREFIX (not a concrete `attendanceSummary(days)`
			// key — its default `withLeaves:false` never matches the fallback history's
			// `withLeaves:true` variant, which is exactly the "punch needs a reload" bug).
			// Deliberately NOT awaited: the punch is recorded AND already on screen (the
			// fold above), so this background refetch is pure verification — ordering,
			// row ids and the leaves arrive from the server as always.
			void queryClient.invalidateQueries({ queryKey: qk.attendanceSummaryAll() });
		},
		[dialogType, queryClient],
	);

	const openEmployee = useCallback(
		(targetId: string) => {
			hapticImpact('light');
			navigate(`/app/attendance/team/${targetId}`);
		},
		[navigate],
	);

	return (
		<ModuleShell title="ရုံးတက်" subtitle="Enterprise Workspace">
			{scope === 'team' ? (
				/* Team Tracking — the viewer's direct reports, listed directly (the
				   personal dashboard and its reads are deferred while this scope shows). */
				<TeamRoster onPick={(hit) => openEmployee(hit.id)} query={teamQuery} />
			) : (
				<>
					<AttendanceHeader
						className="mb-4"
						name={identity.employee?.name_mm ?? identity.employee?.name_en}
						eid={identity.employee?.eid}
						photoUrl={identity.employee?.photo_url}
						online={Boolean(checkIn) && !checkOut}
						loading={headerLoading}
					/>
					{hasNoEmployee ? (
						<p className={`mb-2 mt-4 ${CARD_FRAME} px-4 py-6 text-center text-sm font-medium leading-myanmar text-muted-foreground`}>
							This account is not linked to an employee record. Please contact HR.
						</p>
					) : (
						<>
							<AttendanceCards
								checkIn={checkIn}
								checkOut={checkOut}
								loading={summaryLoading}
								onCheckInClick={() => setDialogType('check-in')}
								onCheckOutClick={() => setDialogType('check-out')}
							/>
							{/* A real summary failure (not the HR-module-missing case) — say so
								instead of silently reading as "no punches yet". Clears on recovery. */}
							{summary.isError && (
								<p className="mt-2 text-center text-xs font-medium leading-myanmar text-destructive">
									Could not load your records. Check your connection and try again.
								</p>
							)}
							{/* Status-driven: an early-leave request needs a check-in on the
							 *  books, so that pill is disabled without one. Leave and overtime
							 *  are ALWAYS available — the OT form carries its own date (any day,
							 *  not only a completed one), so gating it on today's check-out
							 *  blocked a legitimate filing. */}
							<div className="mt-3">
								<QuickActions disabled={{ early: !checkIn }} />
							</div>

							{/* Projects tasks — gated on the session's app access (see showTasks).
							 *  The task feed REPLACES the attendance history while it is shown: the
							 *  dashboard leads with today's work, and the punch log returns only when
							 *  the session has no Projects access. */}
							{showTasks ? (
								<MyTasksSection status={view.status} onStatusChange={(status) => setView({ status })} employeeId={employeeId} />
							) : (
								/* Attendance Records — today + the last 3 work days, from the same summary. */
								<AttendanceHistory
									punches={summary.data?.attendance ?? []}
									leaves={summary.data?.leaves ?? []}
									workDate={workDate}
									loading={summaryLoading}
								/>
							)}
						</>
					)}
				</>
			)}

			{/* Room for the fixed bottom bar when the page is fully scrolled. */}
			<div className="h-24" aria-hidden />

			{/* Punch dialog — only rendered when a card is tapped (location requested on mount) */}
			{scope === 'mine' && dialogType && (
				<PunchDialog
					type={dialogType}
					shifts={dialogShifts}
					shiftsLoading={shifts.isPending}
					shiftsError={shifts.isError}
					onConfirm={handleConfirm}
					onClose={() => setDialogType(null)}
				/>
			)}

			{/* The fixed bottom bar — the scope switch (filter), the scope's label,
			    and a search shortcut into Team Tracking. */}
			<BottomActionBar
				left={
					<button
						type="button"
						aria-label="Scope"
						onClick={() => {
							hapticImpact('light');
							setScopeOpen(true);
						}}
						className={`${GLASS_ICON_BUTTON} ${scope !== 'mine' ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
					>
						<SlidersHorizontal className="size-5" aria-hidden />
						{scope !== 'mine' && <span className="absolute right-px top-px size-2 rounded-full bg-primary" aria-hidden />}
					</button>
				}
				center={SCOPE_META[scope].label}
				right={
					scope === 'team' ? (
						<button
							type="button"
							aria-label={teamSearchOpen ? 'Close search' : 'Search team'}
							onClick={() => {
								hapticImpact('light');
								if (teamSearchOpen) {
									setTeamQuery('');
									setTeamSearchOpen(false);
								} else {
									setTeamSearchOpen(true);
								}
							}}
							className={`${GLASS_ICON_BUTTON} ${teamSearchOpen ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
						>
							{teamSearchOpen ? <X className="size-5" aria-hidden /> : <Search className="size-5" aria-hidden />}
						</button>
					) : (
						<button
							type="button"
							aria-label="Team tracking"
							onClick={() => {
								hapticImpact('light');
								setView({ scope: 'team' });
							}}
							className={`${GLASS_ICON_BUTTON} ${GLASS_ICON_BUTTON_IDLE}`}
						>
							<Users className="size-5" aria-hidden />
						</button>
					)
				}
				panel={
					scope === 'team' ? (
						<div className="flex w-full items-center gap-2">
							<div className="relative min-w-0 flex-1">
								<Search
									className="pointer-events-none absolute left-4 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
									aria-hidden
								/>
								<input
									ref={teamSearchRef}
									type="search"
									value={teamQuery}
									onChange={(event) => setTeamQuery(event.target.value)}
									placeholder="Search your team"
									className="h-11 w-full rounded-full border border-border/60 bg-white/90 pl-11 pr-4 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring/60 dark:border-white/15 dark:bg-card/95"
								/>
							</div>
							<button
								type="button"
								onClick={() => {
									setTeamQuery('');
									setTeamSearchOpen(false);
								}}
								aria-label="Close search"
								className={`relative flex size-11 items-center justify-center rounded-full border border-border/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 ${GLASS_ICON_BUTTON_ACTIVE}`}
							>
								<X className="size-5" aria-hidden />
							</button>
						</div>
					) : undefined
				}
				panelOpen={scope === 'team' && teamSearchOpen}
			/>

			{/* Scope sheet — My Attendance / Team Tracking (same pattern as the masters hub). */}
			<Sheet open={scopeOpen} onOpenChange={setScopeOpen}>
				<SheetContent side="bottom">
					<SheetHeader className="pb-0">
						<SheetTitle>Show</SheetTitle>
					</SheetHeader>
					<div className="flex flex-col gap-0.5 px-4 pb-safe pt-2">
						{SCOPES.map((value) => {
							const option = SCOPE_META[value];
							const selected = value === scope;
							return (
								<button
									key={value}
									type="button"
									aria-pressed={selected}
									onClick={() => {
										hapticSelection();
										setView({ scope: value });
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

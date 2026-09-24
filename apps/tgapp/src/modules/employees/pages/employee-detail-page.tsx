import { useQuery } from '@tanstack/react-query';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Boxes, Loader2, Mars, Package, User, Venus } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@mmbix/design-system/avatar';

import { useAppAccess } from '@/shared/app-access';
import { DIRECTORY_STALE_MS, qk } from '../data/query-keys';
import {
	fetchEmployeeProfile,
	shouldShowTaskTabs,
	useEmployeeTaskFacets,
	type EmployeeProfile,
	type EmployeeProjectRow,
	type EmployeeTaskRow,
} from '../data/detail-query';
import { qk as tyreQk } from '@/modules/tyres/data/query-keys';
import { EmployeeStatusDot } from '../components/employee-card';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { FactRow, FactValue } from '@/shared/components/dotted-facts';
import { SegmentedTabs, type SegTabOption } from '@/shared/components/segmented-tabs';
import { Shimmer } from '@/shared/components/skeletons';
import { TASK_PRIORITY_META, TASK_STATE_META } from '@/modules/projects/data/meta';
import type { TaskPriority, TaskState } from '@/modules/projects/data/types';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';
import { popBack } from '@/shared/platform/history';
import { formatEnglishDateLabel, formatShiftRange12h } from '@/shared/time/myanmar';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/**
 * ONE employee's full profile (`/app/employees/:id`) — the directory card's tap
 * target, promoted from a bottom sheet to a real route so the person has a
 * shareable, deep-linkable address and room for their belongings.
 *
 *   header    back · the employee's name · ↻
 *   banner    avatar + status dot · name + gender glyph · eid · role tag · assets chip
 *   tabs      Overview · Tasks · Projects
 *   body      the ACTIVE tab only
 *
 * Belonging assets are NOT a tab — the banner's top-right chip opens the person's
 * full register page, so the belongings read only happens when asked for and the
 * profile keeps one pane per person-scoped view.
 *
 * ONE read paints the page: the profile row. There are no tab counts, so nothing
 * else is fetched until a tab is opened — a profile left on Overview issues
 * exactly ONE request. (The chip's number comes from the holder-register CACHE if
 * that register was opened this session, and stays blank otherwise, never costing
 * a request of its own.) Every tab is URL view state (`?tab=`), so a reload or a
 * shared link restores the exact pane.
 */

/** The profile's panes — the tab strip's contract. Belonging assets is NOT one:
 *  the belongings live behind the banner's assets chip, which opens the full
 *  register page (`/app/employees/:id/assets`) — the same deliberate step out the
 *  truck board's `Inventory` button takes, rather than a pane that only ever
 *  holds one kind of row. */
type ProfileTab = 'overview' | 'tasks' | 'projects';

const PROFILE_TABS: ProfileTab[] = ['overview', 'tasks', 'projects'];

/** `?tab=` — default `overview`, omitted from the URL. */
const PROFILE_TAB_PARAM = enumParam<ProfileTab>(PROFILE_TABS, 'overview');

const PROFILE_VIEW = {
	[URL_PARAM.tab]: PROFILE_TAB_PARAM,
} as const;

/** `YYYY-MM-DD` → "03-Jan-2026" (or null — the fact rows render '—'). */
function dateLabel(value?: string | null): string | null {
	return formatEnglishDateLabel(value ?? null);
}

/** The profile banner's skeleton — the exact banner anatomy, shimmered. */
function BannerShimmer() {
	return (
		<div className={`flex items-center gap-3.5 ${CARD_FRAME} p-4 shadow-card`} aria-hidden>
			<Shimmer className="size-14 shrink-0 rounded-full" />
			<div className="flex min-w-0 flex-1 flex-col gap-2">
				<Shimmer className="h-5 w-40 rounded" />
				<Shimmer className="h-3 w-20 rounded" />
				<Shimmer className="h-5 w-32 rounded-full" />
			</div>
		</div>
	);
}

/** The profile header card — avatar (+ presence dot), name (+ gender glyph),
 *  eid and the designation pill, with the ASSETS chip top-right.
 *
 *  The chip is a deliberate step OUT to the person's full register rather than a
 *  tab, so the profile keeps ONE pane for the person and the belongings read only
 *  happens when asked for: a soft-primary pill carrying a `Package` glyph and the
 *  held count (no number while unknown — never a false `0`).
 *
 *  Paints from the lite directory row while the full profile resolves, then
 *  re-renders with the relation-backed role. */
function ProfileBanner({
	name,
	eid,
	avatar,
	gender,
	active,
	role,
	assetCount,
	onOpenAssets,
}: {
	name: string;
	eid: string | null;
	avatar: string | null;
	gender: 'male' | 'female' | null;
	active?: boolean | null;
	role: string | null;
	/** Held asset count, or `null` while unknown / never fetched — the chip then
	 *  reads as a plain call-to-action with no number rather than a false `0`. */
	assetCount: number | null;
	onOpenAssets: () => void;
}) {
	return (
		<section className={`flex items-center gap-3.5 ${CARD_FRAME} p-4 shadow-card`}>
			<div className="relative shrink-0">
				<Avatar className="size-14">
					{avatar ? <AvatarImage src={avatar} alt={name} /> : null}
					<AvatarFallback>
						<User className="size-6" strokeWidth={2} aria-hidden />
					</AvatarFallback>
				</Avatar>
				<EmployeeStatusDot active={active} variant="sheet" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<h2 className="truncate text-base font-bold leading-myanmar text-foreground">{name}</h2>
					{gender === 'male' ? (
						<Mars className="size-4.5 shrink-0 text-status-info" strokeWidth={2.2} aria-label="Male" />
					) : gender === 'female' ? (
						<Venus className="size-4.5 shrink-0 text-status-danger" strokeWidth={2.2} aria-label="Female" />
					) : null}
				</div>
				<p className="truncate text-xs font-semibold tabular-nums text-muted-foreground">{eid || '—'}</p>
				{role ? (
					<span className="mt-1.5 inline-block max-w-full truncate rounded-full bg-primary/10 px-2.5 py-1 text-meta font-bold leading-myanmar text-primary">
						{role}
					</span>
				) : null}
			</div>
			<button
				type="button"
				onClick={onOpenAssets}
				aria-label={
					assetCount == null
						? 'Open this person’s assets'
						: `Open this person’s assets — ${assetCount} item${assetCount === 1 ? '' : 's'} in custody`
				}
				className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-primary/10 px-2.5 py-1.5 text-meta font-bold whitespace-nowrap text-primary transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			>
				<Package className="size-3.5" aria-hidden />
				<span className="sr-only">Assets</span>
				{assetCount != null ? (
					<span className="rounded-full bg-card px-1.5 py-0.5 text-[10px] leading-none font-extrabold tabular-nums shadow-sm">
						{assetCount}
					</span>
				) : null}
			</button>
		</section>
	);
}

/** A generic "could not load" panel with a retry — used by every tab body. */
function LoadError({ label, onRetry, busy }: { label: string; onRetry: () => void; busy: boolean }) {
	return (
		<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-10 text-center">
			<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load {label}.</p>
			<button
				type="button"
				onClick={onRetry}
				className="flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
			>
				{busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
				Try again
			</button>
		</div>
	);
}

/** Two stacked card-shaped shimmer rows — the tab bodies' loading state. */
function TabRowsShimmer({ count = 2 }: { count?: number }) {
	return (
		<div className="flex flex-col gap-2.5" aria-hidden>
			{Array.from({ length: count }, (_, i) => (
				<div key={i} className={`${CARD_FRAME} p-4 shadow-card`}>
					<Shimmer className="h-4 w-1/2 rounded" />
					<Shimmer className="mt-2.5 h-3 w-1/3 rounded" />
				</div>
			))}
		</div>
	);
}

/* ── Overview ────────────────────────────────────────────────────────────────
 * The fact card + the shift cards — the sheet's original body, kept verbatim so
 * the screen reads the same whether it is opened as a sheet or a page. */

function OverviewTab({ profile }: { profile: EmployeeProfile }) {
	const shifts = profile.shifts.filter((shift) => shift.name || shift.timeIn);
	return (
		<div className="flex flex-col gap-3">
			<div className={`flex flex-col ${CARD_FRAME} px-3.5 py-2 shadow-card`}>
				<FactRow label="Department">
					<FactValue>{profile.departmentName || '—'}</FactValue>
				</FactRow>
				<FactRow label="Position">
					<FactValue>{profile.designationName || '—'}</FactValue>
				</FactRow>
				<FactRow label="Start Date">
					<FactValue>{dateLabel(profile.doj) ?? '—'}</FactValue>
				</FactRow>
				<FactRow label="Date of Birth">
					<FactValue>{dateLabel(profile.dob) ?? '—'}</FactValue>
				</FactRow>
				<FactRow label="ETG ID">
					<FactValue>{profile.etgId ? <span className="tabular-nums">{profile.etgId}</span> : '—'}</FactValue>
				</FactRow>
			</div>

			{shifts.length > 0 ? (
				<div className="flex flex-col gap-2">
					<span className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">Shift</span>
					{shifts.map((shift) => (
						<div key={shift.id} className={`flex flex-col gap-0.5 ${CARD_FRAME} px-3.5 py-2.5 shadow-card`}>
							<span className="min-w-0 truncate text-sm font-semibold leading-tight text-foreground">{shift.name ?? '—'}</span>
							<span className="text-xs tabular-nums leading-snug text-muted-foreground">
								{formatShiftRange12h(shift.timeIn, shift.workingHours)}
							</span>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

/* ── Tasks ─────────────────────────────────────────────────────────────────── */

function TaskCard({ task, onOpen }: { task: EmployeeTaskRow; onOpen: () => void }) {
	const state = task.state && task.state in TASK_STATE_META ? TASK_STATE_META[task.state as TaskState] : null;
	const priority = task.priority && task.priority in TASK_PRIORITY_META ? TASK_PRIORITY_META[task.priority as TaskPriority] : null;
	const done = task.state === 'done';
	return (
		<button
			type="button"
			onClick={onOpen}
			className={`flex w-full flex-col gap-2 ${CARD_FRAME} p-3.5 text-left shadow-card transition-transform duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
		>
			<span className="flex items-start justify-between gap-2">
				<span
					className={`min-w-0 flex-1 text-sm font-bold leading-myanmar ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
				>
					{task.name}
				</span>
				{state ? (
					<span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${state.chipClass}`}>
						{state.label}
					</span>
				) : null}
			</span>
			<span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta leading-myanmar text-muted-foreground">
				{task.projectName ? <span className="truncate font-semibold">{task.projectName}</span> : null}
				{task.dueDate ? <span>Due {formatEnglishDateLabel(task.dueDate)}</span> : null}
				{priority ? (
					<span className={`rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priority.chipClass}`}>
						{priority.label}
					</span>
				) : null}
			</span>
		</button>
	);
}

function TasksTab({ employeeId }: { employeeId: string }) {
	const navigate = useNavigate();
	// The SHARED scoped read — one server-resolved request answers BOTH task-derived
	// tabs (and caches under one key, so switching tabs never re-reads).
	const query = useEmployeeTaskFacets(employeeId);
	if (query.isPending) return <TabRowsShimmer />;
	if (query.isError) return <LoadError label="tasks" onRetry={() => void query.refetch()} busy={query.isFetching} />;
	const tasks = query.data?.tasks ?? [];
	if (tasks.length === 0) return <EmptyState title="No tasks" hint="Tasks assigned to this person show here." />;
	return (
		<div className="flex flex-col gap-2.5">
			{tasks.map((task) => (
				<TaskCard
					key={task.id}
					task={task}
					onOpen={() => {
						hapticImpact('light');
						navigate(`/app/projects/task/${task.id}`);
					}}
				/>
			))}
		</div>
	);
}

/* ── Projects ──────────────────────────────────────────────────────────────── */

function ProjectCard({ project, onOpen }: { project: EmployeeProjectRow; onOpen: () => void }) {
	const pct = project.total === 0 ? 0 : Math.round((project.done / project.total) * 100);
	return (
		<button
			type="button"
			onClick={onOpen}
			className={`flex w-full flex-col gap-2.5 ${CARD_FRAME} p-4 text-left shadow-card transition-transform duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
		>
			<span className="flex items-center justify-between gap-2">
				<span className="min-w-0 flex-1 truncate text-sm font-bold leading-myanmar text-foreground">{project.name}</span>
				<span className="shrink-0 text-xs font-bold tabular-nums text-muted-foreground">{pct}%</span>
			</span>
			<span className="h-2 w-full overflow-hidden rounded-full bg-muted">
				<span className="block h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${pct}%` }} />
			</span>
			<span className="text-meta leading-myanmar text-muted-foreground">
				{project.done} of {project.total} {project.total === 1 ? 'task' : 'tasks'} done
			</span>
		</button>
	);
}

function ProjectsTab({ employeeId }: { employeeId: string }) {
	const navigate = useNavigate();
	// The SHARED scoped read — one server-resolved request answers BOTH task-derived
	// tabs (and caches under one key, so switching tabs never re-reads).
	const query = useEmployeeTaskFacets(employeeId);
	if (query.isPending) return <TabRowsShimmer />;
	if (query.isError) return <LoadError label="projects" onRetry={() => void query.refetch()} busy={query.isFetching} />;
	const projects = query.data?.projects ?? [];
	if (projects.length === 0) return <EmptyState title="No projects" hint="Projects this person has tasks in show here." />;
	return (
		<div className="flex flex-col gap-2.5">
			{projects.map((project) => (
				<ProjectCard
					key={project.id}
					project={project}
					onOpen={() => {
						hapticSelection();
						navigate(`/app/projects/${project.id}`);
					}}
				/>
			))}
		</div>
	);
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function EmployeeDetailPage() {
	const { id = '' } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [view, setView] = useViewState(PROFILE_VIEW);
	const { tab } = view;

	// The Tasks / Projects tabs read `hrm_tasks`, which only a role with the Projects
	// app access holds a read grant for. Painting the tabs for a role that lacks it
	// used to fire the read anyway and paint a "Could not load" error — so the read
	// itself is gated on the SAME app-access predicate the launcher uses.
	const appAccess = useAppAccess();
	const canSeeProjects = appAccess.canOpen('projects');
	// …AND the tabs are only meaningful for a person who actually HAS tasks: with
	// none there is nothing to show, and painting them anyway produced the other
	// half of the complaint (a tab that opens to an empty / erroring body). The
	// scoped facets read is therefore the tab strip's gate. It fires ONLY when the
	// caller may read tasks, so a role without the grant still issues nothing — the
	// tabs simply stay hidden — and it is the SAME query both tab bodies use, so
	// opening a tab costs no extra request.
	const facets = useEmployeeTaskFacets(id, canSeeProjects);
	const showTaskTabs = shouldShowTaskTabs(canSeeProjects, facets.data);
	// A deep link (or a role change, or a person with no tasks) must never strand a
	// task-derived tab on screen — fall back to Overview.
	const effectiveTab: ProfileTab = tab !== 'overview' && !showTaskTabs ? 'overview' : tab;

	// The lite directory row (if this session already walked the directory) paints
	// the banner instantly; the on-demand profile read then fills in the rest. The
	// directory is NOT fetched here — a deep link pays only for this one row.
	const profileQuery = useQuery({
		queryKey: qk.employee(id),
		queryFn: () => fetchEmployeeProfile(id),
		enabled: Boolean(id),
		staleTime: DIRECTORY_STALE_MS,
	});

	// The tab strip shows NO counts, so a profile opened on Overview issues NOTHING
	// beyond its own row — the task walk is opened by the tab body that needs it.
	//
	// The banner chip's count is read from the SAME holder-register cache the
	// register page fills — via `getQueryData`, NOT a fetch. The profile must never
	// pay for the belongings read just to paint a badge: if this person's register
	// is already cached we show its length, otherwise the chip renders with no
	// number and the tap is what triggers the read.
	const assetCount = useQueryClient().getQueryData<unknown[]>(tyreQk.holderAssetsOfEmployee(id))?.length ?? null;

	const profile = profileQuery.data ?? null;
	const name = profile?.nameMm || profile?.nameEn || '—';

	const tabOptions: SegTabOption<ProfileTab>[] = [
		{ value: 'overview', label: 'Overview' },
		...(showTaskTabs
			? [
					{ value: 'tasks' as const, label: 'Tasks' },
					{ value: 'projects' as const, label: 'Projects' },
				]
			: []),
	];

	return (
		<ModuleShell title={name === '—' ? 'Employee' : name} backTo="/app/employees">
			<div className="flex flex-1 flex-col gap-3.5">
				{profileQuery.isPending ? (
					<BannerShimmer />
				) : profileQuery.isError ? (
					<LoadError label="this profile" onRetry={() => void profileQuery.refetch()} busy={profileQuery.isFetching} />
				) : !profile ? (
					<div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-12 text-center">
						<Boxes className="size-7 text-muted-foreground" aria-hidden />
						<p className="text-sm font-semibold leading-myanmar text-foreground">Employee not found</p>
						<p className="text-xs leading-myanmar text-muted-foreground">This record may have been removed or merged.</p>
						<button
							type="button"
							onClick={() => popBack(navigate, '/app/employees')}
							className="rounded-full bg-primary px-4 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							Back to directory
						</button>
					</div>
				) : (
					<>
						<ProfileBanner
							name={name}
							eid={profile.eid}
							avatar={profile.avatar}
							gender={profile.gender}
							active={profile.active}
							role={profile.designationName}
							assetCount={assetCount}
							onOpenAssets={() => {
								hapticSelection();
								navigate(`/app/employees/${profile.id}/assets`);
							}}
						/>

						<SegmentedTabs<ProfileTab>
							options={tabOptions}
							value={effectiveTab}
							onChange={(next) => setView({ tab: next })}
							ariaLabel="Employee profile sections"
							scrollable
						/>

						{effectiveTab === 'overview' ? <OverviewTab profile={profile} /> : null}
						{effectiveTab === 'tasks' ? <TasksTab employeeId={profile.id} /> : null}
						{effectiveTab === 'projects' ? <ProjectsTab employeeId={profile.id} /> : null}
					</>
				)}
			</div>
		</ModuleShell>
	);
}

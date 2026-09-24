import { useMemo, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Droplets, IdCard, LoaderCircle, ShieldCheck, type LucideIcon } from 'lucide-react';

import { EmptyState } from '@/shared/components/empty-state';
import { PageError } from '@/shared/components/page-error';
import { getCachedMe } from '@/shared/auth';
import { hapticSelection } from '@/shared/platform/haptics';
import { fetchWidgetFleet, fetchWidgetTasks, grantsOf, widgetsKeys } from '../data/api';
import { buildWidgetsModel, type WidgetIcon, type WidgetTone, type TodoRow } from '../data/model';
import { SURFACES, innerTile, type WidgetSurface } from './surface';

/**
 * The **widgets** board — the app gallery's last page, an iOS-style home for the
 * login user's OWN dashboards. A home screen is NOT one repeating card: iOS
 * mixes near-black, paper-white and accent-tinted widgets, so each widget here
 * gets its own SURFACE (`surface.ts`), and the surfaces are theme-correct — ink
 * stays ink in light mode, paper stays paper in dark, sky/glass follow the theme.
 *
 * Reads: the fleet pointer batch, the server-scoped pending approval feeds and
 * the BOUNDED to-do feed (`my-tasks?limit=`). Each is its own query, so a widget
 * paints as ITS data lands instead of waiting for the slowest read.
 *
 * The queue is the user's own TASKS from Projects — a to-do list (open work,
 * most urgent first), not a mixed feed of care/renewal rows. Visibility is the
 * API's own RBAC mirrored by `grantsOf`; an ungranted widget neither renders nor
 * fetches. Icons are lucide components (never emoji).
 */

// iOS system tones, one set per surface family (contrast, not decoration).
//
// `neutral` is the "nothing wrong here" tone the Ops grid uses for a ZERO count.
// It is deliberately INK (near-black on a light card, white on a dark one), not
// green: a grid of green zeros reads as four positive signals competing with the
// one red alert, so the alert stops standing out. Ink keeps the pre-attentive
// reading "red = act, plain = fine" — colour is spent only where it means
// something. `ok` is kept for surfaces that want an explicit healthy accent
// (the fleet ring).
const TONE_LIGHT = { alert: '#ff3b30', warn: '#8a6a00', ok: '#34c759', neutral: '#1c1c1e' } as const;
const TONE_INK = { alert: '#ff453a', warn: '#ffd60a', ok: '#30d158', neutral: '#ffffff' } as const;
const TONE_TINT = { alert: '#ffffff', warn: '#ffffff', ok: '#ffffff', neutral: '#ffffff' } as const;

const ICONS: Record<WidgetIcon, LucideIcon> = {
	oil: Droplets,
	license: IdCard,
	insurance: ShieldCheck,
};

const toneSet = (surface: WidgetSurface) => (surface === 'ink' ? TONE_INK : surface === 'tint' ? TONE_TINT : TONE_LIGHT);

/** One badge — its palette follows the surface it sits on (never a fixed pair). */
function Badge({ text, tone, surface }: { text: string; tone: WidgetTone; surface: WidgetSurface }) {
	const palette =
		surface === 'ink'
			? {
					alert: 'bg-[#ff453a]/20 text-[#ff8a80] border-[#ff453a]/30',
					warn: 'bg-[#ffd60a]/20 text-[#ffd60a] border-[#ffd60a]/30',
					ok: 'bg-[#30d158]/20 text-[#30d158] border-[#30d158]/30',
				}[tone]
			: surface === 'tint'
				? 'border-white/40 bg-white/25 text-white'
				: {
						alert: 'bg-[rgba(255,59,48,0.12)] text-[#ff3b30] border-[rgba(255,59,48,0.2)]',
						warn: 'bg-[rgba(255,204,0,0.2)] text-[#8a6a00] border-[rgba(255,204,0,0.3)]',
						ok: 'bg-[rgba(52,199,89,0.15)] text-[#248a3d] border-[rgba(52,199,89,0.25)]',
					}[tone];
	return <span className={`shrink-0 truncate rounded-[14px] border px-[11px] py-[5px] text-meta font-semibold ${palette}`}>{text}</span>;
}

function Skeleton({ label }: { label: string }) {
	const s = SURFACES.glass;
	return (
		<div className={`${s.card} flex items-center gap-2 p-4 text-[12px] font-medium ${s.sub}`}>
			<LoaderCircle className="size-4 animate-spin" aria-hidden />
			{label}
		</div>
	);
}

// ── Medium widget: Fleet & Operations ───────────────────────────────────────

function OpsWidget({
	alerts,
	surface,
	onOpen,
}: {
	alerts: Array<{ key: WidgetIcon; name: string; count: number; tone: WidgetTone }>;
	surface: WidgetSurface;
	onOpen: () => void;
}) {
	const s = SURFACES[surface];
	const tones = toneSet(surface);
	return (
		<button
			type="button"
			onClick={onOpen}
			className={`${s.card} flex flex-col gap-3 p-4 text-left transition-transform duration-150 active:scale-[0.97]`}
		>
			<span className="flex items-center justify-between">
				<span className={`text-[12px] font-semibold uppercase tracking-[0.4px] ${s.title}`}>Fleet &amp; Operations</span>
				<span className="text-[12px] font-medium" style={{ color: surface === 'ink' ? '#0a84ff' : s.accent }}>
					View All
				</span>
			</span>
			<span className="grid grid-cols-3 gap-2">
				{alerts.map((cell) => {
					const Icon = ICONS[cell.key];
					// A problem cell keeps its warning/alert colour; a ZERO cell is ink,
					// never green — see the `neutral` note above.
					const color = cell.count > 0 ? tones[cell.tone] : tones.neutral;
					return (
						<span key={cell.key} className={`flex flex-col items-center gap-1 rounded-[18px] border px-1 py-[10px] ${innerTile(surface)}`}>
							<Icon className="size-[17px]" strokeWidth={2.1} style={{ color }} aria-hidden />
							<span className="text-[17px] font-bold leading-none tabular-nums" style={{ color }}>
								{cell.count}
							</span>
							<span className={`text-[10px] font-semibold leading-none ${s.sub}`}>{cell.name}</span>
						</span>
					);
				})}
			</span>
		</button>
	);
}

// ── Large widget: My Tasks (the to-do list) ─────────────────────────────────

/**
 * The to-do list — the user's open project tasks, most urgent first. Icon-free
 * by design: a 3px tone BAR (the pre-attentive urgency cue) + a wrapping title
 * carry the row, so a long task name is always readable instead of being
 * truncated to make room for a decorative glyph. The due chip rides the meta
 * line under the title.
 */
function TodoWidget({
	todos,
	surface,
	onOpen,
	viewAllTo,
}: {
	todos: TodoRow[];
	surface: WidgetSurface;
	onOpen: (row: TodoRow) => void;
	viewAllTo: string;
}) {
	const s = SURFACES[surface];
	const tones = toneSet(surface);
	const navigate = useNavigate();
	return (
		<section className={`${s.card} p-4`}>
			<div className="flex items-center justify-between">
				<span className={`text-[12px] font-semibold uppercase tracking-[0.4px] ${s.title}`}>
					My Tasks
					<span className="ml-1.5 rounded-full bg-black/5 px-1.5 py-0.5 text-[10px] font-bold tabular-nums dark:bg-white/10">
						{todos.length}
					</span>
				</span>
				<button
					type="button"
					onClick={() => navigate(viewAllTo)}
					className="text-[12px] font-medium"
					style={{ color: surface === 'ink' ? '#0a84ff' : s.accent }}
				>
					View All
				</button>
			</div>
			<ul className="mt-2.5 flex flex-col gap-2">
				{todos.map((row) => (
					<li key={row.key}>
						<button
							type="button"
							onClick={() => onOpen(row)}
							className={`flex w-full items-stretch gap-3 rounded-2xl border px-3 py-2.5 text-left transition-transform duration-150 active:scale-[0.98] ${innerTile(surface)}`}
						>
							{/* The urgency cue: a tone bar, not an icon. */}
							<span className="my-0.5 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: tones[row.tone] }} aria-hidden />
							<span className="min-w-0 flex-1">
								{/* Two lines max — long names stay readable, the row stays a row. */}
								<span className={`line-clamp-2 block text-key font-semibold leading-snug ${s.value}`}>{row.title}</span>
								<span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
									{row.subtitle ? <span className={`truncate text-[12px] font-medium ${s.sub}`}>{row.subtitle}</span> : null}
									{row.badge ? <Badge text={row.badge} tone={row.tone} surface={surface} /> : null}
								</span>
							</span>
							<ChevronRight className={`mt-1 size-4 shrink-0 ${s.sub}`} aria-hidden />
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

// ── Board ───────────────────────────────────────────────────────────────────

/**
 * Surface assignment — the home-screen MIX, deliberately NOT mostly dark:
 *   fleet grid  → `paper` (the white calendar card)
 *   my tasks    → `ink`   (ONE near-black card, the iOS watchlist)
 *   loading/empty → `glass` (theme-aware frosted)
 */
const BOARD_SURFACES = { ops: 'paper', todos: 'ink' } as const satisfies Record<string, WidgetSurface>;

export default function WidgetsBoard() {
	const navigate = useNavigate();
	// The AuthGate's boot already populated /auth/me — identity is a free read.
	const me = getCachedMe();
	const grants = useMemo(() => grantsOf(me), [me]);
	const identity = me?.user_id ?? 'none';
	// Only the widgets that actually RENDER gate visibility/fetch — an ungranted
	// (or removed) widget must never issue a read. The approvals card is gone, so
	// its feed is no longer part of `visible`.
	const visible = grants.fleet || grants.tasks;
	const employeeId = me?.employee_id ?? null;

	// Two INDEPENDENT queries — each widget paints as ITS read lands.
	const fleetQuery = useQuery({
		queryKey: widgetsKeys.fleet(identity),
		queryFn: fetchWidgetFleet,
		enabled: visible && grants.fleet,
		staleTime: 60_000,
	});
	const tasksQuery = useQuery({
		queryKey: widgetsKeys.tasks(identity),
		queryFn: () => fetchWidgetTasks(employeeId),
		enabled: visible && grants.tasks && employeeId !== null,
		staleTime: 60_000,
	});

	// The pure model takes whatever has landed; a missing group contributes an
	// empty set (a widget paints its own truth instead of waiting).
	const model = useMemo(
		() =>
			buildWidgetsModel({
				fleets: fleetQuery.data ?? [],
				tasks: tasksQuery.data ?? [],
			}),
		[fleetQuery.data, tasksQuery.data],
	);

	const onOpen = (row: TodoRow) => {
		hapticSelection();
		navigate(row.to);
	};

	if (!visible) {
		return (
			<BoardBody>
				<EmptyState title="No widgets for your account" hint="Ask an admin to grant the collections a widget reads." />
			</BoardBody>
		);
	}
	// Error only when EVERY query that is actually enabled failed — one healthy
	// widget still renders instead of blanking the board.
	const enabledCount = (grants.fleet ? 1 : 0) + (grants.tasks && employeeId !== null ? 1 : 0);
	const erroredCount = (grants.fleet && fleetQuery.isError ? 1 : 0) + (grants.tasks && employeeId !== null && tasksQuery.isError ? 1 : 0);
	if (enabledCount > 0 && erroredCount === enabledCount) {
		return (
			<BoardBody>
				<PageError
					title="Couldn't load your widgets."
					hint="Check the connection and try again."
					onRetry={() => {
						if (grants.fleet) void fleetQuery.refetch();
						if (grants.tasks && employeeId !== null) void tasksQuery.refetch();
					}}
				/>
			</BoardBody>
		);
	}

	const fleetLoading = grants.fleet && fleetQuery.isPending;
	const tasksLoading = grants.tasks && employeeId !== null && tasksQuery.isPending;
	// When tasks is the ONLY grant, the to-do list IS the board's main card —
	// paper surface, so a single-card board still reads like an iOS widget.
	const todoSurface: WidgetSurface = grants.fleet ? BOARD_SURFACES.todos : 'paper';

	return (
		<BoardBody>
			{grants.fleet ? (
				fleetLoading ? (
					<Skeleton label="Fleet & operations" />
				) : (
					<OpsWidget alerts={model.alerts} surface={BOARD_SURFACES.ops} onOpen={() => navigate('/app/fleets/browse')} />
				)
			) : null}
			{grants.tasks ? (
				tasksLoading ? (
					<Skeleton label="My tasks" />
				) : model.todos.length > 0 ? (
					<TodoWidget todos={model.todos} surface={todoSurface} onOpen={onOpen} viewAllTo="/app/projects" />
				) : null
			) : null}
			{!fleetLoading && !tasksLoading && !grants.fleet && model.todos.length === 0 ? (
				<section className={`${SURFACES.glass.card} p-4`}>
					<EmptyState title="Nothing needs you right now" hint="Your tasks and fleet alerts land here." />
				</section>
			) : null}
		</BoardBody>
	);
}

/** The board's page padding — no title row (the gallery's swipe page needs no
 *  label; the AppHeader already names the app). The outer gallery section
 *  already carries `px-4`, so no horizontal padding here (otherwise the card
 *  sits narrower than the app grid). `pt-10` matches the grid's breathing room
 *  under the header. */
function BoardBody({ children }: { children: ReactNode }) {
	return <div className="flex flex-1 flex-col gap-4 pb-6 pt-10">{children}</div>;
}

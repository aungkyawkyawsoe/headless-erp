import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Clock, type LucideIcon } from 'lucide-react';

import { TASK_PRIORITY_META, TASK_STATE_META, TASK_STATE_TABS } from '../data/meta';
import { PROJECTS_STALE_MS, qk } from '../data/query-keys';
import { fetchMyTasks } from '../data/api';
import type { MyTasksSummary, TaskState, TaskStateFilter } from '../data/types';
import { Shimmer } from '@/shared/components/skeletons';
import { SegmentedTabs } from '@/shared/components/segmented-tabs';
import { hapticImpact } from '@/shared/platform/haptics';
import { formatEnglishDayMonth } from '@/shared/time/myanmar';

/** The state glyph a row leads with — a hollow ring / clock / filled check. */
const STATE_ICON: Record<TaskState, { Icon: LucideIcon; className: string }> = {
	todo: { Icon: Circle, className: 'text-muted-foreground' },
	in_progress: { Icon: Clock, className: 'text-status-info' },
	done: { Icon: CheckCircle2, className: 'text-status-success' },
};

/**
 * The signed-in employee's tasks across every project — the attendance
 * dashboard's "Today's Assigned Tasks" section.
 *
 * Rendered ONLY when the session's role may open the Projects app (the caller
 * owns that gate). It reads `fetchMyTasks` (a whole-set walk — see its doc),
 * which needs the acting employee's id: the caller ALREADY resolved it for its
 * own header, so it is passed in rather than looked up again here. The feed
 * filters client-side by the active state tab, so switching tabs is instant.
 * Tapping a row opens the task's full-screen detail.
 */
export function useMyTasks(enabled = true, employeeId: string | null = null): UseQueryResult<MyTasksSummary> {
	return useQuery({
		queryKey: qk.myTasks(employeeId ?? ''),
		queryFn: () => fetchMyTasks(employeeId),
		enabled: enabled && employeeId !== null,
		staleTime: PROJECTS_STALE_MS,
	});
}

interface MyTasksSectionProps {
	/** The active state filter — the caller owns this URL-backed view state. */
	status: TaskStateFilter;
	onStatusChange: (status: TaskStateFilter) => void;
	/** The acting employee's `hrm_employees` id — resolved by the caller, so the
	 *  feed needs no second employee lookup. `null` until it resolves. */
	employeeId: string | null;
}

export function MyTasksSection({ status, onStatusChange, employeeId }: MyTasksSectionProps) {
	const navigate = useNavigate();
	const query = useMyTasks(true, employeeId);
	const tasks = query.data?.tasks ?? [];
	const visible = status === 'all' ? tasks : tasks.filter((task) => task.state === status);

	const openTask = (id: string) => {
		hapticImpact('light');
		navigate(`/app/projects/task/${id}`);
	};

	return (
		<section className="mt-5">
			<div className="mb-3 flex items-center justify-between">
				<h2 className="text-sm font-semibold leading-myanmar text-foreground">Today&apos;s Assigned Tasks</h2>
				<button
					type="button"
					onClick={() => {
						hapticImpact('light');
						navigate('/app/projects');
					}}
					className="text-xs font-semibold text-primary transition-transform duration-150 active:scale-95"
				>
					View all
				</button>
			</div>

			<SegmentedTabs options={TASK_STATE_TABS} value={status} onChange={onStatusChange} ariaLabel="Task state" />

			{query.isPending ? (
				<div className="mt-3 flex flex-col gap-2.5" aria-hidden>
					{[0, 1].map((i) => (
						<div key={i} className={`flex items-center gap-3 ${CARD_FRAME} p-3.5`}>
							<Shimmer className="size-5 shrink-0 rounded-full" />
							<div className="flex flex-1 flex-col gap-2">
								<Shimmer className="h-3.5 w-3/4 rounded" />
								<Shimmer className="h-3 w-1/3 rounded" />
							</div>
						</div>
					))}
				</div>
			) : query.isError ? (
				<p className={`mt-3 ${CARD_FRAME} px-4 py-6 text-center text-xs font-medium leading-myanmar text-destructive`}>
					Could not load your tasks.
				</p>
			) : visible.length === 0 ? (
				<p className={`mt-3 ${CARD_FRAME} px-4 py-6 text-center text-xs font-medium leading-myanmar text-muted-foreground`}>
					{status === 'all' ? 'No tasks assigned to you.' : 'No tasks in this status.'}
				</p>
			) : (
				<ul className="mt-3 flex flex-col gap-2.5">
					{visible.map((task) => {
						const state = task.state ? TASK_STATE_META[task.state] : null;
						const priority = task.priority ? TASK_PRIORITY_META[task.priority] : null;
						const glyph = task.state ? STATE_ICON[task.state] : null;
						const Glyph = glyph?.Icon ?? Circle;
						const done = task.state === 'done';
						return (
							<li key={task.id}>
								<button
									type="button"
									onClick={() => openTask(task.id)}
									className={`flex w-full items-start gap-3 ${CARD_FRAME} p-3.5 text-left shadow-sm transition-transform duration-150 active:scale-[0.99]`}
								>
									<Glyph className={`mt-0.5 size-5 shrink-0 ${glyph?.className ?? 'text-muted-foreground'}`} aria-hidden />
									<span className="flex min-w-0 flex-1 flex-col gap-1">
										<span className="flex min-w-0 items-center gap-1.5">
											{priority && (
												<span
													className={`inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priority.chipClass}`}
												>
													{priority.label}
												</span>
											)}
											{task.projectName && (
												<span className="truncate text-meta font-semibold text-muted-foreground">{task.projectName}</span>
											)}
										</span>
										<span
											className={`text-sm font-semibold leading-myanmar ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
										>
											{task.name}
										</span>
										{task.dueDate && (
											<span className="text-meta font-medium text-muted-foreground">Due {formatEnglishDayMonth(task.dueDate)}</span>
										)}
									</span>
									{state && (
										<span
											className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${state.chipClass}`}
										>
											<span className={`size-1.5 rounded-full ${state.dotClass}`} />
											{state.label}
										</span>
									)}
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

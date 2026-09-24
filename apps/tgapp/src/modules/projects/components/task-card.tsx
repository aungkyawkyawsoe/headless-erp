import { memo } from 'react';
import { CalendarDays, ChevronRight } from 'lucide-react';

import { TASK_PRIORITY_META, TASK_STATE_META } from '../data/meta';
import type { TaskCardModel } from '../data/types';
import { AssigneeAvatars } from './assignee-avatars';
import { daysFromTodayMmt, formatEnglishDayMonth } from '@/shared/time/myanmar';

/**
 * ONE task row on a project's feed — the priority chip + the `TSK-####` number,
 * the state chip, the title, then the assignee avatars and the due date (red once
 * overdue and not done). Rendered inside the shared `ListPage`'s `<ul>`.
 */
export const TaskCard = memo(function TaskCard({
	task,
	onOpen,
}: {
	task: TaskCardModel;
	/** Receives the task — a stable page handler keeps `memo` effective. */
	onOpen: (task: TaskCardModel) => void;
}) {
	const state = task.state ? TASK_STATE_META[task.state] : null;
	const priority = task.priority ? TASK_PRIORITY_META[task.priority] : null;
	const days = task.dueDate ? daysFromTodayMmt(task.dueDate) : null;
	const overdue = days != null && days < 0 && task.state !== 'done';

	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen(task)}
				className="flex w-full flex-col gap-2.5 rounded-2xl border border-border/70 bg-card p-4 text-left shadow-sm transition-transform duration-150 active:scale-[0.99]"
			>
				<div className="flex items-center justify-between gap-2">
					<div className="flex min-w-0 items-center gap-1.5">
						{priority && (
							<span
								className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${priority.chipClass}`}
							>
								{priority.label}
							</span>
						)}
						{task.number && <span className="truncate text-meta font-semibold text-muted-foreground">{task.number}</span>}
					</div>
					{state && (
						<span
							className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${state.chipClass}`}
						>
							<span className={`size-1.5 rounded-full ${state.dotClass}`} />
							{state.label}
						</span>
					)}
				</div>

				<p className="text-sm font-semibold leading-myanmar text-foreground">{task.name}</p>

				<div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
					<AssigneeAvatars assignees={task.assignees} />
					<span className="flex items-center gap-1">
						{task.dueDate && (
							<span className={`flex items-center gap-1 text-meta font-medium ${overdue ? 'text-status-danger' : 'text-muted-foreground'}`}>
								<CalendarDays className="size-3.5" aria-hidden />
								{formatEnglishDayMonth(task.dueDate)}
							</span>
						)}
						<ChevronRight className="size-4 text-muted-foreground" aria-hidden />
					</span>
				</div>
			</button>
		</li>
	);
});

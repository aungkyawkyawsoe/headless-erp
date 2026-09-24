/**
 * TanStack Query key factory for the Projects module.
 *
 * Every key's FIRST segment is the collection slug it reads
 * (`hrm_projects` / `hrm_tasks` / `hrm_comments`) — that is what makes the SDK's
 * automatic write-through invalidation work: a write through the shared client
 * fires `invalidateCollection(qc, collection)`, which prefix-matches
 * `[collection, …]` (see `packages/sdk-react`). So creating a task refreshes the
 * project feed AND the task detail with no manual invalidation, and posting a
 * comment refreshes the comment list.
 *
 * The records are interactive (the app writes them), so the shared `list` tier
 * (30 s) governs passive revisits — freshness comes from write-through.
 */
import { STALE_MS } from '@/shared/api/invalidation';

import type { TaskStateFilter } from './types';

export const PROJECTS_STALE_MS = STALE_MS.list;

export const qk = {
	/** The project register (cursor-paged list). */
	projects: () => ['hrm_projects', 'list'] as const,
	/** ONE project — the detail header's name/description. */
	project: (id: string) => ['hrm_projects', 'detail', id] as const,
	/** ONE project's task feed, scoped by the active state pill. */
	projectTasks: (projectId: string, state: TaskStateFilter) => ['hrm_tasks', 'project', projectId, state] as const,
	/** ONE task's full detail. */
	task: (id: string) => ['hrm_tasks', 'task', id] as const,
	/** ONE task's comments. */
	comments: (taskId: string) => ['hrm_comments', 'task', taskId] as const,
	/** The signed-in employee's tasks across every project — the attendance
	 *  dashboard's "Today's Assigned Tasks" feed (keyed under `hrm_tasks`, the
	 *  collection that moves, so every task write refreshes it write-through).
	 *  Scoped by the employee's `hrm_employees` id so an account switch (log out →
	 *  another dev identity in the same tab) can never serve the previous user's
	 *  tasks from cache. */
	myTasks: (employeeId: string) => ['hrm_tasks', 'mine', employeeId] as const,
	/** The signed-in employee (comment author). */
	me: () => ['hrm_employees', 'me'] as const,
	/**
	 * The workload dashboard — keyed under `hrm_tasks` (the collection that
	 * actually moves) so every task write/state change refreshes it write-through.
	 * It also reads project NAMES; a project rename reflects on the next task write
	 * or after the 60 s module window, an accepted trade for a single-key read
	 * (a key can only carry one collection prefix).
	 */
	workload: () => ['hrm_tasks', 'workload'] as const,
};

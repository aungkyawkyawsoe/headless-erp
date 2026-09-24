/**
 * Display metadata for the Projects module — the task state/priority tones, the
 * state filter tabs and the shared URL parser. One home so the cards, the detail
 * screen and the create form never drift on wording or colour.
 */
import type { SegTabOption } from '@/shared/components/segmented-tabs';
import { enumParam } from '@/shared/url-state';

import type { TaskPriority, TaskState, TaskStateFilter } from './types';

/** Task state → its chip + dot tone (To Do / In Progress / Done). */
export const TASK_STATE_META: Record<TaskState, { label: string; chipClass: string; dotClass: string }> = {
	todo: { label: 'To Do', chipClass: 'bg-muted/70 text-muted-foreground border-border', dotClass: 'bg-muted-foreground' },
	in_progress: { label: 'In Progress', chipClass: 'bg-status-info-soft text-status-info border-transparent', dotClass: 'bg-status-info' },
	done: { label: 'Done', chipClass: 'bg-status-success-soft text-status-success border-transparent', dotClass: 'bg-status-success' },
};

/** Task priority → its chip tone (Critical / High / Medium / Low). */
export const TASK_PRIORITY_META: Record<TaskPriority, { label: string; chipClass: string }> = {
	critical: { label: 'Critical', chipClass: 'bg-status-danger-soft text-status-danger border-transparent' },
	high: { label: 'High', chipClass: 'bg-status-warning-soft text-status-warning border-transparent' },
	medium: { label: 'Medium', chipClass: 'bg-status-info-soft text-status-info border-transparent' },
	low: { label: 'Low', chipClass: 'bg-muted/70 text-muted-foreground border-border' },
};

/** The state filter pill row on the project screen. `all` is the leading
 *  no-filter pill (every task), so it IS rendered here. */
export const TASK_STATE_TABS: ReadonlyArray<SegTabOption<TaskStateFilter>> = [
	{ value: 'all', label: 'All' },
	{ value: 'todo', label: 'To Do' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'done', label: 'Done' },
];

/** The accepted `?status=` values. */
export const TASK_STATE_VALUES: TaskStateFilter[] = ['all', 'todo', 'in_progress', 'done'];

/** The shared `?status=` parser — default `all`, omitted from the URL. */
export const TASK_STATE_PARAM = enumParam<TaskStateFilter>(TASK_STATE_VALUES, 'all');

/** The form's state options (no `all` — a task always has a real state). */
export const TASK_STATE_FORM_OPTIONS: ReadonlyArray<SegTabOption<TaskState>> = [
	{ value: 'todo', label: 'To Do' },
	{ value: 'in_progress', label: 'In Progress' },
	{ value: 'done', label: 'Done' },
];

/** Every selectable priority, in display order. */
export const TASK_PRIORITIES: ReadonlyArray<TaskPriority> = ['critical', 'high', 'medium', 'low'];

/** A task state's display label (`null` state → an em dash). */
export function taskStateLabel(state: TaskState | null | undefined): string {
	return state ? TASK_STATE_META[state].label : '—';
}

/** A task priority's display label (`null` priority → an em dash). */
export function priorityLabel(priority: TaskPriority | null | undefined): string {
	return priority ? TASK_PRIORITY_META[priority].label : '—';
}

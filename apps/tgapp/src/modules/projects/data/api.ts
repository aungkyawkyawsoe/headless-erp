import type { MmbixClient } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { fetchAllPages } from '@/shared/api/fetch-all';
import { LIST_PAGE_SIZE, LOOKUP_LIMIT, SEARCH_LIMIT } from '@/shared/constants';
import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { daysFromTodayMmt } from '@/shared/time/myanmar';

import type {
	AssigneeInfo,
	AssigneeWorkload,
	CommentModel,
	CommentRow,
	MyTask,
	MyTasksSummary,
	ProjectCardModel,
	ProjectRow,
	ProjectWorkload,
	TaskCardModel,
	TaskDetailModel,
	TaskPriority,
	TaskRow,
	TaskState,
	TaskStateFilter,
	WorkloadSummary,
} from './types';
import { mentionToken, type Mention } from './mentions';

/**
 * Data access for the Projects app — entity CRUD over the three real
 * collections: `hrm_projects` (the register), `hrm_tasks` (a project's tasks)
 * and `hrm_comments` (a task's activity). All reads/writes go through the shared
 * `sdk`, narrowed to this module's row shapes with the same local-cast pattern
 * every other module uses (the app-wide client is typed against the stale
 * placeholder `Schema`).
 *
 * Reads are SELF-CONTAINED: every task read expands its `project` (m2o) and
 * `assignee` (m2m) with dotted `?fields=`, so one request paints a full card —
 * no separate employee directory walk.
 */

type OpsSchema = {
	hrm_projects: ProjectRow;
	hrm_tasks: TaskRow;
	hrm_comments: CommentRow;
} & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** Trimmed non-empty string, else null. */
function str(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The engine stores the priority select as `critical|high|medium|Low`; the
 *  capital `Low` is schema drift, so normalize every read to lowercase. */
const PRIORITY_VALUES = new Set<TaskPriority>(['critical', 'high', 'medium', 'low']);

/** The exact stored value per priority (writes must match the select options). */
const PRIORITY_STORED: Record<TaskPriority, string> = { critical: 'critical', high: 'high', medium: 'medium', low: 'Low' };

function normalizePriority(value: unknown): TaskPriority | null {
	const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
	return PRIORITY_VALUES.has(key as TaskPriority) ? (key as TaskPriority) : null;
}

function normalizeState(value: unknown): TaskState | null {
	return value === 'todo' || value === 'in_progress' || value === 'done' ? value : null;
}

/** A bare m2o relation (string id) or an expanded row → `{ id, name }`. */
function toRef(value: unknown): { id: string | null; name: string | null } {
	if (typeof value === 'string') return { id: value || null, name: null };
	if (value && typeof value === 'object') {
		const row = value as { id?: unknown; name?: unknown };
		return { id: typeof row.id === 'string' ? row.id : null, name: str(row.name) };
	}
	return { id: null, name: null };
}

/** The `assignee` m2m expansion → a stable list of display identities. */
function toAssignees(value: unknown): AssigneeInfo[] {
	if (!Array.isArray(value)) return [];
	return value.reduce<AssigneeInfo[]>((acc, raw) => {
		if (!raw || typeof raw !== 'object') return acc;
		const row = raw as { id?: unknown; name_en?: unknown; name_mm?: unknown; avatar?: unknown };
		const id = typeof row.id === 'string' ? row.id : null;
		if (!id) return acc;
		acc.push({ id, name: str(row.name_en) ?? str(row.name_mm), photo: str(row.avatar) });
		return acc;
	}, []);
}

function toProjectCard(row: ProjectRow): ProjectCardModel {
	return { id: row.id, name: str(row.name) ?? '—', description: str(row.description), number: str(row.display_number) };
}

function toTaskCard(row: TaskRow): TaskCardModel {
	return {
		id: row.id,
		name: str(row.name) ?? '—',
		state: normalizeState(row.state),
		priority: normalizePriority(row.priority),
		dueDate: str(row.due_date),
		assignees: toAssignees(row.assignee),
		number: str(row.display_number),
	};
}

// ── Projects ────────────────────────────────────────────────────────────────

const PROJECT_FIELDS = ['id', 'name', 'description', 'display_number'] as const;

/** The project register — `LIST_PAGE_SIZE` rows per cursor page, name-sorted. */
export async function fetchProjectsPage(cursor?: string): Promise<CursorPage<ProjectCardModel>> {
	const res = await ops.items('hrm_projects').list({ fields: PROJECT_FIELDS, sort: 'name', limit: LIST_PAGE_SIZE, cursor });
	return {
		rows: (res.data as ProjectRow[]).map(toProjectCard),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The register's toolbar search — a server-side `?search=`, capped small. */
export async function fetchProjectsSearch(query: string): Promise<ProjectCardModel[]> {
	const res = await ops.items('hrm_projects').list({ fields: PROJECT_FIELDS, search: query, sort: 'name', limit: SEARCH_LIMIT });
	return (res.data as ProjectRow[]).map(toProjectCard);
}

/** ONE project by id — `null` when the row is gone. */
export async function fetchProject(id: string): Promise<ProjectCardModel | null> {
	const res = await ops.items('hrm_projects').list({ fields: PROJECT_FIELDS, filter: { id: { _eq: id } }, limit: 1 });
	const row = (res.data as ProjectRow[])[0];
	return row ? toProjectCard(row) : null;
}

export interface ProjectInput {
	name: string;
	description: string | null;
}

/** Create one project (the engine assigns its `PRJ-####` number). */
export async function createProject(input: ProjectInput): Promise<ProjectCardModel> {
	const row = await ops
		.items('hrm_projects')
		.create({ name: input.name, description: input.description } as unknown as Partial<ProjectRow>);
	return toProjectCard(row as unknown as ProjectRow);
}

/** Update one project's editable fields (name + description). */
export async function updateProject(id: string, input: ProjectInput): Promise<void> {
	await ops.items('hrm_projects').update(id, { name: input.name, description: input.description } as unknown as Partial<ProjectRow>);
}

/** Soft-delete one project — the engine keeps the row in the trash. */
export async function deleteProject(id: string): Promise<void> {
	await ops.items('hrm_projects').remove(id);
}

// ── Tasks ───────────────────────────────────────────────────────────────────

/** ONE field set for every task read — the owning project + the assignees are
 *  expanded in the SAME payload, so a card needs exactly one request. */
const TASK_FIELDS = [
	'id',
	'name',
	'priority',
	'state',
	'due_date',
	'display_number',
	'created_at',
	'updated_at',
	'project.name',
	'assignee.name_en',
	'assignee.name_mm',
	'assignee.avatar',
] as const;

/** ONE project's task feed, narrowed by the active state pill (server-side). */
export async function fetchProjectTasksPage(
	projectId: string,
	state: TaskStateFilter,
	cursor?: string,
): Promise<CursorPage<TaskCardModel>> {
	const filter = state === 'all' ? { project: { _eq: projectId } } : { project: { _eq: projectId }, state: { _eq: state } };
	const res = await ops.items('hrm_tasks').list({ fields: TASK_FIELDS, filter, sort: '-created_at', limit: LIST_PAGE_SIZE, cursor });
	return {
		rows: (res.data as TaskRow[]).map(toTaskCard),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** The project screen's toolbar search — task-name `?search=`, scoped to the
 *  project (the engine never searches relations, so the project filter is what
 *  keeps results inside this project). */
export async function fetchProjectTasksSearch(projectId: string, query: string): Promise<TaskCardModel[]> {
	const res = await ops.items('hrm_tasks').list({
		fields: TASK_FIELDS,
		filter: { project: { _eq: projectId } },
		search: query,
		sort: '-created_at',
		limit: SEARCH_LIMIT,
	});
	return (res.data as TaskRow[]).map(toTaskCard);
}

/** ONE task by id with its project + assignees — `null` when the row is gone. */
export async function fetchTask(id: string): Promise<TaskDetailModel | null> {
	const res = await ops.items('hrm_tasks').list({ fields: TASK_FIELDS, filter: { id: { _eq: id } }, limit: 1 });
	const row = (res.data as TaskRow[])[0];
	if (!row) return null;
	const project = toRef(row.project);
	return {
		...toTaskCard(row),
		projectId: project.id,
		projectName: project.name,
		createdAt: typeof row.created_at === 'string' ? row.created_at : null,
		updatedAt: typeof row.updated_at === 'string' ? row.updated_at : null,
	};
}

export interface TaskInput {
	name: string;
	/** The owning `hrm_projects` id. */
	project: string;
	priority: TaskPriority | null;
	state: TaskState;
	/** The `hrm_employees` ids — an empty list clears the assignees. */
	assignees: string[];
	/** `YYYY-MM-DD`, or null. */
	dueDate: string | null;
}

/** Create one task inside a project. */
export async function createTask(input: TaskInput): Promise<string> {
	const row = await ops.items('hrm_tasks').create({
		name: input.name,
		project: input.project,
		priority: input.priority ? PRIORITY_STORED[input.priority] : null,
		state: input.state,
		assignee: input.assignees,
		due_date: input.dueDate,
	} as unknown as Partial<TaskRow>);
	return (row as unknown as TaskRow).id;
}

/** Move one task to a new state (Start / Complete / Reopen). */
export async function updateTaskState(id: string, state: TaskState): Promise<void> {
	await ops.items('hrm_tasks').update(id, { state } as unknown as Partial<TaskRow>);
}

/** Update one task's editable fields (the owning project is fixed). */
export async function updateTask(id: string, input: Omit<TaskInput, 'project'>): Promise<void> {
	await ops.items('hrm_tasks').update(id, {
		name: input.name,
		priority: input.priority ? PRIORITY_STORED[input.priority] : null,
		state: input.state,
		assignee: input.assignees,
		due_date: input.dueDate,
	} as unknown as Partial<TaskRow>);
}

/** Soft-delete one task — the engine keeps the row in the trash. */
export async function deleteTask(id: string): Promise<void> {
	await ops.items('hrm_tasks').remove(id);
}

// ── Comments ────────────────────────────────────────────────────────────────

const COMMENT_FIELDS = [
	'id',
	'content',
	'created_at',
	'user.id',
	'user.name_en',
	'user.name_mm',
	'user.avatar',
	'user.designation.name',
	'mentions.id',
	'mentions.name_en',
	'mentions.name_mm',
] as const;

/** The `mentions` m2m expansion → the `{ id, name, token }` triples the comment
 *  card highlights. The token is rebuilt from the person's CURRENT display name,
 *  the same rule the composer inserts by — so a rename stops highlighting the
 *  stale run rather than mis-highlighting it. */
function toMentions(value: unknown): Mention[] {
	const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
	return rows.reduce<Mention[]>((acc, raw) => {
		if (!raw || typeof raw !== 'object') return acc;
		const row = raw as { id?: unknown; name_en?: unknown; name_mm?: unknown };
		const id = typeof row.id === 'string' ? row.id : null;
		const name = str(row.name_en) ?? str(row.name_mm);
		if (!id || !name) return acc;
		acc.push({ id, name, token: mentionToken(name) });
		return acc;
	}, []);
}

function toComment(row: CommentRow): CommentModel {
	const user = row.user && typeof row.user === 'object' ? row.user : null;
	const designation = user?.designation && typeof user.designation === 'object' ? user.designation : null;
	return {
		id: row.id,
		content: str(row.content) ?? '',
		authorId: user ? str(user.id) : null,
		authorName: user ? (str(user.name_en) ?? str(user.name_mm)) : null,
		authorPhoto: user ? str(user.avatar) : null,
		authorRole: designation ? str(designation.name) : null,
		mentions: toMentions(row.mentions),
		createdAt: typeof row['created_at'] === 'string' ? row['created_at'] : null,
	};
}

/** ONE task's comments, oldest first (the activity thread). */
export async function fetchTaskComments(taskId: string): Promise<CommentModel[]> {
	const res = await ops.items('hrm_comments').list({
		fields: COMMENT_FIELDS,
		filter: { task_name: { _eq: taskId } },
		sort: 'created_at',
		limit: LOOKUP_LIMIT,
	});
	return (res.data as CommentRow[]).map(toComment);
}

/** Add a comment to a task — `userId` (the signed-in employee) is optional, and
 *  `mentions` are the `hrm_employees` ids the composer tagged. */
export async function createComment(taskId: string, content: string, userId: string | null, mentions: string[]): Promise<void> {
	await ops.items('hrm_comments').create({
		task_name: taskId,
		content,
		user: userId,
		mentions,
	} as unknown as Partial<CommentRow>);
}

/** Edit one comment's body — `mentions` is the surviving tag set (a removed
 *  `@Name` run drops its person, so nobody is notified for a name no longer
 *  written). */
export async function updateComment(id: string, content: string, mentions: string[]): Promise<void> {
	await ops.items('hrm_comments').update(id, { content, mentions } as unknown as Partial<CommentRow>);
}

/** Soft-delete one comment — the engine keeps the row in the trash. */
export async function deleteComment(id: string): Promise<void> {
	await ops.items('hrm_comments').remove(id);
}

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * The signed-in `hrm_employees` row — RE-EXPORTED from the shared resolver in
 * `@/modules/attendance/data/api`, the ONE identity lookup about ten modules
 * already use (it derives the tg id, memoizes per session and coalesces
 * concurrent callers into one round-trip).
 *
 * This module used to carry its OWN tg→employee lookup. That meant the
 * attendance dashboard — whose header reads the same row — fired TWO identical
 * `hrm_employees` reads on every visit: one for the header, one for the task
 * feed below it. Delegating removes the second implementation for good.
 */
export { fetchCurrentEmployee } from '@/modules/attendance/data/api';

// ── My tasks (the attendance dashboard's task section) ──────────────────────

/**
 * The signed-in employee's tasks across EVERY project, newest-state-first (open
 * before done, then by nearest due date) — the attendance dashboard's "Today's
 * Assigned Tasks" feed and its "Tasks Completed" metric.
 *
 * ONE round trip: `GET /api/hr/my-tasks` resolves the m2m `assignee` junction
 * server-side and returns only this employee's rows. The engine URL syntax
 * cannot filter an m2m (`filter[assignee][_null]` is a D1 error), so this used
 * to walk the WHOLE `hrm_tasks` collection (100 rows/request) and filter here —
 * a cost that scaled with the entire table. The endpoint makes it scale with the
 * caller's own assignments instead (and still applies RBAC + lean projection).
 *
 * The acting employee's uuid is passed IN by the call site, which already has it
 * (the attendance dashboard holds it from its header read). This is the same
 * rule `fetchAttendanceSummary` follows on purpose: re-resolving identity here
 * cost a duplicate `/auth/me` + `hrm_employees` round-trip on every visit.
 */
export async function fetchMyTasks(employeeId: string | null, limit?: number): Promise<MyTasksSummary> {
	if (!employeeId) return { tasks: [], total: 0, done: 0 };

	// `limit` bounds the server's junction walk (a small to-do feed pays ONE
	// page); omitted ⇒ the historical whole-list walk.
	const { tasks: rows } = await sdk.request<{ tasks: TaskRow[] }>('/hr/my-tasks', {
		query: { employee_id: employeeId, ...(limit !== undefined ? { limit } : {}) },
	});

	const tasks: MyTask[] = (rows ?? []).map((row) => {
		const project = toRef(row.project);
		return { ...toTaskCard(row), projectId: project.id, projectName: project.name };
	});

	// Open tasks first, then nearest due date (undated last) — so today's work
	// leads the list and finished rows sink to the bottom.
	tasks.sort((a, b) => {
		const aDone = a.state === 'done' ? 1 : 0;
		const bDone = b.state === 'done' ? 1 : 0;
		if (aDone !== bDone) return aDone - bDone;
		const aDue = a.dueDate ?? '9999-12-31';
		const bDue = b.dueDate ?? '9999-12-31';
		return aDue.localeCompare(bDue);
	});

	return { tasks, total: tasks.length, done: tasks.filter((task) => task.state === 'done').length };
}

// ── Workload ────────────────────────────────────────────────────────────────

/** Every column the workload dashboard reads off a task — the owning project
 *  (for the per-project bars) and the assignees (for the per-person leaderboard)
 *  are expanded in the SAME read. */
const WORKLOAD_TASK_FIELDS = [
	'id',
	'state',
	'priority',
	'due_date',
	'project.name',
	'assignee.name_en',
	'assignee.name_mm',
	'assignee.avatar',
] as const;

/** The prioritised buckets, in display order — `null` last (unprioritised). */
const PRIORITY_BUCKETS: ReadonlyArray<TaskPriority | null> = ['critical', 'high', 'medium', 'low', null];

/**
 * The workload dashboard — ONE whole-set read of `hrm_tasks` (cursor-walked)
 * plus the project names, reduced into the KPI totals, the per-project progress
 * bars and the per-assignee leaderboard.
 *
 * Why client-side rather than server `groupBy`: the engine CAN group by `state`
 * and `project`, but the `assignee` m2m cannot be grouped (`groupBy[]=assignee`
 * aliases the relation to itself) nor filtered (`filter[assignee][_null]` is a
 * D1 error), so "unassigned" and "per-person open count" — the two metrics the
 * board exists for — need the rows. A whole-set walk keeps every number derived
 * from one consistent snapshot instead of mixing an aggregate and a row read.
 */
export async function fetchWorkload(): Promise<WorkloadSummary> {
	const [tasks, projects] = await Promise.all([
		fetchAllPages<TaskRow>((cursor, pageSize) =>
			ops.items('hrm_tasks').list({ fields: WORKLOAD_TASK_FIELDS, limit: pageSize, cursor, sort: '-created_at' }),
		),
		fetchAllPages<ProjectRow>((cursor, pageSize) =>
			ops.items('hrm_projects').list({ fields: ['id', 'name'], limit: pageSize, cursor, sort: 'name' }),
		),
	]);

	// Seed every project (a project with no tasks must still show a 0/0 bar).
	const projectBuckets = new Map<string, ProjectWorkload>();
	for (const project of projects) {
		projectBuckets.set(project.id, { id: project.id, name: str(project.name) ?? '—', total: 0, done: 0 });
	}

	const priorityCounts = new Map<TaskPriority | null, number>();
	const assigneeBuckets = new Map<string, AssigneeWorkload>();
	let todo = 0;
	let inProgress = 0;
	let done = 0;
	let overdue = 0;
	let unassigned = 0;

	for (const task of tasks) {
		const state = normalizeState(task.state);
		if (state === 'done') done++;
		else if (state === 'in_progress') inProgress++;
		else todo++;

		if (state !== 'done' && task.due_date && daysFromTodayMmt(task.due_date) < 0) overdue++;

		const assignees = toAssignees(task.assignee);
		if (assignees.length === 0) unassigned++;

		const project = toRef(task.project);
		if (project.id) {
			const bucket = projectBuckets.get(project.id) ?? { id: project.id, name: project.name ?? '—', total: 0, done: 0 };
			bucket.total++;
			if (state === 'done') bucket.done++;
			projectBuckets.set(project.id, bucket);
		}

		const priority = normalizePriority(task.priority);
		priorityCounts.set(priority, (priorityCounts.get(priority) ?? 0) + 1);

		for (const person of assignees) {
			const bucket = assigneeBuckets.get(person.id) ?? { id: person.id, name: person.name, photo: person.photo, open: 0, total: 0 };
			bucket.total++;
			if (state !== 'done') bucket.open++;
			assigneeBuckets.set(person.id, bucket);
		}
	}

	const total = tasks.length;
	return {
		total,
		todo,
		inProgress,
		done,
		overdue,
		unassigned,
		completionPct: total === 0 ? 0 : Math.round((done / total) * 100),
		projects: [...projectBuckets.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
		priorities: PRIORITY_BUCKETS.map((priority) => ({ priority, count: priorityCounts.get(priority) ?? 0 })),
		assignees: [...assigneeBuckets.values()].sort(
			(a, b) => b.open - a.open || b.total - a.total || (a.name ?? '').localeCompare(b.name ?? ''),
		),
	};
}

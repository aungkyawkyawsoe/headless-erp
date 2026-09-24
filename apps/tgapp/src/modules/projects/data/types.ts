/**
 * Row shapes for the Projects launcher app — projects (`hrm_projects`), their
 * tasks (`hrm_tasks`) and a task's comments (`hrm_comments`).
 *
 * The generated `src/generated/schema.ts` snapshot is stale (it still lists the
 * old `hr_*` collections), so this module types its own rows and narrows the
 * shared SDK client to them locally (`api.ts`), exactly like the employees /
 * maintenance / movements modules.
 *
 * Two normalizations happen at the data boundary (`api.ts`):
 *   • the `priority` select stores `critical/high/medium/**Low**` (the capital
 *     `Low` is real schema drift) — the module normalizes every value to
 *     lowercase and re-cases it back to the stored value on write;
 *   • `project` (m2o) and `assignee` (m2m) arrive as expanded rows only when the
 *     read names them in `?fields=` — the module flattens both shapes (bare id
 *     or `{ id, … }`) to stable display models.
 */
import type { Mention } from './mentions';

/** Task lifecycle state — the `hrm_tasks.state` select values. */
export type TaskState = 'todo' | 'in_progress' | 'done';

/** The state FILTER value — the no-filter `all` sentinel plus every real state. */
export type TaskStateFilter = 'all' | TaskState;

/** Task priority — normalized to lowercase (the schema stores `Low` capitalized). */
export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

/** RAW `hrm_projects` row (`cms_hrm_projects`). */
export interface ProjectRow {
	id: string;
	name?: string | null;
	description?: string | null;
	display_number?: string | null;
}

/** RAW `hrm_tasks` row (`cms_hrm_tasks`). */
export interface TaskRow {
	id: string;
	name?: string | null;
	/** m2o → `hrm_projects`; expanded to `{ id, name }` when requested. */
	project?: { id?: string; name?: string | null } | string | null;
	priority?: string | null;
	state?: string | null;
	/** m2m → `hrm_employees`; expanded to an ARRAY of employee rows. */
	assignee?: unknown;
	due_date?: string | null;
	display_number?: string | null;
	/** System timestamps — the detail screen's "Created" cell + "Updated" stamp. */
	created_at?: string | null;
	updated_at?: string | null;
}

/** RAW `hrm_comments` row (`cms_hrm_comments`). */
export interface CommentRow {
	id: string;
	content?: string | null;
	/** m2o → `hrm_tasks`. */
	task_name?: string | null;
	/** m2o → `hrm_employees`; expanded to `{ id, name_en, name_mm, avatar, designation }`. */
	user?:
		| {
				id?: string;
				name_en?: string | null;
				name_mm?: string | null;
				avatar?: string | null;
				designation?: { id?: string; name?: string | null } | string | null;
		  }
		| string
		| null;
	/** m2m → `hrm_employees`; the people this comment tagged. */
	mentions?: unknown;
	created_at?: string | null;
}

/** ONE project card — the register + detail header model. */
export interface ProjectCardModel {
	id: string;
	name: string;
	description: string | null;
	/** The engine's document number (`PRJ-####`), when assigned. */
	number: string | null;
}

/** A resolved `hrm_employees` assignee — display identity only. */
export interface AssigneeInfo {
	id: string;
	name: string | null;
	/** `/api/media/…` avatar, or null (the card renders an initial fallback). */
	photo: string | null;
}

/** ONE task card — the project feed's row model. */
export interface TaskCardModel {
	id: string;
	name: string;
	state: TaskState | null;
	priority: TaskPriority | null;
	/** `YYYY-MM-DD`. */
	dueDate: string | null;
	assignees: AssigneeInfo[];
	number: string | null;
}

/** ONE task assigned to the signed-in employee — the card fields plus the owning
 *  project (shown as the row's context). Used by the attendance dashboard's
 *  "Today's Assigned Tasks" section. */
export interface MyTask extends TaskCardModel {
	projectId: string | null;
	projectName: string | null;
}

/**
 * The signed-in employee's tasks across every project, plus the counts the
 * dashboard's "Tasks Completed" metric reads. Whole-set derived (see
 * `fetchMyTasks`) because the engine cannot filter the `assignee` m2m.
 */
export interface MyTasksSummary {
	tasks: MyTask[];
	total: number;
	done: number;
}

/** ONE task's full detail model (the task screen) — the card fields plus the
 *  owning project (for the header's context link) and the system timestamps. */
export interface TaskDetailModel extends TaskCardModel {
	projectId: string | null;
	projectName: string | null;
	/** UTC ISO timestamp — the "Created" metadata cell. */
	createdAt: string | null;
	/** UTC ISO timestamp — the "Updated …" stamp. */
	updatedAt: string | null;
}

/** ONE comment, flattened for the task screen's activity list. */
export interface CommentModel {
	id: string;
	content: string;
	/** The author's `hrm_employees` id — matched against the viewer to expose
	 *  edit/delete on their OWN comments. Null when the row carries no author. */
	authorId: string | null;
	authorName: string | null;
	authorPhoto: string | null;
	/** The author's `hrm_designations` name — the card's role subtitle. */
	authorRole: string | null;
	/** The people this comment tagged, with the token that identifies each run in
	 *  the body (built from the live `mentions` rows — see `data/mentions.ts`). */
	mentions: Mention[];
	/** UTC ISO timestamp. */
	createdAt: string | null;
}

/** ONE project's slice of the workload dashboard — its task total + done count. */
export interface ProjectWorkload {
	id: string;
	name: string;
	total: number;
	done: number;
}

/** ONE priority's task count on the workload dashboard (`null` = unprioritised). */
export interface PriorityWorkload {
	priority: TaskPriority | null;
	count: number;
}

/** ONE assignee's slice of the workload dashboard — their open + total tasks. */
export interface AssigneeWorkload {
	id: string;
	name: string | null;
	photo: string | null;
	/** Tasks not yet done. */
	open: number;
	total: number;
}

/**
 * The whole workload dashboard — ONE read over every `hrm_tasks` row (plus the
 * project names), computed client-side because the engine cannot group or
 * filter the `assignee` m2m (see `fetchWorkload`).
 */
export interface WorkloadSummary {
	total: number;
	todo: number;
	inProgress: number;
	done: number;
	/** Not done, with a due date before today (MMT). */
	overdue: number;
	/** Tasks with no assignee at all. */
	unassigned: number;
	/** `done / total` as a whole percent (0 when there are no tasks). */
	completionPct: number;
	projects: ProjectWorkload[];
	priorities: PriorityWorkload[];
	assignees: AssigneeWorkload[];
}

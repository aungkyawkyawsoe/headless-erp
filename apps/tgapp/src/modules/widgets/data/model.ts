import type { MyTask } from '@/modules/projects/data/types';

/**
 * The widget board's MODEL — pure, deterministic derivations from the reads.
 * The board fetches (data/api.ts) and this module shapes it; the component only
 * renders. Every count/row answers "where did this come from": the fleet
 * care/document pointers and the bounded to-do feed.
 *
 * The priority queue is the user's OWN TASKS from Projects (a to-do list), read
 * through the bounded `my-tasks` feed — NOT a mixed feed of care/renewal rows,
 * and never the whole task list (see `WIDGET_TASKS_LIMIT`).
 *
 * The approvals feeds are deliberately NOT part of the model: the approvals
 * card was removed from the board, so NO approvals read happens and no cell may
 * imply one (a permanently-zero "Approvals" tile would be a broken view).
 */

/** One vehicle row the board reads — the master's care + document POINTERS
 *  (denormalized on every care/document write), so the alert cells are ONE
 *  bounded read with no child-table walking. */
export interface FleetWidgetRow {
	id: string;
	plate_no?: string | null;
	brand?: string | null;
	last_odo?: number | null;
	last_engine_oil?: number | null;
	last_gear_oil?: number | null;
	last_license?: { expiry_date?: string | null } | null;
	last_insurance?: { expiry_date?: string | null } | null;
}

/** The icon each widget entry shows — a KEY, not a glyph: the board maps it to
 *  a lucide component (no emoji anywhere in the UI). */
export type WidgetIcon = 'oil' | 'license' | 'insurance';

/** Tint the ring + rows share — the iOS-light palette keyed to the due state. */
export type WidgetTone = 'alert' | 'warn' | 'ok';

export function kmLeftOf(dueOdoKm: number | null, currentOdoKm: number | null): number | null {
	if (dueOdoKm == null || currentOdoKm == null) return null;
	return dueOdoKm - currentOdoKm;
}

/** The fleets chips' exact tone rule (status.ts) — mirrored here so the widget
 *  and the register can never disagree about what counts as "due". */
export function toneOf(kmLeft: number | null): WidgetTone {
	if (kmLeft === null || kmLeft < 0) return 'alert';
	if (kmLeft === 0) return 'warn';
	return kmLeft < 500 ? 'warn' : 'ok';
}

/** Calendar days until a due/expiry date (UTC-day math, deterministic). */
export function daysUntil(iso: string | null | undefined): number | null {
	if (!iso) return null;
	const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
	if (Number.isNaN(t)) return null;
	const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
	return Math.round((t - today) / 86_400_000);
}

/** The document warn window (days before expiry) — the ONE number behind both
 *  `documentTone` and the License/Insurance alert cells, so a tile can never
 *  disagree with the register date pill about what counts as "due". */
export const DOC_WARN_DAYS = 30;

export function documentTone(days: number | null): WidgetTone {
	if (days === null) return 'ok';
	if (days < 0) return 'alert';
	if (days <= DOC_WARN_DAYS) return 'warn';
	return 'ok';
}

/** Count the fleet rows whose CURRENT document is expired or inside the warn
 *  window, plus the worst tone among them.
 *
 *  Why not expired-only (the earlier rule): a document expiring tomorrow is
 *  precisely what an operations dashboard must surface, yet counting only
 *  `days < 0` painted the cell a flat "0 / ok" until the paper had already
 *  lapsed — e.g. 4 licenses expiring inside 10 days read as zero. The count now
 *  uses the SAME `documentTone` rule the registers use, so "due soon" is
 *  visible early and the cell's colour still escalates to alert once one is
 *  actually past due. */
function documentCell(
	fleets: FleetWidgetRow[],
	expiryOf: (fleet: FleetWidgetRow) => string | null | undefined,
): { count: number; tone: WidgetTone } {
	let count = 0;
	let worst: WidgetTone = 'ok';
	for (const fleet of fleets) {
		const tone = documentTone(daysUntil(expiryOf(fleet)));
		if (tone === 'ok') continue;
		count += 1;
		if (tone === 'alert') worst = 'alert';
		else if (worst !== 'alert') worst = 'warn';
	}
	return { count, tone: worst };
}

/** The alert-grid cells (Fleet & Operations), MECE over the loaded fleet data:
 *  oil service / license / insurance. */
export interface AlertCell {
	key: WidgetIcon;
	name: string;
	count: number;
	tone: WidgetTone;
}

/** One to-do row in the queue — a project task, ordered for action. */
export interface TodoRow {
	key: string;
	title: string;
	/** The owning project (or a generic "Task" when the row carries none). */
	subtitle: string | null;
	/** The due badge: `Overdue 2d` / `Due today` / `Due Sep 20`. */
	badge: string | null;
	tone: WidgetTone;
	/** The task's full-screen route. */
	to: string;
}

export interface WidgetsModel {
	alerts: AlertCell[];
	/** The to-do list — OPEN tasks only, most urgent first. */
	todos: TodoRow[];
}

/** A task is finished (and therefore NOT a to-do) in any of these states. */
const DONE_STATES = new Set(['done', 'closed', 'completed', 'cancelled', 'canceled']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The due badge + tone for one task — the ONE mapping the queue renders. */
function dueBadge(due: string | null): { badge: string | null; tone: WidgetTone; rank: number } {
	const days = daysUntil(due);
	// Undated to-dos are valid work but they sort AFTER dated ones (rank 3).
	if (days === null) return { badge: null, tone: 'ok', rank: 3 };
	if (days < 0) return { badge: `Overdue ${Math.abs(days)}d`, tone: 'alert', rank: 0 };
	if (days === 0) return { badge: 'Due today', tone: 'warn', rank: 1 };
	const date = new Date(`${String(due).slice(0, 10)}T00:00:00Z`);
	return { badge: `Due ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`, tone: 'ok', rank: 2 };
}

/**
 * Shape the reads into the board. Pure: same inputs ⇒ same widgets, nothing
 * hidden and nothing fabricated — a cell is 0 when its reads say so.
 */
export function buildWidgetsModel(input: { fleets: FleetWidgetRow[]; tasks: MyTask[] }): WidgetsModel {
	let oilAlerts = 0;

	for (const fleet of input.fleets) {
		const engineTone = toneOf(kmLeftOf(fleet.last_engine_oil ?? null, fleet.last_odo ?? null));
		const gearTone = toneOf(kmLeftOf(fleet.last_gear_oil ?? null, fleet.last_odo ?? null));
		if (engineTone !== 'ok' || gearTone !== 'ok') oilAlerts += 1;
	}

	// Expired OR expiring within `DOC_WARN_DAYS` — the registers' own date rule.
	const license = documentCell(input.fleets, (fleet) => fleet.last_license?.expiry_date ?? null);
	const insurance = documentCell(input.fleets, (fleet) => fleet.last_insurance?.expiry_date ?? null);

	// The to-do list: OPEN tasks only, timed first (overdue → due today → upcoming),
	// undated after, then deterministic A→Z within each band.
	const todos: Array<TodoRow & { rank: number; due: string }> = [];
	for (const task of input.tasks) {
		if (task.state && DONE_STATES.has(task.state)) continue;
		const due = task.dueDate ? String(task.dueDate).slice(0, 10) : null;
		const { badge, tone, rank } = dueBadge(due);
		todos.push({
			key: `task:${task.id}`,
			title: task.name || 'Task',
			subtitle: task.projectName || 'Task',
			badge,
			tone,
			to: `/app/projects/task/${task.id}`,
			rank,
			due: due ?? '9999-12-31',
		});
	}
	todos.sort((a, b) =>
		a.rank !== b.rank ? a.rank - b.rank : a.due !== b.due ? a.due.localeCompare(b.due) : a.title.localeCompare(b.title),
	);

	const alerts: AlertCell[] = [
		{ key: 'oil', name: 'Oil', count: oilAlerts, tone: oilAlerts > 0 ? 'alert' : 'ok' },
		{ key: 'license', name: 'License', count: license.count, tone: license.tone },
		{ key: 'insurance', name: 'Insurance', count: insurance.count, tone: insurance.tone },
	];

	return {
		alerts,
		todos: todos.map(({ rank: _rank, due: _due, ...row }) => row),
	};
}

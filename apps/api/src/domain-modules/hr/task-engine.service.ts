/**
 * Task Engine — meeting task lifecycle + daily follow-up digest.
 *
 *  - `runTaskDigest`  — morning cron: due-soon (≤ +2d) and overdue tasks →
 *    one in-app `hr_notifications` reminder + one Telegram push per assignee.
 *    Deduped per task per MMT day, so re-running the same day is a no-op and
 *    tasks that are still open get re-reminded the next morning. BOUNDED: it
 *    reads only the work due inside a recall window and caps one run's fan-out,
 *    reporting a cap that bit as `truncated` instead of dropping rows silently.
 *  - `completeTask`   — the sanctioned "done" path: sets status/`completed_at`
 *    and notifies the assigner (creator) instantly, so the follow-up loop
 *    closes instead of relying on the next digest.
 *
 * Telegram push is best-effort (see `lib/telegram-push.ts`) — the in-app
 * `hr_notifications` row is the durable channel and always written.
 */

import { D1Client, QueryBuilder } from '@mmbix/core';
import { invalidateCollectionReads } from '@mmbix/core';
import { collectionTable } from '@/lib/utils/table-name';
import { sendTelegramMessage, escapeHtml } from '@/lib/telegram-push';
import { addDays, mmtDayStartIso, toMmtDate, todayMmtDate } from '@mmbix/utils';

/** Due-soon horizon (days from today). */
const DUE_SOON_DAYS = 2;

/** How far BACK a run still recalls overdue work. Past this a task is stale data
 *  rather than "the work due" — and without the floor the query scanned EVERY
 *  non-done task that carries a due date, so a daily cron's cost grew with total
 *  task history instead of with today's work (the likeliest way to blow D1's
 *  per-invocation query/CPU budget). */
const OVERDUE_RECALL_DAYS = 30;

/** Hard cap on the tasks ONE run loads. What a cap must guarantee to stay honest:
 *  (a) the rows it drops are the LEAST urgent (the read is most-overdue-first),
 *  (b) they remain in the candidate window while they are still due, so a later
 *  run sees them again, and (c) any drop is REPORTED (`truncated` in the result
 *  and the log) — a capped digest must never be indistinguishable from a quiet
 *  one. It bounds memory/CPU; it is not a pagination cursor. */
const DIGEST_TASK_LIMIT = 500;

/** Burmese date label (UTC-safe: the date string is already MMT-local). */
function mmLabel(date: string): string {
	return date;
}

// ─── Recurrence ────────────────────────────────────────────────

/** Shape of the `recurrence` JSON field on hr_tasks. */
interface TaskRecurrence {
	frequency: 'daily' | 'weekly' | 'monthly';
	interval: number;
	/** The next occurrence's due date (the date the NEXT copy will carry) — `null`
	 *  when the JSON never carried one; the caller then anchors on the ROW's own
	 *  dates rather than on the wall clock (see `completeTask`). */
	next_due: string | null;
}

function parseRecurrence(raw: unknown): TaskRecurrence | null {
	if (!raw) return null;
	let obj = raw;
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const p = JSON.parse(raw) as unknown;
			if (typeof p !== 'object' || p === null) return null;
			obj = p;
		} catch {
			return null;
		}
	}
	if (typeof obj !== 'object') return null;
	const r = obj as Record<string, unknown>;
	const frequency = r.frequency as TaskRecurrence['frequency'] | undefined;
	if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'monthly') return null;
	const interval = Math.max(1, Math.floor(Number(r.interval) || 1));
	const next_due = typeof r.next_due === 'string' && r.next_due ? r.next_due : null;
	return { frequency, interval, next_due };
}

/** Advance a due date by the recurrence interval (monthly clamps the day). */
function advanceDue(date: string, frequency: TaskRecurrence['frequency'], interval: number): string {
	const y = Number(date.slice(0, 4));
	const m = Number(date.slice(5, 7));
	const d = Number(date.slice(8, 10));
	if (frequency === 'monthly') {
		const totalMonths = y * 12 + (m - 1) + interval;
		const ny = Math.floor(totalMonths / 12);
		const nm = (totalMonths % 12) + 1;
		const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate(); // days in target month
		const nd = Math.min(d, last);
		return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
	}
	const days = frequency === 'daily' ? interval : interval * 7;
	const base = new Date(`${date}T00:00:00Z`);
	base.setUTCDate(base.getUTCDate() + days);
	return base.toISOString().slice(0, 10);
}

interface TaskRow {
	id: string;
	title: string;
	description?: string | null;
	status: string;
	priority?: string | null;
	due_date: string | null;
	assignee_tg_id: string | null;
	assignees?: unknown;
	created_by_tg_id: string | null;
	completed_at: string | null;
	subtasks?: unknown;
	require_checklist?: unknown;
	recurrence?: unknown;
	task_type?: string | null;
	created_at?: string | null;
}

export interface TaskDigestResult {
	tasks: number;
	assignees: number;
	reminders: number;
	telegramSent: number;
	telegramFailed: number;
	skippedAlreadyReminded: number;
	/** The cap (`DIGEST_TASK_LIMIT`) dropped due tasks this run — more work exists
	 *  than one run notifies. Surfaced so a capped digest is never mistaken for a
	 *  quiet one. */
	truncated: boolean;
}

export interface CompleteTaskResult {
	status: 'done' | 'not_found' | 'forbidden' | 'already_done' | 'checklist_incomplete';
	notifiedTgId?: string;
	nextTaskId?: string;
	nextDue?: string;
}

/** Write one in-app notification (durable) + best-effort Telegram push. */
async function notify(
	env: Record<string, unknown>,
	db: D1Client,
	tgId: string,
	title: string,
	body: string,
	referenceId: string,
	type: 'reminder' | 'info',
	now: string,
): Promise<{ telegramSent: boolean }> {
	const notifTable = collectionTable('hr_notifications');
	try {
		await db.run(
			QueryBuilder.from(notifTable).toInsert({
				id: crypto.randomUUID(),
				tg_id: tgId,
				title,
				body,
				type,
				reference_id: referenceId,
				read: 0,
				_meta: '{}',
				created_at: now,
				updated_at: now,
			}),
		);
		invalidateCollectionReads('hr_notifications');
	} catch (err) {
		// hr_notifications may not be seeded yet — digest degrades to Telegram only.
		console.error('[task-engine] notification insert failed:', err instanceof Error ? err.message : String(err));
	}

	const sent = await sendTelegramMessage(env, tgId, `${title}\n${body}`);
	if (!sent.ok) console.info('[task-engine] telegram skipped:', sent.error);
	return { telegramSent: sent.ok };
}

/** Morning digest — remind assignees of due-soon / overdue tasks. Idempotent per MMT day. */
export async function runTaskDigest(env: Record<string, unknown>, db: D1Client): Promise<TaskDigestResult> {
	const taskTable = collectionTable('hr_tasks');
	const notifTable = collectionTable('hr_notifications');
	const today = todayMmtDate();
	const horizon = addDays(today, DUE_SOON_DAYS);
	const recallFrom = addDays(today, -OVERDUE_RECALL_DAYS);
	const now = new Date().toISOString();

	// Bounded by the WORK DUE (a due-date range), not by task history, and capped
	// most-overdue-first: `LIMIT + 1` is the probe that says whether the cap cut
	// rows away. `id` is the tie-break so the slice boundary is deterministic
	// (two tasks due the same day must not swap between runs).
	const fetched = await db.all<TaskRow>(
		QueryBuilder.from(taskTable)
			.select('id', 'title', 'status', 'due_date', 'assignee_tg_id', 'created_by_tg_id')
			.whereNull('deleted_at')
			.where('status', '!=', 'done')
			.where('due_date', '<=', horizon)
			.where('due_date', '>=', recallFrom)
			.orderBy('due_date', 'asc')
			.orderBy('id', 'asc')
			.limit(DIGEST_TASK_LIMIT + 1)
			.toSelect(),
	);
	const truncated = fetched.length > DIGEST_TASK_LIMIT;
	const tasks = truncated ? fetched.slice(0, DIGEST_TASK_LIMIT) : fetched;
	if (truncated) {
		console.warn(
			`[task-engine] digest hit the ${DIGEST_TASK_LIMIT}-task cap for ${today} — the tasks beyond it stay open and remain in the window for a later run`,
		);
	}
	if (tasks.length === 0)
		return { tasks: 0, assignees: 0, reminders: 0, telegramSent: 0, telegramFailed: 0, skippedAlreadyReminded: 0, truncated };

	// Dedupe: skip tasks that already have a reminder row today (digest reminders
	// carry comma-joined task ids in `reference_id`). The read is TARGETED at the
	// assignees this run will notify (`tg_id IN (…)` — one `json_each` binding
	// however many there are, see QueryBuilder.whereIn) instead of pulling every
	// reminder of the day into memory, and it is pushed to SQL (`DISTINCT`). A task
	// RE-ASSIGNED since its earlier reminder today can therefore be reminded once
	// more — the price of not scanning the whole day, and a strictly better trade
	// than the unbounded read it replaced.
	//
	// A FAILED read is deliberately fatal: with an empty dedupe set the run would
	// re-send EVERY notification to EVERY assignee, and a daily spam loop is worse
	// than a digest that did not run at all. Throwing makes it loud (the cron and
	// `POST /tasks/digest` both log it) while nothing is sent.
	const remindedToday = new Set<string>();
	const assigneeKeys = [...new Set(tasks.map((t) => t.assignee_tg_id || 'unknown'))];
	const reminded = await db.all<{ reference_id: string | null }>(
		QueryBuilder.from(notifTable)
			.select('reference_id')
			.distinct()
			.where('type', 'reminder')
			.where('created_at', '>=', mmtDayStartIso())
			.whereIn('tg_id', assigneeKeys)
			.toSelect(),
	);
	for (const row of reminded) {
		for (const id of String(row.reference_id ?? '').split(',')) if (id) remindedToday.add(id);
	}

	const fresh = tasks.filter((t) => !remindedToday.has(t.id));
	const skippedAlreadyReminded = tasks.length - fresh.length;
	if (fresh.length === 0) {
		return { tasks: tasks.length, assignees: 0, reminders: 0, telegramSent: 0, telegramFailed: 0, skippedAlreadyReminded, truncated };
	}

	// Bucket + group by assignee.
	const overdue = fresh.filter((t) => String(t.due_date) < today);
	const dueSoon = fresh.filter((t) => String(t.due_date) >= today);
	const byAssignee = new Map<string, TaskRow[]>();
	for (const t of fresh) {
		const key = t.assignee_tg_id || 'unknown';
		const list = byAssignee.get(key) ?? [];
		list.push(t);
		byAssignee.set(key, list);
	}

	let assignees = 0;
	let reminders = 0;
	let telegramSent = 0;
	let telegramFailed = 0;

	for (const [tgId, group] of byAssignee) {
		const line = (t: TaskRow) => `${mmLabel(String(t.due_date))} — ${escapeHtml(t.title)}`;
		const parts: string[] = [];
		if (dueSoon.some((t) => t.assignee_tg_id === tgId))
			parts.push(
				`⏰ နောက်ဆုံးရက် (${today} → ${horizon}):\n${dueSoon
					.filter((t) => t.assignee_tg_id === tgId)
					.map(line)
					.join('\n')}`,
			);
		if (overdue.some((t) => t.assignee_tg_id === tgId))
			parts.push(
				`🔴 ကျော်လွန်နေပြီ:\n${overdue
					.filter((t) => t.assignee_tg_id === tgId)
					.map(line)
					.join('\n')}`,
			);

		const title = '📋 တာဝန် သတိပေးချက်';
		const body = parts.join('\n\n');
		const referenceId = group.map((t) => t.id).join(',');
		const { telegramSent: sent } = await notify(env, db, tgId, title, body, referenceId, 'reminder', now);
		telegramSent += sent ? 1 : 0;
		telegramFailed += sent ? 0 : 1;
		assignees += 1;
		reminders += 1;
	}

	// ONE summary line, no identity: the previous per-assignee line logged the
	// employee's NAME and their Telegram id on every run (PII in application logs
	// for no operational gain — the counts below carry everything support needs,
	// and the task count per batch is visible in the notification rows themselves).
	console.info(
		`[task-engine] digest ${today}: ${assignees} assignee(s), ${reminders} reminder(s), ${telegramFailed} push(es) failed, ${skippedAlreadyReminded} already reminded` +
			(truncated ? ` — CAP ${DIGEST_TASK_LIMIT} REACHED (more tasks were due)` : ''),
	);

	return { tasks: tasks.length, assignees, reminders, telegramSent, telegramFailed, skippedAlreadyReminded, truncated };
}

/**
 * Complete a task — the "done" path. Only the assignee or the creator may
 * complete; completion notifies the creator (assigner) unless they did it
 * themselves, so follow-up owners learn instantly.
 */
export async function completeTask(
	env: Record<string, unknown>,
	db: D1Client,
	taskId: string,
	actorTgId: string,
): Promise<CompleteTaskResult> {
	const taskTable = collectionTable('hr_tasks');
	const row = await db.first<TaskRow>(
		QueryBuilder.from(taskTable)
			.select(
				'id',
				'title',
				'description',
				'status',
				'priority',
				'due_date',
				'assignee_tg_id',
				'assignees',
				'created_by_tg_id',
				'completed_at',
				'subtasks',
				'require_checklist',
				'recurrence',
				'task_type',
				// The recurrence anchor of last resort (see below) — the row's own
				// creation date, never the wall clock.
				'created_at',
			)
			.where('id', taskId)
			.whereNull('deleted_at')
			.toSelect(),
	);
	if (!row) return { status: 'not_found' };
	if (row.assignee_tg_id !== actorTgId && row.created_by_tg_id !== actorTgId) return { status: 'forbidden' };

	const now = new Date().toISOString();
	if (row.status === 'done' && row.completed_at) return { status: 'already_done' };

	// ── Done-rule: an opted-in checklist must be fully complete to close. ──
	const subtasks = parseChecklist(row.subtasks);
	if (Boolean(row.require_checklist) && subtasks.length > 0 && subtasks.some((s) => !s.done)) {
		return { status: 'checklist_incomplete' };
	}

	await db.run(QueryBuilder.from(taskTable).where('id', taskId).toUpdate({ status: 'done', completed_at: now, updated_at: now }));
	invalidateCollectionReads('hr_tasks');

	// ── Recurrence: completing spawns the next occurrence (Asana-style). ──
	let spawned: { nextTaskId?: string; nextDue?: string } = {};
	const recurrence = parseRecurrence(row.recurrence);
	// The next occurrence is derived from the ROW's OWN data — never the wall clock:
	// `recurrence.next_due` (the series' own cursor) leads, then this task's
	// `due_date`, then the row's creation date. A REPLAYED completion therefore
	// derives the same next date whatever day it runs on — the old
	// `todayMmtDate()` default made the series depend on when the retry happened.
	// A row carrying none of the three has no date to anchor a series on, so no
	// copy is filed (deterministically so, on every replay).
	const anchor = recurrence ? (recurrence.next_due ?? row.due_date ?? (row.created_at ? toMmtDate(String(row.created_at)) : '')) : '';
	if (recurrence && anchor) {
		const nextDue = recurrence.next_due ?? advanceDue(anchor, recurrence.frequency, recurrence.interval);
		const dueAfter = advanceDue(nextDue, recurrence.frequency, recurrence.interval);
		const id = crypto.randomUUID();
		try {
			await db.run(
				QueryBuilder.from(taskTable).toInsert({
					id,
					title: row.title,
					description: row.description ?? null,
					assignee_tg_id: row.assignee_tg_id ?? null,
					assignees: row.assignees ?? null,
					created_by_tg_id: row.created_by_tg_id ?? null,
					status: 'todo',
					priority: row.priority ?? null,
					task_type: row.task_type ?? null,
					due_date: nextDue,
					subtasks: JSON.stringify(subtasks.map((s) => ({ ...s, done: false }))),
					require_checklist: Boolean(row.require_checklist) ? 1 : 0,
					// Advance next_due so the spawned task's own completion creates the
					// FOLLOWING occurrence — not a duplicate of this one.
					recurrence: JSON.stringify({ ...recurrence, next_due: dueAfter }),
					completed_at: null,
					_meta: '{}',
					created_at: now,
					updated_at: now,
				}),
			);
			invalidateCollectionReads('hr_tasks');
			spawned = { nextTaskId: id, nextDue };
		} catch (err) {
			console.error('[task-engine] recurring spawn failed:', err instanceof Error ? err.message : String(err));
		}
	}

	const creator = row.created_by_tg_id;
	if (creator && creator !== actorTgId) {
		const title = '✅ တာဝန် ပြီးစီးပါပြီ';
		const body = `${escapeHtml(row.title)}${row.due_date ? `\nနောက်ဆုံးရက်: ${mmLabel(String(row.due_date))}` : ''}`;
		await notify(env, db, creator, title, body, taskId, 'info', now);
		return { status: 'done', notifiedTgId: creator, ...spawned };
	}
	return { status: 'done', ...spawned };
}

/** Normalize the `subtasks` JSON field into an array of { title, done }. */
function parseChecklist(raw: unknown): { title: string; done: boolean }[] {
	let list: unknown[] = [];
	if (Array.isArray(raw)) list = raw;
	else if (typeof raw === 'string' && raw.trim()) {
		try {
			const p = JSON.parse(raw) as unknown;
			if (Array.isArray(p)) list = p;
		} catch {
			return [];
		}
	}
	return list
		.filter((s): s is { title?: unknown; done?: unknown } => typeof s === 'object' && s !== null)
		.map((s) => ({ title: String(s.title ?? '').trim(), done: s.done === true || s.done === 1 || s.done === '1' || s.done === 'true' }))
		.filter((s) => s.title);
}

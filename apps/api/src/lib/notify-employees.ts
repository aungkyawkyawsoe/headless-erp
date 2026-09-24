/**
 * Employee notifications — the ONE way a server-side event tells people about it.
 *
 * Used by the HR request flow (filed → superior, decided → requester) and the
 * MRO asset-transfer flow (same shape). A caller resolves WHO should hear
 * (usually the reporting edge in `hrm_employee_links`), then calls
 * `notifyEmployees`; this module owns the two delivery legs so no caller can
 * invent a third:
 *
 *   1. a DURABLE in-app row in `hr_notifications` (the app's one inbox) — awaited,
 *      so it exists before the caller's response and a test can assert it; and
 *   2. a BEST-EFFORT Telegram DM — handed to `backgroundTask`, so a slow or
 *      failing Bot API never delays the write it describes.
 *
 * Delivery is deliberately never-throwing: a notification is not the write it
 * reports, so a missing table or a DB blip logs and degrades rather than failing
 * the caller.
 */

import { D1Client, QueryBuilder, invalidateCollectionReads } from '@mmbix/core';
import { backgroundTask } from '@/lib/request-tasks';
import { pushTelegram } from '@/lib/telegram-push';
import { collectionTable } from '@/lib/utils/table-name';

/**
 * The app's ONE in-app notification inbox. HR-named for history, but the shape
 * (`tg_id` / `title` / `body` / `type` / `reference_id` / `read`) is generic, so
 * every module files here rather than each inventing an inbox.
 */
const NOTIFICATION_COLLECTION = 'hr_notifications';

/** A notification recipient resolved to a Telegram DM target. */
export interface Recipient {
	id: string;
	tgId: string | null;
	name: string;
}

export interface EmployeeNotifyMessage {
	title: string;
	body: string;
	type: 'approval' | 'info' | 'reminder';
	referenceId: string;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Whether a read failed because the table is simply NOT PROVISIONED on this
 *  deploy — the only failure that may degrade to "no reporting line". A D1 blip
 *  propagates rather than silently dropping a notification. */
function isTableAbsent(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return message.includes('no such table');
}

/**
 * Resolve employee rows to their Telegram targets. The HR module's own
 * projection contract (`EMPLOYEE_REF`) guarantees `etg_id` + the two name
 * columns exist on `hrm_employees`.
 */
export async function employeesByIds(db: D1Client, ids: string[]): Promise<Recipient[]> {
	const unique = [...new Set(ids.filter(Boolean))];
	if (unique.length === 0) return [];
	const rows = await db.all<{ id?: unknown; etg_id?: unknown; name_mm?: unknown; name_en?: unknown }>(
		QueryBuilder.from(collectionTable('hrm_employees'))
			.select('id', 'etg_id', 'name_mm', 'name_en')
			.whereIn('id', unique)
			.whereNull('deleted_at')
			.toSelect(),
	);
	return rows
		.map((r) => ({
			id: str(r.id),
			tgId: str(r.etg_id) || null,
			name: str(r.name_mm) || str(r.name_en),
		}))
		.filter((r) => r.id);
}

/** The employee uuids who report DIRECTLY to `employeeId` — the reporting edge
 *  every approver scope in the app is built on. An unprovisioned table means
 *  there IS no reporting line (`[]`). */
export async function superiorEmployeeIds(db: D1Client, employeeId: string): Promise<string[]> {
	try {
		const rows = await db.all<{ superior?: unknown }>(
			QueryBuilder.from(collectionTable('hrm_employee_links'))
				.select('superior')
				.where('subordinate', employeeId)
				.whereNull('deleted_at')
				.toSelect(),
		);
		return [...new Set(rows.map((r) => str(r.superior)).filter(Boolean))];
	} catch (err) {
		if (isTableAbsent(err)) return [];
		throw err;
	}
}

/** Write the durable in-app rows for `recipients` (one batch). */
async function writeNotifications(db: D1Client, recipients: Recipient[], msg: EmployeeNotifyMessage): Promise<void> {
	const now = new Date().toISOString();
	const notifTable = collectionTable(NOTIFICATION_COLLECTION);
	const statements = recipients.map((r) =>
		QueryBuilder.from(notifTable).toInsert({
			id: crypto.randomUUID(),
			tg_id: r.tgId,
			title: msg.title,
			body: msg.body,
			type: msg.type,
			reference_id: msg.referenceId,
			read: 0,
			_meta: '{}',
			created_at: now,
			updated_at: now,
		}),
	);
	try {
		await db.batch(statements);
		invalidateCollectionReads(NOTIFICATION_COLLECTION);
	} catch (err) {
		// The inbox may not be seeded on this deploy — the DM is still attempted.
		console.error('[notify-employees] notification insert failed:', err instanceof Error ? err.message : String(err));
	}
}

/** Best-effort Telegram DMs — never throws; a failure is logged, not surfaced. */
async function pushNotifications(recipients: Recipient[], msg: EmployeeNotifyMessage): Promise<void> {
	const text = `${msg.title}\n${msg.body}`;
	await Promise.all(
		recipients
			.filter((r) => r.tgId)
			.map(async (r) => {
				const sent = await pushTelegram(r.tgId as string, text);
				if (!sent.ok) console.info('[notify-employees] telegram skipped:', sent.error);
			}),
	);
}

/**
 * Notify a set of employees: ONE durable row each + a best-effort DM. Recipients
 * without a Telegram id still get the durable row (they can read it in-app).
 * Returns the number of rows written. Never throws — a notification must never
 * fail the write it describes.
 */
export async function notifyEmployees(db: D1Client, employeeIds: string[], msg: EmployeeNotifyMessage): Promise<number> {
	try {
		const recipients = await employeesByIds(db, employeeIds);
		if (recipients.length === 0) return 0;
		await writeNotifications(db, recipients, msg);
		backgroundTask(pushNotifications(recipients, msg));
		return recipients.length;
	} catch (err) {
		console.error('[notify-employees] failed:', err instanceof Error ? err.message : String(err));
		return 0;
	}
}

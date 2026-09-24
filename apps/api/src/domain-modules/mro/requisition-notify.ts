/**
 * MRO requisition (store request) notifications — the same shape as the asset
 * transfer flow:
 *
 *   • FILED   → the requester's recorded superior(s) learn a stock request is
 *               waiting. Triggered by a compiled `after_insert` hook on
 *               `mro_requisitions` (the row is created through the generic
 *               entity API as `requisition_status: 'requested'`, so every writer
 *               notifies).
 *   • DECIDED → the requester learns the outcome: approved (confirm), rejected
 *               (close), or issued (stock released against it).
 *
 * Recipients are the SAME reporting edge the asset-transfer decision uses
 * (`hrm_employee_links.superior`). Delivery is owned by
 * `@/lib/notify-employees`.
 */

import { D1Client } from '@mmbix/core';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { escapeHtml } from '@/lib/telegram-push';
import { employeesByIds, notifyEmployees, superiorEmployeeIds } from '@/lib/notify-employees';
import { collectionTable } from '@/lib/utils/table-name';

/** One shared plugin id — the Studio hook viewer lists the rule once. */
export const MRO_REQUISITION_NOTIFY_PLUGIN = 'mro-requisition-notify' as const;

const REQUISITION = 'mro_requisitions';

export type RequisitionDecision = 'approved' | 'rejected' | 'issued';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The requester filed a stock request → tell their recorded superior(s). */
async function notifyRequestFiled(db: D1Client, doc: Record<string, unknown>): Promise<void> {
	const ownerId = str(doc?.requested_by);
	if (!ownerId) return;
	const superiors = await superiorEmployeeIds(db, ownerId);
	if (superiors.length === 0) return;

	const requester = (await employeesByIds(db, [ownerId]))[0];
	const who = requester?.name || 'ဝန်ထမ်း';
	const docNo = str(doc?.display_number) || 'ပစ္စည်းတောင်းခံလွှာ';
	await notifyEmployees(db, superiors, {
		title: '📦 ပစ္စည်းတောင်းခံလွှာ အသစ်',
		body: `${escapeHtml(who)} မှ ${escapeHtml(docNo)} တင်ထားပါသည်။\nကြည့်ရှု အတည်ပြုပေးပါ။`,
		type: 'approval',
		referenceId: str(doc?.id),
	});
}

/**
 * The requester's requisition was decided (approved / rejected / issued) → tell
 * them. Reads the request's OWN row for the requester + doc number, so the caller
 * only needs the id and the outcome.
 */
export async function notifyRequisitionDecided(db: D1Client, requestId: string, action: RequisitionDecision, reason = ''): Promise<void> {
	const row = await db.first<{ requested_by?: unknown; display_number?: unknown }>({
		sql: `SELECT requested_by, display_number FROM ${collectionTable(REQUISITION)} WHERE id = ?1 AND deleted_at IS NULL`,
		bindings: [requestId],
	});
	const ownerId = str(row?.requested_by);
	if (!ownerId) return;
	const docNo = str(row?.display_number) || 'ပစ္စည်းတောင်းခံလွှာ';

	const title =
		action === 'approved'
			? '✅ ပစ္စည်းတောင်းခံလွှာ အတည်ပြုပြီး'
			: action === 'rejected'
				? '❌ ပစ္စည်းတောင်းခံလွှာ ပယ်ဖျက်ပြီး'
				: '🚚 ပစ္စည်းတောင်းခံလွှာ ထုတ်ပေးပြီး';
	const body =
		action === 'approved'
			? `သင့် ${escapeHtml(docNo)} ကို အတည်ပြုပြီးပါပြီ။`
			: action === 'rejected'
				? `သင့် ${escapeHtml(docNo)} ကို ပယ်ဖျက်ပါသည်။${reason ? `\nအကြောင်းပြချက်: ${escapeHtml(reason)}` : ''}`
				: `သင့် ${escapeHtml(docNo)} အရ ပစ္စည်း ထုတ်ပေးပြီးပါပြီ။`;

	await notifyEmployees(db, [ownerId], { title, body, type: 'info', referenceId: requestId });
}

let registered = false;

/** Register the "request filed" hook — idempotent, called once at boot from
 *  `mountDomainModules`. */
export function registerMroRequisitionNotifyHooks(): void {
	if (registered) return;
	registered = true;

	pluginHookRegistry.register({
		collection: REQUISITION,
		event: 'after_insert',
		pluginId: MRO_REQUISITION_NOTIFY_PLUGIN,
		priority: 40,
		timeoutMs: 5_000,
		description: 'Notify the requester’s recorded superior(s) when a stock requisition is filed.',
		writesTo: ['hr_notifications'],
		handler: async (doc, db) => {
			await notifyRequestFiled(db, doc);
		},
	});
}

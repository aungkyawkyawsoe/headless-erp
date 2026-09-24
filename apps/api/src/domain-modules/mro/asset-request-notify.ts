/**
 * MRO asset-transfer notifications — the transfer/return/write-off request flow
 * tells the same two people the HR request flow does:
 *
 *   • FILED   → the requester's recorded superior(s) learn a request is waiting
 *               on them. Triggered by a compiled `after_insert` hook on
 *               `mro_asset_requests` (the row is created through the generic
 *               entity API, so every writer notifies).
 *   • DECIDED → the requester learns the outcome (approved / rejected /
 *               executed). Triggered by the `/api/mro/asset-requests/:id/…`
 *               routes.
 *
 * Recipients are the SAME reporting edge the decide guard enforces
 * (`hrm_employee_links.superior`), so a notification can never reach someone who
 * could not act on it. Delivery is owned by `@/lib/notify-employees`.
 */

import { D1Client } from '@mmbix/core';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { escapeHtml } from '@/lib/telegram-push';
import { employeesByIds, notifyEmployees, superiorEmployeeIds } from '@/lib/notify-employees';
import { collectionTable } from '@/lib/utils/table-name';

/** One shared plugin id — the Studio hook viewer lists the rule once. */
export const MRO_ASSET_REQUEST_NOTIFY_PLUGIN = 'mro-asset-request-notify' as const;

const ASSET_REQUEST = 'mro_asset_requests';

export type AssetRequestDecision = 'approved' | 'rejected' | 'executed';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The requester filed a transfer/return/write-off → tell their superior(s). */
async function notifyRequestFiled(db: D1Client, doc: Record<string, unknown>): Promise<void> {
	const ownerId = str(doc?.requested_by);
	if (!ownerId) return;
	const superiors = await superiorEmployeeIds(db, ownerId);
	if (superiors.length === 0) return;

	const requester = (await employeesByIds(db, [ownerId]))[0];
	const who = requester?.name || 'ဝန်ထမ်း';
	const docNo = str(doc?.display_number) || 'လွှဲပြောင်း တောင်းဆိုချက်';
	await notifyEmployees(db, superiors, {
		title: '📦 ပစ္စည်း လွှဲပြောင်း တောင်းဆိုချက် အသစ်',
		body: `${escapeHtml(who)} မှ ${escapeHtml(docNo)} တင်ထားပါသည်။\nအတည်ပြု/ပယ်ချ လုပ်ပေးပါ။`,
		type: 'approval',
		referenceId: str(doc?.id),
	});
}

/**
 * The requester's request was decided (approved / rejected / executed) → tell
 * them. Reads the request's OWN row for the requester + doc number, so the
 * caller only needs the id and the outcome.
 */
export async function notifyAssetRequestDecided(db: D1Client, requestId: string, action: AssetRequestDecision, reason = ''): Promise<void> {
	const row = await db.first<{ requested_by?: unknown; display_number?: unknown }>({
		sql: `SELECT requested_by, display_number FROM ${collectionTable(ASSET_REQUEST)} WHERE id = ?1 AND deleted_at IS NULL`,
		bindings: [requestId],
	});
	const ownerId = str(row?.requested_by);
	if (!ownerId) return;
	const docNo = str(row?.display_number) || 'လွှဲပြောင်း တောင်းဆိုချက်';

	const title =
		action === 'approved'
			? '✅ လွှဲပြောင်း တောင်းဆိုချက် အတည်ပြုပြီး'
			: action === 'rejected'
				? '❌ လွှဲပြောင်း တောင်းဆိုချက် ပယ်ချပြီး'
				: '🚚 လွှဲပြောင်း တောင်းဆိုချက် ဆောင်ရွက်ပြီး';
	const body =
		action === 'approved'
			? `သင့် ${escapeHtml(docNo)} ကို အတည်ပြုပြီးပါပြီ။`
			: action === 'rejected'
				? `သင့် ${escapeHtml(docNo)} ကို ပယ်ချပါသည်။${reason ? `\nအကြောင်းပြချက်: ${escapeHtml(reason)}` : ''}`
				: `သင့် ${escapeHtml(docNo)} ကို ဆောင်ရွက်ပြီးပါပြီ။`;

	await notifyEmployees(db, [ownerId], { title, body, type: 'info', referenceId: requestId });
}

let registered = false;

/** Register the "request filed" hook — idempotent, called once at boot from
 *  `mountDomainModules`. */
export function registerMroAssetRequestNotifyHooks(): void {
	if (registered) return;
	registered = true;

	pluginHookRegistry.register({
		collection: ASSET_REQUEST,
		event: 'after_insert',
		pluginId: MRO_ASSET_REQUEST_NOTIFY_PLUGIN,
		priority: 40,
		timeoutMs: 5_000,
		description: 'Notify the requester’s recorded superior(s) when an asset transfer/return/write-off request is filed.',
		writesTo: ['hr_notifications'],
		handler: async (doc, db) => {
			await notifyRequestFiled(db, doc);
		},
	});
}

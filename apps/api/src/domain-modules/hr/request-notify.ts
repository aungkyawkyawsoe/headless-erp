/**
 * HR request notifications — who learns what, when.
 *
 *   • FILED   → the requester's recorded superior(s) are told a request is
 *               waiting on them. Triggered by a compiled `after_update` hook on
 *               the transition `doc_status → pending_review` (the engine always
 *               drafts a new row, so submit — not insert — is the filing event),
 *               which means EVERY writer (tgapp, Studio, CLI, import) notifies.
 *   • DECIDED → the requester is told the outcome. Triggered by the sanctioned
 *               `/api/hr/requests/:kind/:id/decide` route, which already resolves
 *               the owner and the actor.
 *
 * Recipients are the SAME reporting edge the decision itself enforces
 * (`hrm_employee_links.superior`), so a notification can never reach someone who
 * could not act on it, and a request with no recorded superior notifies nobody
 * (deny-by-default). Delivery (durable inbox row + best-effort DM) is owned by
 * `@/lib/notify-employees`.
 */

import { D1Client } from '@mmbix/core';
import { pluginHookRegistry } from '@/core/plugin-hooks';
import { escapeHtml } from '@/lib/telegram-push';
import { employeesByIds, notifyEmployees, superiorEmployeeIds } from '@/lib/notify-employees';

/** One shared plugin id — the Studio hook viewer lists the rule once. */
export const HR_REQUEST_NOTIFY_PLUGIN = 'hr-request-notify' as const;

/** The three native request collections (mirror of `HR_REQUEST_TYPES`). */
export const HR_REQUEST_COLLECTIONS = ['hrm_leaves', 'hrm_overtimes', 'hrm_early_leaves'] as const;

/** Burmese noun per request collection — the ONE label both messages read. */
const HR_REQUEST_LABEL: Record<string, string> = {
	hrm_leaves: 'ခွင့်',
	hrm_overtimes: 'အချိန်ပို',
	hrm_early_leaves: 'စောထွက်ခွင့်',
};

const labelOf = (collection: string): string => HR_REQUEST_LABEL[collection] ?? 'လျှောက်လွှာ';

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The requester filed a request → tell their recorded superior(s). */
async function notifyRequestFiled(db: D1Client, collection: string, doc: Record<string, unknown>): Promise<void> {
	const ownerId = str(doc?.employee);
	if (!ownerId) return;
	const superiors = await superiorEmployeeIds(db, ownerId);
	if (superiors.length === 0) return;

	const requester = (await employeesByIds(db, [ownerId]))[0];
	const who = requester?.name || 'ဝန်ထမ်း';
	const label = labelOf(collection);
	await notifyEmployees(db, superiors, {
		title: `📝 ${label} လျှောက်လွှာ အသစ်`,
		body: `${escapeHtml(who)} မှ ${label} လျှောက်လွှာ တင်ထားပါသည်။\nအတည်ပြု/ပယ်ချ လုပ်ပေးပါ။`,
		type: 'approval',
		referenceId: str(doc?.id),
	});
}

/**
 * The requester's request was decided → tell them the outcome. `cancelled` is
 * the requester's OWN action, so it notifies nobody.
 */
export async function notifyRequestDecided(
	db: D1Client,
	collection: string,
	ownerId: string,
	action: 'approved' | 'rejected' | 'cancelled',
	reason: string,
	requestId: string,
): Promise<void> {
	if (!ownerId || action === 'cancelled') return;
	const label = labelOf(collection);
	const approved = action === 'approved';
	await notifyEmployees(db, [ownerId], {
		title: approved ? `✅ ${label} လျှောက်လွှာ အတည်ပြုပြီး` : `❌ ${label} လျှောက်လွှာ ပယ်ချပြီး`,
		body: approved
			? `သင့် ${label} လျှောက်လွှာကို အတည်ပြုပြီးပါပြီ။`
			: `သင့် ${label} လျှောက်လွှာကို ပယ်ချပါသည်။${reason ? `\nအကြောင်းပြချက်: ${escapeHtml(reason)}` : ''}`,
		type: 'info',
		referenceId: requestId,
	});
}

let registered = false;

/** Register the "request filed" hooks — idempotent, called once at boot from
 *  `mountDomainModules`. */
export function registerHrRequestNotifyHooks(): void {
	if (registered) return;
	registered = true;

	for (const collection of HR_REQUEST_COLLECTIONS) {
		pluginHookRegistry.register({
			collection,
			event: 'after_update',
			pluginId: HR_REQUEST_NOTIFY_PLUGIN,
			priority: 40,
			timeoutMs: 5_000,
			description: 'Notify the requester’s recorded superior(s) when a request is submitted for review (draft → pending_review).',
			writesTo: ['hr_notifications'],
			handler: async (doc, db) => {
				const previous = doc?._existing;
				const before = previous && typeof previous === 'object' ? str((previous as Record<string, unknown>).doc_status) : '';
				// ONLY the submit transition — a decision (approved/rejected) and a
				// no-op re-save must not fire it.
				if (str(doc?.doc_status) !== 'pending_review' || before === 'pending_review') return;
				await notifyRequestFiled(db, collection, doc);
			},
		});
	}
}

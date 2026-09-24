/**
 * Pure row → card mapping for the notification inbox. Kept apart from `api.ts`
 * (which imports the SDK/browser client) so it is unit-testable in a node env.
 */
import type { HrNotificationRow, NotificationCardModel, NotificationKind } from './types';

/** A raw `hr_notifications` row → the display-ready card model. */
export function notificationOf(row: HrNotificationRow): NotificationCardModel {
	const type = typeof row.type === 'string' ? row.type : '';
	const kind: NotificationKind = type === 'approval' || type === 'reminder' ? type : 'info';
	return {
		id: typeof row.id === 'string' ? row.id : '',
		title: typeof row.title === 'string' && row.title ? row.title : 'အသိပေးချက်',
		body: typeof row.body === 'string' ? row.body : '',
		kind,
		read: row.read === true || row.read === 1 || row.read === '1',
		referenceId: typeof row.reference_id === 'string' && row.reference_id ? row.reference_id : null,
		createdAt: typeof row.created_at === 'string' && row.created_at ? row.created_at : null,
	};
}

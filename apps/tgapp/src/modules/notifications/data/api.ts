import type { MmbixClient } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { LIST_PAGE_SIZE } from '@/shared/constants';
import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { notificationOf } from './map';
import type { HrNotificationRow, NotificationCardModel } from './types';

/**
 * The inbox's typed client — the same local-cast pattern as every sibling
 * module. Reads/writes touch `hr_notifications`, which the server row-filters to
 * the signed session's own `tg_id`, so no recipient is ever named client-side.
 */
type OpsSchema = { hr_notifications: HrNotificationRow } & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** Every column the card renders. */
const NOTIFICATION_FIELDS = ['id', 'title', 'body', 'type', 'reference_id', 'read', 'created_at'] as const;

/**
 * One page of the session's notifications — `LIST_PAGE_SIZE` rows, newest first,
 * cursor-paginated (the page streams pages via `useCursorList`). Scoping is
 * SERVER-side (the role's self row filter), so this read can only ever return
 * the caller's own rows.
 */
export async function fetchNotificationsPage(cursor?: string): Promise<CursorPage<NotificationCardModel>> {
	const res = await ops.items('hr_notifications').list({
		fields: NOTIFICATION_FIELDS,
		sort: '-created_at',
		limit: LIST_PAGE_SIZE,
		cursor,
	});
	return {
		rows: res.data.map(notificationOf),
		nextCursor: res.meta.next_cursor ?? null,
		hasMore: res.meta.has_more,
	};
}

/** Mark ONE notification read — a generic update, guarded by the same self row
 *  filter, so a caller can only ever touch their own row. */
export async function markNotificationRead(id: string): Promise<void> {
	if (!id) return;
	await ops.items('hr_notifications').update(id, { read: true } as never);
}

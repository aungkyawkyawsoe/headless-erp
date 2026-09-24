import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { NotificationCard } from '../components/notification-card';
import { fetchNotificationsPage, markNotificationRead } from '../data/api';
import { NOTIFICATIONS_STALE_MS, qk } from '../data/query-keys';
import type { NotificationCardModel } from '../data/types';
import { ListPage } from '@/shared/components/list-page';
import { listPageErrorProps, useCursorList } from '@/shared/hooks/use-cursor-list';

/**
 * အသိပေးချက် — the in-app notification inbox (`/app/notifications`, launcher tile
 * `notifications`).
 *
 * The app's ONE inbox: an HR leave/OT/early request decision, an MRO
 * asset-transfer approval/execution, and a store requisition's approve/issue all
 * file a durable row here (plus a best-effort Telegram DM). The read is scoped
 * SERVER-side to the signed session's own Telegram id, so a colleague's
 * notifications are never on the wire. Newest first; tapping a row marks it read.
 */
export default function NotificationsPage() {
	const queryClient = useQueryClient();
	const list = useCursorList({
		queryKey: qk.notifications(),
		fetcher: (cursor) => fetchNotificationsPage(cursor),
		staleTime: NOTIFICATIONS_STALE_MS,
	});

	// Mark read on open — a no-op for an already-read row, so a double tap never
	// re-writes. The prefix invalidation clears the unread dot immediately.
	const onOpen = useCallback(
		(notification: NotificationCardModel) => {
			if (notification.read) return;
			void markNotificationRead(notification.id).then(() => queryClient.invalidateQueries({ queryKey: qk.notificationsAll() }));
		},
		[queryClient],
	);

	const renderItem = useCallback(
		(notification: NotificationCardModel) => (
			<NotificationCard key={notification.id} notification={notification} onOpen={() => onOpen(notification)} />
		),
		[onOpen],
	);

	return (
		<ListPage
			{...listPageErrorProps(list)}
			title="အသိပေးချက်"
			rows={list.rows}
			isPending={list.isPending}
			skeletonVariant="dense"
			renderItem={renderItem}
			emptyState={{
				title: 'အသိပေးချက် မရှိပါ',
				hint: 'သင့်လျှောက်လွှာ အတည်ပြု/ပယ်ချ ဖြစ်တဲ့အခါ ဒီမှာ ပေါ်လာပါမယ်။',
			}}
			pagination={{
				hasNextPage: list.hasNextPage,
				isFetchingNextPage: list.isFetchingNextPage,
				onLoadMore: () => void list.fetchNextPage(),
				waitForScroll: true,
			}}
			searchPlaceholder="အသိပေးချက် ရှာရန်"
			// The inbox is small and personal; the search narrows the rows already
			// loaded rather than a server term, and says so (`searchScopeNote`).
			fetchSearch={async (query) => {
				const term = query.trim().toLowerCase();
				return term ? list.rows.filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(term)) : list.rows;
			}}
			searchScopeNote="Loaded notifications only"
		/>
	);
}

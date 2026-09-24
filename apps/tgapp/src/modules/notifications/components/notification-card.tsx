import { ErpRow } from '@/shared/components/erp-row';
import { formatRelativeTime } from '@/shared/time/myanmar';
import type { NotificationCardModel } from '../data/types';

/**
 * One inbox row — the app's shared `ErpRow` vocabulary: the notification TITLE
 * is the anchor, its age the tertiary fact, and the MESSAGE the always-visible
 * detail (a notification exists to be read, so the body is not hidden behind a
 * disclosure). An unread row carries a leading dot; tapping it marks it read.
 */
export function NotificationCard({ notification, onOpen }: { notification: NotificationCardModel; onOpen: () => void }) {
	return (
		<ErpRow
			className="rounded-xl border border-border bg-card shadow-sm"
			anchor={notification.title}
			tertiary={notification.createdAt ? formatRelativeTime(notification.createdAt) : undefined}
			leading={notification.read ? undefined : <span className="mt-1.5 block size-2 rounded-full bg-primary" aria-label="Unread" />}
			meta={[{ label: 'Message', value: notification.body || '—', wide: true }]}
			metaAlwaysVisible
			onOpen={onOpen}
		/>
	);
}

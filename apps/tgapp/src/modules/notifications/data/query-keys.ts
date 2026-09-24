/**
 * TanStack Query key factory for the အသိပေးချက် (notification inbox) module.
 *
 * The inbox is a cursor-paginated read of `hr_notifications` under its own
 * `['notifications', …]` namespace. Marking a row read invalidates the prefix so
 * the unread indicator clears without a full reload.
 */

import { STALE_MS } from '@/shared/api/invalidation';

/** Decisions land a moment after the acting superior taps, so the inbox
 *  refreshes on the ordinary module window. */
export const NOTIFICATIONS_STALE_MS = STALE_MS.module;

export const qk = {
	/** The cursor-paginated inbox list. */
	notifications: () => ['notifications', 'list'] as const,
	/** Prefix of every inbox query — invalidated after a mark-read. */
	notificationsAll: () => ['notifications'] as const,
};

/**
 * Row + card shapes for the in-app notification inbox (`hr_notifications`).
 *
 * The collection is the app's ONE inbox: HR request decisions, MRO asset-transfer
 * and requisition outcomes all file a row here, each addressed to the recipient's
 * Telegram id (`tg_id`). The server row filter scopes a read to the signed
 * session, so the client never passes — or can forge — a recipient.
 */

/** A raw `hr_notifications` row (the engine's projection). */
export interface HrNotificationRow {
	id?: unknown;
	tg_id?: unknown;
	title?: unknown;
	body?: unknown;
	type?: unknown;
	reference_id?: unknown;
	read?: unknown;
	created_at?: unknown;
}

export type NotificationKind = 'approval' | 'info' | 'reminder';

/** The card's resolved shape — display-ready, no raw wire values. */
export interface NotificationCardModel {
	id: string;
	title: string;
	body: string;
	kind: NotificationKind;
	read: boolean;
	/** The document id the notification is about (a request), when known. */
	referenceId: string | null;
	createdAt: string | null;
}

/**
 * The user directory's saved VIEWS — Directus's sidebar list (Active Users /
 * Suspended Users / Invited Users / All Users), in Directus's order.
 *
 * A view is a FILTER over the one `_users` read, never a write and never a
 * destination: its state lives in the URL (`?view=`) so a reload or a pasted
 * link restores the same view, and switching one is a REPLACE (the URL/history
 * contract in `lib/view-state.ts`) — the section keeps its ONE history entry.
 *
 * ONE array drives every control: the portal's panel rows (`ViewsPanel`), the
 * Studio Admin toolbar toggle and the table's own filter + empty state. They
 * cannot disagree about which views exist or what they are called.
 */
import { useCallback } from 'react';
import type { LucideIcon } from 'lucide-react';
import { UserCheck, UserPlus, UserX, Users } from 'lucide-react';
import { useViewState } from './view-state';

/** The URL param the active view lives in. */
export const USER_VIEW_PARAM = 'view';

/**
 * Every view a user directory can show: the three stored states, plus `all`.
 *
 * `unknown` (a row that arrived with no status) is deliberately NOT a view — it
 * is not a state anyone chooses, it is what a row without one reads as. Those
 * rows are reachable through All, where nothing is claimed about them.
 */
export type UserViewId = 'active' | 'suspended' | 'invited' | 'all';

export interface UserView {
	id: UserViewId;
	label: string;
	icon: LucideIcon;
}

/**
 * The views, in Directus's order and wording. Active FIRST is load-bearing: the
 * first entry is the default a bare `/idp/users` lands on, mirroring Directus's
 * `/admin/users` (Active Users).
 */
export const USER_VIEWS: UserView[] = [
	{ id: 'active', label: 'Active Users', icon: UserCheck },
	{ id: 'suspended', label: 'Suspended Users', icon: UserX },
	{ id: 'invited', label: 'Invited Users', icon: UserPlus },
	{ id: 'all', label: 'All Users', icon: Users },
];

const DEFAULT_USER_VIEW: UserViewId = USER_VIEWS[0].id;

/** The active view for a raw `?view=` value. A value outside the vocabulary —
 *  or none at all — reads as the default rather than leaving the table in a
 *  "no view" state. */
export function resolveUserView(raw: string | null | undefined): UserViewId {
	const hit = USER_VIEWS.find((v) => v.id === raw);
	return hit ? hit.id : DEFAULT_USER_VIEW;
}

/**
 * The ONE view state both surfaces share: the portal's panel drives it, Studio
 * Admin's toolbar toggle drives it, and the table filters by the SAME value.
 *
 * The default is written as the BARE url — `?view=active` and no param are the
 * same view, and only one of them is canonical (`/idp/users`, the Directus
 * landing).
 */
export function useUserView(): { view: UserViewId; selectView: (id: UserViewId) => void } {
	const { searchParams, update } = useViewState();
	const view = resolveUserView(searchParams.get(USER_VIEW_PARAM));
	const selectView = useCallback(
		(id: UserViewId) => {
			update((p) => {
				if (id === DEFAULT_USER_VIEW) p.delete(USER_VIEW_PARAM);
				else p.set(USER_VIEW_PARAM, id);
			});
		},
		[update],
	);
	return { view, selectView };
}

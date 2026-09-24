/**
 * Design-B role → app access — the ONE predicate behind "may this session open
 * app X", plus its React binding.
 *
 * There are TWO independent gates in the DB, and an app opens only when BOTH
 * pass. Conflating them is the bug this module exists to prevent:
 *
 *   1. `_roles.app_access` — the launcher allow-list. Reaches the client as
 *      `/auth/me apps`. Semantics (identical to the launcher grid):
 *
 *        - admin, or `apps` null/absent (uncurated role / pre-migration API) → allowed
 *        - `apps` = a list                                                    → only those ids
 *        - `apps` = an empty list                                             → nothing
 *
 *   2. `_role_permissions` — per-COLLECTION grants. Reaches the client as
 *      `/auth/me granted_collections`:
 *
 *        - `'*'`            → every collection (admin / role with no curator)
 *        - a list           → read those slugs only
 *        - null/absent      → endpoint answered before the field existed → unknown
 *
 * Gate 1 alone is NOT enough to render an app: it gates the launcher TILE, while
 * every read the tile performs is gated by gate 2. A role can therefore hold
 * `projects` in its allow-list while `_role_permissions` has no row for
 * `hrm_projects`/`hrm_tasks` — the tile appears, the app opens, and every list
 * read 403s. `APP_COLLECTIONS` (shared with the Studio, in `@mmbix/types`) closes
 * that gap by making the second gate part of the SAME predicate, so "no read
 * permission" hides the app's UI instead of painting it and then failing.
 *
 * The launcher renders its tiles through this same predicate, and an in-page gate
 * (e.g. the attendance dashboard showing the Projects app's tasks) MUST reuse it
 * rather than hand-roll a second, drifting rule.
 */
import { useEffect, useState } from 'react';

import { APP_COLLECTIONS } from '@mmbix/types';

import { fetchMe, getCachedMe, subscribeMe, type MeUser } from './auth';

/**
 * The engine collections each launcher app READS — re-exported so the mini app
 * keeps one import site while the mapping itself lives in `@mmbix/types` beside
 * the Studio's auto-grant (the two must never drift; see the module doc there).
 */
export { APP_COLLECTIONS };

/**
 * May the session read `slug`? Mirrors the API's `businessGuard`: admin and the
 * `'*'` sentinel pass freely; a null/absent list is the pre-migration API shape
 * (treat as unrestricted — the API is the real enforcer, this only decides
 * whether to paint UI); a list is an exact-membership test.
 */
export function canReadCollection(me: MeUser, slug: string): boolean {
	if (me.is_admin) return true;
	const granted = me.granted_collections;
	if (granted == null || granted === '*') return true;
	return granted.includes(slug);
}

/** May `me` open the launcher app `appId`? Both gates must pass. */
export function isAppAllowed(me: MeUser, appId: string): boolean {
	if (me.is_admin) return true;

	const allow = me.apps;
	if (Array.isArray(allow) && allow.length === 0) return false;
	if (Array.isArray(allow) && !allow.includes(appId)) return false;

	// Gate 2 — the app's backing collections must be readable, or the app would
	// open onto a 403 on every screen.
	return (APP_COLLECTIONS[appId] ?? []).every((slug) => canReadCollection(me, slug));
}

export interface AppAccess {
	/** True once `/auth/me` has settled (success or failure) — before that, a
	 *  gate should keep its app-dependent UI hidden rather than flash it. */
	resolved: boolean;
	/** May the session open the launcher app `appId`? */
	canOpen: (appId: string) => boolean;
}

/**
 * The session's app-access decision, read from the memoized `/auth/me` (the
 * AuthGate has already fetched it, so this costs no extra round-trip). A failed
 * read resolves to "nothing allowed" — the app-dependent UI stays hidden, which
 * is the safe direction for a purely cosmetic gate (the API enforces RBAC).
 */
export function useAppAccess(): AppAccess {
	// Seed from the synchronous cache so an in-page gate paints its resolved state
	// immediately on a normal load (the AuthGate's boot already populated it).
	const [state, setState] = useState<{ resolved: boolean; me: MeUser | null }>(() => {
		const cached = getCachedMe();
		return { resolved: cached !== null, me: cached };
	});

	useEffect(() => {
		if (state.resolved) return;
		let alive = true;
		fetchMe()
			.then((me) => alive && setState({ resolved: true, me }))
			.catch(() => alive && setState({ resolved: true, me: null }));
		return () => {
			alive = false;
		};
	}, [state.resolved]);

	// `/auth/me` is memoized for the life of the page load, so a role/permission
	// change made while this Mini App stays open (Telegram re-shows the WebView
	// without reloading it) would never repaint the launcher or an in-page gate.
	//
	// The AuthGate OWNS the resume re-read — it must also turn a 401 revocation
	// into a logout/relogin. This hook only SUBSCRIBES to the published result, so
	// every mounted consumer (the launcher, an in-page gate, …) shares that ONE
	// `/auth/me` on resume. Each consumer calling `refreshMe` for itself instead
	// nulled the shared in-flight promise and stacked a duplicate request per
	// consumer. A failed refresh publishes nothing, so the last known grants stay.
	useEffect(() => subscribeMe((me) => setState({ resolved: true, me })), []);

	return {
		resolved: state.resolved,
		canOpen: (appId) => (state.me ? isAppAllowed(state.me, appId) : false),
	};
}

/**
 * Studio capabilities — the pure half of RBAC-aware UI.
 *
 * The API is the real enforcer (every admin route 403s). This module only
 * decides what the UI OFFERS, from the signed session's `/auth/me` — so a
 * non-admin never sees a control the server would reject (PoLP, Poka-Yoke).
 *
 * `granted_collections` semantics mirror the backend `businessGuard`:
 *   - `'*'` or absent  → unknown / unrestricted (do NOT over-hide)
 *   - a list           → exact membership
 */

export interface CapabilitySubject {
	is_admin?: boolean;
	granted_collections?: string[] | '*' | null;
}

/** Is the session the system administrator? */
export function isAdmin(me?: CapabilitySubject | null): boolean {
	return me?.is_admin === true;
}

/**
 * May the session read `slug`? Unknown/absent grants return `true` (the API is
 * the real gate; hiding on an unknown would hide a control that actually works).
 */
export function canReadCollection(me: CapabilitySubject | null | undefined, slug: string): boolean {
	if (!me) return false;
	if (me.is_admin) return true;
	const granted = me.granted_collections;
	if (granted == null || granted === '*') return true;
	return Array.isArray(granted) && granted.includes(slug);
}

/** Admin-only surfaces: roles, users, API keys, config, events, DS exports. */
export function canAdminister(me?: CapabilitySubject | null): boolean {
	return isAdmin(me);
}

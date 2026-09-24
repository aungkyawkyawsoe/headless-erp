/**
 * The engine collections each launcher app READS — THE cross-app definition.
 *
 * There are TWO independent gates behind "may this role open app X", and an app
 * opens only when BOTH pass:
 *
 *   1. `_roles.app_access` — the launcher allow-list (the Studio's board
 *      checkboxes; reaches the mini app as `/auth/me apps`).
 *   2. `_role_permissions` — a per-collection `can_read` grant for every slug
 *      listed here.
 *
 * Gate 1 alone is NOT enough: the launcher tile appears, the app opens, and then
 * every read 403s. Both sides of the wire need the SAME mapping to close that
 * gap — the mini app turns it into "hide the app's UI" (`isAppAllowed`), and the
 * Studio turns it into "ticking an app auto-grants read on its collections"
 * (`appRequiredCollections` → `roles-tab.saveRole`). Keeping two copies meant the
 * compiler could not catch drift between the gate that denies and the grant that
 * allows, so the two lived in separate bundles and only a comment tied them
 * together. This module is the one source; both apps import it.
 *
 * An app absent here has no collection requirement: correct for apps that read
 * nothing (Settings, Profile) and the deliberate default for apps not yet mapped.
 * Unknown is treated as "no requirement" rather than "denied", so an unmapped app
 * never disappears from a role that could use it.
 */
export const APP_COLLECTIONS: Record<string, string[]> = {
	// Projects — the HR project/task board: `hrm_projects` → `hrm_tasks`.
	projects: ['hrm_projects', 'hrm_tasks'],
	// Attendance — the dashboard's own collection (the Projects task feed it may
	// also show is gated separately, by the `projects` entry above).
	attendance: ['hrm_attendances'],
	// Employees — the HR directory.
	hr: ['hrm_employees'],
};

/**
 * Every collection the selected apps require `can_read` on. `null` (the "every
 * app" board) has no per-app mapping and yields nothing — an unrestricted board
 * is not auto-granted per collection. Duplicates are collapsed so one collection
 * shared by two apps writes a single permission row.
 */
export function appRequiredCollections(apps: string[] | null | undefined): string[] {
	if (!apps || apps.length === 0) return [];
	const slugs = new Set<string>();
	for (const id of apps) {
		for (const slug of APP_COLLECTIONS[id] ?? []) slugs.add(slug);
	}
	return [...slugs];
}

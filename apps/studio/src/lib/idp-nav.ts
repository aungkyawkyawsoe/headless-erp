/**
 * The IDP portal's navigation registry — the ONE source of truth for the
 * activity bar (tier 1), each section's side panel (tier 2) and the ⌘K palette
 * entries. Mirrors the `lib/app-sections.ts` precedent: the rail, the panel and
 * the command list are all DERIVED from `IDP_SECTIONS`, so a new surface is one
 * registry entry rather than three edits that drift apart.
 *
 * Two invariants keep it honest:
 *   • the active section is DERIVED from the pathname (`activeSectionForPath`),
 *     never passed down by each page — a page cannot disagree with the rail;
 *   • a section's `match` entries are the ONLY spellings of its routes, and no
 *     two sections may own the same one (pinned by `idp-nav.spec.ts`).
 */
import type { LucideIcon } from 'lucide-react';
import { BookOpen, Database, Gauge, Home, LayoutGrid, Plus, ShieldCheck, Users } from 'lucide-react';

export type IdpSectionId = 'overview' | 'catalog' | 'collections' | 'access' | 'users' | 'governance' | 'api-docs';

/** What the side panel shows while this section is active. */
export type IdpPanelSpec =
	/** The live collections registry (`CollectionsPanel`). */
	| { kind: 'collections' }
	/** A short list of the section's pages (`LinksPanel`). */
	| { kind: 'links'; items: Array<{ label: string; path: string; icon: LucideIcon }> }
	/** The user directory's saved views, Directus's sidebar (`ViewsPanel`): the
	 *  rows are view state (`?view=` — replace), a filter in place, not a
	 *  destination. The list itself is `lib/user-view.ts` (`USER_VIEWS`). */
	| { kind: 'views' }
	/** No panel at all — for a section that is ONE page with no entities to list. */
	| { kind: 'none' };

export interface IdpSection {
	id: IdpSectionId;
	/** Rail tooltip + panel title. */
	label: string;
	icon: LucideIcon;
	/** Where a rail click lands. */
	path: string;
	/** Every route this section owns (longest match wins). */
	match: string[];
	/** Hide from a session the API would 403 (PoLP). */
	adminOnly?: boolean;
	panel: IdpPanelSpec;
}

/** The portal root. Exact-only: it must not swallow `/idp/<anything>`. */
const ROOT = '/idp';

export const IDP_SECTIONS: IdpSection[] = [
	{
		id: 'overview',
		label: 'Overview',
		icon: Home,
		path: ROOT,
		match: [ROOT],
		// The panel here used to be a labeled directory of the portal's own domains
		// (the icon-ambiguity answer while the rail is icons-only). It was the RAIL's
		// OWN LIST one tier down — the rail already names every domain in its
		// tooltips, so the column was a duplicate of tier 1, not information the page
		// does not already carry. The page keeps the canvas instead (the scorecard).
		panel: { kind: 'none' },
	},
	{
		id: 'catalog',
		label: 'Catalog',
		icon: LayoutGrid,
		path: '/idp/catalog',
		match: ['/idp/catalog', '/idp/create'],
		panel: {
			kind: 'links',
			items: [
				{ label: 'Catalog', path: '/idp/catalog', icon: LayoutGrid },
				{ label: 'Create', path: '/idp/create', icon: Plus },
			],
		},
	},
	{
		id: 'collections',
		label: 'Collections',
		icon: Database,
		path: '/idp/collections',
		match: ['/idp/collections'],
		panel: { kind: 'collections' },
	},
	{
		// Roles & Access splits into two PAGES: User Roles (the role registry + its
		// profile form) and Access Policies (the permission matrix per role). The
		// panel lists those two pages — it no longer enumerates the roles, because
		// the registry is the User Roles page's own table now (Directus: the table
		// IS the page), and a panel copy of it would be the same rows twice.
		id: 'access',
		label: 'Roles & Access',
		icon: ShieldCheck,
		path: '/idp/access',
		match: ['/idp/access', '/idp/access/roles', '/idp/access/policies'],
		panel: {
			kind: 'links',
			items: [
				{ label: 'User Roles', path: '/idp/access/roles', icon: Users },
				{ label: 'Access Policies', path: '/idp/access/policies', icon: ShieldCheck },
			],
		},
	},
	{
		// The directory's saved views, as Directus keeps them: a sidebar list
		// (Active Users first — the default a bare `/idp/users` lands on — then
		// Suspended, Invited, All). They filter the table in place (`?view=` —
		// replace, the URL/history contract), so the section still owns ONE
		// history entry; `USER_VIEWS` (`lib/user-view.ts`) is the one list the
		// panel, the Studio Admin toolbar toggle and the empty state derive from.
		id: 'users',
		label: 'Users',
		icon: Users,
		path: '/idp/users',
		match: ['/idp/users'],
		panel: { kind: 'views' },
	},
	{
		id: 'governance',
		label: 'Governance',
		icon: Gauge,
		path: '/idp/policies',
		match: ['/idp/policies'],
		panel: {
			kind: 'links',
			items: [{ label: 'Policies', path: '/idp/policies', icon: Gauge }],
		},
	},
	{
		// The API reference used to be a standalone `/api-docs` page OUTSIDE the
		// shell (its own header + theme toggle), so it could not be a rail item.
		// It is a portal destination like any other now; `/api-docs` still resolves
		// (a route-level redirect in App.tsx) so old links and bookmarks keep working.
		id: 'api-docs',
		label: 'API Docs',
		icon: BookOpen,
		path: '/idp/api-docs',
		match: ['/idp/api-docs'],
		// No panel: the section IS the page. A tier-2 list would hold one row that
		// links to itself — the shell renders `panel: null` and the docs go full-bleed.
		panel: { kind: 'none' },
	},
];

const OVERVIEW = IDP_SECTIONS[0];
const CATALOG = IDP_SECTIONS[1];

/** `true` when `pathname` is exactly `prefix` or lives beneath it (`prefix/x`). */
function under(pathname: string, prefix: string): boolean {
	// The root is exact-only — `/idp/create`, `/idp/users`, … belong to their own
	// section, and `/idp/<slug>` is an app-detail page (Catalog).
	return pathname === prefix || (prefix !== ROOT && pathname.startsWith(`${prefix}/`));
}

/**
 * The section that owns `pathname`. Longest match first, so `/idp/collections`
 * outranks the root. Anything else under the portal is an app-detail page
 * (`/idp/:slug`) → Catalog; anything outside it (or a blank pathname) →
 * Overview. Total: never throws, never returns undefined, so the rail always
 * has exactly one active item.
 */
export function activeSectionForPath(pathname: string | undefined | null): IdpSection {
	const path = (pathname ?? '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
	const hit = IDP_SECTIONS.flatMap((section) => section.match.map((m) => ({ section, m })))
		.sort((a, b) => b.m.length - a.m.length)
		.find(({ m }) => under(path, m));
	if (hit) return hit.section;
	return path.startsWith(`${ROOT}/`) ? CATALOG : OVERVIEW;
}

/** The rail's items for this session — an admin-only section never renders for a non-admin (PoLP). */
export function visibleSections(isAdmin: boolean): IdpSection[] {
	return IDP_SECTIONS.filter((s) => !s.adminOnly || isAdmin);
}

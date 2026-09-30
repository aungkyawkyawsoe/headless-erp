/**
 * The app workbench's MODES — the ONE source of truth for the section list, its
 * route shape and the legacy `?section=` mapping.
 *
 * A mode is a real route PATH (`/apps/:slug/<mode>`), not a query param: a mode
 * change is real navigation (push), so each mode owns its own history entry and
 * the back arrow leaves the workbench in one press. The focused collection /
 * view / row stay QUERY PARAMS (view state — replace, never push). See
 * `lib/view-state.ts` for the full Studio URL/history contract.
 *
 * Why this module exists: the mode list used to be written twice — a literal
 * array in the workbench header and a ternary chain in the page — so adding or
 * renaming a mode meant editing both and hoping they stayed in step. Those two
 * spellings are now derived from `APP_SECTIONS` here.
 */

/** The workbench modes, in switcher order. The ONLY list — everything derives from it. */
export const APP_SECTIONS = ['models', 'menus', 'pages'] as const;

export type AppSection = (typeof APP_SECTIONS)[number];

/** Where a bare `/apps/:slug` (or an unrecognised segment) lands. */
export const DEFAULT_APP_SECTION: AppSection = 'models';

/** Narrow an arbitrary string to a known mode. */
export function isAppSection(value: string): value is AppSection {
	return (APP_SECTIONS as readonly string[]).includes(value);
}

/**
 * A route segment (or the whole `*` splat) → the active mode, clamped to the
 * default when the segment is absent or unknown, so a bad link renders a real
 * pane instead of blanking the layout.
 */
export function resolveAppSection(raw: string | undefined | null): AppSection {
	const segment = (raw ?? '').split('/')[0];
	return isAppSection(segment) ? segment : DEFAULT_APP_SECTION;
}

/** The canonical path for a mode — the ONE place the route shape is written. */
export function appSectionPath(slug: string, section: AppSection): string {
	return `/apps/${slug}/${section}`;
}

/**
 * Map a LEGACY `?section=` value (a pre-mode-route bookmark like `?section=menu`)
 * onto a mode, or `null` when the param is absent. Any unrecognised value still
 * lands on a real mode rather than blanking the screen.
 */
export function legacySectionTarget(legacy: string | null | undefined): AppSection | null {
	if (!legacy) return null;
	if (legacy === 'menu' || legacy === 'menus') return 'menus';
	if (legacy === 'builder' || legacy === 'pages') return 'pages';
	return DEFAULT_APP_SECTION;
}

/**
 * Rewrite query params that do not belong to the active mode, so a pasted or
 * shared link never carries a foreign mode's state:
 *
 *   • `page` / `template` are the pages mode's; drop them everywhere else.
 *   • the models mode only knows the `table` / `schema` view — clamp a stale
 *     builder value (e.g. `view=form`) so the right-hand field panel still renders.
 *
 * Pure: the input is never mutated, a copy is returned. `changed` is `false`
 * when the params were already valid, so the caller can skip the history write.
 */
export function normalizeSectionParams(section: AppSection, params: URLSearchParams): { params: URLSearchParams; changed: boolean } {
	const next = new URLSearchParams(params);
	let changed = false;
	if (section !== 'pages' && (next.has('page') || next.has('template'))) {
		next.delete('page');
		next.delete('template');
		changed = true;
	}
	if (section === 'models' && next.has('view') && next.get('view') !== 'table' && next.get('view') !== 'schema') {
		next.set('view', 'schema');
		changed = true;
	}
	return { params: next, changed };
}

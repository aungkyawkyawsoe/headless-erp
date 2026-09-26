import { useCallback, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DEFAULT_APP_SECTION, appSectionPath, isAppSection, resolveAppSection, type AppSection } from './app-sections';

/**
 * The app workbench's mode routing — the ONE place the active mode is read from
 * the URL and a mode change is turned into real navigation.
 *
 * A mode is a route PATH (`/apps/:slug/<mode>`), so switching mode is real
 * navigation (push) and each mode owns its own history entry; the focused
 * collection / view / row stay query params (view state — replace, never push).
 * See `lib/view-state.ts` for the Studio URL/history contract.
 *
 * Two jobs:
 *   1. Derive the active mode from the `*` splat, clamping anything unknown to
 *      the default mode so a bad link renders a real pane, not a blank layout.
 *   2. Canonicalise a bare `/apps/:slug` (the apps grid + IDP catalog link here)
 *      to the default mode with a REPLACE, so the entry never stacks a second
 *      copy of the same screen and a pasted bad link self-heals.
 */
export function useAppSectionRoute(slug: string | undefined): { section: AppSection; setSection: (s: AppSection) => void } {
	const params = useParams();
	const navigate = useNavigate();
	const rawMode = (params['*'] ?? '').split('/')[0];
	const section = resolveAppSection(rawMode);
	useEffect(() => {
		if (!slug || isAppSection(rawMode)) return;
		navigate(appSectionPath(slug, DEFAULT_APP_SECTION), { replace: true });
	}, [rawMode, slug, navigate]);
	const setSection = useCallback(
		(s: AppSection) => {
			// A mode change is a PATH change → real navigation (PUSH), not a view-state write.
			if (!slug) return;
			navigate(appSectionPath(slug, s));
		},
		[slug, navigate],
	);
	return { section, setSection };
}

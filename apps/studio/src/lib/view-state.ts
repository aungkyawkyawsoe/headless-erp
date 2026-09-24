import { useCallback } from 'react';
import { useSearchParams, type NavigateFunction } from 'react-router-dom';

/**
 * Studio URL/history contract — ONE rule for every screen (existing, new, future):
 *
 *   • A route PATH is a real screen. Changing it IS navigation → <Link> / navigate() PUSH.
 *   • A route's QUERY PARAMS are the current screen's view state — which section, the
 *     table-vs-schema toggle, the focused collection/row/page/template, etc. They stay
 *     URL-backed so reloads and pasted links restore the same view, but changing them is
 *     NOT navigation and must NOT create a history entry.
 *
 * Consequence: every screen owns exactly ONE history entry — the one created when its
 * real route (path) was navigated to — and the back arrow leaves the screen in one
 * press. It never has to walk back through every section/collection/row the user
 * switched to while on that screen.
 *
 *   ✅ useViewState().update/commit  — URL-backed view-state writes (REPLACE, default)
 *   ✅ popBack(navigate, fallback)    — explicit "← Back" buttons (real pop when possible)
 *   🚫 NEVER call setSearchParams() from useSearchParams directly (forgets { replace })
 *   🚫 NEVER push a history entry for a pure ?param change
 */
export function useViewState() {
	const [searchParams, setSearchParams] = useSearchParams();

	/** Replace the current history entry with these (already built) params. */
	const commit = useCallback((next: URLSearchParams) => setSearchParams(next, { replace: true }), [setSearchParams]);

	/** Clone the current params, run mutate() on the copy, then commit() (replace — never push). */
	const update = useCallback(
		(mutate: (p: URLSearchParams) => void) => {
			const next = new URLSearchParams(searchParams);
			mutate(next);
			commit(next);
		},
		[searchParams, commit],
	);

	return { searchParams, update, commit };
}

/**
 * True when the current entry has a real previous entry beneath it. React Router stamps
 * `idx` (the entry's session-history position) onto every entry it pushes — a cold open
 * (deep link, reload, first load) sits at `idx === 0` with nothing to pop. Mirrors
 * `apps/client app/src/shared/platform/history.ts` so both apps share one back philosophy.
 */
export function canGoBackInHistory(): boolean {
	return ((window.history.state?.idx as number | undefined) ?? 0) > 0;
}

/**
 * The ONE back action for explicit "← Back" buttons: pop the real previous entry when
 * one exists, otherwise REPLACE to `fallback`. Never PUSH — a push would stack a second
 * copy of the destination under the current screen, and the next back press would walk
 * back into the screen you just left ("too many presses" regression this prevents).
 */
export function popBack(navigate: NavigateFunction, fallback: string): void {
	if (canGoBackInHistory()) navigate(-1);
	else navigate(fallback, { replace: true });
}

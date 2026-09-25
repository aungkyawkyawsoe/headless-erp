import { useEffect, useState } from 'react';

/**
 * Subscribe React state to a CSS media query.
 *
 * The Studio is a dense desktop workspace built with inline styles, which a
 * stylesheet `@media` rule cannot override — so responsive behavior is driven in
 * JS through this hook. Environment-safe: it returns `false` when `matchMedia`
 * is unavailable (jsdom, SSR) and re-reads on mount, so a component/test never
 * crashes for lack of the API.
 */
export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
		const mql = window.matchMedia(query);
		const onChange = () => setMatches(mql.matches);
		onChange(); // the query may have changed since the initial render
		mql.addEventListener('change', onChange);
		return () => mql.removeEventListener('change', onChange);
	}, [query]);

	return matches;
}

/** Below the workspace breakpoint. Panes collapse to slim strips so the canvas
 *  keeps the width on a tablet/phone instead of being squeezed to nothing. */
export function useIsNarrow(breakpointPx = 900): boolean {
	return useMediaQuery(`(max-width: ${breakpointPx}px)`);
}

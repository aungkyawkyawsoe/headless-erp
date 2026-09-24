import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { Search, X } from 'lucide-react';

import { GLASS_ICON_BUTTON, GLASS_ICON_BUTTON_ACTIVE, GLASS_ICON_BUTTON_IDLE } from '@/shared/components/bottom-action-bar';
import { SEARCH_DEBOUNCE_MS } from '@/shared/constants';
import { hapticImpact } from '@/shared/platform/haptics';
import { URL_PARAM, searchParam, useViewState } from '@/shared/url-state';

/** The toolbar search's URL view state — one key (`?q=`), one schema. */
const BAR_SEARCH_VIEW = { [URL_PARAM.search]: searchParam } as const;

/** The toolbar search's state + ready-to-mount UI for the two bar slots. */
export interface BarSearch<T> {
	/** The trimmed, lowercased SETTLED query — non-empty means search is live. */
	query: string;
	/** Whether the search panel is open. */
	open: boolean;
	/** The pill's right-slot toggle button (🔍, glass capsule) — visible while
	 *  the search is closed. */
	button: ReactElement;
	/** The search row that REPLACES the pill while open — `[🔍 field][✕]`, no
	 *  card behind it. Always mounted: the bar cross-fades it in and out, and
	 *  the `✕` here is what closes the search. Pass alongside `open` to the
	 *  bar's `panel` / `panelOpen` slots. */
	panel: ReactElement;
	/** Server-side rows for the settled query — the page renders these with its
	 *  own card component (the list card, so results match the list). */
	results: T[];
	/** True while a request is in flight for the settled query. */
	searching: boolean;
	/** True when the last settled query FAILED — the caller shows an error state
	 *  instead of mistaking the failure for a genuine "no results" empty. */
	error: boolean;
	/** Clear the query and close the panel — the filtered-empty "clear" action. */
	clear: () => void;
}

/**
 * The list-view toolbar search — one behavior for every list page: a 🔍 toggle
 * in the bar's right slot that morphs the pill into an isolated search field
 * (🔍 … placeholder) with a ✕ close button — no card behind it, iOS-style.
 *
 * The search is SERVER-SIDE: each settled query runs the page's search fetcher
 * (a `?search=` entity read on the page's main collection) and the returned rows
 * render with the page's own list card, so results always match the list.
 * Closing the search drops the query too — the same clear-on-close rule as the
 * launcher's search toggle.
 *
 * KEYSTROKE ISOLATION (performance): the text being typed lives in the field
 * component's own state, NOT here and NOT in the URL. Previously the input was
 * bound straight to `?q=`, so every character did a `history.replaceState` and
 * re-rendered THIS hook's owner (the whole list page, plus every other
 * `useViewState` container on it). Typing on a 100-row list repainted the list
 * once per character. Now a keystroke re-renders only the field; after the
 * app-wide `SEARCH_DEBOUNCE_MS` the settled text lands here once (one URL write,
 * one fetch), which is all the URL ever needed to hold.
 */
export function useBarSearch<T>(placeholder: string, fetcher: (query: string) => Promise<T[]>): BarSearch<T> {
	const [view, setView] = useViewState(BAR_SEARCH_VIEW);
	// The settled query is the single source for the URL, the fetch and results.
	const query = view.q;
	// A URL-restored query (reload / back-nav / deep link) must reopen the panel
	// on mount — otherwise the query would be live with nowhere to clear it.
	const [open, setOpen] = useState(() => query !== '');
	const [results, setResults] = useState<T[]>([]);
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState(false);

	// Always call the LATEST fetcher (pages close over fresh lookups) without
	// re-running the effect on every render.
	const fetcherRef = useRef(fetcher);
	fetcherRef.current = fetcher;

	// True when the current `query` came from the FIELD's settle (a keystroke
	// pause) rather than from the URL. A typed query can fetch at once — the
	// field already debounced. A RESTORED query (reload / back-nav) must still
	// wait one debounce: some pages "search" a board that is still loading, and
	// firing at t=0 would settle on an empty result before the data arrives.
	const settledFromField = useRef(false);

	// Fetch once per SETTLED query. Stale responses (a newer keystroke won the
	// race) are discarded via `cancelled` on cleanup.
	useEffect(() => {
		const q = query.trim();
		if (!open || q === '') {
			setResults([]);
			setSearching(false);
			setError(false);
			settledFromField.current = false;
			return;
		}
		const delay = settledFromField.current ? 0 : SEARCH_DEBOUNCE_MS;
		settledFromField.current = false;
		let cancelled = false;
		setSearching(true);
		setError(false);
		const timer = setTimeout(() => {
			fetcherRef
				.current(q)
				.then((rows) => {
					if (!cancelled) {
						setResults(rows);
						setError(false);
					}
				})
				.catch(() => {
					// A failed search is NOT "no results" — surface the failure so the
					// caller can say so instead of rendering a false empty state.
					if (!cancelled) {
						setResults([]);
						setError(true);
					}
				})
				.finally(() => {
					if (!cancelled) setSearching(false);
				});
		}, delay);
		return () => {
			cancelled = true;
			if (timer) clearTimeout(timer);
		};
	}, [query, open]);

	const toggle = () => {
		hapticImpact('light');
		// Closing search drops the query too — clear-on-close like the launcher.
		if (open) setView({ q: '' });
		setOpen((wasOpen) => !wasOpen);
	};

	const clear = () => {
		setView({ q: '' });
		setOpen(false);
	};

	const button = (
		<button
			type="button"
			onClick={toggle}
			aria-label={open ? 'Close search' : 'Search'}
			className={`${GLASS_ICON_BUTTON} ${open ? GLASS_ICON_BUTTON_ACTIVE : GLASS_ICON_BUTTON_IDLE}`}
		>
			{open ? <X className="size-5" aria-hidden /> : <Search className="size-5" aria-hidden />}
		</button>
	);

	const panel = (
		<BarSearchField
			placeholder={placeholder}
			open={open}
			settled={query}
			onSettle={(next) => {
				// A field settle can fetch immediately (the field already waited out
				// the debounce) — see the fetch effect's `delay`.
				settledFromField.current = true;
				setView({ q: next });
			}}
			onClear={clear}
		/>
	);

	return { query: query.trim().toLowerCase(), open, button, panel, results, searching, error, clear };
}

/**
 * The isolated search field. Owns the in-progress text and the debounce, so a
 * keystroke re-renders ONLY this component — the list behind it stays untouched
 * until the query settles.
 */
function BarSearchField({
	placeholder,
	open,
	settled,
	onSettle,
	onClear,
}: {
	placeholder: string;
	open: boolean;
	/** The last value that reached the URL (our own write, or a restore). */
	settled: string;
	onSettle: (value: string) => void;
	onClear: () => void;
}) {
	const [draft, setDraft] = useState(settled);
	const inputRef = useRef<HTMLInputElement>(null);
	// The last value THIS field pushed up — distinguishes our own settle from an
	// external one (back/forward, close), so a settle never clobbers live typing.
	const lastSettled = useRef(settled);
	const settleRef = useRef(onSettle);
	settleRef.current = onSettle;

	// Adopt an EXTERNAL change (a restore, or clear-on-close) into the field.
	useEffect(() => {
		if (settled === lastSettled.current) return;
		lastSettled.current = settled;
		setDraft(settled);
	}, [settled]);

	// One push per pause in typing — never per keystroke.
	useEffect(() => {
		if (draft === settled) return;
		const timer = setTimeout(() => {
			lastSettled.current = draft;
			settleRef.current(draft);
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [draft, settled]);

	// Focus the field when search opens — with the page's scroll position pinned.
	// The field lives in the fixed bottom bar, so iOS/WKWebView must never scroll
	// the document to "reveal" it: that scroll flings the bar to the top of the
	// screen and leaves a black void below (see useKeyboardInset in
	// bottom-action-bar.tsx). `preventScroll` stops the initial jump; the
	// rAF/settle re-assert re-captures any scroll the keyboard opening itself
	// performs (some WebViews scroll after the focus call returns) — and is a
	// no-op whenever nothing moved.
	useEffect(() => {
		if (!open) return;
		const input = inputRef.current;
		if (!input) return;
		const y = window.scrollY;
		input.focus({ preventScroll: true });
		const restore = () => {
			if (window.scrollY !== y) window.scrollTo(0, y);
		};
		const raf = requestAnimationFrame(restore);
		const settleTimer = setTimeout(restore, 350);
		return () => {
			cancelAnimationFrame(raf);
			clearTimeout(settleTimer);
		};
	}, [open]);

	return (
		<div className="flex w-full items-center gap-2">
			{/* min-w-0: let the field shrink instead of pushing the ✕ off the bar. */}
			<div className="relative min-w-0 flex-1">
				{/* z-10: the field's own background creates a stacking context that would
				 * otherwise paint OVER this absolutely-positioned sibling icon. */}
				<Search className="pointer-events-none absolute left-4 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
				<input
					ref={inputRef}
					type="search"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					placeholder={placeholder}
					className="h-11 w-full rounded-full border border-border/60 bg-white/90 pl-11 pr-4 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring/60 dark:border-white/15 dark:bg-card/95"
				/>
			</div>
			{/* Mirrors the bar's glass capsule but sized to the field's height
			 * (h-11 = 44px) so the ✕ sits level with the box it closes. */}
			<button
				type="button"
				onClick={() => {
					hapticImpact('light');
					onClear();
				}}
				aria-label="Close search"
				className={`relative flex size-11 items-center justify-center rounded-full border border-border/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15 ${GLASS_ICON_BUTTON_ACTIVE}`}
			>
				<X className="size-5" aria-hidden />
			</button>
		</div>
	);
}

import { useEffect, useRef, useState } from 'react';

import { LoadingRow } from './loading-row';

interface LoadMoreSentinelProps {
	/** Whether another page exists (React Query's `hasNextPage`). */
	hasMore: boolean;
	/** A page fetch is in flight — the observer idles while loading. */
	loading: boolean;
	/** React Query's `fetchNextPage` (stable identity). */
	onLoadMore: () => void;
	/** How early (px) the next page fires before the sentinel is visible. */
	rootMargin?: string;
	/** The "data loading" hint rendered below the list while pages stream. */
	loadingLabel?: string;
	/**
	 * Only fetch the next page AFTER the user has actually scrolled. Without this
	 * the observer fires as soon as the sentinel is (virtually) within reach of the
	 * fold — so a list whose first page doesn't fill the viewport auto-fetches the
	 * NEXT page during the initial paint (the premature cursor request you saw).
	 * Defaults false (legacy preload) to avoid changing every caller; enable for
	 * lists that should page only on real scroll.
	 */
	waitForScroll?: boolean;
}

/**
 * Infinite-scroll sentinel — a zero-height marker at the end of a list that
 * requests the next cursor page as soon as it approaches the viewport (the
 * generous `rootMargin` preloads before the user actually reaches the bottom).
 *
 * While the sentinel STAYS visible the pages chain at network speed: every
 * fetch that lands re-arms the observer, which fires the next page
 * immediately (`!loading` sequences them — never two pages in flight). A
 * short list (e.g. a client-side filter showing a few cards of a larger raw
 * set — has_more stays true until the raw cursor drains, because later raw
 * pages may still hold matches) therefore drains its remaining pages in one
 * quick burst instead of one fetch every couple of seconds.
 *
 * Pass `waitForScroll` to hold the first fetch until the user scrolls — with
 * it, a short list renders page 1 only and the next page is fetched on real
 * scroll rather than automatically on mount.
 *
 * The `draining` flag keeps the hint visible continuously from the FIRST
 * fetch until has_more drops (the sentinel then unmounts) — it never blinks
 * between chained pages. When the sentinel scrolls out of view the observer
 * simply idles; the hint is below the fold anyway.
 */
export function LoadMoreSentinel({
	hasMore,
	loading,
	onLoadMore,
	rootMargin = '240px 0px',
	loadingLabel = 'Loading…',
	waitForScroll = false,
}: LoadMoreSentinelProps) {
	const ref = useRef<HTMLDivElement>(null);
	// Read the latest callbacks/inputs through refs — the pages pass an inline
	// arrow (new identity every render), which would otherwise re-run the
	// observer effect (and re-observe) on every re-render.
	const onLoadMoreRef = useRef(onLoadMore);
	onLoadMoreRef.current = onLoadMore;
	const loadingRef = useRef(loading);
	loadingRef.current = loading;
	// Arming: only true once the user has scrolled (drives `waitForScroll`).
	const hasScrolledRef = useRef(false);
	// The live observer + target, so arming can force a fresh intersection check
	// after a scroll that armed the loader.
	const lifecycle = useRef<{ observer: IntersectionObserver | null; el: Element | null }>({
		observer: null,
		el: null,
	});
	// True from the FIRST next-page fetch until the sentinel unmounts
	// (has_more false) — keeps the hint up across the chained drain.
	const [draining, setDraining] = useState(false);

	// A page fetch is in flight OR the drain has begun — the hint stays up.
	const busy = loading || draining;

	// Re-observe forces an immediate intersection record. Needed for a short list
	// whose sentinel sits within the fold margin on mount: the gated mount
	// callback discards that intersection, and scrolling alone (staying
	// intersecting the whole way) never delivers a *new* transition — so without
	// this recheck the first scroll would never retry. Stable enough across the
	// sentinel's lifetime — it reads the `lifecycle` ref, never stale props.
	const recheck = () => {
		const { observer, el } = lifecycle.current;
		if (!observer || !el) return;
		observer.disconnect();
		observer.observe(el);
	};

	// With `waitForScroll`, don't fire while the sentinel just happens to be near
	// the fold on initial paint — arm only after a real scroll/touch gesture, then
	// recheck so a short list pages on that first scroll instead of staying stuck.
	useEffect(() => {
		if (!waitForScroll) return;
		const arm = () => {
			hasScrolledRef.current = true;
			document.removeEventListener('scroll', arm, true);
			document.removeEventListener('wheel', arm, { capture: true } as AddEventListenerOptions);
			recheck();
		};
		// capture: catches scrolls of ANY scroll container, not just the window.
		document.addEventListener('scroll', arm, true);
		document.addEventListener('wheel', arm, { capture: true, passive: true });
		return () => {
			document.removeEventListener('scroll', arm, true);
			document.removeEventListener('wheel', arm, { capture: true } as AddEventListenerOptions);
		};
	}, [waitForScroll]);

	useEffect(() => {
		const el = ref.current;
		if (!el || !hasMore) return;

		const onIntersect = (entries: IntersectionObserverEntry[]) => {
			if (!entries.some((entry) => entry.isIntersecting) || loadingRef.current) return;
			// With `waitForScroll`, ignore the initial-paint intersection (the
			// sentinel is only "near" the fold, not yet reached by the user).
			if (waitForScroll && !hasScrolledRef.current) return;
			setDraining(true);
			onLoadMoreRef.current();
		};
		const observer = new IntersectionObserver(onIntersect, { rootMargin });
		lifecycle.current = { observer, el };
		observer.observe(el);
		return () => {
			observer.disconnect();
			lifecycle.current = { observer: null, el: null };
		};
	}, [hasMore, rootMargin, waitForScroll]);

	if (!hasMore) return null;
	return (
		<div ref={ref} className="flex items-center justify-center gap-2 py-3">
			{busy ? <LoadingRow label={loadingLabel} /> : null}
		</div>
	);
}

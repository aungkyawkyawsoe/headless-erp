'use client';

import * as React from 'react';
import { cn } from '@/utils';

interface DataTableScrollbarProps {
	/**
	 * Serialized pinning state — the pinned zones are re-measured whenever
	 * columns are pinned/unpinned, so the track follows the pinned columns.
	 */
	pinningKey: string;
}

/**
 * Custom horizontal scrollbar that spans only the unpinned (center) area of
 * the table.
 *
 * The native scrollbar always spans the full container width, which looks
 * wrong once columns are pinned left/right — the pinned columns don't scroll,
 * so the scrollbar should only appear *between* them. This overlay renders a
 * track from the right edge of the left-pinned zone to the left edge of the
 * right-pinned zone, and drives the container's native scrollLeft.
 *
 * Rendered as a direct child of the scroll container (`[data-slot=
 * "datatable-container"]`), which it reaches via its own ref's parentElement —
 * a parent's ref is not attached yet when this component's layout effect runs.
 */
export function DataTableScrollbar({ pinningKey }: DataTableScrollbarProps) {
	const trackRef = React.useRef<HTMLDivElement | null>(null);
	const thumbRef = React.useRef<HTMLDivElement | null>(null);
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const [visible, setVisible] = React.useState(false);
	const geometryRef = React.useRef({ left: 0, right: 0 });

	React.useLayoutEffect(() => {
		const wrapper = trackRef.current?.parentElement as HTMLDivElement | null;
		const el = wrapper?.querySelector<HTMLDivElement>('[data-slot="datatable-container"]');
		if (!el) return;
		containerRef.current = el;

		const measure = () => {
			// Measure the sticky header cells — the left/right pinned zones are
			// everything that sticks horizontally (control columns + pinned columns).
			const headerRow = el.querySelector('[data-slot="datatable-header"] tr');
			if (!headerRow) {
				setVisible(false);
				return;
			}
			let left = 0;
			let right = 0;
			let hasPinned = false;
			for (const cell of Array.from(headerRow.children)) {
				const style = getComputedStyle(cell);
				if (style.position !== 'sticky') continue;
				if (style.left === 'auto' && style.right === 'auto') continue;
				hasPinned = true;
				const width = cell.getBoundingClientRect().width;
				if (style.left !== 'auto') left += width;
				else right += width;
			}
			geometryRef.current = { left, right };
			setVisible(hasPinned && el.scrollWidth > el.clientWidth);
		};

		const updateThumb = () => {
			const track = trackRef.current;
			const thumb = thumbRef.current;
			if (!track || !thumb) return;
			const { left, right } = geometryRef.current;
			const trackWidth = Math.max(el.clientWidth - left - right, 0);
			const scrollable = el.scrollWidth - el.clientWidth;
			track.style.left = `${left}px`;
			track.style.width = `${trackWidth}px`;
			if (scrollable <= 0 || trackWidth <= 0) {
				thumb.style.width = '0px';
				return;
			}
			const thumbWidth = Math.max(trackWidth * (el.clientWidth / el.scrollWidth), 24);
			thumb.style.width = `${thumbWidth}px`;
			thumb.style.transform = `translateX(${(el.scrollLeft / scrollable) * (trackWidth - thumbWidth)}px)`;
		};

		measure();
		updateThumb();
		const observer = new ResizeObserver(() => {
			measure();
			updateThumb();
		});
		observer.observe(el);
		const table = el.querySelector('[data-slot="datatable-table"]');
		if (table) observer.observe(table);
		const onScroll = () => updateThumb();
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			observer.disconnect();
			el.removeEventListener('scroll', onScroll);
		};
	}, [pinningKey]);

	const handleThumbPointerDown = (event: React.PointerEvent) => {
		event.preventDefault();
		const track = trackRef.current;
		const thumb = thumbRef.current;
		if (!track || !thumb || !containerRef.current) return;
		const startX = event.clientX;
		const startScrollLeft = containerRef.current.scrollLeft;
		const scrollable = containerRef.current.scrollWidth - containerRef.current.clientWidth;
		const draggable = Math.max(track.clientWidth - thumb.clientWidth, 1);

		const onMove = (moveEvent: PointerEvent) => {
			const delta = moveEvent.clientX - startX;
			if (containerRef.current) {
				containerRef.current.scrollLeft = startScrollLeft + (delta / draggable) * scrollable;
			}
		};
		const onUp = () => {
			window.removeEventListener('pointermove', onMove);
			window.removeEventListener('pointerup', onUp);
		};
		window.addEventListener('pointermove', onMove);
		window.addEventListener('pointerup', onUp);
	};

	const handleTrackPointerDown = (event: React.PointerEvent) => {
		if (event.target === thumbRef.current) return;
		const track = trackRef.current;
		if (!track || !containerRef.current) return;
		const rect = track.getBoundingClientRect();
		const ratio = (event.clientX - rect.left) / rect.width;
		containerRef.current.scrollLeft = ratio * (containerRef.current.scrollWidth - containerRef.current.clientWidth);
	};

	return (
		<div
			ref={trackRef}
			data-slot="datatable-scrollbar"
			className={cn('absolute bottom-0 z-20 h-1.5 rounded-full bg-muted/60', visible ? 'opacity-100' : 'pointer-events-none opacity-0')}
			onPointerDown={handleTrackPointerDown}
		>
			<div
				ref={thumbRef}
				data-slot="datatable-scrollbar-thumb"
				className="h-full cursor-grab rounded-full bg-muted-foreground/40 transition-colors hover:bg-muted-foreground/60 active:cursor-grabbing"
				onPointerDown={handleThumbPointerDown}
			/>
		</div>
	);
}

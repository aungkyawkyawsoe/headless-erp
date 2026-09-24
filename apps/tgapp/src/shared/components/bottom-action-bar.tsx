import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useKeyboardInset } from '@/shared/platform/keyboard-inset';

/** iOS-style motion — fast start, gentle settle (cubic-bezier(0.32, 0.72, 0, 1)),
 * used by the pill ⇄ search morph so open/close reads as one fluid swap. */
const IOS_EASE = 'ease-[cubic-bezier(0.32,0.72,0,1)]';

/**
 * iOS 26-style "liquid glass" action capsules for the bottom bar — translucent
 * white with a backdrop blur, a hairline edge and a soft drop shadow, so every
 * bar button (filter / search / refresh / create) reads as one glass surface
 * with the pill. Shared by every list page's bar — one look everywhere.
 *
 * Light mode uses the theme's dimmed border token (border-border/60, same as
 * the pill) so the capsules stay defined on the frosted-white pill instead of
 * disappearing white-on-white; dark mode drops the hairline (the translucent
 * fill alone defines the capsule on the darker glass).
 */
export const GLASS_ICON_BUTTON =
	'relative flex size-10 items-center justify-center rounded-full border border-border/60 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-transparent';
/** The active-filter tint on a glass capsule (funnel open / search open). */
export const GLASS_ICON_BUTTON_ACTIVE = 'bg-primary/15 text-primary transition-colors dark:bg-primary/25';
/** The resting glass capsule — frosted glass like the pill: translucent white,
 * tinted, defined by the dimmed hairline (no flat opaque fill). Deliberately
 * NO backdrop-filter: re-blurring the region under a fixed bar every scroll
 * frame is the most expensive paint on a phone WebView, so the glass reads
 * through a high-opacity tint instead. */
export const GLASS_ICON_BUTTON_IDLE =
	'bg-white/85 text-foreground/75 transition-colors hover:bg-white/90 dark:bg-white/15 dark:text-muted-foreground dark:hover:bg-white/20';
/** The bar's primary action (create +) — solid brand pill; its own color defines
 * it, so no hairline border (the glass capsules above carry those). */
export const GLASS_PRIMARY_BUTTON =
	'flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

interface BottomActionBarProps {
	/** Left slot — typically the filter trigger. */
	left?: ReactNode;
	/** Center slot — typically the active-filter label (or nothing). */
	center?: ReactNode;
	/** Right slot — typically the create (+) button. */
	right?: ReactNode;
	/**
	 * Replacement content for the pill — e.g. the search field. While `panel` is
	 * present the pill and the panel swap in the same slot (iOS-style morph):
	 * the pill dissolves while the panel slides in, so opening and closing
	 * search reads as a single fluid swap instead of the field appearing above
	 * the bar. Both layers stay mounted — the hidden one is inert (no
	 * focus/taps) — which is what makes the exit transition possible.
	 */
	panel?: ReactNode;
	/** Whether the `panel` (e.g. search) is the visible layer. While true the
	 * bar stays pinned (no hide-on-scroll): sliding away mid-search would drop
	 * the focused field off-screen. */
	panelOpen?: boolean;
}

/** Min scroll delta before the bar toggles — tiny jitter never moves it. */
const SCROLL_THRESHOLD = 8;
/** Within this distance of the list's top/bottom the bar always stays put. */
const EDGE_MARGIN = 16;

/**
 * Fixed bottom action bar — the list-view toolbar in an iOS 26 liquid-glass
 * treatment: a translucent pill with a specular top
 * highlight, filter controls on the left, the create (+) button on the right,
 * pinned above the bottom safe area and aligned to the app's centered
 * `max-w-md` column. Renders only on list pages, so navigating to a `/+` create
 * page removes it automatically. When a `panel` (e.g. search) is provided it
 * morphs into the pill's slot — see the `panel` prop doc.
 *
 * Hide-on-scroll: while the LIST scrolls via user input (wheel / touch —
 * content moving up, page scrolling down) the bar slides away with a transform
 * transition so more rows are visible; the moment the scroll reverses (content
 * moving down) it slides back. Programmatic scrolls — the filter sheet's
 * scroll-lock restore, a filtered list shrinking/growing — never move the bar.
 * The very top and bottom of the list keep it shown — that's where the next
 * action (create / filter) lives. Shared by every list page that renders the
 * bar (requests, approvals, employees, vehicles) — one behavior everywhere.
 */
export function BottomActionBar({ left, center, right, panel, panelOpen = false }: BottomActionBarProps) {
	const [hidden, setHidden] = useState(false);
	const lastY = useRef(0);
	const keyboardInset = useKeyboardInset();

	useEffect(() => {
		lastY.current = window.scrollY;

		// The bar follows the LIST's scrolling only — genuine wheel / touch input.
		// Programmatic scrolls (the filter sheet's scroll-lock restore, a filtered
		// list shrinking/growing) fire the same `scroll` events with no gesture
		// behind them; gating on wheel/touchmove keeps the bar put through those.
		// Each scroll event re-arms the window, so momentum (scroll events fired
		// after the gesture ends) keeps working until the list settles.
		let gestureActive = false;
		let settleTimer: ReturnType<typeof setTimeout> | undefined;
		const armGesture = () => {
			gestureActive = true;
			if (settleTimer) clearTimeout(settleTimer);
			settleTimer = setTimeout(() => {
				gestureActive = false;
			}, 250);
		};

		const onScroll = () => {
			if (!gestureActive) return;
			if (settleTimer) clearTimeout(settleTimer);
			settleTimer = setTimeout(() => {
				gestureActive = false;
			}, 250);

			const y = window.scrollY;
			const delta = y - lastY.current;
			lastY.current = y;
			if (Math.abs(delta) < SCROLL_THRESHOLD) return;
			const atEdge = y <= EDGE_MARGIN || window.innerHeight + y >= document.documentElement.scrollHeight - EDGE_MARGIN;
			// List scrolled DOWN (content moved up) → hide; scrolled UP → reveal.
			setHidden(delta > 0 && !atEdge);
		};

		window.addEventListener('wheel', armGesture, { passive: true });
		window.addEventListener('touchmove', armGesture, { passive: true });
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			window.removeEventListener('wheel', armGesture);
			window.removeEventListener('touchmove', armGesture);
			window.removeEventListener('scroll', onScroll);
			if (settleTimer) clearTimeout(settleTimer);
		};
	}, []);

	// A closing panel (e.g. search) re-reveals the bar: scrolls made while the
	// panel pinned it may have latched `hidden` on, and it must not stay hidden
	// the moment the panel closes.
	useEffect(() => {
		if (panelOpen) return;
		setHidden(false);
	}, [panelOpen]);

	// An open panel (search) pins the bar — see the `panelOpen` prop doc. The
	// on-screen keyboard pins it too: hiding would drop the bar below the
	// keyboard, where it's unreachable.
	const shouldHide = hidden && !panelOpen && keyboardInset === 0;

	const pillContent = (
		<>
			{/* Specular top highlight — the glass "shine" hairline. */}
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-3 top-0 h-px rounded-t-full bg-linear-to-r from-transparent via-white/80 to-transparent dark:via-white/25"
			/>
			<div className="flex items-center">{left}</div>
			<div className="min-w-0 flex-1 truncate text-center text-xs font-medium leading-6.5 text-muted-foreground">{center}</div>
			<div className="flex items-center">{right}</div>
		</>
	);
	const pillBase =
		'relative flex items-center justify-between gap-3 rounded-full border border-border/60 bg-white/90 px-3 py-2 shadow-lg shadow-black/10 dark:border-white/15 dark:bg-card/95';

	return (
		<div
			className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-out${shouldHide ? ' translate-y-full' : ''}`}
			// Lift the bar above the on-screen keyboard when it overlays the page
			// (Telegram Mini App) — see `useKeyboardInset`. Instant, not animated:
			// the keyboard pops in one frame, so a lagging bar would re-trigger the
			// iOS pan/scroll glitch. No-op (0) wherever the layout resizes instead.
			style={keyboardInset > 0 ? { bottom: keyboardInset } : undefined}
			aria-hidden={shouldHide}
		>
			<div className="mx-auto w-full max-w-md px-4 pb-safe">
				{panel ? (
					// Search morph — pill and panel swap in the same slot, so
					// opening/closing reads as one fluid swap (no card behind the
					// search: just the field + ✕ floating in the bar's place). The
					// panel slides in TRANSFORM-ONLY: opacity snaps to full the
					// instant it opens, so the glass field never passes through a
					// see-through phase while the glass fill settles — it must
					// read frosted from frame one. Only on the way out (closing)
					// does it fade, while the pill dissolves back in.
					<div className="relative">
						<div
							className={`${pillBase} transition-all duration-200 ${IOS_EASE}${
								panelOpen ? ' pointer-events-none -translate-y-1 scale-[0.97] opacity-0' : ''
							}`}
							inert={panelOpen}
						>
							{pillContent}
						</div>
						<div
							className={`absolute inset-0 flex items-center px-3 ${IOS_EASE}${
								panelOpen
									? ' translate-y-0 scale-100 opacity-100 transition-transform duration-300'
									: ' pointer-events-none translate-y-2 scale-[0.97] opacity-0 transition-all duration-200'
							}`}
							inert={!panelOpen}
						>
							{panel}
						</div>
					</div>
				) : (
					<div className={pillBase}>{pillContent}</div>
				)}
			</div>
		</div>
	);
}

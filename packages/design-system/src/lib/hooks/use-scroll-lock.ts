import * as React from 'react';

/**
 * Body scroll lock for open overlays (sheets / dialogs / pickers).
 *
 * When a bottom sheet or picker is open, the page behind must not scroll —
 * otherwise wheel/touch scrolling inside the sheet chains into the background
 * content (the classic "scrolling the sheet scrolls the page" bug). Setting
 * `overflow: hidden` on `<body>` propagates to the viewport (CSS overflow
 * propagation), locking the page while the overlay is open.
 *
 * A module-level depth counter makes NESTED overlays safe: opening a picker
 * inside a form sheet locks twice, and each close restores one level, so the
 * last overlay to close restores the original value (LIFO).
 */

let lockDepth = 0;
let savedOverflow = '';
let savedScrollY = 0;
// Subscribers told whenever the overlay-lock count crosses zero in either
// direction. The lock is the ONE place a sheet/picker/dialog announces "I am
// covering the page", so consumers that must react to that fact (e.g. hiding a
// native button the Telegram client paints OVER the WebView's bottom edge, which
// no CSS z-index can reach) read it from here instead of re-deriving per sheet.
const overlayListeners = new Set<() => void>();

function emitOverlayChange(): void {
	for (const listener of overlayListeners) listener();
}
// Non-passive touchmove guard added while a lock is held. `overflow: hidden`
// on <body> alone does NOT stop touch scrolling on iOS WebViews (Telegram):
// the page still rubber-bands behind the sheet. Blocking touchmove at the
// document level fixes that; touches that begin inside a genuinely scrollable
// ancestor (the sheet's option list) are allowed through so the sheet itself
// still scrolls.
function onTouchMove(e: TouchEvent): void {
	let el = e.target as HTMLElement | null;
	while (el && el !== document.body) {
		if (el.scrollHeight > el.clientHeight) {
			const oy = getComputedStyle(el).overflowY;
			if (oy === 'auto' || oy === 'scroll') return;
		}
		el = el.parentElement;
	}
	e.preventDefault();
}

export function lockBodyScroll(): void {
	if (typeof document === 'undefined') return;
	if (lockDepth === 0) {
		savedOverflow = document.body.style.overflow;
		// iOS: freezing the body in place (`position: fixed` offset by the
		// current scroll) is the only reliable lock — without it the fixed
		// overlay's touchmoves chain into the viewport. Scroll position is
		// restored on the final unlock.
		savedScrollY = window.scrollY;
		document.body.style.position = 'fixed';
		document.body.style.left = '0';
		document.body.style.right = '0';
		document.body.style.top = `-${savedScrollY}px`;
		document.body.style.width = '100%';
		document.addEventListener('touchmove', onTouchMove, { passive: false });
	}
	lockDepth += 1;
	document.body.style.overflow = 'hidden';
	emitOverlayChange();
}

export function unlockBodyScroll(): void {
	if (typeof document === 'undefined' || lockDepth === 0) return;
	lockDepth -= 1;
	if (lockDepth === 0) {
		document.body.style.overflow = savedOverflow;
		document.body.style.position = '';
		document.body.style.left = '';
		document.body.style.right = '';
		document.body.style.top = '';
		document.body.style.width = '';
		document.removeEventListener('touchmove', onTouchMove);
		window.scrollTo(0, savedScrollY);
	}
	emitOverlayChange();
}

/** True while at least one locked overlay (sheet / picker / dialog) is open. */
export function isOverlayOpen(): boolean {
	return lockDepth > 0;
}

/**
 * Subscribe to overlay open/close transitions. The listener fires on every
 * lock/unlock (nested overlays included); read `isOverlayOpen()` for the
 * current value. Returns an unsubscribe.
 */
export function subscribeOverlayOpen(listener: () => void): () => void {
	overlayListeners.add(listener);
	return () => {
		overlayListeners.delete(listener);
	};
}

/**
 * React binding for `isOverlayOpen` — re-renders the caller when any overlay
 * opens or closes. Used by the Telegram Mini App to tuck the native MainButton
 * away while a bottom sheet covers it (the client draws that button above the
 * WebView, so it cannot be covered by CSS).
 */
export function useOverlayOpen(): boolean {
	return React.useSyncExternalStore(subscribeOverlayOpen, isOverlayOpen, () => false);
}

/** Lock the page behind an open overlay while `active` is true. */
export function useScrollLock(active: boolean): void {
	React.useEffect(() => {
		if (!active) return;
		lockBodyScroll();
		return () => unlockBodyScroll();
	}, [active]);
}

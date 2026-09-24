import { useEffect, useState } from 'react';

/**
 * Bottom inset (px) while the on-screen keyboard is up, derived from the
 * visual viewport: the gap between the LAYOUT viewport (`innerHeight`) and
 * the VISIBLE viewport (`visualViewport.height`) is exactly the keyboard.
 *
 * - Safari / Android (`interactive-widget=resizes-content`) shrink the layout
 *   viewport with the keyboard — both heights drop together → 0, and the
 *   fixed `bottom: 0` bar already rides above the keyboard on its own.
 * - The Telegram Mini App keyboard can OVERLAY the WebView (no layout
 *   resize) → the gap is the keyboard height and a `bottom: 0` bar sits
 *   UNDER the keyboard. iOS then pans/scrolls the page to reveal the focused
 *   field: the fixed bar rides the layer to the top of the screen and the
 *   vacated area paints the WebView's black canvas (the "black screen"
 *   glitch). Lifting the bar by the gap keeps the input visible, so that
 *   pan never triggers.
 *
 * Telegram's device bottom inset is subtracted so the lift lands flush with
 * the keyboard instead of double-counting the safe-area padding.
 *
 * This is the ONE home for the calculation: the bottom action bar reads it for
 * its own lift, and `useKeyboardInsetVar` mirrors it to a CSS variable so EVERY
 * bottom sheet (design-system internals included) lifts by the same amount
 * without touching each call site.
 */
export function useKeyboardInset(): number {
	const [inset, setInset] = useState(0);

	useEffect(() => {
		const vv = window.visualViewport;
		if (!vv) return;
		const update = () => {
			const envBottom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tg-safe-area-inset-bottom')) || 0;
			setInset(Math.max(0, window.innerHeight - vv.height - envBottom));
		};
		update();
		vv.addEventListener('resize', update);
		vv.addEventListener('scroll', update);
		window.addEventListener('resize', update);
		return () => {
			vv.removeEventListener('resize', update);
			vv.removeEventListener('scroll', update);
			window.removeEventListener('resize', update);
		};
	}, []);

	return inset;
}

/**
 * Mirror the keyboard inset to `--keyboard-inset` on <html>, once, app-wide.
 *
 * `index.css` consumes the variable to lift every `[data-side="bottom"]` sheet.
 * A sheet that owns a text field (a reject reason, a note) previously pushed its
 * action row UNDER the overlay keyboard on the exact flow that mandates typing —
 * `pb-safe` accounts for the notch, not the keyboard.
 */
export function useKeyboardInsetVar(): void {
	const inset = useKeyboardInset();
	useEffect(() => {
		document.documentElement.style.setProperty('--keyboard-inset', `${inset}px`);
		return () => {
			document.documentElement.style.setProperty('--keyboard-inset', '0px');
		};
	}, [inset]);
}

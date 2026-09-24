/**
 * Widget SURFACES — the iOS-widget truth the board mirrors: a widget is not
 * always a frosted-glass card. iOS ships a family of widget backgrounds
 * (automatic glass, solid ink, paper-white, and accent TINTS), and a home
 * screen mixes them — some near-black, one white calendar, a weather tint.
 * Coupling every widget to ONE glass look is the thing this module exists to
 * prevent.
 *
 * Each variant returns the full class bundle a widget needs (card + text
 * layers) so contrast stays correct in BOTH themes: `ink` stays ink in light
 * mode, `paper` stays paper in dark mode (exactly how iOS behaves), while
 * `glass` and `tint` shift with the theme.
 */

export type WidgetSurface = 'glass' | 'ink' | 'paper' | 'tint' | 'sky';

export interface SurfaceClasses {
	/** The card container (radius, border, background, shadow, blur). */
	card: string;
	/** The uppercase micro-label. */
	title: string;
	/** The primary/value text. */
	value: string;
	/** The secondary/muted line. */
	sub: string;
	/** The ring/icon accent that sits on this surface. */
	accent: string;
}

const RADIUS = 'rounded-[26px]';

export const SURFACES: Record<WidgetSurface, SurfaceClasses> = {
	// The automatic glass look — the ONLY variant that flips with the theme.
	glass: {
		card: `${RADIUS} border border-white/70 bg-white/75 shadow-[0_10px_30px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.04)] dark:border-white/10 dark:bg-white/[0.07] dark:shadow-[0_10px_30px_rgba(0,0,0,0.35)]`,
		// 0.8 alpha ≈ 5.7:1 on the frosted light card (0.6 measured 3.3:1).
		title: 'text-[rgba(60,60,67,0.8)] dark:text-white/70',
		value: 'text-foreground dark:text-white',
		sub: 'text-[rgba(60,60,67,0.8)] dark:text-white/70',
		accent: '#007aff',
	},
	// The near-black widget (battery / watchlist in the reference home screens).
	ink: {
		card: `${RADIUS} border border-black/40 bg-[#1c1c1e] shadow-[0_10px_30px_rgba(0,0,0,0.28)] dark:border-white/10 dark:bg-[#141416]`,
		title: 'text-white/55',
		value: 'text-white',
		sub: 'text-white/55',
		// Also a link accent (same reason as `paper`) — the component already
		// overrode this to blue for ink; make the token agree.
		accent: '#0a84ff',
	},
	// The paper-white widget (the calendar in the reference) — stays white in BOTH
	// themes, exactly as an iOS widget's white background does.
	paper: {
		card: `${RADIUS} border border-black/5 bg-white shadow-[0_10px_30px_rgba(0,0,0,0.10)] dark:border-black/40 dark:bg-white`,
		// 0.85 alpha ≈ 6.9:1 on white (0.6 measured 3.4:1).
		title: 'text-[rgba(60,60,67,0.85)]',
		value: 'text-black',
		sub: 'text-[rgba(60,60,67,0.85)]',
		// The accent paints the card's "View All" LINK — iOS blue, not the red it
		// used to be. Red on the paper card reads as an alarm and spends the one
		// colour that must mean "something is wrong" on plain navigation.
		accent: '#007aff',
	},
	// The iOS TINT family — the accent carries the card, white text rides it.
	// The fill is a DEEP orange, not iOS' bright #ff9500: white on #ff9500 is
	// 2.2:1, so every 12–13px label on the widget was unreadable to WCAG. #c2410c
	// keeps the accent identity while clearing AA (white = 5.2:1).
	tint: {
		card: `${RADIUS} border border-white/25 bg-[#c2410c] shadow-[0_10px_30px_rgba(194,65,12,0.32)] dark:border-white/15 dark:bg-[#b45309]`,
		title: 'text-white',
		value: 'text-white',
		sub: 'text-white',
		accent: '#ffffff',
	},
	// The iOS "weather" surface — a soft blue-grey gradient card that reads
	// LIGHT in light mode and a deep blue-grey in dark (the way the iOS weather
	// widget itself flips), with theme-aware text.
	sky: {
		card: `${RADIUS} border border-white/60 bg-gradient-to-b from-[#d3dce6] to-[#b3bfcc] shadow-[0_10px_30px_rgba(20,30,45,0.14)] dark:border-white/10 dark:from-[#2b3440] dark:to-[#1a222c] dark:shadow-[0_10px_30px_rgba(0,0,0,0.35)]`,
		// Full-strength ink (8.3:1) — the old /70 over the blue-grey was 3.4:1.
		title: 'text-[#2b3340] dark:text-white/70',
		value: 'text-[#12161c] dark:text-white',
		sub: 'text-[#2b3340] dark:text-white/70',
		accent: '#0a84ff',
	},
};

/** The inner inset tile used by the ops grid / rows on a surface. */
export function innerTile(surface: WidgetSurface): string {
	if (surface === 'paper') return 'border-black/5 bg-black/[0.03]';
	if (surface === 'ink') return 'border-white/10 bg-white/[0.08]';
	if (surface === 'sky') return 'border-white/50 bg-white/35 dark:border-white/10 dark:bg-white/[0.08]';
	return 'border-white/60 bg-white/45 dark:border-white/10 dark:bg-white/[0.08]';
}

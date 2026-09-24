import { describe, expect, it } from 'vitest';

import { SURFACES, innerTile } from './surface';

/**
 * The iOS-widget contract this module exists for: a home screen MIXES widget
 * backgrounds, and each variant is theme-correct in the way iOS is —
 * `ink` stays ink in light mode, `paper` stays paper in dark mode, while
 * `glass` follows the theme. Pinned here so a future "make it all frosted"
 * edit cannot silently regress the mix.
 */
describe('widget surfaces — the iOS background family, theme-correct', () => {
	it('glass follows the theme (light + dark card backgrounds)', () => {
		const card = SURFACES.glass.card;
		expect(card).toContain('bg-white/75');
		expect(card).toContain('dark:bg-white/[0.07]');
		// Deliberately NO backdrop-filter: a blurred card forces the compositor to
		// re-sample what is behind it on every scroll frame, which is the single
		// most expensive paint on a phone WebView. The frosted LOOK comes from the
		// translucent fill instead.
		expect(card).not.toContain('backdrop-blur');
	});

	it('ink stays ink in BOTH themes (never flips to white)', () => {
		const card = SURFACES.ink.card;
		expect(card).toContain('bg-[#1c1c1e]');
		expect(card).toContain('dark:bg-[#141416]');
		// The one thing that must never appear: a light card forced in dark mode.
		expect(card).not.toMatch(/dark:bg-white/);
		expect(SURFACES.ink.value).toContain('text-white');
	});

	it('paper stays paper in BOTH themes (the white calendar widget)', () => {
		expect(SURFACES.paper.card).toContain('bg-white');
		expect(SURFACES.paper.card).toContain('dark:bg-white');
		expect(SURFACES.paper.value).toContain('text-black');
	});

	it('tint carries an accent background deep enough for white text', () => {
		// The fill is deliberately a DEEP orange (#c2410c), not iOS' bright #ff9500:
		// white on #ff9500 is only 2.2:1, so every 12–13px label on the widget failed
		// WCAG AA. #c2410c keeps the accent identity at 5.2:1. Pinned so a "make it
		// pop again" edit cannot silently reintroduce unreadable text.
		expect(SURFACES.tint.card).toContain('bg-[#c2410c]');
		expect(SURFACES.tint.card).toContain('dark:bg-[#b45309]');
		// White text is only legible because the fill is dark — they move together.
		expect(SURFACES.tint.card).not.toContain('bg-[#ff9500]');
		expect(SURFACES.tint.sub).toContain('text-white');
	});

	it('sky is the iOS weather gradient — light blue-grey, deep in dark, theme-aware text', () => {
		const card = SURFACES.sky.card;
		expect(card).toContain('bg-gradient-to-b');
		expect(card).toContain('from-[#d3dce6]');
		expect(card).toContain('dark:from-[#2b3440]');
		// Its text must flip with the theme (dark ink on the light gradient,
		// white on the deep one) — otherwise the light card is unreadable at night.
		expect(SURFACES.sky.value).toContain('dark:text-white');
	});

	it('the home grid is a MIX of surfaces, never one repeating card', () => {
		const used = ['sky', 'tint', 'paper', 'ink'] as const;
		expect(new Set(used).size).toBe(4);
		expect(SURFACES.paper.card).not.toBe(SURFACES.ink.card);
		expect(SURFACES.tint.card).not.toBe(SURFACES.sky.card);
	});

	it('inner tiles follow their surface, not one global pair', () => {
		expect(innerTile('ink')).not.toBe(innerTile('paper'));
		expect(innerTile('ink')).toContain('border-white/10');
		expect(innerTile('paper')).toContain('border-black/5');
	});
});

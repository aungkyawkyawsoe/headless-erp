// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ItemThumb, initialsOf } from './item-thumb';

/**
 * The item avatar: the SKU's photo when it has one, a MONOGRAM otherwise — never
 * a generic package glyph (identical on every row = no information).
 */
afterEach(cleanup);

describe('initialsOf', () => {
	it('takes up to two initials from the label, uppercased', () => {
		expect(initialsOf('Air Filter AF-1001')).toBe('AF');
		expect(initialsOf('Tyre')).toBe('T');
		expect(initialsOf('  24V Bulb ')).toBe('2B');
	});
	it('falls back to # for a label with nothing to draw from', () => {
		expect(initialsOf('—')).toBe('#');
		expect(initialsOf(null)).toBe('#');
	});
});

describe('ItemThumb', () => {
	it('renders the real photo when the SKU has one', () => {
		render(<ItemThumb name="Air Filter AF-4004" image="/api/media/abc" className="flex size-8" />);
		const img = document.querySelector('img');
		expect(img?.getAttribute('src')).toBe('/api/media/abc');
		expect(screen.queryByText('AF')).toBeNull();
	});

	it('renders the monogram (no lucide glyph) when there is no photo', () => {
		render(<ItemThumb name="Air Filter AF-4004" image={null} className="flex size-8" />);
		expect(screen.getByText('AF')).toBeTruthy();
		expect(document.querySelector('img')).toBeNull();
		expect(document.querySelector('svg')).toBeNull();
	});
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ItemCard } from './item-card';
import type { ItemCardModel } from '../data/types';

/**
 * The catalog card shows the SKU's IDENTITY on the left (its R2 photo, or the
 * shared `ItemThumb` monogram when it has none) plus the English label (group +
 * model) over the Myanmar name — and NOTHING else: no on-hand figure, no stock
 * lines, no tracking-policy badge, no ⋮ menu. Both names WRAP rather than
 * truncate. The card body is the single affordance (→ the SKU's edit form).
 */

const item: ItemCardModel = {
	id: 'm1',
	name: 'Air Filter AF-1001',
	nameMm: 'လေစစ်ဇကာ AF-1001',
	image: null,
	tracking: 'batch',
};

function renderCard(over: Partial<ItemCardModel> = {}, onOpen: (() => void) | undefined = vi.fn()) {
	const handler = onOpen;
	render(<ItemCard item={{ ...item, ...over }} onOpen={handler} />);
	return { onOpen: handler };
}

afterEach(cleanup);

describe('item card — thumb + label + Myanmar line', () => {
	it('paints the group+model label and the Myanmar name', () => {
		renderCard();
		expect(screen.getByText('Air Filter AF-1001')).toBeTruthy();
		expect(screen.getByText('လေစစ်ဇကာ AF-1001')).toBeTruthy();
	});

	it('paints NO tracking-policy badge (the policy is stated where it is actionable)', () => {
		renderCard();
		// The compact badge wording the card used to carry.
		expect(screen.queryByText('Batch')).toBeNull();
		// A `serial`/`standard` SKU adds nothing either.
		renderCard({ tracking: 'serial' });
		expect(screen.queryByText('Serial')).toBeNull();
		expect(screen.queryByText('Standard')).toBeNull();
	});

	it('lets the item name WRAP instead of truncating it', () => {
		renderCard();
		const name = screen.getByText('Air Filter AF-1001');
		expect(name.className).not.toContain('truncate');
		// The Myanmar line wraps too — an ellipsis would hide the distinguishing glyphs.
		expect(screen.getByText('လေစစ်ဇကာ AF-1001').className).not.toContain('truncate');
	});

	it('draws the SKU photo from the `image` URL', () => {
		renderCard({ image: '/api/media/abc.jpg' });
		const img = document.querySelector('img');
		expect(img?.getAttribute('src')).toBe('/api/media/abc.jpg');
	});

	it('draws the ItemThumb monogram when the SKU has no photo', () => {
		renderCard();
		expect(document.querySelector('img')).toBeNull();
		// The monogram initials of "Air Filter AF-1001" are "AF".
		expect(screen.getByText('AF')).toBeTruthy();
	});

	it('paints the identity label in the display face, and the Myanmar line is NOT', () => {
		renderCard();
		// The card's key label is the identity a scan lands on → the display face.
		expect(screen.getByText('Air Filter AF-1001').className).toContain('font-display');
		// The Burmese line stays in the body face (Exo 2 has no Myanmar cut — a
		// Burmese string must never be handed a face it cannot render).
		expect(screen.getByText('လေစစ်ဇကာ AF-1001').className).not.toContain('font-display');
	});

	it('shows NO on-hand figure and no stock line at all (stock lives in the stock app)', () => {
		renderCard();
		expect(screen.queryByText(/On hand/)).toBeNull();
		expect(screen.queryByText('Stock out')).toBeNull();
	});

	it('has exactly one affordance — no ⋮ menu', () => {
		renderCard();
		expect(screen.queryByRole('button', { name: /more actions/ })).toBeNull();
		expect(screen.queryByRole('menu')).toBeNull();
		expect(screen.getAllByRole('button')).toHaveLength(1);
	});

	it('reserves the same height with or without a Myanmar name (reserved line)', () => {
		renderCard({ nameMm: null });
		const bare = document.querySelector('li button');
		expect(bare?.className).toContain('min-h-[72px]');
		const lines = bare?.querySelectorAll('p');
		expect(lines?.length).toBe(2);
		expect(lines?.[1].textContent).toBe('\u00A0');
	});

	it('opens the SKU edit form from the card body', () => {
		const { onOpen } = renderCard();
		fireEvent.click(screen.getByRole('button', { name: 'Edit Air Filter AF-1001' }));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GroupCard } from './group-card';
import type { MroModelGroup } from '../data/types';

/**
 * The flat item-group card: NO parent category card/accordion — every card
 * CARRIES its category (in Burmese), the EN name is the primary line and the
 * MY name is its sub-label underneath. No tracking-policy badge: the policy is
 * INHERITED by every SKU under the master, so the group card states identity only.
 */

const group = (over: Partial<MroModelGroup> & { id: string; nameEn: string }): MroModelGroup => ({
	nameMm: '',
	count: 0,
	categoryId: 'c1',
	categoryNameEn: 'Electric & Lighting',
	categoryNameMm: 'လျှပ်စစ်နှင့် မီးချောင်း',
	...over,
});

function renderCard(over: Partial<MroModelGroup> = {}) {
	const onOpen = vi.fn();
	const onEdit = vi.fn();
	render(<GroupCard group={group({ id: 'g1', nameEn: 'Battery', nameMm: 'ဘက်ထရီ', ...over })} onOpen={onOpen} onEdit={onEdit} />);
	return { onOpen, onEdit };
}

afterEach(cleanup);

describe('item-group card — flat, Burmese category, EN name + MY sub-label', () => {
	it('shows the category in BURMESE, the EN name and its MY sub-label', () => {
		renderCard();
		expect(screen.getByText('လျှပ်စစ်နှင့် မီးချောင်း')).toBeTruthy();
		expect(screen.getByText('Battery')).toBeTruthy();
		expect(screen.getByText('ဘက်ထရီ')).toBeTruthy();
		// The English category label is NOT the visible text any more.
		expect(screen.queryByText('Electric & Lighting')).toBeNull();
	});

	it('paints NO tracking-policy badge (the policy is inherited, stated per SKU)', () => {
		renderCard();
		// The wording this card used to carry for a `serial` master.
		expect(screen.queryByText('Serial tracked')).toBeNull();
		expect(screen.queryByText('Batch tracked')).toBeNull();
		expect(screen.queryByText('Standard')).toBeNull();
	});

	it('lets both names WRAP instead of truncating them', () => {
		renderCard();
		expect(screen.getByText('Battery').className).not.toContain('truncate');
		expect(screen.getByText('ဘက်ထရီ').className).not.toContain('truncate');
	});

	it('falls back to the English category label when a category has no name_mm', () => {
		renderCard({ categoryNameMm: null });
		expect(screen.getByText('Electric & Lighting')).toBeTruthy();
	});

	it('shows Uncategorized for an unclassified master', () => {
		renderCard({ categoryId: null, categoryNameEn: null, categoryNameMm: null });
		expect(screen.getByText('Uncategorized')).toBeTruthy();
	});

	it('carries NO count and no expand/collapse affordance (no parent card)', () => {
		renderCard();
		expect(screen.queryByText(/items?\b/)).toBeNull();
		expect(document.querySelector('[aria-expanded]')).toBeNull();
	});

	it('routes taps: the card opens the SKU list, the pencil edits', () => {
		const { onOpen, onEdit } = renderCard();
		fireEvent.click(screen.getByRole('button', { name: /Battery — open its items/ }));
		expect(onOpen).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByRole('button', { name: /Battery — edit/ }));
		expect(onEdit).toHaveBeenCalledTimes(1);
	});
});

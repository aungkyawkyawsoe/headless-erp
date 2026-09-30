import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Database, Home } from 'lucide-react';

import { NavRail, type NavRailItem } from './nav-rail';

const ITEMS: NavRailItem[] = [
	{ id: 'overview', label: 'Overview', icon: Home },
	{ id: 'collections', label: 'Collections', icon: Database },
];

describe('NavRail', () => {
	it('renders one button per item with an accessible name inside a labelled landmark', () => {
		render(<NavRail items={ITEMS} onSelectItem={() => {}} />);

		expect(screen.getByRole('navigation', { name: 'Sections' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Overview' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collections' })).toBeTruthy();
	});

	it('marks only the active item with aria-current', () => {
		render(<NavRail items={ITEMS} activeId="collections" onSelectItem={() => {}} />);

		expect(screen.getByRole('button', { name: 'Collections' }).getAttribute('aria-current')).toBe('page');
		expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
	});

	it('reports the clicked item', () => {
		const onSelectItem = vi.fn();
		render(<NavRail items={ITEMS} onSelectItem={onSelectItem} />);

		fireEvent.click(screen.getByRole('button', { name: 'Collections' }));

		expect(onSelectItem).toHaveBeenCalledWith(ITEMS[1]);
	});

	it('renders the top and footer slots', () => {
		render(
			<NavRail
				items={ITEMS}
				onSelectItem={() => {}}
				top={<button type="button">Brand</button>}
				footer={<button type="button">Theme</button>}
			/>,
		);

		expect(screen.getByRole('button', { name: 'Brand' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Theme' })).toBeTruthy();
	});

	it('uses a custom landmark label when given one', () => {
		render(<NavRail items={ITEMS} onSelectItem={() => {}} label="Factory sections" />);

		expect(screen.getByRole('navigation', { name: 'Factory sections' })).toBeTruthy();
	});
});

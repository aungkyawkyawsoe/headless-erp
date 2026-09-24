// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CategoryStrip, type CategoryTab } from './category-strip';

/**
 * The category strip is the masters hub's selector: a horizontal row of large
 * category tabs (Myanmar name + count) with a leading "All". Selecting a tile
 * reports its id (the page narrows the item-name list below).
 */

const tabs: CategoryTab[] = [
	{ id: '', nameEn: 'All', nameMm: 'အားလုံး' },
	{ id: 'cat-engine', nameEn: 'Engine & Gear Box', nameMm: 'အင်ဂျင်နှင့် ဂီယာဘောက်စ်' },
	{ id: 'cat-tools', nameEn: 'Tools', nameMm: 'ကိရိယာ' },
];

afterEach(cleanup);

describe('CategoryStrip', () => {
	it('renders the "All" tab first plus one tab per category', () => {
		render(<CategoryStrip tabs={tabs} value="" onChange={() => {}} />);
		expect(screen.getByRole('tab', { name: /အားလုံး/ })).toBeTruthy();
		expect(screen.getByRole('tab', { name: /အင်ဂျင်နှင့် ဂီယာဘောက်စ်/ })).toBeTruthy();
		expect(screen.getByRole('tab', { name: /ကိရိယာ/ })).toBeTruthy();
		expect(screen.getAllByRole('tab')).toHaveLength(3);
	});

	it('marks the active tab selected', () => {
		render(<CategoryStrip tabs={tabs} value="cat-tools" onChange={() => {}} />);
		expect(screen.getByRole('tab', { name: /ကိရိယာ/ }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('tab', { name: /အားလုံး/ }).getAttribute('aria-selected')).toBe('false');
	});

	it('reports the picked category id (and "" for All)', () => {
		const onChange = vi.fn();
		render(<CategoryStrip tabs={tabs} value="" onChange={onChange} />);
		fireEvent.click(screen.getByRole('tab', { name: /အင်ဂျင်နှင့် ဂီယာဘောက်စ်/ }));
		expect(onChange).toHaveBeenLastCalledWith('cat-engine');
		fireEvent.click(screen.getByRole('tab', { name: /အားလုံး/ }));
		expect(onChange).toHaveBeenLastCalledWith('');
	});
});

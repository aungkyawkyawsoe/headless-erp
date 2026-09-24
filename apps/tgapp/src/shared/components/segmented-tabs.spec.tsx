// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SegmentedTabs, type SegTabOption } from './segmented-tabs';

/**
 * The shared tab row's two shapes. These pin the contract that made
 * `scrollable` a "proper" scrollable tab (it used to render content-width chips
 * pinned to the left with the row's remaining width empty):
 *
 *   1. the GRID row still fills its width with `w-full` columns;
 *   2. the SCROLLABLE row is equal segments — `flex-1` to split the width, floored
 *      by `min-w-max` so a long label overflows into a scroll instead of
 *      truncating (that pair is what makes it fill-while-fit, scroll-when-not);
 *   3. the selection contract is unchanged (tap → `onChange`, re-tap with
 *      `deselectValue` → the clear value).
 */
const OPTIONS: ReadonlyArray<SegTabOption<'a' | 'b' | 'c'>> = [
	{ value: 'a', label: 'Alpha' },
	{ value: 'b', label: 'Beta' },
	{ value: 'c', label: 'Gamma' },
];

afterEach(cleanup);

describe('SegmentedTabs — grid', () => {
	it('fills the row with equal w-full columns', () => {
		render(<SegmentedTabs options={OPTIONS} value="a" onChange={() => {}} ariaLabel="Test" />);
		const list = screen.getByRole('tablist');
		expect(list.className).toContain('grid');
		for (const tab of screen.getAllByRole('tab')) {
			expect(tab.className).toContain('w-full');
		}
	});
});

describe('SegmentedTabs — scrollable', () => {
	it('renders equal segments that overflow into a scroll rather than truncating', () => {
		render(<SegmentedTabs options={OPTIONS} value="a" onChange={() => {}} ariaLabel="Test" scrollable />);
		const list = screen.getByRole('tablist');
		expect(list.className).toContain('overflow-x-auto');
		expect(list.className).toContain('scroll-px-4');
		for (const tab of screen.getAllByRole('tab')) {
			expect(tab.className).toContain('flex-1');
			expect(tab.className).toContain('min-w-max');
			expect(tab.className).not.toContain('w-full');
		}
	});

	it('marks the selected tab with aria-selected', () => {
		render(<SegmentedTabs options={OPTIONS} value="b" onChange={() => {}} ariaLabel="Test" scrollable />);
		const [alpha, beta, gamma] = screen.getAllByRole('tab');
		expect(alpha.getAttribute('aria-selected')).toBe('false');
		expect(beta.getAttribute('aria-selected')).toBe('true');
		expect(gamma.getAttribute('aria-selected')).toBe('false');
	});
});

describe('SegmentedTabs — selection', () => {
	it('emits the tapped value', () => {
		const onChange = vi.fn();
		render(<SegmentedTabs options={OPTIONS} value="a" onChange={onChange} ariaLabel="Test" scrollable />);
		fireEvent.click(screen.getByRole('tab', { name: 'Beta' }));
		expect(onChange).toHaveBeenCalledWith('b');
	});

	it('emits deselectValue when the active tab is tapped again', () => {
		const onChange = vi.fn();
		render(<SegmentedTabs options={OPTIONS} value="a" onChange={onChange} ariaLabel="Test" deselectValue="a" />);
		fireEvent.click(screen.getByRole('tab', { name: 'Alpha' }));
		expect(onChange).toHaveBeenCalledWith('a');
	});
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErpRow, ErpRowList } from './erp-row';

afterEach(cleanup);

const status = { label: 'Requested', className: 'bg-status-warning-soft text-status-warning' };

describe('ErpRow — the dense ERP row contract', () => {
	it('renders the 3-scale face: anchor, identity and tertiary meta', () => {
		render(<ErpRow anchor="REQ-00004" secondary="Main Store" tertiary="Aung · 12 Jan" />);

		const anchor = screen.getByText('REQ-00004');
		// L1 anchor — the named scale token + bold, never an arbitrary px value.
		expect(anchor.className).toContain('text-key');
		expect(anchor.className).toContain('font-bold');

		expect(screen.getByText('Main Store').className).toContain('text-sub');
		expect(screen.getByText('Aung · 12 Jan').className).toContain('text-meta');
	});

	it('pins the status pill in the top-right of the collapsed face', () => {
		render(<ErpRow anchor="REQ-00004" status={status} meta={[{ label: 'Requested By', value: 'Aung' }]} />);

		const pill = screen.getByText('Requested');
		expect(pill.className).toContain('bg-status-warning-soft');
		// The disclosure chevron sits beside the pill — the top-right cluster.
		expect(screen.getByRole('button', { name: 'Show details' })).toBeTruthy();
	});

	it('hides meta until disclosed, then reveals it (progressive disclosure)', () => {
		render(<ErpRow anchor="REQ-00004" meta={[{ label: 'Approved By', value: 'Daw Mya' }]} />);

		// Collapsed: the fact is not on screen at all.
		expect(screen.queryByText('Approved By')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Show details' }));

		expect(screen.getByText('Approved By')).toBeTruthy();
		expect(screen.getByText('Daw Mya')).toBeTruthy();
		// The toggle reports its state and flips its label for assistive tech.
		expect(screen.getByRole('button', { name: 'Hide details' })).toBeTruthy();
	});

	it('does not render a disclosure control when there is no meta', () => {
		render(<ErpRow anchor="REQ-00004" secondary="Main Store" />);

		expect(screen.queryByRole('button', { name: 'Show details' })).toBeNull();
	});

	it('opens the record from the face tap', () => {
		const onOpen = vi.fn();
		render(<ErpRow anchor="REQ-00004" onOpen={onOpen} />);

		fireEvent.click(screen.getByRole('button', { name: 'REQ-00004' }));

		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it('renders inline actions only when supplied — never implied', () => {
		const { rerender } = render(<ErpRow anchor="REQ-00004" />);
		expect(screen.queryByText('Approve')).toBeNull();

		rerender(<ErpRow anchor="REQ-00004" actions={<button type="button">Approve</button>} />);
		expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
	});

	it('ErpRowList supplies the flat bordered frame with hairline dividers', () => {
		render(
			<ErpRowList>
				<ErpRow anchor="REQ-00004" />
				<ErpRow anchor="REQ-00005" />
			</ErpRowList>,
		);

		const list = screen.getByRole('list');
		// The frame + dividers live on the LIST, not per row — the density source.
		expect(list.className).toContain('divide-y');
		expect(list.className).toContain('rounded-xl');
		expect(list.querySelectorAll('li').length).toBe(2);
	});
});

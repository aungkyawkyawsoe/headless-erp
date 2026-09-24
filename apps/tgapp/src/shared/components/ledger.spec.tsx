// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LedgerList, LedgerRow } from './ledger';

afterEach(cleanup);

/**
 * The truck-ledger contract: a record list is ONE framed series of flush rows
 * (never a stack of floating cards), and a row can state the TRANSITION from the
 * previous record. Pinned so the four per-truck files keep one shape.
 */
describe('LedgerList — one framed series', () => {
	it('supplies the border + hairline dividers, with an optional caption/count', () => {
		render(
			<LedgerList caption="Policy history" count="3 policies">
				<LedgerRow anchor="AYA" />
				<LedgerRow anchor="GGI" />
			</LedgerList>,
		);

		const list = screen.getByRole('list');
		expect(list.className).toContain('divide-y');
		expect(list.className).toContain('rounded-xl');
		expect(screen.getByText('Policy history')).toBeTruthy();
		expect(screen.getByText('3 policies')).toBeTruthy();
		expect(list.querySelectorAll('li').length).toBe(2);
	});
});

describe('LedgerRow — the 3-scale record row + its transition', () => {
	it('renders the anchor, the facts line, the value and the delta', () => {
		render(
			<LedgerRow
				anchor="2025/26"
				secondary="Expires Jun 3, 2026"
				value="1,250,000 Ks"
				delta={{ label: 'premium +70,000', tone: 'warn' }}
			/>,
		);

		expect(screen.getByText('2025/26').className).toContain('text-sub');
		expect(screen.getByText('Expires Jun 3, 2026').className).toContain('text-meta');
		expect(screen.getByText('1,250,000 Ks')).toBeTruthy();
		const delta = screen.getByText('premium +70,000');
		// The delta carries a TONE — that is what makes an anomaly readable.
		expect(delta.className).toContain('text-status-warning');
	});

	it('uses a neutral delta tone by default', () => {
		render(<LedgerRow anchor="29 Sep" delta={{ label: '+700 km' }} />);
		expect(screen.getByText('+700 km').className).toContain('text-muted-foreground');
	});

	it('reveals details on tap (progressive disclosure) and reports its state', () => {
		render(<LedgerRow anchor="Suspension Repair" details={<p>MMK 250,000</p>} />);

		expect(screen.queryByText('MMK 250,000')).toBeNull();
		const row = screen.getByRole('button');
		expect(row.getAttribute('aria-expanded')).toBe('false');

		fireEvent.click(row);
		expect(screen.getByText('MMK 250,000')).toBeTruthy();
		expect(row.getAttribute('aria-expanded')).toBe('true');
	});

	it('acts on tap when there is nothing to reveal', () => {
		const onOpen = vi.fn();
		render(<LedgerRow anchor="29 Sep" onOpen={onOpen} />);

		fireEvent.click(screen.getByRole('button'));
		expect(onOpen).toHaveBeenCalledTimes(1);
	});

	it('renders a trailing action WITHOUT a row-level button (no nested buttons)', () => {
		const onEdit = vi.fn();
		render(
			<LedgerRow
				anchor="YGN/26/100"
				trailing={
					<button type="button" aria-label="Edit license" onClick={onEdit}>
						edit
					</button>
				}
			/>,
		);

		const actions = screen.getAllByRole('button');
		expect(actions).toHaveLength(1);
		fireEvent.click(actions[0]);
		expect(onEdit).toHaveBeenCalledTimes(1);
		// No toggle-shaped row wrapper — a non-expandable row is a plain container,
		// so the trailing pencil is the ONLY button in the row.
		expect(screen.getAllByRole('button')).toHaveLength(1);
	});
});

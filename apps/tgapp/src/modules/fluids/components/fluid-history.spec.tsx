// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FluidFillRowCard } from './fluid-history';
import type { FluidFillHistoryModel } from '../data/types';

const FILL: FluidFillHistoryModel = {
	id: 'f1',
	odo: 15000,
	nextDueOdo: 15500,
	qtyLiters: 20,
	createdLabel: '22 Sep',
	docStatus: 'draft',
};

afterEach(cleanup);

/** Render the card with BOTH actions offered (the caller's newest-fill wiring). */
function renderCard(docStatus: string) {
	const onEdit = vi.fn();
	const onConfirm = vi.fn();
	render(
		<ul>
			<FluidFillRowCard fill={{ ...FILL, docStatus }} onEdit={onEdit} onConfirm={onConfirm} />
		</ul>,
	);
	return { onEdit, onConfirm };
}

/**
 * A confirmed fill is a POSTED service fact — its correction path is a new fill,
 * not an edit. The card's actions follow the row's `doc_status`, so a caller
 * that passes `onEdit` for the newest fill cannot surface Edit on a posted row
 * (the "Confirmed items are still allowed to be edited" report).
 */
describe('FluidFillRowCard — actions follow the row status', () => {
	it('offers Edit on a PENDING fill (and wires the handler)', () => {
		const { onEdit } = renderCard('draft');
		screen.getByRole('button', { name: /edit/i }).click();
		expect(onEdit).toHaveBeenCalledTimes(1);
	});

	it('shows NO Edit on a CONFIRMED fill even though the caller passed onEdit', () => {
		renderCard('approved');
		expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
	});

	it('shows NO action at all on a CANCELLED fill', () => {
		renderCard('cancelled');
		expect(screen.queryByRole('button', { name: /edit/i })).toBeNull();
		expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
	});

	it('offers Confirm on a pending fill that can still be confirmed', () => {
		renderCard('pending_review');
		expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy();
	});
});

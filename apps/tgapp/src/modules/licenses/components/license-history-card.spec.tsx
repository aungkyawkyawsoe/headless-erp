// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { LicenseHistoryCard } from './license-history-card';
import type { LicenseCardModel } from '../data/types';

afterEach(cleanup);

/** The truck 5S-6467's superseded permit: issued 2025-06-30, expired 2026-06-30. */
const superseded: LicenseCardModel = {
	id: 'old',
	createdAt: '2026-03-25T10:48:33.367Z',
	vehicleId: 'v1',
	plate: '5S-6467',
	brand: null,
	licenseNo: 'YGN',
	place: 'YwarTharGyi',
	expiryDate: '2026-06-30',
	remainingDays: -78,
	tone: 'alert',
};

/** The same truck's CURRENT permit: issued 2026-06-29, expiring 2027-06-29. */
const current: LicenseCardModel = { ...superseded, id: 'new', expiryDate: '2027-06-29', remainingDays: 286, tone: 'ok' };

/**
 * Urgency belongs to the CURRENT permit alone. A superseded row's expiry is in the
 * past by definition, so rendering it as "Overdue" painted a renewed truck as
 * overdue in its own history — the confusing state this pins shut.
 */
describe('LicenseHistoryCard — urgency only on the current permit', () => {
	it('shows the renewal-urgency pill for the current permit', () => {
		render(
			<ul>
				<LicenseHistoryCard license={current} current />
			</ul>,
		);
		expect(screen.getByText('286 days')).toBeTruthy();
		expect(screen.queryByText('Superseded')).toBeNull();
	});

	it('labels a superseded permit instead of calling it Overdue', () => {
		render(
			<ul>
				<LicenseHistoryCard license={superseded} />
			</ul>,
		);
		expect(screen.getByText('Superseded')).toBeTruthy();
		expect(screen.queryByText('Overdue')).toBeNull();
		// The factual expiry date still appears in the row's identity line.
		expect(screen.getByText(/Expires Jun 30, 2026/)).toBeTruthy();
	});

	it('never paints the alarm tone on a superseded row even when it is overdue', () => {
		const { container } = render(
			<ul>
				<LicenseHistoryCard license={superseded} />
			</ul>,
		);
		expect(container.textContent).not.toContain('Overdue');
		expect(container.querySelector('.text-status-danger')).toBeNull();
	});
});

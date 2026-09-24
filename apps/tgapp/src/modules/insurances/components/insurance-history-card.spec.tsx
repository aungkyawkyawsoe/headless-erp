// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InsuranceHistoryCard } from './insurance-history-card';
import type { InsuranceCardModel } from '../data/types';

afterEach(cleanup);

const policy: InsuranceCardModel = {
	id: 'p1',
	plateNo: '2Q-8386',
	brandLabel: 'FAW',
	provider: 'AYA',
	policyNo: 'AYA/1',
	expiryDate: '2026-12-31',
	betterment: null,
	windscreenCover: null,
	premiumAmount: null,
	sumInsured: null,
	note: null,
	status: 'valid',
	remainingDays: 90,
};

/**
 * The correction action is rendered ONLY when the page passes `onEdit` — which
 * it does for the truck's newest record alone, so a historical policy can never
 * offer editing.
 */
describe('InsuranceHistoryCard — the newest record offers Edit', () => {
	it('renders the Edit action when supplied and invokes it with the policy', () => {
		const onEdit = vi.fn();
		render(
			<ul>
				<InsuranceHistoryCard insurance={policy} onEdit={onEdit} />
			</ul>,
		);
		screen.getByRole('button', { name: 'Edit policy' }).click();
		expect(onEdit).toHaveBeenCalledWith(policy);
	});

	it('omits the Edit action for an older (read-only) row', () => {
		const { container } = render(
			<ul>
				<InsuranceHistoryCard insurance={policy} />
			</ul>,
		);
		expect(within(container).queryByRole('button', { name: 'Edit policy' })).toBeNull();
	});
});

/**
 * The SAME rule as the license ledger: only the current policy carries the
 * expiry-status pill; a replaced policy shows the neutral Superseded chip, so a
 * renewed truck never reads as "Expired" in its history.
 */
describe('InsuranceHistoryCard — urgency only on the current policy', () => {
	const expired: InsuranceCardModel = { ...policy, id: 'old', expiryDate: '2026-06-30', status: 'expired', remainingDays: -78 };

	it('shows the status pill for the current policy', () => {
		render(
			<ul>
				<InsuranceHistoryCard insurance={policy} current />
			</ul>,
		);
		expect(screen.getByText('90 days')).toBeTruthy();
		expect(screen.queryByText('Superseded')).toBeNull();
	});

	it('labels a superseded policy instead of calling it Expired', () => {
		const { container } = render(
			<ul>
				<InsuranceHistoryCard insurance={expired} />
			</ul>,
		);
		expect(screen.getByText('Superseded')).toBeTruthy();
		expect(container.textContent).not.toContain('Expired');
	});
});

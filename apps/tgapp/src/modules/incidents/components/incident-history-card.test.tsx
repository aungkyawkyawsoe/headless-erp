// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IncidentHistoryCard } from './incident-history-card';
import type { IncidentCardModel } from '../data/types';

afterEach(cleanup);

/** A fully-populated record — each test narrows the fields it cares about. */
const record = (overrides: Partial<IncidentCardModel> = {}): IncidentCardModel => ({
	id: 'rec-1',
	createdAt: '2026-09-06T09:20:41.191Z',
	vehicleId: 'v1',
	plateNo: '7S-1265',
	brandLabel: 'HINO',
	kind: 'accident',
	title: 'Rear bumper scrape',
	description: 'Side swipe at main gate while reversing.',
	severity: 'high',
	location: 'Main store yard',
	dateLabel: '06-Sep-2026',
	costLabel: 'MMK 250,000',
	personnel: [{ id: 'p1', name: 'U Soe Naing', role: 'Safety Supervisor', photo: null }],
	ageLabel: '4 days ago',
	...overrides,
});

/** The card's disclosure button — the one carrying `aria-expanded`. */
const toggle = () => screen.getByRole('button', { expanded: false });

describe('IncidentHistoryCard', () => {
	it('opens collapsed, headed by the record title with the priority as plain text', () => {
		render(<IncidentHistoryCard record={record()} />);

		expect(screen.getByText('Rear bumper scrape')).toBeTruthy();
		// The priority badge carries the LEVEL as words only — no severity tint.
		expect(screen.getByText('High')).toBeTruthy();
		expect(screen.getByText('Accident')).toBeTruthy();
		// Collapsed: none of the details have rendered yet.
		expect(screen.queryByText('Full description')).toBeNull();
		expect(screen.queryByText('Main store yard')).toBeNull();
	});

	it('reveals the details inline when the card is tapped', () => {
		render(<IncidentHistoryCard record={record()} />);

		fireEvent.click(toggle());

		expect(screen.getByRole('button', { expanded: true })).toBeTruthy();
		expect(screen.getByText('Main store yard')).toBeTruthy();
		expect(screen.getByText('MMK 250,000')).toBeTruthy();
		expect(screen.getByText('Side swipe at main gate while reversing.')).toBeTruthy();
	});

	it('resolves the record staff into the personnel grid', () => {
		render(<IncidentHistoryCard record={record()} />);

		fireEvent.click(toggle());

		expect(screen.getByText('Personnel (1)')).toBeTruthy();
		// Each member's designation is the role line above their name.
		expect(screen.getByText('Safety Supervisor')).toBeTruthy();
		expect(screen.getByText('U Soe Naing')).toBeTruthy();
	});

	it('shows the name alone when a member carries no designation', () => {
		render(<IncidentHistoryCard record={record({ personnel: [{ id: 'p1', name: 'Aung Kyaw', role: null, photo: null }] })} />);

		fireEvent.click(toggle());

		expect(screen.getByText('Personnel (1)')).toBeTruthy();
		expect(screen.getByText('Aung Kyaw')).toBeTruthy();
	});

	it('omits the personnel grid when the record carries no staff', () => {
		render(<IncidentHistoryCard record={record({ personnel: [] })} />);

		fireEvent.click(toggle());

		expect(screen.queryByText(/Personnel/)).toBeNull();
	});

	it('does not repeat the account when the record carries no title', () => {
		render(<IncidentHistoryCard record={record({ title: null, description: 'Only the account' })} />);

		fireEvent.click(toggle());

		expect(screen.getByText('Only the account')).toBeTruthy();
		expect(screen.queryByText('Full description')).toBeNull();
	});

	it('hands the record to onOpen from the details edit action', () => {
		const onOpen = vi.fn();
		const rec = record();
		render(<IncidentHistoryCard record={rec} onOpen={onOpen} />);

		fireEvent.click(toggle());
		fireEvent.click(screen.getByRole('button', { name: /Edit record/ }));

		expect(onOpen).toHaveBeenCalledWith(rec);
	});

	it('renders no edit action when the caller supplies no onOpen', () => {
		render(<IncidentHistoryCard record={record()} />);

		fireEvent.click(toggle());

		expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
	});
});

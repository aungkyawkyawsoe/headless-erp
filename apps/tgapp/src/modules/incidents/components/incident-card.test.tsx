// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IncidentCard } from './incident-card';
import type { IncidentCardModel, PersonnelEntry } from '../data/types';

afterEach(cleanup);

const person = (overrides: Partial<PersonnelEntry> = {}): PersonnelEntry => ({
	id: 'p1',
	name: 'U Soe Naing',
	role: 'Driver',
	photo: null,
	...overrides,
});

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
	personnel: [person()],
	ageLabel: '4 days ago',
	...overrides,
});

describe('IncidentCard', () => {
	it('shows the crew leader (designation role · name) and counts the rest', () => {
		render(
			<IncidentCard
				record={record({
					personnel: [
						person(),
						person({ id: 'p2', name: 'Aung Kyaw', role: 'Conductor' }),
						person({ id: 'p3', name: 'David Lin', role: null }),
					],
				})}
			/>,
		);

		// The lead's designation is the role line; the remaining two collapse to +2.
		expect(screen.getByText(/Driver · U Soe Naing/)).toBeTruthy();
		expect(screen.getByText('+2')).toBeTruthy();
	});

	it('shows the name alone when the lead carries no designation', () => {
		render(<IncidentCard record={record({ personnel: [person({ role: null, name: 'Aung Kyaw' })] })} />);

		expect(screen.getByText('Aung Kyaw')).toBeTruthy();
		expect(screen.queryByText(/·/)).toBeNull();
	});

	it('renders no crew line when the record carries no personnel', () => {
		render(<IncidentCard record={record({ personnel: [] })} />);

		// The age stamp still anchors the footer; the crew line is gone.
		expect(screen.getByText('4 days ago')).toBeTruthy();
		expect(screen.queryByText(/Driver/)).toBeNull();
	});

	it('makes the whole card the tap target when onOpen is supplied', () => {
		const onOpen = vi.fn();
		const rec = record();
		render(<IncidentCard record={rec} onOpen={onOpen} />);

		fireEvent.click(screen.getByRole('button', { name: /edit record/ }));

		expect(onOpen).toHaveBeenCalledWith(rec);
	});
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaintenanceLogCard } from './maintenance-log-card';
import type { MaintenanceLogCardModel } from '../data/types';

afterEach(cleanup);

/** A fully-populated log — each test narrows the fields it cares about. */
const log = (overrides: Partial<MaintenanceLogCardModel> = {}): MaintenanceLogCardModel => ({
	id: 'log-1',
	vehicleId: 'v1',
	plateNo: 'RF-11',
	brandLabel: 'FUSO',
	issueTypeName: 'Suspension Repair',
	jobCode: 'JOB-SUS',
	category: { id: 'cat-sus', nameEn: 'Suspension & Steering', nameMm: 'ကိုင်းစနစ်နှင့် စတီယာရင်' },
	rangeLabel: '12 Aug – 15 Aug 2026',
	durationLabel: '4 days',
	odo: '184,500 km',
	odoKm: 184500,
	partsLabel: 'MMK 250,000',
	laborLabel: 'MMK 80,000',
	totalLabel: 'MMK 330,000',
	vendorType: 'in_house',
	technician: 'Ko Aung (in-house)',
	driverName: 'U Hla Tun',
	note: 'Leaf spring replaced.',
	docStatus: 'draft',
	...overrides,
});

/** The card header is the disclosure button; clicking it toggles the details. */
const toggle = () => fireEvent.click(screen.getByRole('button', { expanded: false }));

describe('MaintenanceLogCard', () => {
	it('headlines the job over its code and the engine-computed total', () => {
		render(<MaintenanceLogCard log={log()} />);

		expect(screen.getByText('Suspension Repair')).toBeTruthy();
		expect(screen.getByText('JOB-SUS')).toBeTruthy();
		expect(screen.getByText('MMK 330,000')).toBeTruthy();
	});

	it('shows the truck identity, the vendor and the job window', () => {
		render(<MaintenanceLogCard log={log({ vendorType: 'external' })} />);

		expect(screen.getByText('RF-11')).toBeTruthy();
		expect(screen.getByText('FUSO')).toBeTruthy();
		expect(screen.getByText('External Vendor')).toBeTruthy();
		expect(screen.getByText('12 Aug – 15 Aug 2026')).toBeTruthy();
		expect(screen.getByText('4 days')).toBeTruthy();
	});

	it('keeps the details collapsed until the header is tapped', () => {
		render(<MaintenanceLogCard log={log()} />);

		// Collapsed — the breakdown, the odometer and the note are not on screen.
		expect(screen.queryByText('MMK 250,000')).toBeNull();
		expect(screen.queryByText('184,500 km')).toBeNull();
		expect(screen.queryByText('Leaf spring replaced.')).toBeNull();

		toggle();

		// Expanded — the parts/labor breakdown, the facts and the note appear.
		expect(screen.getByText('MMK 250,000')).toBeTruthy();
		expect(screen.getByText('MMK 80,000')).toBeTruthy();
		expect(screen.getByText('184,500 km')).toBeTruthy();
		expect(screen.getByText('U Hla Tun')).toBeTruthy();
		expect(screen.getByText('Ko Aung (in-house)')).toBeTruthy();
		expect(screen.getByText('Leaf spring replaced.')).toBeTruthy();
	});

	it('reads "In progress" on the window and "No cost recorded" when unpriced', () => {
		render(<MaintenanceLogCard log={log({ rangeLabel: '02 Sep 2026 · In progress', durationLabel: null, totalLabel: null })} />);

		expect(screen.getByText('02 Sep 2026 · In progress')).toBeTruthy();
		expect(screen.getByText('No cost recorded')).toBeTruthy();
	});

	it('states the km run since the previous job in the header when provided', () => {
		render(<MaintenanceLogCard log={log()} kmSincePrevious={184500} />);

		expect(screen.getByText('184,500 km since the previous job')).toBeTruthy();

		cleanup();
		render(<MaintenanceLogCard log={log()} />);
		expect(screen.queryByText(/since the previous job/)).toBeNull();
	});

	it('opens the edit form from the details action when onOpen is supplied', () => {
		const onOpen = vi.fn();
		const row = log();
		render(<MaintenanceLogCard log={row} onOpen={onOpen} />);

		// The Edit action lives INSIDE the expanded details, never on the header.
		toggle();
		fireEvent.click(screen.getByRole('button', { name: /Edit record/ }));

		expect(onOpen).toHaveBeenCalledWith(row);
	});

	it('offers Edit AND Confirm while the log is still a draft', () => {
		const onConfirm = vi.fn();
		const row = log();
		render(<MaintenanceLogCard log={row} onOpen={vi.fn()} onConfirm={onConfirm} />);

		toggle();
		fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }));

		expect(onConfirm).toHaveBeenCalledWith(row);
	});

	it('locks a confirmed log — no Edit, no Confirm, a visible Confirmed pill', () => {
		const row = log({ docStatus: 'confirmed' });
		render(<MaintenanceLogCard log={row} onOpen={vi.fn()} onConfirm={vi.fn()} />);

		// The pill is pre-attentive — visible without expanding.
		expect(screen.getByText('Confirmed')).toBeTruthy();

		toggle();
		expect(screen.queryByRole('button', { name: /Edit record/ })).toBeNull();
		expect(screen.queryByRole('button', { name: /^Confirm$/ })).toBeNull();
		expect(screen.getByText(/this job is locked/)).toBeTruthy();
	});
});

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { StoreRequestCard } from './store-request-card';
import type { MroRequisitionCardModel } from '../data/types';

afterEach(cleanup);

/** A request bound to a truck, with a resolved requester (the expanded read). */
function request(over: Partial<MroRequisitionCardModel> = {}): MroRequisitionCardModel {
	return {
		id: 'r1',
		displayNumber: 'REQ-00001',
		status: 'confirmed',
		requisitionStatus: 'requested',
		requestedBy: { id: 'e1', name: 'Aung', avatar: null },
		approvedBy: { id: null, name: null, avatar: null },
		vehicleId: 'v1',
		vehiclePlate: '24W-HAUL-990',
		issuedQty: null,
		requestedQty: 12,
		locationLabel: 'Main Store',
		requestDateLabel: '5 Sep 2026',
		lineCount: 2,
		totalQty: 12,
		summaryLabel: '2 items · Total 12',
		note: null,
		closeReason: null,
		ageLabel: '1 week ago',
		...over,
	};
}

describe('StoreRequestCard', () => {
	it('names the requester and the truck on the collapsed face — no disclosure needed', () => {
		render(<StoreRequestCard request={request()} onOpen={() => {}} />);

		// L1 anchor — the number a scan lands on.
		expect(screen.getByText('REQ-00001')).toBeTruthy();
		// L2 — store · truck, so a decision sees WHAT and FOR WHICH TRUCK on the face.
		expect(screen.getByText('Main Store · 24W-HAUL-990')).toBeTruthy();
		// L3 — the requester's name + the request date.
		expect(screen.getByText('Aung · 5 Sep 2026')).toBeTruthy();
		expect(screen.getByText('Requested')).toBeTruthy();
	});

	it('falls back to the store alone when the request is bound to no truck', () => {
		render(<StoreRequestCard request={request({ vehicleId: null, vehiclePlate: null })} onOpen={() => {}} />);

		expect(screen.getByText('Main Store')).toBeTruthy();
	});

	it('shows the requester’s description inline — no expand/collapse toggle', () => {
		render(<StoreRequestCard request={request({ note: 'Four tyres for the front axle.' })} onOpen={() => {}} />);

		// Always visible — the card has no disclosure control.
		expect(screen.getByText('Description')).toBeTruthy();
		expect(screen.getByText('Four tyres for the front axle.')).toBeTruthy();
		expect(screen.queryByRole('button', { name: /details/i })).toBeNull();
		// The requester + date already ride the face — never repeated in the details.
		expect(screen.queryByText('Requested By')).toBeNull();
		expect(screen.queryByText('Requested Date')).toBeNull();
	});
});

// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { FleetCard } from './fleet-card';
import type { FleetCardModel } from '../data/types';

/**
 * The truck card's identity is stacked so a scan lands on the PLATE first:
 *
 *   1. the plate — ALONE on its line, in the display face (`font-display`), with
 *      the wheel + length spec tags pinned to the RIGHT of that same line;
 *   2. brand · unit type · year — the truck's "model" line, same face;
 *   3. the license place · township — the location, in the body face.
 *
 * The plate deliberately does NOT share its line with the region: two facts on
 * one baseline meant neither of them read first.
 */

const fleet: FleetCardModel = {
	id: 'v1',
	plateNo: '9Q-2576',
	brandLabel: 'FUSO',
	unitLabel: 'TRACTOR UNIT',
	unitType: 'tractor_unit',
	year: '2017',
	wheelLabel: '10 W',
	feetLabel: '24 ft',
	licenseLabel: 'YGN · YwarTharGyi',
	image: null,
	care: null,
};

function renderCard(over: Partial<FleetCardModel> = {}) {
	render(
		<MemoryRouter>
			<FleetCard fleet={{ ...fleet, ...over }} />
		</MemoryRouter>,
	);
}

/** The identity column — the plate's line, its parent. */
function identityColumnOf(plate: HTMLElement): HTMLElement {
	return plate.parentElement?.parentElement as HTMLElement;
}

afterEach(cleanup);

describe('fleet card — the truck identity, plate first', () => {
	it('stacks the plate, then brand · unit · year, then the license place', () => {
		renderCard();

		const lines = Array.from(identityColumnOf(screen.getByText('9Q-2576')).children);
		expect(lines).toHaveLength(3);
		// The plate OWNS the first line (the tags ride it — see the next test).
		expect(lines[0].firstElementChild?.textContent).toBe('9Q-2576');
		expect(lines[1].textContent).toBe('FUSO · TRACTOR UNIT · 2017');
		expect(lines[2].textContent).toBe('YGN · YwarTharGyi');
	});

	it('pins the wheel + length tags onto the PLATE’s own line, glyph-free', () => {
		renderCard();

		const plateLine = screen.getByText('9Q-2576').parentElement as HTMLElement;
		// Both tags ride the plate's row — the card no longer spends a line on them.
		expect(within(plateLine).getByText('10 W')).toBeTruthy();
		expect(within(plateLine).getByText('24 ft')).toBeTruthy();
		// Exactly [plate, tags]: the tags are LAST, so they sit at the right edge.
		expect(plateLine.children).toHaveLength(2);
		expect(plateLine.lastElementChild?.textContent).toBe('10 W24 ft');
		// A number carrying its own unit needs no wheel / ruler glyph beside it.
		expect(plateLine.querySelectorAll('svg')).toHaveLength(0);
	});

	it('drops the tag row entirely when neither spec is set', () => {
		renderCard({ wheelLabel: null, feetLabel: null });
		expect((screen.getByText('9Q-2576').parentElement as HTMLElement).children).toHaveLength(1);
	});

	it('paints the plate in the display face, never the old mono face', () => {
		renderCard();
		const plate = screen.getByText('9Q-2576');
		expect(plate.className).toContain('font-display');
		expect(plate.className).not.toContain('font-mono');
	});

	it('paints the brand · unit · year line in the display face too', () => {
		renderCard();
		expect(screen.getByText('FUSO · TRACTOR UNIT · 2017').className).toContain('font-display');
	});

	it('leaves the license place in the body face (it is a location, not an identity)', () => {
		renderCard();
		expect(screen.getByText('YGN · YwarTharGyi').className).not.toContain('font-display');
	});

	it('omits each identity line independently when its fact is missing', () => {
		renderCard({ licenseLabel: null });
		expect(screen.queryByText('YGN · YwarTharGyi')).toBeNull();
		// The plate and the model line survive without the region.
		expect(screen.getByText('9Q-2576')).toBeTruthy();
		expect(screen.getByText('FUSO · TRACTOR UNIT · 2017')).toBeTruthy();
	});
});

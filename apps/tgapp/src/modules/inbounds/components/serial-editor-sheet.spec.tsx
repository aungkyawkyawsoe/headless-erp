// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SerialEditorSheet } from './serial-editor-sheet';

/**
 * The serial editor — the contract the sheet exists for:
 *  - a unit is entered ONE ROW AT A TIME (and a pasted column is one Add);
 *  - a repeat is refused WITH A REASON, never silently dropped — on this line or
 *    on another line of the same receipt (a serial names one physical unit);
 *  - the header counter tracks the quantity the list has to match.
 *
 * The sheet is stateless about the list: it reports `onChange` and the host owns
 * the value, so the harness below is the host.
 */

function Host({
	initial = [],
	qty = null,
	others = [],
	readOnly = false,
}: {
	initial?: string[];
	qty?: number | null;
	others?: { serial: string; where: string }[];
	readOnly?: boolean;
}) {
	const [value, setValue] = useState<string[]>(initial);
	return (
		<SerialEditorSheet
			open
			title="Tyre · 11R 22.5"
			value={value}
			qty={qty}
			others={others}
			readOnly={readOnly}
			onOpenChange={vi.fn()}
			onChange={setValue}
		/>
	);
}

/** Type a unit into the entry box and press Add. */
function add(text: string) {
	fireEvent.change(screen.getByLabelText('Serial number'), { target: { value: text } });
	fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

beforeAll(() => {
	// jsdom ships neither, and the design-system Sheet / ScrollArea touch both.
	window.matchMedia ??= ((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia;
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
	if (!Element.prototype.getAnimations) {
		Element.prototype.getAnimations = () => [];
	}
});

afterEach(cleanup);

describe('SerialEditorSheet — entering the units of one line', () => {
	it('adds one unit per tap and states how far the count still is', () => {
		render(<Host qty={2} />);
		expect(screen.getByText(/No serial numbers yet/)).toBeTruthy();

		add('TY-1001');
		expect(screen.getByText('TY-1001')).toBeTruthy();
		// The counter is the fact the operator is watching.
		expect(screen.getByText('1/2')).toBeTruthy();
		expect(screen.getByText(/1 more to add/)).toBeTruthy();

		add('TY-1002');
		expect(screen.getByText('2/2')).toBeTruthy();
		expect(screen.getByText('All 2 units entered.')).toBeTruthy();
		// The entry box is cleared, ready for the next label.
		expect((screen.getByLabelText('Serial number') as HTMLInputElement).value).toBe('');
	});

	it('clears the entry and adds on Enter (a keyboard-driven run of labels)', () => {
		render(<Host qty={1} />);
		const entry = screen.getByLabelText('Serial number');
		fireEvent.change(entry, { target: { value: 'TY-7' } });
		fireEvent.keyDown(entry, { key: 'Enter' });

		expect(screen.getByText('TY-7')).toBeTruthy();
		expect((entry as HTMLInputElement).value).toBe('');
	});

	it('takes a whole PASTED column in one Add', () => {
		render(<Host qty={3} />);
		add('TY-1, TY-2 TY-3');
		for (const serial of ['TY-1', 'TY-2', 'TY-3']) expect(screen.getByText(serial)).toBeTruthy();
		expect(screen.getByText('3/3')).toBeTruthy();
	});

	it('refuses a repeat on THIS line and says why (never a silent drop)', () => {
		render(<Host initial={['TY-1']} qty={2} />);
		add('ty-1'); // same unit, other case

		expect(screen.getByText(/is already in this list/)).toBeTruthy();
		// The list is untouched, so the count still tells the truth.
		expect(screen.getByText('1/2')).toBeTruthy();
	});

	it('refuses a unit another line already carries, and names that line', () => {
		render(<Host qty={1} others={[{ serial: 'TY-9', where: 'item 2' }]} />);
		add('TY-9');

		expect(screen.getByText(/is already on item 2/)).toBeTruthy();
		expect(screen.getByText(/No serial numbers yet/)).toBeTruthy();
	});

	it('removes a mis-typed unit, and warns when the list runs LONG', () => {
		render(<Host initial={['TY-1', 'TY-2', 'TY-3']} qty={2} />);
		expect(screen.getByText(/1 too many/)).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: 'Remove TY-3' }));
		expect(screen.queryByText('TY-3')).toBeNull();
		expect(screen.getByText('All 2 units entered.')).toBeTruthy();
	});

	it('says nothing about the count before a quantity is typed', () => {
		render(<Host qty={null} />);
		expect(screen.queryByText(/more to add/)).toBeNull();
		expect(screen.queryByText(/too many/)).toBeNull();
		// The counter drops the denominator rather than inventing one.
		expect(screen.getByText('0')).toBeTruthy();
	});
});

/**
 * The READ-ONLY view of a settled document's units: the same list, one row per unit and
 * counted against the quantity, with every way to change it ABSENT rather than dead —
 * no entry box, no Add, no per-row delete, and no instruction to type. Reading the
 * units a posted receipt received is not a write, so this view stays available.
 */
describe('SerialEditorSheet — the read-only view', () => {
	it('lists the units and offers not one way to change them', () => {
		render(<Host initial={['TY-12', 'TY-13', 'TY-14']} qty={3} readOnly />);

		// The list reads exactly as it does while editing…
		expect(screen.getByText('3/3')).toBeTruthy();
		for (const unit of ['TY-12', 'TY-13', 'TY-14']) expect(screen.getByText(unit)).toBeTruthy();

		// …and the ACTIONS are gone, not disabled: nothing to type, nothing to add,
		// nothing to remove.
		expect(screen.queryByLabelText('Serial number')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
		expect(screen.queryByLabelText('Remove TY-12')).toBeNull();
		// Nor an instruction to type — the count hint is the editor's, not a viewer's.
		expect(screen.queryByText('All 3 units entered.')).toBeNull();
		expect(screen.queryByText(/more to add/)).toBeNull();
	});

	it('says an empty line has none, rather than asking for one', () => {
		render(<Host qty={2} readOnly />);
		expect(screen.getByText('No serial numbers on this line.')).toBeTruthy();
		expect(screen.queryByText(/paste the whole list/)).toBeNull();
	});
});

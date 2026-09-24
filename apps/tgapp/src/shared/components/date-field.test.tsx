// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DateField } from './date-field';

// jsdom ships no `matchMedia`, which the design-system DatePicker's
// mobile/desktop surface switch reads. Stub it as "desktop" (matches = false).
beforeAll(() => {
	if (!window.matchMedia) {
		window.matchMedia = ((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		})) as unknown as typeof window.matchMedia;
	}
});

afterEach(cleanup);

/**
 * The date-field contract this app depends on: the field must occupy exactly the
 * space its sibling `Input`s do. Historically these were native
 * `<input type="date">`, whose intrinsic width overflows a narrow card and whose
 * height never matched the surrounding fields. These tests pin the two halves of
 * the fix: the control IS the design-system DatePicker (a calendar trigger, not a
 * native date input), and it forwards the caller's field class — the single
 * source of the height/width — onto that trigger.
 */
describe('DateField', () => {
	it('renders the design-system calendar trigger, never a native date input', () => {
		render(<DateField value="" onChange={() => {}} className="h-11 w-full" />);

		expect(screen.getByRole('button')).toBeTruthy();
		expect(document.querySelector('input[type="date"]')).toBeNull();
	});

	it('forwards the field class so height/width match the sibling inputs', () => {
		render(<DateField value="" onChange={() => {}} className="h-11 w-full rounded-lg" />);

		const trigger = screen.getByRole('button');
		expect(trigger.className).toContain('h-11');
		expect(trigger.className).toContain('w-full');
		// The label is the flexible child that truncates instead of stretching the
		// field past its container.
		expect(trigger.className).toContain('min-w-0');
	});

	it('shows the placeholder while unset and emits `YYYY-MM-DD` on select', () => {
		const onChange = vi.fn();
		render(<DateField value="" onChange={onChange} placeholder="Pick a date" className="h-11 w-full" />);

		expect(screen.getByText('Pick a date')).toBeTruthy();
	});

	it('renders a set value as a readable calendar date', () => {
		render(<DateField value="2026-09-10" onChange={() => {}} className="h-11 w-full" />);

		// No native `09/10/2026` input text — a formatted date label instead.
		expect(screen.queryByDisplayValue('2026-09-10')).toBeNull();
		expect(screen.getByRole('button').textContent).toBeTruthy();
	});

	it('states the app’s SHORT day-first format — `10 Sep 2026`, never the locale’s long form', () => {
		render(<DateField value="2026-09-10" onChange={() => {}} className="h-11 w-full" />);

		// A date field is a FIELD: the stock-document header pairs it beside another
		// picker in a half-width cell, where “September 10, 2026” would truncate.
		expect(screen.getByRole('button').textContent).toContain('10 Sep 2026');
		expect(screen.queryByText(/September/)).toBeNull();
	});

	it('passes the disabled state through to the trigger', () => {
		render(<DateField value="" onChange={() => {}} disabled className="h-11 w-full" />);

		expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
	});
});

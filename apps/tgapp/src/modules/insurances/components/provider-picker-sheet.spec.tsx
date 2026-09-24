// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ProviderField, providerOptionsOf } from './provider-picker-sheet';
import { INSURANCE_PROVIDER_OPTIONS } from '../data/status';

// jsdom ships neither, and the design-system Sheet's portal/animation path
// touches them. Both are inert here — the tests assert rendering + callbacks.
beforeAll(() => {
	if (!globalThis.ResizeObserver) {
		globalThis.ResizeObserver = class {
			observe() {}
			unobserve() {}
			disconnect() {}
		} as unknown as typeof ResizeObserver;
	}
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

describe('providerOptionsOf — the rows the picker offers', () => {
	it('leads with every declared insurer, in declaration order', () => {
		const options = providerOptionsOf();
		expect(options.map((o) => o.value)).toEqual(INSURANCE_PROVIDER_OPTIONS.map((o) => o.value));
		// The stored value and the displayed label differ for AYA (AYI → AYA).
		expect(options[0]).toEqual({ value: 'AYI', label: 'AYA' });
	});

	it('appends a truck\u2019s legacy providers that the select does not declare', () => {
		const options = providerOptionsOf(['State Insurance']);
		expect(options.at(-1)).toEqual({ value: 'State Insurance', label: 'State Insurance' });
	});

	it('never duplicates a value already declared — including a raw LABEL spelling', () => {
		// 'AYA' is a declared LABEL, not a value: it must resolve to the canon code
		// rather than add a second AYA row.
		const options = providerOptionsOf(['AYI', 'AYA', 'AYA ', '']);
		expect(options.filter((o) => o.label === 'AYA')).toHaveLength(1);
		expect(options.filter((o) => o.value === 'AYI')).toHaveLength(1);
		expect(options.map((o) => o.value)).toEqual(INSURANCE_PROVIDER_OPTIONS.map((o) => o.value));
	});

	it('ignores blank entries', () => {
		expect(providerOptionsOf(['', '   '])).toHaveLength(INSURANCE_PROVIDER_OPTIONS.length);
	});
});

describe('ProviderField — tap to open the sheet, tap a row to choose', () => {
	it('opens a bottom sheet listing the declared insurers and reports the pick', () => {
		const onChange = vi.fn();
		render(<ProviderField provider="" onProviderChange={onChange} ariaLabel="Provider" />);

		// Closed to start: no option rows are rendered.
		expect(screen.queryByRole('option')).toBeNull();

		fireEvent.click(screen.getByRole('button', { name: 'Provider' }));

		const rows = screen.getAllByRole('option');
		expect(rows.map((row) => row.textContent)).toEqual(INSURANCE_PROVIDER_OPTIONS.map((o) => o.label));

		fireEvent.click(screen.getByRole('option', { name: 'KBZMS' }));
		expect(onChange).toHaveBeenCalledWith('KBZMS');
		// The sheet closes on a pick.
		expect(screen.queryByRole('option')).toBeNull();
	});

	it('shows the stored option\u2019s LABEL on the trigger, not its code', () => {
		render(<ProviderField provider="AYI" onProviderChange={() => {}} ariaLabel="Provider" />);
		expect(screen.getByRole('button', { name: 'Provider' }).textContent).toContain('AYA');
	});

	it('marks the current value as selected', () => {
		render(<ProviderField provider="EFI" onProviderChange={() => {}} ariaLabel="Provider" />);
		fireEvent.click(screen.getByRole('button', { name: 'Provider' }));
		expect(screen.getByRole('option', { name: 'EFI' }).getAttribute('aria-selected')).toBe('true');
		expect(screen.getByRole('option', { name: 'FNI' }).getAttribute('aria-selected')).toBe('false');
	});

	it('prompts when nothing is chosen yet', () => {
		render(<ProviderField provider="" onProviderChange={() => {}} ariaLabel="Provider" />);
		expect(screen.getByRole('button', { name: 'Provider' }).textContent).toContain('Select provider');
	});
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConfirmSheet } from './confirm-sheet';

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

const base = {
	open: true,
	title: 'Confirm this receipt?',
	description: 'Confirming posts these items into stock.',
	onConfirm: () => {},
	onClose: () => {},
};

describe('ConfirmSheet', () => {
	it('renders the title, description and default labels', () => {
		render(<ConfirmSheet {...base} />);

		expect(screen.getByText('Confirm this receipt?')).toBeTruthy();
		expect(screen.getByText('Confirming posts these items into stock.')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
	});

	it('renders nothing while closed', () => {
		render(<ConfirmSheet {...base} open={false} />);

		expect(screen.queryByText('Confirm this receipt?')).toBeNull();
	});

	it('runs onConfirm when the confirm button is pressed', () => {
		const onConfirm = vi.fn();
		render(<ConfirmSheet {...base} onConfirm={onConfirm} />);

		fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

		expect(onConfirm).toHaveBeenCalledTimes(1);
	});

	it('dismisses via onClose when Cancel is pressed', () => {
		const onClose = vi.fn();
		render(<ConfirmSheet {...base} onClose={onClose} />);

		fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it('honours the custom confirm/cancel labels', () => {
		render(<ConfirmSheet {...base} confirmLabel="Cancel draft" cancelLabel="Keep it" />);

		expect(screen.getByRole('button', { name: 'Cancel draft' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
	});

	it('locks the sheet while busy — spinner shown, both buttons disabled, no callbacks', () => {
		const onConfirm = vi.fn();
		const onClose = vi.fn();
		render(<ConfirmSheet {...base} busy onConfirm={onConfirm} onClose={onClose} />);

		const confirm = screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;
		const cancel = screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement;
		expect(confirm.disabled).toBe(true);
		expect(cancel.disabled).toBe(true);
		expect(confirm.getAttribute('aria-busy')).toBe('true');
		// The spinner is the only child svg added while busy.
		expect(confirm.querySelector('svg')).toBeTruthy();

		fireEvent.click(confirm);
		fireEvent.click(cancel);
		expect(onConfirm).not.toHaveBeenCalled();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('surfaces a failure inline without closing', () => {
		render(<ConfirmSheet {...base} error="Could not confirm — try again." />);

		expect(screen.getByRole('alert').textContent).toBe('Could not confirm — try again.');
	});

	it('switches the confirm colour on tone', () => {
		const { rerender } = render(<ConfirmSheet {...base} />);
		expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).className).toContain('bg-primary');

		rerender(<ConfirmSheet {...base} tone="destructive" />);
		expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).className).toContain('bg-destructive');
	});
});

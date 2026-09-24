// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormError, FormSubmitBar } from './form-submit';

afterEach(cleanup);

/**
 * The save-action contract: one error treatment, and an in-page button that
 * yields to Telegram's native MainButton. Forms used to hand-roll both (24
 * button strings, 4 error styles) — these pin the shared behavior.
 */
describe('FormError', () => {
	it('renders nothing when there is no error', () => {
		const { container } = render(<FormError error={null} />);
		expect(container.firstChild).toBeNull();
	});

	it('announces the message as an alert', () => {
		render(<FormError error="Could not save" />);
		expect(screen.getByRole('alert').textContent).toBe('Could not save');
	});
});

describe('FormSubmitBar', () => {
	it('hides the in-page button while the native MainButton is shown', () => {
		const { container } = render(<FormSubmitBar label="Save" isMainButton onSubmit={() => {}} />);
		expect(container.firstChild).toBeNull();
	});

	it('fires onClick for a type="button" save', () => {
		const onClick = vi.fn();
		render(<FormSubmitBar label="Save" isMainButton={false} onSubmit={onClick} />);
		const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
		expect(button.type).toBe('button');
		fireEvent.click(button);
		expect(onClick).toHaveBeenCalledTimes(1);
	});

	it('disables and swaps the label while submitting', () => {
		render(<FormSubmitBar label="Save" isMainButton={false} submitting onSubmit={() => {}} />);
		const button = screen.getByRole('button') as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.textContent).toContain('Saving…');
	});

	it('renders a type="submit" button (no onClick) for form-native submission', () => {
		render(<FormSubmitBar label="Save" type="submit" isMainButton={false} />);
		expect((screen.getByRole('button') as HTMLButtonElement).type).toBe('submit');
	});
});

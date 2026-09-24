// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PageError } from './page-error';

afterEach(cleanup);

/**
 * A failed read must be announced as a failure and be retryable — never
 * masquerade as "no records" (the silent-failure regression this component
 * removed). These pin the role + the retry wiring.
 */
describe('PageError', () => {
	it('announces the default failure copy as an alert', () => {
		render(<PageError />);
		expect(screen.getByRole('alert').textContent).toContain('Could not load this list.');
	});

	it('renders a retry button that calls onRetry', () => {
		const onRetry = vi.fn();
		render(<PageError onRetry={onRetry} />);
		fireEvent.click(screen.getByRole('button', { name: /try again/i }));
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it('omits the retry button when no retry handler is given', () => {
		render(<PageError />);
		expect(screen.queryByRole('button')).toBeNull();
	});
});

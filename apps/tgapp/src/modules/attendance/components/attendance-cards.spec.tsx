// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttendanceCards } from './attendance-cards';

/**
 * The check-out minimum-wait gate (#1): after a check-in the Check Out card stays
 * inert for 15 minutes and shows the remaining wait; it unlocks on its own once
 * the window elapses (the card owns the ticking clock while the wait is pending).
 */

const MIN = 60_000;
/** An arbitrary instant; the work-day boundary is irrelevant to the gate. */
const BASE = Date.UTC(2026, 0, 15, 3, 30, 0);

const checkOutButton = () => screen.getByRole('button', { name: /ရုံးဆင်း/ }) as HTMLButtonElement;

describe('AttendanceCards — 15-minute check-out gate', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(BASE);
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it('disables Check Out right after check-in and explains the wait', () => {
		render(<AttendanceCards checkIn={new Date(BASE).toISOString()} checkOut={null} />);

		expect(checkOutButton().disabled).toBe(true);
		expect(screen.getByText('Available in 15m')).toBeTruthy();
	});

	it('stays disabled before 15 minutes and unlocks exactly at the boundary', () => {
		render(<AttendanceCards checkIn={new Date(BASE).toISOString()} checkOut={null} />);

		act(() => {
			vi.advanceTimersByTime(14 * MIN);
		});
		expect(checkOutButton().disabled).toBe(true);
		expect(screen.getByText('Available in 1m')).toBeTruthy();

		act(() => {
			vi.advanceTimersByTime(1 * MIN);
		});
		expect(checkOutButton().disabled).toBe(false);
		expect(screen.queryByText(/available in/i)).toBeNull();
	});

	it('keeps Check Out inert with no check-in (no wait hint)', () => {
		render(<AttendanceCards checkIn={null} checkOut={null} />);

		expect(checkOutButton().disabled).toBe(true);
		expect(screen.queryByText(/available in/i)).toBeNull();
	});

	it('locks both cards once the day is checked out', () => {
		render(<AttendanceCards checkIn={new Date(BASE).toISOString()} checkOut={new Date(BASE + 16 * MIN).toISOString()} />);

		expect((screen.getByRole('button', { name: /ရုံးတက်/ }) as HTMLButtonElement).disabled).toBe(true);
		expect(checkOutButton().disabled).toBe(true);
		expect(screen.queryByText(/available in/i)).toBeNull();
	});
});

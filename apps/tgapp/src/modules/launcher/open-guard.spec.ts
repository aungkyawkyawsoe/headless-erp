import { describe, expect, it } from 'vitest';

import { createOpenGuard } from './open-guard';

describe('createOpenGuard', () => {
	it('claims the first open and reports it pending', () => {
		const guard = createOpenGuard();
		expect(guard.begin('attendance')).toBe(true);
		expect(guard.pending()).toBe('attendance');
	});

	it('rejects a second app while one open is pending', () => {
		const guard = createOpenGuard();
		guard.begin('attendance');
		// The second tap must be ignored outright — this is the "I can still press
		// another app icon" bug.
		expect(guard.begin('projects')).toBe(false);
		expect(guard.pending()).toBe('attendance');
	});

	it('rejects re-opening the SAME app while pending (double tap)', () => {
		const guard = createOpenGuard();
		guard.begin('attendance');
		expect(guard.begin('attendance')).toBe(false);
	});

	it('accepts the next open once released', () => {
		const guard = createOpenGuard();
		guard.begin('attendance');
		guard.release();
		expect(guard.pending()).toBeNull();
		expect(guard.begin('projects')).toBe(true);
		expect(guard.pending()).toBe('projects');
	});

	it('releases idempotently', () => {
		const guard = createOpenGuard();
		guard.release();
		expect(guard.pending()).toBeNull();
	});

	it('keeps separate instances independent (one per launcher mount)', () => {
		const a = createOpenGuard();
		const b = createOpenGuard();
		expect(a.begin('attendance')).toBe(true);
		expect(b.begin('projects')).toBe(true);
	});
});

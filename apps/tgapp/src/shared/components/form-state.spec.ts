// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useFormDirty, useSubmitGuard, valuesEqual } from './form-state';

describe('useSubmitGuard', () => {
	it('admits the first begin() and refuses a second until end() releases it', () => {
		const { result } = renderHook(() => useSubmitGuard());

		expect(result.current.begin()).toBe(true);
		// SAME synchronous tick — the Poka-Yoke gap a `submitting` state check
		// cannot close (React has not re-rendered between two taps yet).
		expect(result.current.begin()).toBe(false);
		expect(result.current.begin()).toBe(false);

		act(() => result.current.end());
		expect(result.current.begin()).toBe(true);
	});

	it('keeps the latch per hook instance, not module-global', () => {
		const a = renderHook(() => useSubmitGuard());
		const b = renderHook(() => useSubmitGuard());

		expect(a.result.current.begin()).toBe(true);
		// A second form's guard is independent — one in-flight submit never blocks another.
		expect(b.result.current.begin()).toBe(true);
	});
});

describe('valuesEqual', () => {
	it('compares primitives, null and undefined', () => {
		expect(valuesEqual('a', 'a')).toBe(true);
		expect(valuesEqual('a', 'b')).toBe(false);
		expect(valuesEqual(null, null)).toBe(true);
		expect(valuesEqual(null, undefined)).toBe(false);
		expect(valuesEqual(0, 0)).toBe(true);
		expect(valuesEqual(0, false)).toBe(false);
	});

	it('compares arrays element-wise (order matters, length matters)', () => {
		expect(valuesEqual([1, 2], [1, 2])).toBe(true);
		expect(valuesEqual([1, 2], [1, 2, 3])).toBe(false);
		expect(valuesEqual([1, 2], [2, 1])).toBe(false);
		expect(valuesEqual([{ id: 'x' }], [{ id: 'x' }])).toBe(true);
	});

	it('compares plain objects by key, ignoring key order', () => {
		expect(valuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
		expect(valuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(valuesEqual({ a: 1 }, { a: 2 })).toBe(false);
		expect(valuesEqual({ a: undefined }, {})).toBe(false);
	});

	it('compares Dates by instant', () => {
		expect(valuesEqual(new Date(0), new Date(0))).toBe(true);
		expect(valuesEqual(new Date(0), new Date(1))).toBe(false);
	});

	it('falls back to reference equality for non-plain values', () => {
		class Box {
			v: number;
			constructor(v: number) {
				this.v = v;
			}
		}
		const b = new Box(1);
		// Same reference — equal; a distinct class instance with the same shape — not.
		expect(valuesEqual(b, b)).toBe(true);
		expect(valuesEqual(b, new Box(1))).toBe(false);
	});
});

describe('useFormDirty', () => {
	it('is clean when current matches the baseline and dirty once it differs', () => {
		const { result, rerender } = renderHook(({ current }) => useFormDirty({ name: 'orig', qty: 1 }, current), {
			initialProps: { current: { name: 'orig', qty: 1 } },
		});
		expect(result.current).toBe(false);

		rerender({ current: { name: 'orig', qty: 2 } });
		expect(result.current).toBe(true);

		rerender({ current: { name: 'orig', qty: 1 } });
		expect(result.current).toBe(false);
	});

	it('reads a prefilled CREATE as dirty when the baseline is the empty default', () => {
		// A create form that seeds fields from a prefill must remain submittable.
		const { result } = renderHook(() => useFormDirty({ reason: '' }, { reason: 'prefilled' }));
		expect(result.current).toBe(true);
	});
});

import { describe, expect, it, vi } from 'vitest';

import { listPageErrorProps } from './use-cursor-list';

/**
 * The error-prop bridge that fixes the silent-failure class: a `ListPage`
 * consumer forgot to pass `isError`/`onRetry`, so a failed read rendered the
 * empty state. Spreading `listPageErrorProps(list)` makes the wiring the
 * default; this pins the mapping.
 */
describe('listPageErrorProps', () => {
	it('forwards isError and turns refetch into onRetry', () => {
		const refetch = vi.fn();
		const props = listPageErrorProps({ isError: true, refetch });

		expect(props.isError).toBe(true);
		props.onRetry();
		expect(refetch).toHaveBeenCalledTimes(1);
	});

	it('carries a false isError through untouched (no false positive)', () => {
		expect(listPageErrorProps({ isError: false, refetch: () => {} }).isError).toBe(false);
	});
});

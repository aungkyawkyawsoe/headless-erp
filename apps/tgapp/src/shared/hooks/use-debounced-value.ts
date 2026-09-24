import { useEffect, useState } from 'react';

/**
 * Trailing-edge debounce — `value` settles into `debounced` only after `delayMs`
 * of quiet. The standard input companion for the app's type-ahead searches (the
 * vehicle picker keeps its own local copy; the toolbar bar-search debounces its
 * own effect so it can cancel stale fetches).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}

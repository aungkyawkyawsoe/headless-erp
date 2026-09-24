/**
 * Data bindings — resolve live collection data for widgets and blocks.
 *
 * A block config can carry a `bind` spec (e.g. `{ kind: 'item', collection:
 * 'employee', id: '…' }`); the renderer resolves it through a host-provided
 * `DataSource` (the frontend's API client, the Studio canvas, …) and hands the
 * result to the widget as a reserved `data` prop. Canvas == runtime: both
 * hosts provide the same fetcher contract.
 */
import { useEffect, useState } from 'react';

export type BindingSpec =
	| { kind: 'count'; collection: string; filters?: Record<string, unknown> }
	| { kind: 'list'; collection: string; limit?: number; sort?: string; filters?: Record<string, unknown> }
	| { kind: 'item'; collection: string; id: string }
	| {
			kind: 'aggregate';
			collection: string;
			groupBy?: string;
			aggregate?: Array<{ op: string; field: string }>;
			filters?: Record<string, unknown>;
	  };

/** Host-provided fetcher — resolves a binding spec to live data. */
export type DataSource = (spec: BindingSpec) => Promise<unknown>;

export interface BindingResult {
	data: unknown;
	error: string | null;
	loading: boolean;
}

/** Resolve a binding spec via the host data source (cancellation-safe). */
export function useBinding(spec: BindingSpec | null | undefined, dataSource?: DataSource | null): BindingResult {
	const [data, setData] = useState<unknown>(null);
	const [error, setError] = useState<string | null>(null);
	// `loading` is explicit state — true only until the in-flight promise settles.
	// A settled `data === null` is a VALID empty result (e.g. `item` kind resolving
	// a missing record), never an excuse to keep showing the loading skeleton.
	const [loading, setLoading] = useState(true);
	const key = spec ? JSON.stringify(spec) : '';

	useEffect(() => {
		if (!spec || !dataSource) {
			setData(null);
			setError(null);
			setLoading(false);
			return;
		}
		let cancelled = false;
		setData(null);
		setError(null);
		setLoading(true);
		dataSource(spec)
			.then((d) => {
				if (!cancelled) {
					setData(d);
					setLoading(false);
				}
			})
			.catch((e) => {
				if (!cancelled) {
					setError(e instanceof Error ? e.message : 'Binding failed');
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [key, dataSource]);

	return { data, error, loading };
}

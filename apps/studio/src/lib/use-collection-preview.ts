import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SYSTEM_FIELD_NAMES, type EntitySchema } from './api';
import { itemsQuery, type ItemsPage } from './queries';
import { qk } from './query-keys';
import type { ViewConfig } from '../components/PageBuilderContext';

type Row = Record<string, unknown>;

/**
 * useCollectionPreview — shared live-preview plumbing for the card/kanban canvases.
 *
 * Resolves the focused collection (menu focus wins, then the view config), loads
 * its schema + user fields, and fetches a bounded page of records for the WYSIWYG
 * preview. The per-view "seed from the collection's runtime config" effect stays
 * in each canvas (the seed conditions differ); everything else is shared.
 *
 * The preview rows ride the ONE cache layer (TanStack Query), keyed exactly like
 * every other read of that collection: switching table ⇄ card ⇄ kanban, or coming
 * back to a canvas, is a cache hit instead of a fresh round trip, and the count /
 * table page over the same collection share the in-flight request. It used to be
 * a hand-rolled `useState` + `useEffect` read that re-fetched on every mount.
 */
export function useCollectionPreview(
	token: string,
	viewConfigs: Record<string, ViewConfig>,
	schemas: Record<string, EntitySchema>,
	fetchSchema: (collection: string) => Promise<EntitySchema | null>,
	focusCollection: string | null,
	viewKey: string,
	opts?: { limit?: number; enabled?: boolean },
) {
	const queryClient = useQueryClient();
	const vc = viewConfigs[viewKey] ?? {};
	const collection = focusCollection ?? vc.collection ?? '';
	const schema = collection ? (schemas[collection] ?? null) : null;

	useEffect(() => {
		if (collection && !schemas[collection]) void fetchSchema(collection);
	}, [collection, schemas, fetchSchema]);

	const fields = useMemo(() => (schema?.schema_json.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name)), [schema]);

	// Live preview — the first records of the collection, re-rendered as cards/board.
	const limit = opts?.limit ?? 6;
	const params = useMemo(() => ({ limit }), [limit]);
	const rowsQ = useQuery({
		...itemsQuery(token, collection, params),
		// The canvas preview is a small, cheap page; while it has data, a background
		// refresh must not blank the cards (stale-while-revalidate is the point).
		enabled: token.length > 0 && !!collection && opts?.enabled !== false,
	});

	/** Optimistic edit of ONE preview row (e.g. a card photo upload) — writes the
	 *  same cache entry the table/count read, so every view agrees. */
	const setRows = useCallback(
		(updater: (rows: Row[]) => Row[]) => {
			if (!collection) return;
			queryClient.setQueryData<ItemsPage>(qk.items(collection, params), (prev) => (prev ? { ...prev, rows: updater(prev.rows) } : prev));
		},
		[queryClient, collection, params],
	);

	return { collection, schema, fields, rows: rowsQ.data?.rows ?? [], setRows, loading: rowsQ.isPending, vc };
}

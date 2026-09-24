/**
 * useReportPreview(token, def) — live report execution for the Studio.
 *
 * Shared by every "design == runtime" preview surface: the pivot view editor's
 * live preview, the pivot view canvas, and pivot/report block previews. Executes
 * the definition against the real `/api/reports/execute` endpoint.
 *
 * Execution is the most expensive read the Studio issues (a GROUP BY over a
 * collection), so it is NOT imperative any more — it runs through TanStack Query
 * (`reportQuery`), keyed by the canonical JSON of the definition. Consequences:
 * the same definition on the canvas and in the editor costs ONE execution (they
 * used to fire two), toggling a view mode back and forth is free, and a row write
 * in the report's collection drops the cached matrix (`invalidateRows`). The
 * definition is compared by VALUE (canonical JSON), so editing a dimension/measure
 * is a new key and refetches, while a fresh object identity from the caller is not.
 */
import { useQuery } from '@tanstack/react-query';
import type { StudioReportDef } from './api';
import { reportQuery } from './queries';

export interface ReportPreviewSpec {
	collection: string;
	rowDimensions: string[];
	columnDimensions?: string[];
	measures: Array<{ op: string; field: string; alias?: string }>;
}

export interface ReportPreviewResult {
	result: { data: Array<Record<string, unknown>>; columns: string[] } | null;
	error: string | null;
	loading: boolean;
}

/** Normalize a preview spec into the canonical engine definition (the query key). */
function toStudioDef(d: ReportPreviewSpec): StudioReportDef {
	return {
		collection: d.collection,
		rowDimensions: d.rowDimensions,
		...(d.columnDimensions?.length ? { columnDimensions: d.columnDimensions } : {}),
		measures: d.measures.map((m) => ({
			op: m.op,
			field: m.field,
			alias: m.alias ?? `${m.op}_${m.field === '*' ? 'all' : m.field}`,
		})),
	};
}

export function useReportPreview(token: string, def: ReportPreviewSpec | null): ReportPreviewResult {
	const studioDef = def ? toStudioDef(def) : null;
	// The definition IS the identity — canonical JSON, so a caller's fresh object
	// never invalidates the cache and a real edit always does.
	const key = studioDef ? JSON.stringify(studioDef) : '';
	const q = useQuery(reportQuery(token, studioDef?.collection ?? '', key, studioDef));

	return {
		result: q.data ?? null,
		error: q.error ? (q.error instanceof Error ? q.error.message : 'Report failed') : null,
		// A key is present but the first execution hasn't landed yet. A disabled
		// query (no definition) is `isPending` too, hence the explicit key guard.
		loading: key !== '' && q.isPending,
	};
}

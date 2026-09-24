/**
 * View-model shapes for the စတော့ dashboard — derived CLIENT-side from the raw
 * `/api/mro/stock/onhand` rows (a flat per (model, location) balance report).
 *
 * The generated app Schema has no `mro_*` collections (no SchemaRow exists for
 * them), so these are plain local interfaces over the shared row types in
 * `@/shared/mro` — grouped/sorted exactly as the page draws them.
 */

import type { MroOnHandRow } from '@/shared/mro';

/** One store's slice of the report — its balance rows under one header. */
export interface OnHandGroup {
	/** The raw location value (`main_store`, …); `label` carries the Burmese name. */
	location: string;
	/** The location's display label (ပင်မစတိုး …; raw value until the map knows it). */
	label: string;
	/** Balance rows in display order — below-reorder first, then by model name. */
	rows: MroOnHandRow[];
	/** Rows flagged `below_reorder` — the header's ပြန်မှာရန် count. */
	belowReorderCount: number;
}

/** The summary strip's headline counts, derived from the on-hand rows. */
export interface OnHandTotals {
	/** Distinct item models across every location (SKUs on hand). */
	skuCount: number;
	/** Locations that carry at least one balance row. */
	locationCount: number;
	/** Balance rows flagged `below_reorder` — reorder now. */
	belowReorderCount: number;
}

/** The full on-hand report, grouped for display. */
export interface OnHandReport {
	/** Location groups in the shared MRO_LOCATIONS order. */
	groups: OnHandGroup[];
	totals: OnHandTotals;
}

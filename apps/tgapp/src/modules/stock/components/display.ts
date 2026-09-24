import type { MroExpiryRow, MroOnHandRow } from '@/shared/mro';

/**
 * Shared row-display helpers for the စတော့ dashboard.
 *
 * These are number/name fallbacks for the raw report rows. The tracking-policy
 * wording the dashboard used to badge each row with is GONE — the policy is a
 * property of the item, stated by the item's own surfaces and by the drill-down
 * page's line caption, never restated on every stock row.
 */

/** Expiry feed row kind → label (`lot` rows ARE the batch policy's lots). */
export const EXPIRY_KIND_LABELS: Record<string, string> = {
	lot: 'Batch',
	serial: 'Serial',
};

/** The row's display name — '—' when the model master row is gone. */
export function modelNameOf(row: Pick<MroOnHandRow | MroExpiryRow, 'model_name'>): string {
	return row.model_name?.trim() || '—';
}

/** The row's FULL display name — the item (group) name TOGETHER with the model,
 *  e.g. "Air Filter AF-1001", so a bare model code never reads as an orphan on a
 *  stock screen. Falls back to whichever half exists. */
export function itemNameOf(row: Pick<MroOnHandRow, 'group_name' | 'model_name'>): string {
	const group = row.group_name?.trim();
	const model = row.model_name?.trim();
	if (group && model) return `${group} ${model}`;
	return model || group || '—';
}

/** The item (group) name's Burmese label — the card's sub-line, or null. */
export function itemNameMmOf(row: Pick<MroOnHandRow, 'group_name_mm'>): string | null {
	return row.group_name_mm?.trim() || null;
}

/** "12" / "12.5" — a qty as short as its data (lot remainders can be fractional). */
export function fmtQty(value: number | null | undefined): string {
	if (value == null) return '0';
	return String(Math.round(value * 100) / 100);
}

/** DOM anchor for a below-reorder row — the summary strip's ပြန်မှာရန် tile
 *  scrolls to the first flagged row's card (ids are unique per row). */
export function reorderRowAnchor(row: Pick<MroOnHandRow, 'id' | 'location' | 'model'>): string {
	if (row.id) return `reorder-${row.id}`;
	return `reorder-${`${row.location}-${row.model ?? 'unknown'}`.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

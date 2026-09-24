import { MRO_DOC_STATUS_META, type MroDocStatus } from '@/shared/mro';

/**
 * The adjustment list's doc-status filter — options + labels DERIVED from the
 * shared `MRO_DOC_STATUS_META`, so the filter sheet's wording and the card
 * badges' wording can never disagree (same rule as every sibling module).
 *
 * An adjustment moves draft → confirmed when a DIFFERENT employee authorizes it
 * on the list; confirming is what surfaces as the card's "Authorize" action.
 */

/** The list filter's values — `'all'` shows every adjustment document. */
export type AdjustmentStatusFilterValue = MroDocStatus | 'all';

/** The filter sheet's options — the shared meta's labels, 'all' first. */
export const ADJUSTMENT_STATUS_OPTIONS: ReadonlyArray<{ value: AdjustmentStatusFilterValue; label: string }> = [
	{ value: 'all', label: 'All' },
	{ value: 'draft', label: MRO_DOC_STATUS_META.draft.label },
	{ value: 'confirmed', label: MRO_DOC_STATUS_META.confirmed.label },
	{ value: 'cancelled', label: MRO_DOC_STATUS_META.cancelled.label },
];

/** Value → label — derived from the options so the two can never drift. */
export const ADJUSTMENT_STATUS_LABELS = Object.fromEntries(
	ADJUSTMENT_STATUS_OPTIONS.map((option) => [option.value, option.label]),
) as Record<AdjustmentStatusFilterValue, string>;

/**
 * Normalize a row's `doc_status` — the engine treats `''` / missing as draft,
 * so the card pill and the draft-only Authorize action must too.
 */
export function adjustmentDocStatusOf(value: unknown): MroDocStatus {
	return value === 'confirmed' || value === 'cancelled' ? value : 'draft';
}

import { MRO_TRACKING, MRO_TRACKING_LABELS, type MroTracking } from '@/shared/mro';

/**
 * Tracking-policy presentation for the ပစ္စည်းများ (item models) module.
 *
 * Every value/word here derives from the SHARED `shared/mro.ts` maps
 * (`MRO_TRACKING` + `MRO_TRACKING_LABELS`) so the filter sheet and the bar pill
 * can never disagree with the rest of the MRO UI.
 *
 * There is deliberately NO per-card badge map any more: the policy is a property
 * of the item NAME, and the SKU cards (the catalog, the stock rows, the item-group
 * cards) state the item's identity instead. What remains here is the list's own
 * `?tracking=` FILTER wording — a control an operator reaches for on purpose.
 */

/** The items list's tracking filter — `'all'` shows every policy. */
export type TrackingFilterValue = MroTracking | 'all';

/** Every selectable filter value — the leading `'all'` (အားလုံး) entry included. */
export const ITEM_TRACKING_FILTER_VALUES: readonly TrackingFilterValue[] = ['all', ...MRO_TRACKING.map((tracking) => tracking.value)];

/** The filter sheet's options — labels straight from `MRO_TRACKING_LABELS`. */
export const ITEM_TRACKING_OPTIONS: ReadonlyArray<{ value: TrackingFilterValue; label: string }> = [
	{ value: 'all', label: 'All' },
	...MRO_TRACKING.map((tracking) => ({ value: tracking.value, label: MRO_TRACKING_LABELS[tracking.value] })),
];

/** Value → label — derived from the options so the bar pill can never drift. */
export const ITEM_TRACKING_LABELS = Object.fromEntries(ITEM_TRACKING_OPTIONS.map((option) => [option.value, option.label])) as Record<
	TrackingFilterValue,
	string
>;

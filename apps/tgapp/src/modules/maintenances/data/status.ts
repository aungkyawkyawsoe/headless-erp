import type { MaintenanceDocStatus, VendorType } from './types';

/**
 * Copy + tone for the maintenance UI — the single source the card, the form's
 * picker and the browse filter read, so the wording can never drift between them.
 *
 * A job's CATEGORY is NOT copy: it is the `mro_item_categories` master reached
 * through `veh_issue_types.category` (an m2o), so every category label + filter
 * option is read from that shared directory (`useMroCategories`), never from a
 * hardcoded list here.
 */

/** Normalize a log's system `doc_status` — only `confirmed` is posted; every
 *  other value (null / '' / draft / anything unexpected) stays editable. */
export function maintenanceDocStatusOf(value: string | null | undefined): MaintenanceDocStatus {
	return String(value ?? '').toLowerCase() === 'confirmed' ? 'confirmed' : 'draft';
}

/** The "Confirmed" pill — the pre-attentive lock marker on a posted job. */
export const CONFIRMED_BADGE = {
	label: 'Confirmed',
	className: 'border-status-success/30 bg-status-success-soft text-status-success',
} as const;

/** Who performed the job — the log's `vendor_type` select copy + the badge tone
 *  the expanded card's identity row shows (an outside shop reads amber, in-house
 *  stays neutral so only the exception draws the eye). */
export const VENDOR_TYPE_META: Record<VendorType, { label: string; className: string }> = {
	in_house: { label: 'In-house', className: 'border-border/60 bg-muted/50 text-muted-foreground' },
	external: { label: 'External Vendor', className: 'border-status-warning/30 bg-status-warning-soft text-status-warning' },
};

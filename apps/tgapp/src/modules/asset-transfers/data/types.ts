/**
 * Asset-transfer (ATR) types — the approval center's asset tab.
 *
 * The wire row is `MroAssetRequestRow` from the shared MRO client (the
 * `GET /api/mro/asset-requests` feed contract), re-exported here so this module
 * owns ONE name for it — there is no second declaration to drift.
 *
 * The transfer lifecycle is NOT the engine's `doc_status`: it is the request's
 * own `status` column, written only by the MRO service. `requested` → a superior
 * decides → `approved` → executed → `executed` (or `rejected` with a reason).
 * Approve ≠ execute: the sign-off changes no holder, the execute is the atomic
 * move pinned to the request's recorded source.
 */
import type { MroAssetRequestRow } from '@/shared/mro';

/** One approver-feed row — display-ready (every m2o resolved server-side). */
export type AssetTransferRow = MroAssetRequestRow;

/** The transfer-request lifecycle. */
export type AssetTransferStatus = 'requested' | 'approved' | 'rejected' | 'executed';

const TRANSFER_STATUS_VALUES: readonly string[] = ['requested', 'approved', 'rejected', 'executed'];

/** Coerce a raw `status` to a known lifecycle — an unknown value reads as
 *  `requested` (the create default), so the card never renders a bare unknown. */
export function transferStatusOf(value: string | null | undefined): AssetTransferStatus {
	return value && TRANSFER_STATUS_VALUES.includes(value) ? (value as AssetTransferStatus) : 'requested';
}

/** Status → pill copy + tint (the established MRO doc-status tone family). */
export const TRANSFER_STATUS_META: Record<AssetTransferStatus, { label: string; className: string }> = {
	requested: { label: 'To Approve', className: 'bg-status-warning-soft text-status-warning' },
	approved: { label: 'Approved', className: 'bg-status-info-soft text-status-info' },
	rejected: { label: 'Rejected', className: 'bg-status-danger-soft text-status-danger' },
	executed: { label: 'Executed', className: 'bg-status-success-soft text-status-success' },
};

/** What a filed request IS. */
export type AssetRequestKind = 'write-off' | 'return' | 'transfer';

/**
 * The request's KIND, derived from its own shape — the SAME rule the engine's
 * execute dispatches on (`write_off` ⇒ scrapped where it sits, `to_location` ⇒
 * back to a store, a destination ⇒ a holder move). Decided here rather than in
 * JSX so the card can never describe a request one way and have the execute run it
 * another, and so the app's wording follows the engine rather than a second list.
 */
export function requestKindOf(row: Pick<AssetTransferRow, 'write_off' | 'to_location'>): AssetRequestKind {
	if (row.write_off) return 'write-off';
	return row.to_location?.trim() ? 'return' : 'transfer';
}

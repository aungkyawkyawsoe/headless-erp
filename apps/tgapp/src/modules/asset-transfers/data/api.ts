import type { MmbixClient } from '@mmbix/sdk';

import { sdk } from '@/shared/api/sdk';
import { SEARCH_LIMIT } from '@/shared/constants';
import type { CursorPage } from '@/shared/hooks/use-cursor-list';
import { mroApi } from '@/shared/mro';
import { transferStatusOf, type AssetTransferRow } from './types';

/**
 * The asset-transfer module's data seam — the approver feed (`GET
 * /api/mro/asset-requests`, session-scoped server-side) and the three decision
 * writers on top of the shared MRO client, plus the ONE create that files a
 * request (the generic entity API, which session-stamps `requested_by` and
 * defaults `status = 'requested'`).
 *
 * The SDK instance is narrowed locally (the app-wide client is typed against the
 * placeholder typegen `Schema`, which knows no `mro_*` collections) — the same
 * local-cast pattern every MRO module uses.
 */
type AssetRequestEntity = {
	id: string;
	display_number?: string | null;
	status?: string | null;
	requested_by?: string | null;
} & Record<string, unknown>;

type OpsSchema = { mro_asset_requests: AssetRequestEntity } & Record<string, Record<string, unknown>>;

const ops = sdk as unknown as MmbixClient<OpsSchema>;

/** The three approval-center chips → the server `status` filter values. The
 *  `approved` chip folds in `executed` (an executed request is DONE, tracked with
 *  the approved ones) — the card pill still tells the two apart. */
const STATUS_SCOPE: Record<'pending' | 'approved' | 'rejected', string> = {
	pending: 'requested',
	approved: 'approved,executed',
	rejected: 'rejected',
};

/** The whole lifecycle — the toolbar search's scope (track ANY status by serial,
 *  plate, ATR number or requester, per the "track it" requirement). */
const ALL_STATUSES = 'requested,approved,rejected,executed';

function toRow(raw: AssetTransferRow): AssetTransferRow {
	return { ...raw, status: transferStatusOf(raw.status) };
}

/**
 * ONE page of the approver feed for the active status chip. Cursor-paginated
 * server-side; `nextCursor` is null on the last page.
 */
export async function fetchTransferPage(
	scope: 'pending' | 'approved' | 'rejected',
	cursor?: string,
): Promise<CursorPage<AssetTransferRow>> {
	const res = await mroApi.assetRequests({ status: STATUS_SCOPE[scope], cursor });
	return {
		rows: res.rows.map(toRow),
		nextCursor: res.nextCursor,
		hasMore: res.nextCursor !== null,
	};
}

/**
 * Toolbar search across EVERY status the approver may see — the "track this
 * transfer" read (a serial / plate / ATR number / requester name resolves a
 * request wherever it sits in its lifecycle). The server matches the term; the
 * result is a single page capped at the app search limit.
 */
export async function fetchTransferSearch(query: string): Promise<AssetTransferRow[]> {
	const term = query.trim();
	if (!term) return [];
	const res = await mroApi.assetRequests({ status: ALL_STATUSES, search: term });
	return res.rows.slice(0, SEARCH_LIMIT).map(toRow);
}

/** A request's filed shape — the SOURCE the change is pinned to, and the
 *  requested DESTINATION. Exactly ONE of the three destination holderships is
 *  set: `toVehicle` (+ optional seat), `toEmployee`, or `toLocation` (a RETURN
 *  back into a store) — OR none at all with `writeOff` set (a WRITE-OFF). */
export interface FileTransferInput {
	serial: string;
	fromVehicle?: string | null;
	fromSlot?: string | null;
	fromEmployee?: string | null;
	toVehicle?: string | null;
	toSlot?: string | null;
	toEmployee?: string | null;
	/** Set ⇒ this is a RETURN (holder → store); leave the other two null. */
	toLocation?: string | null;
	/** Set ⇒ this is a WRITE-OFF: the unit is scrapped where it sits, so NO
	 *  destination may be named (the engine refuses the contradiction). */
	writeOff?: boolean;
	note?: string | null;
}

/**
 * File a transfer request through the generic entity API. `requested_by` is
 * stamped from the signed session and `status` starts `requested` — neither is a
 * caller field, which is what makes the superior check meaningful. No holder
 * changes: the request is the gate, the execute is the change.
 *
 * ONE create serves all THREE governed shapes — the engine derives the kind from
 * the shape it was given (`writeOff` ⇒ a write-off, `toLocation` ⇒ a return, a
 * destination ⇒ a transfer), so none of them is a second writer here.
 */
export async function fileAssetTransfer(input: FileTransferInput): Promise<{ id: string; display_number: string | null }> {
	const created = await ops.items('mro_asset_requests').create({
		serial: input.serial,
		from_vehicle: input.fromVehicle ?? null,
		from_slot: input.fromSlot ?? null,
		from_employee: input.fromEmployee ?? null,
		to_vehicle: input.toVehicle ?? null,
		to_slot: input.toSlot ?? null,
		to_employee: input.toEmployee ?? null,
		to_location: input.toLocation ?? null,
		write_off: input.writeOff ?? false,
		note: input.note?.trim() || null,
	});
	return { id: created.id, display_number: created.display_number ?? null };
}

/** Approve a requested transfer (a sign-off; no holder change). */
export async function approveAssetTransfer(id: string, actorId?: string | null): Promise<void> {
	await mroApi.approveAssetRequest(id, { actorId: actorId ?? undefined });
}

/** Reject a requested transfer, recording who and why. */
export async function rejectAssetTransfer(id: string, reason: string, actorId?: string | null): Promise<void> {
	await mroApi.rejectAssetRequest(id, { actorId: actorId ?? undefined, reason });
}

/** Execute an approved transfer — ONE atomic guarded move pinned to the source.
 *  The engine dispatches on the request's own destination: a `to_location` row
 *  performs the RETURN, every other row performs the move. */
export async function executeAssetTransfer(id: string, actorId?: string | null): Promise<void> {
	await mroApi.executeAssetRequest(id, { actorId: actorId ?? undefined });
}

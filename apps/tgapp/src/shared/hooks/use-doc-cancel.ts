import { useCallback, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

import { invalidateDomain } from '@/shared/api/invalidation';
import { mroApi, type MroCancellableDocKind, type MroCancelResult, type MroDocStatus } from '@/shared/mro';
import { hapticImpact } from '@/shared/platform/haptics';

/**
 * The ONE cancel action for the four stock documents that have a reversal
 * (`/api/mro/{inbounds|outbounds|transfers|adjustments}/:id/cancel`), shared by the
 * list cards AND the full-screen doc pages of all four modules so every entry point
 * behaves — and refreshes — identically.
 *
 * The SERVER owns the meaning: a draft is a pure lifecycle flip, a POSTED document
 * is REVERSED (its stock effect undone) in the same atomic batch, and a second tap
 * is an idempotent no-op. The client therefore never passes a mode, and the copy that
 * tells the operator which of those will happen is derived from `docStatus` here —
 * one derivation for every surface, so a screen cannot promise a bare flip over a
 * write that reverses a posted movement.
 *
 * What it refreshes is decided the same way: a reversal moved stock, so it invalidates
 * the stock + movement domains (and `store-requests`, whose fulfilment a reversed
 * goods issue recomputes); a DRAFT flip touched nothing, so only the module list is
 * refreshed. Refusals (partly consumed stock, a unit that moved on, money recorded
 * against a receipt) arrive as the API's own prose on `error` — shown verbatim, and
 * carried by a `409` the caller never has to re-word.
 */
export function useDocCancel(options: {
	kind: MroCancellableDocKind;
	docId: string;
	/** The document's state BEFORE the call — decides the copy and the refresh set. */
	docStatus: MroDocStatus;
	/** The module's own list prefix (e.g. `qk.inboundsAll()`). */
	listKey: QueryKey;
	/** A reversed goods issue recomputes its source request — invalidate that hub too. */
	touchesStoreRequests?: boolean;
	onCancelled?: () => void;
}) {
	const { kind, docId, docStatus, listKey, touchesStoreRequests = false, onCancelled } = options;
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	/** The document is POSTED, so this call reverses its stock effect. */
	const willReverse = docStatus === 'confirmed';

	const cancel = useCallback(async (): Promise<MroCancelResult | null> => {
		if (busy) return null;
		setBusy(true);
		setError(null);
		try {
			const result = await mroApi.cancel(kind, docId);
			hapticImpact('medium');
			// The document's rows always change (its status pill, and on a reversal its
			// totals and every list that scopes by status).
			void queryClient.invalidateQueries({ queryKey: listKey, refetchType: 'active' });
			if (willReverse || result.reversed) {
				// Write-through — the reversal put stock back and rewrote the ledger's
				// lines, exactly like the confirm it undoes.
				void invalidateDomain(queryClient, 'stock');
				void invalidateDomain(queryClient, 'mro-movements');
				if (touchesStoreRequests) void invalidateDomain(queryClient, 'store-requests');
			}
			onCancelled?.();
			return result;
		} catch (err) {
			hapticImpact('light');
			// The API's own message (a guard 'no', a 404, a 403) surfaces verbatim.
			setError(err instanceof Error && err.message.trim() ? err.message : 'Could not cancel — try again.');
			return null;
		} finally {
			setBusy(false);
		}
	}, [busy, docId, kind, listKey, onCancelled, queryClient, touchesStoreRequests, willReverse]);

	return { busy, error, cancel, willReverse, clearError: useCallback(() => setError(null), []) };
}

/**
 * Per-family noun — ONE entry per document family, the single source the cancel copy
 * below is built from, so a family can never be called a `receipt` on one surface and
 * a `document` on the next.
 */
const DOC_NOUN: Record<MroCancellableDocKind, string> = {
	inbounds: 'receipt',
	outbounds: 'issue',
	transfers: 'transfer',
	adjustments: 'adjustment',
};

/**
 * The confirmation copy for a cancel — ONE wording per (document state × family), so
 * the list card and the detail page of a module never describe the same write in two
 * different voices. The promise is deliberately exact: a draft says nothing was moved
 * and CAN be re-typed; a posted document says its stock goes back and that it is
 * final — because the engine bakes that: a cancelled stock document is frozen (never
 * reopened, never deleted), so the correction path is a NEW document.
 */
export function cancelCopyOf(
	kind: MroCancellableDocKind,
	docStatus: MroDocStatus,
): {
	title: string;
	description: string;
	label: string;
} {
	const noun = DOC_NOUN[kind];
	if (docStatus === 'draft') {
		return {
			title: `Cancel this ${noun}?`,
			description: `This draft never moved stock, so nothing has to be put back — it leaves the list. Cancelling is final, so a ${noun} still needed has to be filed again.`,
			label: `Cancel ${noun}`,
		};
	}
	return {
		title: `Cancel this ${noun} and put the stock back?`,
		description:
			kind === 'inbounds'
				? 'This receipt is posted, so cancelling it REVERSES it: the stock it received comes back out, its lots/serials are withdrawn, and any payment it filed itself is taken back. It cannot be restored — file a new receipt instead.'
				: kind === 'outbounds'
					? 'This issue is posted, so cancelling it REVERSES it: the units return to the store and the source request’s fulfilment is recomputed. It cannot be restored — file a new issue instead.'
					: kind === 'transfers'
						? 'This move is posted, so cancelling it REVERSES it: the source store gets its lots back, the destination store gives up what arrived, and every moved unit returns to where it came from. It cannot be restored — file a new transfer instead.'
						: 'This adjustment is applied, so cancelling it REVERSES it: added stock is taken back and removed stock returns. It cannot be restored — file a new adjustment instead.',
		label: `Cancel & reverse`,
	};
}

import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { invalidateDomain } from '@/shared/api/invalidation';
import { hapticImpact } from '@/shared/platform/haptics';
import { confirmOutbound } from './api';
import { qk } from './query-keys';

/**
 * The draft-outbound confirm — shared by the list card AND the full-screen doc
 * page so a confirm from either screen refreshes exactly the same caches. The
 * issuer is the CURRENT logged-in employee (posted as `issued_by` so the
 * confirm service attributes the move and — for a request-linked goods issue —
 * advances the source request's fulfilment lifecycle). Engine failures
 * (insufficient stock, bad serial picks, an unknown/cancelled doc) surface
 * verbatim on `error`; the caller owns where busy/error render.
 *
 * CANCELLING is deliberately NOT here: it is ONE verb across the stock documents
 * (a draft flips, a POSTED issue is REVERSED — the units come back to the store)
 * and lives in `@/shared/hooks/use-doc-cancel`, so every family shares one
 * implementation and each action owns its own error slot.
 */
export function useOutboundConfirm(docId: string, onConfirmed?: () => void) {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const confirm = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const me = await fetchCurrentEmployee();
			if (!me) throw new Error('No employee account is linked to this session — someone else must confirm this issue.');
			await confirmOutbound(docId, me.id);
			hapticImpact('medium');
			// Refresh every outbound list (this doc's rows flip to confirmed).
			void queryClient.invalidateQueries({ queryKey: qk.outboundsAll(), refetchType: 'active' });
			// Write-through — the new CONFIRMED lines now belong to the movement
			// ledger: refresh every cached mro-movements read too, and the stock +
			// store-request domains the move touched.
			void invalidateDomain(queryClient, 'mro-movements');
			void invalidateDomain(queryClient, 'stock');
			void invalidateDomain(queryClient, 'store-requests');
			onConfirmed?.();
		} catch (err) {
			hapticImpact('light');
			// The API's own message (409 … / 404 / …) surfaces verbatim so the
			// store clerk sees the actionable reason.
			setError(err instanceof Error && err.message.trim() ? err.message : 'Could not confirm — try again.');
		} finally {
			setBusy(false);
		}
	}, [busy, docId, onConfirmed, queryClient]);

	return { busy, error, confirm };
}

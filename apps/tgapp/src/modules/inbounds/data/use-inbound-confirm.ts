import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { invalidateDomain } from '@/shared/api/invalidation';
import { hapticImpact } from '@/shared/platform/haptics';
import { mroApi } from '@/shared/mro';
import { qk } from './query-keys';

/**
 * The draft-inbound confirm — shared by the list card AND the full-screen doc
 * page so a confirm from either screen refreshes exactly the same caches.
 * `/api/mro/inbounds/:id/confirm` is the sole writer of `confirmed`; engine
 * failures (bad serial picks, an unknown/cancelled doc) surface verbatim on
 * `error` — the caller owns where busy/error render.
 *
 * CANCELLING is deliberately NOT here: it is one action with one meaning across
 * every document family, so it lives in `@/shared/hooks/use-doc-cancel` and each
 * surface mounts it (a draft flips / a posted receipt reverses — the DOCUMENT
 * decides). Keeping one hook per ACTION also keeps each sheet's error its own:
 * a confirm error can never appear in the cancel sheet's slot again.
 */
export function useInboundConfirm(docId: string, onConfirmed?: () => void) {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const confirm = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await mroApi.confirm('inbounds', docId);
			hapticImpact('medium');
			// Refresh every inbound list (the row flips to confirmed + totals land).
			void queryClient.invalidateQueries({ queryKey: qk.inboundsAll(), refetchType: 'active' });
			// Write-through — the new CONFIRMED lines now belong to the movement
			// ledger and the receipt MOVED stock: refresh both cached domains.
			void invalidateDomain(queryClient, 'mro-movements');
			void invalidateDomain(queryClient, 'stock');
			onConfirmed?.();
		} catch (err) {
			hapticImpact('light');
			// The API's own message (bad serial pick / 404 / …) surfaces verbatim.
			setError(err instanceof Error && err.message.trim() ? err.message : 'Could not confirm — try again.');
		} finally {
			setBusy(false);
		}
	}, [busy, docId, onConfirmed, queryClient]);

	return { busy, error, confirm };
}

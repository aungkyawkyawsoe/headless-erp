import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { invalidateDomain } from '@/shared/api/invalidation';
import { hapticImpact } from '@/shared/platform/haptics';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { confirmTransferDoc } from './api';
import { qk } from './query-keys';

/**
 * The draft-transfer confirm — shared by the list card AND the full-screen doc
 * page so a confirm from either surface refreshes exactly the same caches.
 *
 * The confirming operator is the APPROVER of the move: resolve the CURRENT
 * logged-in employee from the session and post its id as `approved_by`
 * (`/api/mro/transfers/:id/confirm` — the moment stock actually moves). Engine
 * failures (approver equals reporter (409), insufficient stock at the source
 * (409), an unknown/cancelled doc) surface verbatim on `error`; the caller owns
 * where busy/error render.
 */
export function useTransferConfirm(docId: string, onConfirmed?: () => void) {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const confirm = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const me = await fetchCurrentEmployee();
			if (!me) throw new Error('No employee account is linked to this session — someone else must confirm this transfer.');
			await confirmTransferDoc(docId, me.id);
			hapticImpact('medium');
			// Refresh every transfer read (the list row flips + the detail header).
			void queryClient.invalidateQueries({ queryKey: qk.transfersAll(), refetchType: 'active' });
			// Write-through — the CONFIRMED TRF lines now belong to the movement
			// ledger AND the store balances moved: refresh both cached domains.
			void invalidateDomain(queryClient, 'mro-movements');
			void invalidateDomain(queryClient, 'stock');
			onConfirmed?.();
		} catch (err) {
			hapticImpact('light');
			setError(err instanceof Error && err.message.trim() ? err.message : 'Could not confirm — try again.');
		} finally {
			setBusy(false);
		}
	}, [busy, docId, onConfirmed, queryClient]);

	return { busy, error, confirm };
}

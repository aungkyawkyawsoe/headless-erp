import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { invalidateDomain } from '@/shared/api/invalidation';
import { hapticImpact } from '@/shared/platform/haptics';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { confirmAdjustment } from './api';
import { qk } from './query-keys';

/**
 * The draft-adjustment approve — shared by the list card AND the full-screen doc
 * page so an approve from either surface refreshes exactly the same caches.
 *
 * Resolve the CURRENT logged-in employee and post its id as `approved_by`
 * (`/api/mro/adjustments/:id/confirm`), the moment the ± deltas are applied to
 * stock. Engine failures (approver equals reporter (409), insufficient stock for
 * a remove (409), no approver (400)) surface verbatim on `error`; the caller
 * owns where busy/error render.
 */
export function useAdjustmentApprove(docId: string, onApproved?: () => void) {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const approve = useCallback(async () => {
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const me = await fetchCurrentEmployee();
			if (!me) throw new Error('No employee account is linked to this session — someone else must approve this adjustment.');
			await confirmAdjustment(docId, me.id);
			hapticImpact('medium');
			// Refresh every adjustment read (the list row flips + the detail header).
			void queryClient.invalidateQueries({ queryKey: qk.adjustmentsAll(), refetchType: 'active' });
			// Write-through — the apply moved stock and wrote ledger lines.
			void invalidateDomain(queryClient, 'stock');
			void invalidateDomain(queryClient, 'mro-movements');
			onApproved?.();
		} catch (err) {
			hapticImpact('light');
			// The API's own message (409 … / 400 …) surfaces verbatim.
			setError(err instanceof Error && err.message.trim() ? err.message : 'Could not approve — try again.');
		} finally {
			setBusy(false);
		}
	}, [busy, docId, onApproved, queryClient]);

	return { busy, error, approve };
}

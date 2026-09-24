import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { hapticImpact } from '@/shared/platform/haptics';
import { confirmMaintenanceLog } from './api';
import { maintenanceListKey, qk } from './query-keys';
import type { MaintenanceLogCardModel } from './types';

/**
 * The draft-log CONFIRM — shared by the truck's Service history ledger and the
 * browse/search cards so a confirm from either surface refreshes the same caches.
 *
 * Confirming is a one-way door: the engine's `writes.freeze_when` policy makes
 * the row read-only the moment `doc_status` becomes `confirmed`. The signed
 * session employee is stamped as `approved_by` when one is linked (the stamp is
 * best-effort — an unlinked identity can still confirm).
 */

/**
 * Map an engine transition/freeze failure to copy a driver understands. The raw
 * messages ("Cannot transition from "draft" to "confirmed"",
 * "rows in state "confirmed" are frozen …") are status-machine jargon that would
 * read as a server bug on a phone; every realistic failure here means "it is
 * already confirmed, or the list is stale".
 */
export function friendlyConfirmError(err: unknown): string {
	const message = err instanceof Error && err.message.trim() ? err.message.trim() : '';
	if (/cannot transition|invalid doc_status/i.test(message)) {
		return 'This job could not be confirmed — it may already be final. Refresh the list and check.';
	}
	if (/frozen/i.test(message)) {
		return 'This job is already confirmed and locked. Refresh the list to see its current status.';
	}
	return message || 'Could not confirm — try again.';
}

export function useMaintenanceConfirm() {
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const confirm = useCallback(
		async (log: MaintenanceLogCardModel, onDone?: () => void) => {
			if (busy) return;
			setBusy(true);
			setError(null);
			try {
				const me = await fetchCurrentEmployee().catch(() => null);
				await confirmMaintenanceLog(log.id, me?.id ?? null);
				hapticImpact('medium');
				// Every maintenance feed (register + the owning truck's file) refreshes.
				void queryClient.invalidateQueries({ queryKey: maintenanceListKey, refetchType: 'active' });
				if (log.vehicleId) void queryClient.invalidateQueries({ queryKey: qk.truck(log.vehicleId), refetchType: 'active' });
				onDone?.();
			} catch (err) {
				hapticImpact('light');
				setError(friendlyConfirmError(err));
			} finally {
				setBusy(false);
			}
		},
		[busy, queryClient],
	);

	const reset = useCallback(() => setError(null), []);

	return { busy, error, confirm, reset };
}

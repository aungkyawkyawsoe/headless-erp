import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { qk } from './query-keys';
import { invalidateDomain } from '@/shared/api/invalidation';

/**
 * The ONE post-mutation reaction for the wheel board — shared by the rig page
 * (`TyreVehiclePage`) and the full-screen action page (`TyreActionPage`) so a
 * write from either surface refreshes exactly the same reads:
 *
 *   · the whole per-holder register (`qk.holderAssets()`) — the board, the tray
 *     and the on-board list all repaint from one fresh read;
 *   · the stock + movement domains, because a fit / unseat / return ALSO flips a
 *     serial's register status and a model+location balance;
 *   · each changed serial's snapshot + history (`qk.tyreUnit` / `qk.tyreEvents`),
 *     so its lifecycle page never narrates stale state.
 */
export function useBoardChanged() {
	const queryClient = useQueryClient();
	return useCallback(
		(serialIds: readonly string[]) => {
			void queryClient.invalidateQueries({ queryKey: qk.holderAssets() });
			void invalidateDomain(queryClient, 'stock');
			void invalidateDomain(queryClient, 'mro-movements');
			for (const serialId of serialIds) {
				void queryClient.invalidateQueries({ queryKey: qk.tyreEvents(serialId) });
				void queryClient.invalidateQueries({ queryKey: qk.tyreUnit(serialId) });
			}
		},
		[queryClient],
	);
}

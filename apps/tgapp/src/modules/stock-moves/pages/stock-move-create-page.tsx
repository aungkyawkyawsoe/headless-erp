import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { StockMoveForm } from '../components/stock-move-form';
import { qk } from '../data/query-keys';
import { ModuleShell } from '@/shared/components/module-shell';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * ပြောင်းရွှေ့မှုအသစ် — the location-transfer create destination
 * (`/app/stock-moves/+`), hosting the multi-line `StockMoveForm`. The form
 * leaves a DRAFT doc (stock moves only when the user confirms it from the
 * list) — so done invalidates the transfer list and pops back to it, where the
 * new draft sits on top waiting for အတည်ပြုမည်.
 */
export default function StockMoveCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const handleDone = useCallback(() => {
		hapticImpact('medium');
		// A fresh draft must show on the list — refetch under the transfers prefix,
		// then return to it.
		void queryClient.invalidateQueries({ queryKey: qk.transfersAll(), refetchType: 'active' });
		// Pop (not push): a pushed list entry would leave the create page beneath
		// it, so back from the list would re-open a fresh empty form.
		notifySaved('Transfer saved');
		popBack(navigate, '/app/stock-moves');
	}, [queryClient, navigate]);

	return (
		<ModuleShell title="New Transfer" backTo="/app/stock-moves">
			<StockMoveForm onDone={handleDone} />
		</ModuleShell>
	);
}

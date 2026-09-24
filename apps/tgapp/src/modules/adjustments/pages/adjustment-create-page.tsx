import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { AdjustmentForm } from '../components/adjustment-form';
import { qk } from '../data/query-keys';
import { ModuleShell } from '@/shared/components/module-shell';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * Adjustment အသစ် — the Additions + destination for the Adjustments list
 * (`/app/adjustments/+`). Hosts the multi-line `AdjustmentForm`; a save writes a
 * DRAFT attributed to the current employee and returns to the list — the ±
 * deltas land only when a different employee later presses "Authorize" on a
 * listed draft.
 */
export function AdjustmentCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const handleDone = useCallback(() => {
		hapticImpact('medium');
		// A fresh draft must show on the list — refetch under the adjustments prefix,
		// then return to it.
		void queryClient.invalidateQueries({ queryKey: qk.adjustmentsAll(), refetchType: 'active' });
		// Pop (not push): a pushed list entry would leave the create page beneath
		// it, so back from the list would re-open a fresh empty form.
		notifySaved('Adjustment saved');
		popBack(navigate, '/app/adjustments');
	}, [queryClient, navigate]);

	return (
		<ModuleShell title="New Adjustment" backTo="/app/adjustments">
			<AdjustmentForm onDone={handleDone} />
		</ModuleShell>
	);
}

export default AdjustmentCreatePage;

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { InboundDocForm } from '../components/inbound-doc-form';
import { qk } from '../data/query-keys';
import { INBOUND_VIEW } from './inbound-hub-page';
import { ModuleShell } from '@/shared/components/module-shell';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { URL_PARAM, useViewState } from '@/shared/url-state';

/**
 * အဝင်စာရင်းအသစ် — the inbound hub's single `/+` destination
 * (`/app/inbounds/+?type=…`). The kind is URL-driven through the SAME `?type=`
 * parser as the hub tabs, so each tab's + button opens the draft form preset to
 * that kind (`purchase` | `legacy` | `return`) and a saved draft returns to the
 * tab it was opened from. Hosts the multi-line `InboundDocForm`; stock lands
 * only when the user later confirms the draft from the list (`အတည်ပြုမည်`).
 */
export default function InboundCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [view] = useViewState(INBOUND_VIEW);
	const { type } = view;

	const handleDone = useCallback(() => {
		hapticImpact('medium');
		// A fresh draft must show on the list — refetch under the inbounds prefix,
		// then return to it (same type tab).
		void queryClient.invalidateQueries({ queryKey: qk.inboundsAll(), refetchType: 'active' });
		// Pop (not push): a pushed list entry would leave the create page beneath
		// it, so back from the list would re-open a fresh empty form.
		notifySaved('Goods received');
		popBack(navigate, `/app/inbounds?${URL_PARAM.type}=${type}`);
	}, [queryClient, navigate, type]);

	return (
		<ModuleShell title="New Inbound" backTo={`/app/inbounds?${URL_PARAM.type}=${type}`}>
			<InboundDocForm onDone={handleDone} initialType={type} />
		</ModuleShell>
	);
}

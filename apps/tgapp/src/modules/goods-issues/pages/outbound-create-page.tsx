import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { OutboundDocForm, type OutboundPrefillLine } from '../components/outbound-doc-form';
export type { OutboundPrefillLine } from '../components/outbound-doc-form';
import { qk } from '../data/query-keys';
import { OUTBOUND_TYPE_META } from '../data/meta';
import type { MroOutboundType } from '../data/types';
import { ModuleShell } from '@/shared/components/module-shell';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * The canonical outbound CREATE page — the `/+` destination behind every
 * outbound list's + button, hosting the shared `OutboundDocForm`. The three
 *  screens (ထုတ်ပေးမှု / ပယ်ဖျက် / ချို့ယွင်း-စွန့်ပစ်) share this one component
 * and differ only in `type`; the thin page files (`goods-issue-create-page.tsx`,
 * `write-off-create-page.tsx`, `scrape-create-page.tsx`) wrap it.
 *
 * A successful create leaves a DRAFT doc (stock is untouched until the user
 * confirms it from the list) — so done invalidates every outbound list and pops
 * back to this type's list route, where the new draft sits on top waiting for
 * အတည်ပြုမည်.
 *
 * `initialLines` arrives from the တောင်းခံလွှာ card's "ထုတ်ပေးမှု" action — a confirmed
 *  requisition's lines pre-filled into the draft so the operator only reviews +
 *  confirms. Absent (the normal + path) leaves the form with one blank row.
 */
export function OutboundCreatePage({
	type,
	initialLines,
	initialRequestId,
	requestRefLabel,
}: {
	type: MroOutboundType;
	initialLines?: OutboundPrefillLine[];
	/** Source requisition id (from `?request=`) for a store-request-linked issue. */
	initialRequestId?: string;
	/** Source requisition `REQ-…` number (from `?request_ref=`) for the header ref. */
	requestRefLabel?: string | null;
}) {
	const meta = OUTBOUND_TYPE_META[type];
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const handleDone = useCallback(() => {
		hapticImpact('medium');
		// A fresh draft must show on the list — refetch under the outbounds prefix
		// (also refreshes deeper cached pages), then return to it.
		void queryClient.invalidateQueries({ queryKey: qk.outboundsAll(), refetchType: 'active' });
		// Pop (not push): a pushed list entry would leave the create page beneath
		// it, so back from the list would re-open a fresh empty form.
		notifySaved('Goods issued');
		popBack(navigate, meta.listRoute);
	}, [queryClient, navigate, meta.listRoute]);

	return (
		<ModuleShell title={meta.createTitle} backTo={meta.listRoute}>
			<OutboundDocForm
				type={type}
				onDone={handleDone}
				initialLines={initialLines}
				initialRequestId={initialRequestId}
				requestRefLabel={requestRefLabel}
			/>
		</ModuleShell>
	);
}

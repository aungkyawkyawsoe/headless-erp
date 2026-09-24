import { AlarmClockMinus, ArrowLeftRight, Palmtree, ScrollText, Timer } from 'lucide-react';

import { ModuleShell } from '@/shared/components/module-shell';
import { APPROVAL_STATUS_META, type ApprovalStatusFilterValue } from '@/shared/components/approval-status-filter';
import { IconTabStrip, type IconTab } from '@/shared/components/icon-tab-strip';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';
import { AssetApprovals } from '@/modules/asset-transfers/components/asset-approvals';
import { RequisitionApprovals } from '@/modules/store-requests/components/requisition-approvals';
import { HrApprovals } from '../components/hr-approvals';
import type { HrRequestType } from '../data/types';

/**
 * Approval Center — the app's ONE decision surface (launcher tile `approval` →
 * /app/approval), built as a thin container: a tab strip and the panel each tab
 * mounts.
 *
 *   Early Leave / Leave / Overtime → HR requests routed to me (`HrApprovals`)
 *   Transfers                      → asset-transfer requests my team filed
 *                                    (`AssetApprovals`)
 *   Requisitions                   → the store-requisition queue (`RequisitionApprovals`),
 *                                    READ-ONLY here (each card shows the requested items;
 *                                    a tap opens `/app/store-requests/:id`, which owns
 *                                    approve / issue / reject)
 *
 * Each tab is a DIFFERENT domain with its own lifecycle and its own feed, so each
 * gets its own panel rather than a union inside one. Every panel owns its list,
 * toolbar search and bottom bar; the page owns only what they share — the tab
 * strip and the URL view state.
 *
 * URL view state: `?type=` (tab) + `?status=` (filter) survive reloads and
 * back/forward round-trips; nuqs `replace` (default) keeps taps out of the
 * history stack. `?status=` defaults to the decide queue, not 'all' — the
 * approval center always opens on what needs a decision.
 */
type ApprovalTab = HrRequestType | 'transfer' | 'requisition';

const TABS: IconTab<ApprovalTab>[] = [
	{ value: 'early', label: 'စောပြန်ခွင့်', icon: AlarmClockMinus },
	{ value: 'leave', label: 'ခွင့်', icon: Palmtree },
	{ value: 'ot', label: 'အချိန်ပို', icon: Timer },
	{ value: 'transfer', label: 'လွှဲပြောင်း', icon: ArrowLeftRight },
	{ value: 'requisition', label: 'တောင်းခံ', icon: ScrollText },
];

/** The approval center's whole URL view state — the tab + the status filter. */
const APPROVAL_VIEW = {
	[URL_PARAM.type]: enumParam<ApprovalTab>(
		TABS.map((tab) => tab.value),
		'early',
	),
	[URL_PARAM.status]: enumParam<ApprovalStatusFilterValue>(Object.keys(APPROVAL_STATUS_META) as ApprovalStatusFilterValue[], 'pending'),
} as const;

export default function ApprovalPage() {
	const [view, setView] = useViewState(APPROVAL_VIEW);
	const { type, status } = view;

	return (
		<ModuleShell title="ဆုံးဖြတ်" backTo="/app">
			{/* The tab row — five icon tiles that pan when they outgrow a narrow
			    phone (same tile language as the masters hub's category strip). Each
			    tile carries NO digit badge — a pending count is never shown here. */}
			<IconTabStrip tabs={TABS} value={type} onChange={(value) => setView({ type: value })} ariaLabel="Request type" compact />

			{/* The panel grows to the body's height: with nothing to decide, its empty state
			    IS the screen — never a small card floating over a blank half-page. */}
			<div className="mt-4 flex flex-1 flex-col">
				{type === 'transfer' ? (
					<AssetApprovals status={status} onStatusChange={(value) => setView({ status: value })} />
				) : type === 'requisition' ? (
					<RequisitionApprovals status={status} onStatusChange={(value) => setView({ status: value })} />
				) : (
					<HrApprovals type={type} status={status} onStatusChange={(value) => setView({ status: value })} />
				)}
			</div>
		</ModuleShell>
	);
}

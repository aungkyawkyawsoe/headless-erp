import { OutboundListPage } from './outbound-list-page';
import type { MroOutboundType } from '../data/types';
import { SegmentedTabs, type SegTabOption } from '@/shared/components/segmented-tabs';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/** အထွက်စာရင်း — the module's own screen name, used as the DEFAULT (Issue)
 *  tab's app-bar heading. The other kinds carry their OWN heading (see
 *  `OUTBOUND_TABS`), so the bar names the kind you are actually on. */
export const OUTBOUND_MODULE_TITLE = 'Outbounds';

/** The three outbound kinds — the hub's tab row. The TAB labels read in English
 *  (Issue / Write-off / Dispose); the per-tab `title` is the app-bar HEADING for
 *  that kind, so switching the tab renames the screen (Issue → the module name,
 *  Write-off → ပယ်ဖျက်, Dispose → စွန့်ပစ်). */
export const OUTBOUND_TABS: ReadonlyArray<SegTabOption<MroOutboundType> & { title: string }> = [
	{ value: 'goods_issue', label: 'Issue', title: OUTBOUND_MODULE_TITLE },
	{ value: 'write_offs', label: 'Write-off', title: 'Write-off' },
	{ value: 'defects_missing', label: 'Dispose', title: 'Dispose' },
];

/** The shared URL state — the hub list AND its `/+` create read `?type=` from
 *  this one parser, so a create always returns to the tab it was opened from. */
export const OUTBOUND_TYPE_PARAM = enumParam<MroOutboundType>(
	OUTBOUND_TABS.map((tab) => tab.value),
	'goods_issue',
);

/** The hub's WHOLE URL view state — the kind tab. Exported so the create/detail
 *  screens read `?type=` through the SAME schema (one source of truth). */
export const OUTBOUND_VIEW = {
	[URL_PARAM.type]: OUTBOUND_TYPE_PARAM,
} as const;

/**
 * အထွက်စာရင်း — the MRO outbound HUB (`/app/outbounds`, launcher tile
 * `outbounds`). ONE `mro_outbounds` document flow with three kinds — issue
 * usable stock (Issue), write off obsolete stock (Write-off) and dispose
 * defect/missing units (Dispose). The tab row on top switches the server-side
 * `type` filter; the lists below it are the SAME `OutboundListPage`, so draft
 * အတည်ပြုမည် confirms, status filters and search behave identically on every
 * tab. Old deep links (`/app/goods-issues`, `/app/write-offs`, `/app/scrapes`,
 * `/app/transfers`) redirect into the matching tab from the router.
 */
export default function OutboundHubPage() {
	const [view, setView] = useViewState(OUTBOUND_VIEW);
	const { type } = view;
	const activeTitle = OUTBOUND_TABS.find((tab) => tab.value === type)?.title ?? OUTBOUND_TABS[0].title;

	return (
		<OutboundListPage
			type={type}
			title={activeTitle}
			subheader={
				<SegmentedTabs options={OUTBOUND_TABS} value={type} onChange={(value) => setView({ type: value })} ariaLabel="Outbound type" />
			}
		/>
	);
}

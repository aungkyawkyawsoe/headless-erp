import { InboundListPage } from './inbound-list-page';
import type { InboundType } from '../data/types';
import { SegmentedTabs, type SegTabOption } from '@/shared/components/segmented-tabs';
import { URL_PARAM, enumParam, useViewState } from '@/shared/url-state';

/** အဝင်စာရင်း — the module's own screen name, used as the DEFAULT (Purchase)
 *  tab's app-bar heading. The other kinds carry their OWN heading (see
 *  `INBOUND_TABS`), so the bar names the kind you are actually on. */
export const INBOUND_MODULE_TITLE = 'Inbounds';

/** The three inbound kinds — the hub's tab row. The TAB labels read in English
 *  (Purchase / Opening / Return); the per-tab `title` is the app-bar HEADING for
 *  that kind, so switching the tab renames the screen (Purchase → the module
 *  name, Opening → the other-method receipt, Return → its kind tag). */
export const INBOUND_TABS: ReadonlyArray<SegTabOption<InboundType> & { title: string }> = [
	{ value: 'purchase', label: 'Purchase', title: INBOUND_MODULE_TITLE },
	{ value: 'legacy', label: 'Opening', title: 'Opening Balance' },
	{ value: 'return', label: 'Return', title: 'Return' },
];

/** The shared URL state — the hub list AND its `/+` create read `?type=` from
 *  this one parser, so a create always returns to the tab it was opened from. */
export const INBOUND_TYPE_PARAM = enumParam<InboundType>(
	INBOUND_TABS.map((tab) => tab.value),
	'purchase',
);

/** The hub's WHOLE URL view state — the kind tab. Exported so the create/detail
 *  screens read `?type=` through the SAME schema (one source of truth). */
export const INBOUND_VIEW = {
	[URL_PARAM.type]: INBOUND_TYPE_PARAM,
} as const;

/**
 * အဝင်စာရင်း — the MRO inbound HUB (`/app/inbounds`, launcher tile `inbounds`).
 * ONE `mro_inbounds` document flow with three kinds — purchase goods from a
 * supplier (Purchase), seed opening balances (Opening) and re-instock issued
 * units (Return). The kind tab row on top switches the server-side `type`
 * filter; the lists below it are the SAME `InboundListPage`, so draft
 * အတည်ပြုမည် confirms, status filters and search behave identically on every
 * tab.
 */
export default function InboundHubPage() {
	const [view, setView] = useViewState(INBOUND_VIEW);
	const { type } = view;
	const activeTitle = INBOUND_TABS.find((tab) => tab.value === type)?.title ?? INBOUND_TABS[0].title;

	return (
		<InboundListPage
			type={type}
			title={activeTitle}
			subheader={
				<SegmentedTabs options={INBOUND_TABS} value={type} onChange={(value) => setView({ type: value })} ariaLabel="Inbound type" />
			}
		/>
	);
}

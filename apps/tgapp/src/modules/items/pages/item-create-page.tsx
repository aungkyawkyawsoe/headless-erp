import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import ItemForm from '../components/item-form';
import { createItemModel } from '../data/api';
import { qk } from '../data/query-keys';
import { invalidateDomainsReading } from '@/shared/api/invalidation';
import { MRO_ITEM_MODELS_QUERY_KEY } from '@/shared/hooks/use-mro-item-models';
import { ModuleShell } from '@/shared/components/module-shell';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { URL_PARAM, stringParam, useViewState } from '@/shared/url-state';

/** The create form's URL view state — the `?item_name=` preselected master. */
const ITEM_CREATE_VIEW = {
	[URL_PARAM.itemName]: stringParam,
} as const;

/**
 * ပစ္စည်းအသစ် — the item-model create form (`/app/items/+`, the ပစ္စည်းများ
 * list's + button). The shared ItemForm runs in create mode:
 *
 *   ပစ္စည်းအုပ်စု (m2o picker + quick-add WITH the master's tracking policy) →
 *   ပစ္စည်းအမည် (auto-composed until
 *   hand-edited) → tracking (read-only, inherited) → expiry-alert days.
 *
 * Deep link: `?item_name=<master id>` preselects the ပစ္စည်းအုပ်စု (the groups
 * page's flow). On success the row is created and the page pops back to the list.
 */
export default function ItemCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [view] = useViewState(ITEM_CREATE_VIEW);
	const { item_name: itemNameParam } = view;

	const save = async (input: Parameters<typeof createItemModel>[0]) => {
		await createItemModel(input);
		// Refresh every item-model list (the active one + deeper cached pages)
		// so the new row shows without a manual reload after returning.
		void queryClient.invalidateQueries({ queryKey: qk.items(), refetchType: 'active' });
		// Write-through — a `mro_item_model` write can change every directory that
		// derives from it (the movement Screen 1 directory when a model is
		// re-grouped; the item-groups hub's counts) — refresh each domain that
		// reads the collection, whatever it is today.
		void invalidateDomainsReading(queryClient, 'mro_item_model');
		// A brand-new SKU must appear in every doc form's picker (the shared
		// `['mro','item-models']` SKU directory) without waiting out the 5-min
		// master window.
		void queryClient.invalidateQueries({ queryKey: MRO_ITEM_MODELS_QUERY_KEY });
		// Pop (not push): a pushed list entry would leave the create page beneath
		// it, so back from the list would re-open a fresh empty form.
		notifySaved('Item saved');
		popBack(navigate, '/app/items');
	};

	return (
		<ModuleShell title="New Item" backTo="/app/items">
			<ItemForm
				mode="create"
				itemNameParam={itemNameParam ?? null}
				save={save}
				submitLabel="Create"
				savingLabel="Creating…"
				errorMessage="Could not create the item. Please try again."
			/>
		</ModuleShell>
	);
}

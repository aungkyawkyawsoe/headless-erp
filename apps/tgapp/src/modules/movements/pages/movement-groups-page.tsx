import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { MovementGroupRow, movementGroupDisplay } from '../components/movement-group-row';
import { fetchMovementGroups } from '../data/api';
import { MOVEMENT_STALE_MS, qk } from '../data/query-keys';
import type { MovementGroupRow as MovementGroupRowModel } from '../data/types';
import { SearchKiosk } from '@/shared/components/search-kiosk';

/** ပစ္စည်းလှုပ်ရှားမှု — the module's Burmese screen name (launcher label). */
const MOVEMENT_TITLE = 'Movements';

/**
 * ပစ္စည်းလှုပ်ရှားမှု — the parts-movement app (launcher tile `movements` →
 * `/app/movements`).
 *
 * Search-first, the SAME shared kiosk shape as Fluid / odo / stock, but over
 * ITEMS: it opens BLANK with ONE centred item search (zero reads while idle)
 * and runs only a debounced server `?search=` read once the operator types. A
 * single match — or a picked suggestion — opens that group's movement feed
 * directly; the full directory stays one tap away at `/app/movements/browse`.
 *
 * The state machine, search pill, suggestion listbox and result states all live
 * in the shared `SearchKiosk` — this page only supplies the group row card, its
 * server search and the module's cache tier.
 */
export default function MovementGroupsPage() {
	const navigate = useNavigate();

	const openGroup = useCallback(
		(group: MovementGroupRowModel) => {
			navigate(`/app/movements/models?group=${encodeURIComponent(group.id)}`);
		},
		[navigate],
	);

	const search = useCallback(async (term: string) => (await fetchMovementGroups({ search: term })).rows, []);

	return (
		<SearchKiosk<MovementGroupRowModel>
			title={MOVEMENT_TITLE}
			heading="Find an item"
			placeholder="Enter item name (e.g. Alternator)"
			inputLabel="Item name"
			search={search}
			queryKeyPrefix={qk.groups()}
			staleTime={MOVEMENT_STALE_MS}
			keyOf={(group) => group.id}
			primaryText={(group) => movementGroupDisplay(group)}
			secondaryText={(group) => group.name_mm?.trim() || null}
			renderResult={(group) => <MovementGroupRow key={group.id} group={group} onOpen={() => openGroup(group)} />}
			onPick={openGroup}
			notFoundHint="Check the item name and try again — e.g. Alternator. Only items with confirmed movement appear."
			skeletonVariant="category"
			browse={{ to: '/app/movements/browse', label: 'Browse all item groups' }}
		/>
	);
}

import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import ItemForm from '../components/item-form';
import { fetchItemModelById, masterPickOf, updateItemModel } from '../data/api';
import { qk } from '../data/query-keys';
import { STALE_MS, invalidateDomainsReading } from '@/shared/api/invalidation';
import { MRO_TRACKING, type MroTracking } from '@/shared/mro';
import { MRO_ITEM_MODELS_QUERY_KEY } from '@/shared/hooks/use-mro-item-models';
import { ModuleShell } from '@/shared/components/module-shell';
import { FormSkeleton } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';

/**
 * ပစ္စည်း ပြင်ဆင်မည် — the single-item-model edit page (`/app/items/:id`,
 * reached by tapping an item card on the ပစ္စည်းများ list). Loads the row and
 * renders the shared ItemForm in edit mode with its stored values:
 *
 *   - ပစ္စည်းအုပ်စု — the classification is editable (re-homing a SKU
 *     to another group re-inherits that group's tracking policy; the group itself
 *     cannot be cleared — it IS the policy source);
 *   - ပစ္စည်းအမည် / မြန်မာအမည် — editable, never auto-rewritten;
 *   - tracking — READ-ONLY and INHERITED: stock rows (lots/serials/balances) and
 *     the confirm engine key off the policy, which the item NAME owns;
 *   - သက်တမ်း သတိပေးရက် — editable (empty = clear the alert).
 *
 * Saving updates the row, invalidates the catalog lists and pops back.
 */
export default function ItemEditPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { id } = useParams<{ id: string }>();

	const rowQuery = useQuery({
		queryKey: qk.itemEdit(id ?? ''),
		queryFn: () => fetchItemModelById(id ?? ''),
		enabled: id != null && id !== '',
		// The row read seeds the form — it must ALWAYS refetch on entry. The
		// app-wide QueryClient default is a 30s staleTime, which would serve a
		// cached pre-save row and (without invalidation) never refetch — the
		// "old data until page refresh" bug. `STALE_MS.live` (0) = always refetch.
		staleTime: STALE_MS.live,
	});

	const initial = useMemo(() => {
		const row = rowQuery.data;
		if (!row) return undefined;
		// The policy is INHERITED from the row's item name — it arrives expanded on
		// the row read (`item_name.tracking`) and is only the form's display
		// fallback while the shared master directory resolves.
		const rawTracking = typeof row.item_name === 'object' && row.item_name ? row.item_name.tracking : null;
		const tracking: MroTracking = MRO_TRACKING.some((policy) => policy.value === rawTracking) ? (rawTracking as MroTracking) : 'standard';
		return {
			name_en: row.name_en?.trim() || '',
			nameMm: row.name_mm?.trim() ?? '',
			tracking,
			expiryAlertDays: row.expiry_alert_days ?? null,
			image: typeof row.image === 'string' && row.image.trim() ? row.image.trim() : null,
			itemName: masterPickOf(row.item_name),
		};
	}, [rowQuery.data]);

	const save = async (input: Parameters<typeof updateItemModel>[1]) => {
		if (!id) return;
		const updated = await updateItemModel(id, input);
		// Patch the SAVED row into the edit-page cache so a quick re-entry into
		// this item shows the new values with no stale flash, then refresh every
		// model list (the active one + deeper cached pages).
		queryClient.setQueryData(qk.itemEdit(id), updated);
		void queryClient.invalidateQueries({ queryKey: qk.items(), refetchType: 'active' });
		// Write-through — reassigning the model's ပစ္စည်းအုပ်စု re-homes its
		// confirmed movement between masters: refresh every domain that reads
		// `mro_item_model` (the movement Screen 1 directory, whose membership is
		// group-scoped) so a cached directory can't list the line under the old
		// master.
		void invalidateDomainsReading(queryClient, 'mro_item_model');
		// The shared SKU directory (`['mro','item-models']`) must pick up the
		// renamed/re-grouped row so every doc form's picker shows the fresh label
		// without waiting out the 5-min master window.
		void queryClient.invalidateQueries({ queryKey: MRO_ITEM_MODELS_QUERY_KEY });
		notifySaved('Item updated');
		popBack(navigate, '/app/items');
	};

	return (
		<ModuleShell title="Edit Item" backTo="/app/items">
			{rowQuery.isPending ? (
				<FormSkeleton />
			) : rowQuery.isError || !rowQuery.data ? (
				<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load the item.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void rowQuery.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Try Again
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, '/app/items')}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back to List
						</button>
					</div>
				</div>
			) : (
				<>
					<ItemForm
						key={id ?? ''}
						mode="edit"
						modelId={id ?? undefined}
						initial={initial}
						save={save}
						submitLabel="Save"
						savingLabel="Saving…"
						errorMessage="Could not save. Please try again."
					/>
				</>
			)}
		</ModuleShell>
	);
}

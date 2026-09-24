import { useEffect, useMemo, useState } from 'react';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Input } from '@mmbix/design-system/input';
import { RefreshCw } from 'lucide-react';

import { MasterDeleteAction } from '../components/master-delete-action';
import { fetchItemNameById, removeItemName, renameItemName } from '../data/api';
import { qk } from '../data/query-keys';
import { STALE_MS } from '@/shared/api/invalidation';
import { MRO_ITEM_NAMES_QUERY_KEY, dropMasterFromDirectory, upsertMasterDirectory } from '@/shared/hooks/use-mro-masters';
import { MRO_ITEM_MODELS_QUERY_KEY } from '@/shared/hooks/use-mro-item-models';
import { ModuleShell } from '@/shared/components/module-shell';
import { FormField } from '@/shared/components/form-field';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { RequiredMark } from '@/shared/components/required-mark';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormSkeleton } from '@/shared/components/skeletons';
import { MRO_TRACKING_LABELS, type MroTracking } from '@/shared/mro';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';

/**
 * Edit Item Group — the item-name master rename page
 * (`/app/mro-categories/groups/:id`, opened by the pencil on a group card on the
 * masters hub's Item Groups tab). The `tracking` policy is set ONCE at creation
 * and inherited by every SKU under the group, so it is shown read-only here —
 * only the two display names are editable. Saving invalidates the group
 * aggregate + the shared SKU/item-name directories and pops back; failures show
 * inline.
 */

const BACK_TO = '/app/mro-categories';

export default function MroCategoryEditPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { id } = useParams<{ id: string }>();

	const rowQuery = useQuery({
		queryKey: qk.groupEdit(id ?? ''),
		queryFn: () => fetchItemNameById(id ?? ''),
		enabled: id != null && id !== '',
		// Seeds the form — always refetch on entry (the app-wide default 30s
		// staleTime would freeze the fields on a cached pre-save name).
		staleTime: STALE_MS.live,
	});

	const initialEn = useMemo(() => rowQuery.data?.name_en?.trim() ?? '', [rowQuery.data]);
	const initialMm = useMemo(() => rowQuery.data?.name_mm?.trim() ?? '', [rowQuery.data]);
	const tracking = rowQuery.data?.tracking as MroTracking | undefined;

	const [nameEn, setNameEn] = useState(initialEn);
	const [nameMm, setNameMm] = useState(initialMm);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Re-seed whenever the loaded row changes (a cached row may land before the
	// fresh fetch) so the fields never freeze on stale data.
	useEffect(() => {
		setNameEn(initialEn);
		setNameMm(initialMm);
		setError(null);
	}, [initialEn, initialMm]);

	const trimmedEn = nameEn.trim();
	const trimmedMm = nameMm.trim();
	// Dirty gate — the edit must differ from the loaded row before it can save.
	const dirty = useFormDirty({ nameEn: initialEn, nameMm: initialMm }, { nameEn, nameMm });
	const canSubmit = trimmedEn !== '' && trimmedMm !== '' && !submitting && dirty;

	const submit = async () => {
		if (!id || trimmedEn === '' || trimmedMm === '' || submitting || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		try {
			const row = await renameItemName(id, trimmedEn, trimmedMm);
			// Write-through the item-names directory (server response = truth, no
			// refetch); the groups AGGREGATE + the shared SKU directory carry derived
			// data this rename affects — invalidate those behind the paint.
			upsertMasterDirectory(queryClient, MRO_ITEM_NAMES_QUERY_KEY, {
				id: row.id,
				name: row.name_en ?? trimmedEn,
				tracking: row.tracking ?? null,
			});
			void queryClient.invalidateQueries({ queryKey: qk.groups(), refetchType: 'active' });
			void queryClient.invalidateQueries({ queryKey: MRO_ITEM_MODELS_QUERY_KEY });
			notifySaved('Category updated');
			popBack(navigate, BACK_TO);
		} catch {
			setError("Couldn't save the item group. Please try again.");
			setSubmitting(false);
			submitGuard.end();
		}
	};

	const isMainButton = useTelegramMainButton({
		text: submitting ? 'Saving…' : 'Save',
		onClick: () => void submit(),
		disabled: !canSubmit,
		loading: submitting,
	});

	// Delete — the engine refuses (409) while any SKU still points at this group;
	// the thrown message is shown verbatim by the action.
	const remove = async () => {
		if (!id) return;
		await removeItemName(id);
		dropMasterFromDirectory(queryClient, MRO_ITEM_NAMES_QUERY_KEY, id);
		void queryClient.invalidateQueries({ queryKey: qk.groups(), refetchType: 'active' });
		notifySaved('Category deleted');
		popBack(navigate, BACK_TO);
	};

	if (rowQuery.isPending) {
		return (
			<ModuleShell title="Edit Item Group" backTo={BACK_TO}>
				<FormSkeleton />
			</ModuleShell>
		);
	}

	if (rowQuery.isError || !rowQuery.data) {
		return (
			<ModuleShell title="Edit Item Group" backTo={BACK_TO}>
				<div className="flex flex-1 flex-col items-center gap-3 px-4 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Couldn't load this item group.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void rowQuery.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Retry
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, BACK_TO)}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back to list
						</button>
					</div>
				</div>
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title="Edit Item Group" backTo={BACK_TO}>
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{/* 1 — Item group name (EN). */}
				<section>
					<label htmlFor="item-name-en" className={labelClass}>
						Item Group Name (English)
						<RequiredMark />
					</label>
					<Input
						id="item-name-en"
						value={nameEn}
						onChange={(e) => setNameEn(e.target.value)}
						placeholder="e.g. — Bulb, Clutch, Tyre"
						autoComplete="off"
						maxLength={120}
						disabled={submitting}
						className={fieldClass}
					/>
				</section>

				{/* 2 — Item group name (MM). */}
				<section>
					<label htmlFor="item-name-mm" className={labelClass}>
						Item Group Name (Myanmar)
						<RequiredMark />
					</label>
					<Input
						id="item-name-mm"
						value={nameMm}
						onChange={(e) => setNameMm(e.target.value)}
						placeholder="e.g. — the group name in Myanmar"
						autoComplete="off"
						maxLength={120}
						disabled={submitting}
						className={fieldClass}
					/>
				</section>

				{/* 3 — Tracking policy: read-only. Set once at creation, inherited by
					every SKU under the group, so it can never change here. */}
				<section>
					<FormField label="Tracking" group>
						{() => (
							<div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
								<span className="text-sm font-semibold leading-6 text-foreground">{tracking ? MRO_TRACKING_LABELS[tracking] : '—'}</span>
								<span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold leading-myanmar text-muted-foreground">
									Locked
								</span>
							</div>
						)}
					</FormField>
					<p className="mt-1.5 text-xs leading-myanmar text-muted-foreground">
						All items under this group already inherit this policy — it cannot be changed later.
					</p>
				</section>

				<FormError error={error} />

				<FormSubmitBar
					label="Save"
					isMainButton={isMainButton}
					disabled={!canSubmit}
					submitting={submitting}
					onSubmit={() => void submit()}
				/>

				{/* Destructive action — the engine blocks it while SKUs still belong here. */}
				<MasterDeleteAction noun="item group" errorMessage="Couldn't delete the item group. Please try again." onDelete={remove} />
			</div>
		</ModuleShell>
	);
}

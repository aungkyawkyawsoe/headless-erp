import { useCallback, useEffect, useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, RefreshCw } from 'lucide-react';

import { FluidFillForm, type FluidDraft } from '../components/fluid-section';
import { fetchFluidFillById, fetchFluidHistoryPage, fluidFillVehicleId } from '../data/api';
import { fillEditDraft } from '../data/fill-edit';
import { qk } from '../data/query-keys';
import { canEditFill } from '../data/status';
import type { FluidKind } from '../data/types';
import { FLUID_KIND_LABELS } from '@/modules/fleets/data/status';
import { qk as fleetsQk } from '@/modules/fleets/data/query-keys';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { isNewestRecord } from '@/shared/records/newest';

/**
 * The fill editor — owns the draft (seeded once from the loaded row), so a
 * remount never re-seeds mid-typing. Rendered only after the row loads.
 */
function FillEditor({
	fillId,
	vehicleId,
	kind,
	initial,
	onSaved,
}: {
	fillId: string;
	vehicleId: string;
	kind: FluidKind;
	initial: FluidDraft;
	onSaved: () => void;
}) {
	const [draft, setDraft] = useState<FluidDraft>(initial);

	// Re-seed the draft whenever the initial data changes (e.g., background refetch).
	useEffect(() => {
		setDraft(initial);
	}, [initial]);

	return (
		<FluidFillForm
			vehicleId={vehicleId}
			kind={kind}
			// A correction must be able to change the odo freely — the create form's
			// "can't exceed the current reading" ceiling does not apply to an edit.
			currentOdo={null}
			previousIntervalKm={null}
			draft={draft}
			onDraftChange={setDraft}
			onSaved={onSaved}
			editingId={fillId}
			baselineDraft={initial}
		/>
	);
}

/**
 * Fluid → ONE fill's CORRECTION screen (`/app/fluid/fill/:id`, reached from the
 * Edit action on the vehicle's NEWEST fill card of that kind).
 *
 * The fill is read RAW by id — only the newest fill of its kind may be corrected
 * (older service history is the audit trail), so the screen also reads that
 * kind's history page 1 and refuses when this id is not at its head (a direct
 * URL to an older fill cannot bypass the rule). Saving pops back to where the
 * operator came from.
 */
export default function FluidEditPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { id } = useParams<{ id: string }>();
	const fillId = id ?? '';

	const record = useQuery({
		queryKey: qk.fill(fillId),
		queryFn: () => fetchFluidFillById(fillId),
		enabled: fillId !== '',
	});
	const vehicleId = record.data ? fluidFillVehicleId(record.data) : null;
	const kind = (record.data?.fluid_kind as FluidKind | null | undefined) ?? null;

	// The newest fill of this kind — the editability guard. A dedicated key, not
	// the vehicle page's infinite feed.
	const history = useQuery({
		queryKey: ['fluids', 'edit-guard', vehicleId ?? '', kind ?? ''] as const,
		queryFn: () => fetchFluidHistoryPage(vehicleId as string, kind as FluidKind),
		enabled: vehicleId != null && vehicleId !== '' && kind != null,
	});

	const backTo = vehicleId ? `/app/fluid/${vehicleId}` : '/app/fluid';
	const handleSaved = useCallback(() => {
		if (vehicleId && kind) {
			void queryClient.invalidateQueries({ queryKey: qk.history(vehicleId, kind), refetchType: 'active' });
			void queryClient.invalidateQueries({ queryKey: qk.list(), refetchType: 'none' });
			void queryClient.invalidateQueries({ queryKey: fleetsQk.fleets(), refetchType: 'none' });
		}
		notifySaved('Service record updated');
		popBack(navigate, backTo);
	}, [queryClient, navigate, backTo, vehicleId, kind]);

	if (record.isPending) {
		return (
			<ModuleShell title="Edit fill" backTo={backTo}>
				<section aria-hidden className={`${CARD_FRAME} p-4 shadow-card`}>
					<Shimmer className="h-11 rounded-lg" />
					<div className="mt-3 grid grid-cols-2 gap-3">
						<Shimmer className="h-11 rounded-lg" />
						<Shimmer className="h-11 rounded-lg" />
					</div>
					<Shimmer className="mt-3 h-11 rounded-lg" />
					<Shimmer className="mt-3 h-20 rounded-lg" />
					<Shimmer className="mt-5 h-11 w-full rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (record.isError || !record.data || vehicleId == null || kind == null) {
		return (
			<ModuleShell title="Edit fill" backTo="/app/fluid">
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this fill.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void record.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Retry
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, '/app/fluid')}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back to list
						</button>
					</div>
				</div>
			</ModuleShell>
		);
	}

	if (history.isPending) {
		return (
			<ModuleShell title="Edit fill" backTo={backTo}>
				<section aria-hidden className={`${CARD_FRAME} p-4 shadow-card`}>
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="mt-3 h-11 rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (history.isError || !history.data) {
		return (
			<ModuleShell title="Edit fill" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not check this truck's service history.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void history.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Retry
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, backTo)}
							className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
						>
							Back
						</button>
					</div>
				</div>
			</ModuleShell>
		);
	}

	const isNewest = isNewestRecord(history.data.rows, fillId);
	if (!isNewest) {
		return (
			<ModuleShell title="Edit fill" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<Lock className="size-6 text-muted-foreground" aria-hidden />
					<p className="text-sm font-medium leading-myanmar text-foreground">
						This fill is no longer the latest for this fluid — only the newest can be edited.
					</p>
					<button
						type="button"
						onClick={() => popBack(navigate, backTo)}
						className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
					>
						Back
					</button>
				</div>
			</ModuleShell>
		);
	}

	// A POSTED fill is history — a direct URL to it cannot bypass the rule either.
	if (!canEditFill(record.data.doc_status)) {
		return (
			<ModuleShell title="Edit fill" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<Lock className="size-6 text-muted-foreground" aria-hidden />
					<p className="text-sm font-medium leading-myanmar text-foreground">
						This fill is already confirmed — it can no longer be edited.
					</p>
					<button
						type="button"
						onClick={() => popBack(navigate, backTo)}
						className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
					>
						Back
					</button>
				</div>
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title="Edit fill" backTo={backTo}>
			<section className={`${CARD_FRAME} p-4 shadow-card`}>
				<div className="mb-4">
					<p className="text-base font-bold leading-myanmar text-foreground">Edit {FLUID_KIND_LABELS[kind].toLowerCase()} fill</p>
					<p className="mt-0.5 text-xs leading-myanmar text-muted-foreground">
						Correct this truck's newest fill — saving keeps it current.
					</p>
				</div>
				<FillEditor fillId={fillId} vehicleId={vehicleId} kind={kind} initial={fillEditDraft(record.data)} onSaved={handleSaved} />
			</section>
			<div className="h-10" aria-hidden />
		</ModuleShell>
	);
}

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

import { emptyFluidDraft, FluidFillForm, type FluidDraft } from '../components/fluid-section';
import { fetchFluidFleetIdentity, fetchFluidHistoryPage } from '../data/api';
import { KIND_FILTER } from '../data/kinds';
import { qk } from '../data/query-keys';
import type { FluidKind } from '../data/types';
import { qk as fleetsQk } from '@/modules/fleets/data/query-keys';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { URL_PARAM, stringParam, useViewState } from '@/shared/url-state';

/** The create screen's WHOLE URL view state, declared ONCE — the truck it is
 *  bound to (`?vehicle=`) and the kind being serviced (`?type=`). */
const FLUID_CREATE_VIEW = {
	[URL_PARAM.vehicle]: stringParam,
	[URL_PARAM.type]: KIND_FILTER,
} as const;

/**
 * Fluid — the RECORD PAGE (`/app/fluid/+?vehicle=<id>&type=<kind>`), the bottom
 * bar's + destination on a vehicle's Fluid page.
 *
 * A REAL route (not a tab view) so the create form owns the whole screen: the
 * fields directly on the page, with the native Telegram MainButton as the save
 * action (`ModuleShell` reserves its bottom clearance). It is bound to ONE truck
 * through `?vehicle=` — the plate titles the header and the truck's current odo
 * prefills the fill field (ONE lean `veh_fleets` read, shared under the master
 * key). The active kind's newest fill supplies the "Next due (km)" placeholder
 * hint (the previous service's chosen interval).
 *
 * The KIND is NOT chosen here — there are no Engine oil / Gear oil tabs on this
 * screen. It arrives already fixed in `?type=` from the vehicle page's + (the
 * kind tab the operator was on), and the form's own copy names it ("Save engine
 * oil fill"). Kind switching is the VEHICLE page's job; the tabs live there.
 *
 * A save writes a `veh_fluid_fills` row and pops back to the truck's Fluid page.
 */
export default function FluidCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [viewState] = useViewState(FLUID_CREATE_VIEW);
	const { vehicle: vehicleId, type: kind } = viewState;

	// The bound truck's identity — the plate (header) AND the current odo (the
	// fill-field prefill). ONE lean read, shared under the master key.
	const identity = useQuery({
		queryKey: qk.fleet(vehicleId ?? ''),
		queryFn: () => fetchFluidFleetIdentity(vehicleId as string),
		enabled: vehicleId != null && vehicleId !== '',
	});

	// The active kind's newest fill — the previous interval hint (no extra read:
	// the fill carries its own `next_due_odo`). Page 1 only. A DEDICATED key
	// (`qk.newest`, NOT `qk.history`): the vehicle page reads that same history
	// with `useInfiniteQuery` (data = `{ pages, pageParams }`), so sharing the key
	// made this plain `useQuery` read `.rows` off the infinite shape — crashing
	// the screen when it was opened from an already-cached vehicle page.
	const history = useQuery({
		queryKey: qk.newest(vehicleId ?? '', kind),
		queryFn: () => fetchFluidHistoryPage(vehicleId as string, kind),
		enabled: vehicleId != null && vehicleId !== '',
	});

	const currentOdo = identity.data?.lastOdo ?? null;
	const newestFill = history.data?.rows[0] ?? null;
	const previousIntervalKm =
		newestFill != null && newestFill.odo != null && newestFill.nextDueOdo != null ? newestFill.nextDueOdo - newestFill.odo : null;

	// Per-kind drafts — a kind-tab switch remounts the form (`key={kind}`), so a
	// draft owned by the form would vanish; one entry per kind keeps both.
	const [drafts, setDrafts] = useState<Partial<Record<FluidKind, FluidDraft>>>({});
	const draft = drafts[kind] ?? emptyFluidDraft(currentOdo);
	const setDraft = useCallback(
		(next: FluidDraft) => {
			setDrafts((prev) => ({ ...prev, [kind]: next }));
		},
		[kind],
	);

	const backTo = vehicleId ? `/app/fluid/${vehicleId}` : '/app/fluid';
	const title = identity.data?.plateNo?.trim() || 'Record fill';

	// A save changes the ACTIVE kind's history (new top fill + count) and the
	// lists that render km-left from it — the Fluid list chips and the FLEET list
	// chips (the unmounted lists are stale-marked only, `refetchType: 'none'`).
	const handleSaved = useCallback(() => {
		if (vehicleId) {
			void queryClient.invalidateQueries({ queryKey: qk.history(vehicleId, kind), refetchType: 'active' });
			void queryClient.invalidateQueries({ queryKey: qk.list(), refetchType: 'none' });
			void queryClient.invalidateQueries({ queryKey: fleetsQk.fleets(), refetchType: 'none' });
		}
		notifySaved('Service recorded');
		popBack(navigate, backTo);
	}, [queryClient, navigate, vehicleId, kind, backTo]);

	// No bound truck (a bare `/app/fluid/+`) — nothing to record against.
	if (vehicleId == null || vehicleId === '') {
		return (
			<ModuleShell title="Record fill" backTo="/app/fluid">
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">No vehicle selected for this fill.</p>
					<button
						type="button"
						onClick={() => popBack(navigate, '/app/fluid')}
						className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
					>
						Back to list
					</button>
				</div>
			</ModuleShell>
		);
	}

	// The truck identity (plate + current odo) gates the form: the odo prefill
	// must be known before the fields seed.
	if (identity.isPending) {
		return (
			<ModuleShell title="Record fill" backTo={backTo}>
				<section aria-hidden className="flex flex-col gap-4 pt-2">
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="h-24 rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (identity.isError) {
		return (
			<ModuleShell title="Record fill" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this vehicle.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void identity.refetch()}
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

	return (
		<ModuleShell title={title} backTo={backTo}>
			<div className="flex flex-1 flex-col gap-5 pt-2">
				<FluidFillForm
					key={kind}
					vehicleId={vehicleId}
					kind={kind}
					currentOdo={currentOdo}
					previousIntervalKm={previousIntervalKm}
					draft={draft}
					onDraftChange={setDraft}
					onSaved={handleSaved}
				/>
			</div>
		</ModuleShell>
	);
}

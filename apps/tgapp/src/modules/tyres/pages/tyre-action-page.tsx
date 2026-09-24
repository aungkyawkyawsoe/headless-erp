import { useCallback, useMemo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { ScrapRequestSection, SwapSection, TYRE_ACTION_TITLE, UnseatSection, isTyreActionKind } from '../components/tyre-action-sections';
import { InspectSection, MovePositionSection } from '../components/tyre-detail-body';
import { TransferRequestSection } from '@/modules/asset-transfers/components/transfer-request-section';
import { fetchHolderAssets } from '../data/api';
import { qk, TYRE_STALE_MS } from '../data/query-keys';
import { useBoardChanged } from '../data/use-board-changed';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import { popBack } from '@/shared/platform/history';

/**
 * တာယာ → ONE action on ONE mounted tyre (`/app/tyres/vehicle/:id/action/:kind/
 * :tyreId`) — the FULL-SCREEN body behind every row of the wheel-plan manage menu.
 *
 * The menu itself stays a quick bottom sheet on the rig's LIST body (tap a unit's row
 * → its actions); picking one CLOSES it and opens this page, so a write form (or the
 * governed transfer filer) owns the whole screen and carries the app bar's real back
 * affordance instead of being squeezed into the sheet under the menu's own chrome. The
 * route mirrors the rig (`/app/tyres/vehicle/:id`) so back returns to the board it came
 * from, and the Telegram native BackButton behaves like every other page.
 *
 * Data comes from the SAME two reads the rig page holds (shared caches, usually
 * already warm): the plate masters and the truck's whole asset register
 * (`GET /api/mro/assets/holder?vehicle=`). The tyre and the swap partner list are
 * derived from that one register — never a second request. A cold deep link (where
 * only the ids survive) resolves through exactly the same reads.
 *
 * The swap partner list is THIS truck's other mounted tyres only: a swap is a
 * rotation, and a cross-truck exchange is an approval-gated transfer request.
 */
export default function TyreActionPage() {
	const { id, kind, tyreId } = useParams<{ id: string; kind: string; tyreId: string }>();
	const navigate = useNavigate();
	const action = isTyreActionKind(kind) ? kind : null;
	const backTo = id ? `/app/tyres/vehicle/${id}` : '/app/tyres/fleet';

	// The truck's whole register — the SAME query key the rig page uses, so opening
	// an action from a warm board costs one cache read, not a network round trip.
	const holder = useQuery({
		queryKey: qk.holderAssetsOf(id ?? ''),
		queryFn: () => fetchHolderAssets({ vehicle: id ?? '' }),
		enabled: Boolean(id),
		staleTime: TYRE_STALE_MS,
	});
	const units = useMemo(() => holder.data ?? [], [holder.data]);
	const tyre = useMemo(() => units.find((unit) => unit.id === tyreId) ?? null, [units, tyreId]);
	// Every OTHER tyre CURRENTLY MOUNTED on THIS truck — the whole swap partner list.
	// The read is already vehicle-scoped, and the plate check keeps it that way even
	// if the read ever widens: a swap is a rotation, never a cross-truck exchange.
	const partners = useMemo(
		() =>
			units
				.filter((unit) => unit.kind === 'tyre' && unit.slot != null && unit.id !== tyre?.id && unit.plateNo === tyre?.plateNo)
				.sort((a, b) => (a.serialNo ?? '').localeCompare(b.serialNo ?? '')),
		[units, tyre?.id, tyre?.plateNo],
	);

	const boardChanged = useBoardChanged();
	// A completed write refreshes the board's reads and leaves the page (a POP, so
	// the rig is not duplicated in history).
	const done = useCallback(
		(serialIds: readonly string[]) => {
			boardChanged(serialIds);
			popBack(navigate, backTo);
		},
		[boardChanged, navigate, backTo],
	);

	// A malformed route (an unknown :kind) has no body to render.
	if (!action) {
		return (
			<ModuleShell title="Wheel actions" backTo={backTo}>
				<EmptyState
					title="Unknown action"
					hint="This action link is not one of the wheel-plan actions — open the tyre from its truck's wheel plan."
				/>
			</ModuleShell>
		);
	}

	const title = TYRE_ACTION_TITLE[action];

	return (
		<ModuleShell title={title} subtitle={tyre?.serialNo ?? tyre?.plateNo ?? undefined} backTo={backTo}>
			{holder.isPending ? (
				<ListSkeleton variant="tyre" count={2} />
			) : holder.isError ? (
				<div className={`${CARD_FRAME} p-6 text-center`}>
					<p className="text-sm font-semibold text-foreground">Could not load this truck’s wheel plan.</p>
					<button
						type="button"
						onClick={() => void holder.refetch()}
						className="mt-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
					>
						Try again
					</button>
				</div>
			) : !tyre ? (
				<EmptyState
					title="Unit not on this truck"
					hint="This serial is no longer on this truck's register — open the truck's wheel plan to act on what it carries."
				/>
			) : action === 'inspect' ? (
				<InspectSection tyre={tyre} onRecorded={() => done([tyre.id])} defaultOpen />
			) : action === 'move' ? (
				<MovePositionSection tyre={tyre} onRecorded={() => done([tyre.id])} defaultOpen />
			) : action === 'unseat' ? (
				<UnseatSection tyre={tyre} onDone={done} />
			) : action === 'swap' ? (
				partners.length > 0 ? (
					<SwapSection tyre={tyre} partners={partners} onDone={done} />
				) : (
					<EmptyState
						title="No other tyre to swap"
						hint="This is the only tyre mounted on the truck — fit or move another tyre onto this truck first, then swap the two wheel positions."
					/>
				)
			) : action === 'transfer' ? (
				<TransferRequestSection tyre={tyre} onDone={done} />
			) : (
				<ScrapRequestSection tyre={tyre} onDone={done} />
			)}
		</ModuleShell>
	);
}

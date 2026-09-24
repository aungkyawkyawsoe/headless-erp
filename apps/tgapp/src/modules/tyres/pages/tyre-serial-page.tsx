import { useMemo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useParams } from 'react-router-dom';

import { TyreDetailBody } from '../components/tyre-detail-body';
import { fetchTyreUnit, type TyreLookups } from '../data/api';
import { qk, TYRE_STALE_MS } from '../data/query-keys';
import type { TyreCardModel } from '../data/types';
import { EmptyState } from '@/shared/components/empty-state';
import { ModuleShell } from '@/shared/components/module-shell';
import { ListSkeleton } from '@/shared/components/skeletons';
import { useMroItemModels } from '@/shared/hooks/use-mro-item-models';
import { useVehicleMasters } from '@/shared/lookups/hooks';

/**
 * တာယာ → ONE serial — the FULL-SCREEN lifecycle-history page for a tyre unit
 * (`/app/tyres/tyre/:id`, reached from a By Serial match/card or a By Fleet
 * wheel-plan tyre tap). This is the former per-tyre detail BOTTOM SHEET
 * promoted to a real page with a back arrow, mirroring the By Fleet vehicle
 * plan: the serial code IS the app-bar title, the body carries the unit's live
 * snapshot (model + status + where it sits + remaining tread), the record-
 * inspection / move-to-another-position actions, and the tyre's WHOLE immutable
 * history (wear logs, rotations, re-fits, store moves, write-offs…).
 *
 * The header paints INSTANTLY from the tapped card when one is carried through
 * router state (the search/board already has the `mro_stock_serials` snapshot);
 * the page also reconciles the authoritative single-unit read
 * (`GET /entities/mro_stock_serials/:id` via `fetchTyreUnit`) so a cold deep
 * link / reload — where only the id survives — still resolves the unit, and so
 * a just-moved/just-measured tyre's live values refresh after an action.
 */
export default function TyreSerialPage() {
	const { id } = useParams<{ id: string }>();
	const location = useLocation();

	// The register card the opening screen already held (search match / board
	// tile) — carried through router state for an instant header paint. Guarded to
	// THIS unit so a stale/foreign state object is never trusted.
	const seededTyre: TyreCardModel | null = useMemo(() => {
		const state = location.state as { tyre?: TyreCardModel } | null;
		const tyre = state?.tyre;
		return tyre && typeof tyre === 'object' && tyre.id === id ? tyre : null;
	}, [location.state, id]);

	// The join lookups — the same shared masters the By Serial search uses, needed
	// to resolve the single unit's plate + SKU into a display card.
	const vehicles = useVehicleMasters();
	const models = useMroItemModels();
	const lookups: TyreLookups = useMemo(() => ({ vehicles: vehicles.data ?? [], models: models.data ?? [] }), [vehicles.data, models.data]);
	const lookupsReady = !vehicles.isPending && !models.isPending;

	// The authoritative snapshot — one read for THE unit (the same engine route
	// the serial search uses), gated on the masters so the header never resolves
	// a blank plate/SKU. The seeded card rides as initial data.
	const unitQuery = useQuery({
		queryKey: qk.tyreUnit(id ?? ''),
		queryFn: () => fetchTyreUnit(lookups, id ?? ''),
		enabled: lookupsReady && Boolean(id),
		staleTime: TYRE_STALE_MS,
		// The opened card paints instantly but is ALWAYS reconciled against the
		// register read above (`initialDataUpdatedAt: 0` marks the seed stale, so
		// the authoritative single-unit fetch runs once on mount).
		initialData: seededTyre ?? undefined,
		initialDataUpdatedAt: seededTyre ? 0 : undefined,
	});

	const tyre = unitQuery.data;

	// The unit id is required — a malformed URL (no /:id) has nothing to resolve.
	if (!id) {
		return (
			<ModuleShell title="Tyre history" backTo="/app/tyres/serial">
				<EmptyState title="Tyre not found" hint="This link has no tyre serial on it — search a serial code from the tyre module." />
			</ModuleShell>
		);
	}

	return (
		<ModuleShell title={tyre?.serialNo ?? 'History'} backTo="/app/tyres/serial">
			{tyre ? (
				<TyreDetailBody tyre={tyre} />
			) : unitQuery.isError ? (
				<div className={`${CARD_FRAME} p-6 text-center`}>
					<p className="text-sm font-semibold text-foreground">Could not load this tyre's history.</p>
					<button
						type="button"
						onClick={() => void unitQuery.refetch()}
						className="mt-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
					>
						Try again
					</button>
				</div>
			) : unitQuery.isPending ? (
				<ListSkeleton variant="tyre" count={3} />
			) : (
				/* A resolved row that is not an assets-flagged unit (or a unit the
				   register no longer returns) — nothing to narrate. */
				<EmptyState
					title="Unit not found"
					hint="This serial is not on the asset register — it may have been removed, or the code belongs to another stock line."
				/>
			)}
		</ModuleShell>
	);
}

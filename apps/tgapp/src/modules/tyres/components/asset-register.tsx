import { useMemo } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Disc3, Wrench } from 'lucide-react';

import { fetchHolderAssets } from '../data/api';
import { qk, TYRE_STALE_MS } from '../data/query-keys';
import { treadBandOf, type TreadBand } from '../data/readings';
import type { TyreCardModel } from '../data/types';
import { EmptyState } from '@/shared/components/empty-state';
import { hapticSelection } from '@/shared/platform/haptics';

/**
 * The shared ASSET REGISTER body — ONE holder's belongings, read from the single
 * `GET /api/mro/assets/holder` endpoint.
 *
 * ONE read feeds the whole register (no second request, the server derives the
 * holder from whichever id is sent) and tapping a row opens its full-screen
 * lifecycle page — so a serial has exactly ONE detail surface, whichever screen
 * it was reached from.
 *
 * This is the PERSON's register. A truck's belongings read through the richer
 * on-board registry (`truck-inventory-list.tsx`): the same `?vehicle=` read, split
 * into worn / un-worn / equipment SECTIONS OF ONE LIST with the per-unit actions
 * (wear / take off / transfer) a custody alone does not need. Here there is no
 * writer — custody changes happen on the unit's own detail, so every move is one
 * guarded, audited action.
 */
function depthText(treadMm: number): string {
	const rounded = Math.round(treadMm * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The measured-depth text tone — follows the tyre's tread band. */
const BAND_TONE: Record<TreadBand, string> = {
	good: 'text-status-success',
	warn: 'text-status-warning',
	danger: 'text-status-danger',
};

function tyreRowTone(treadMm: number | null): string | null {
	const band = treadBandOf(treadMm);
	return band ? BAND_TONE[band] : null;
}

/** The asset condition label (`good` → Good …) — plain, colour-free copy. */
const CONDITION_LABELS: Record<string, string> = {
	good: 'Good',
	fair: 'Fair',
	poor: 'Poor',
	damaged: 'Damaged',
};

function conditionText(condition: string | null): string | null {
	if (!condition) return null;
	return CONDITION_LABELS[condition] ?? condition;
}

/** ONE register row — a tyre or an asset unit. Tapping it opens its lifecycle. */
function RegisterRow({ unit, onOpen }: { unit: TyreCardModel; onOpen: (unit: TyreCardModel) => void }) {
	const isTyre = unit.kind === 'tyre';
	const title = (isTyre ? unit.modelName : unit.itemNameEn || unit.modelName) ?? (isTyre ? 'Tyre' : 'Asset');
	const tone = isTyre ? tyreRowTone(unit.treadMm) : null;
	const position = isTyre ? (unit.slot ?? 'Not on a wheel') : conditionText(unit.condition);
	return (
		<li>
			<button
				type="button"
				onClick={() => onOpen(unit)}
				className={`flex w-full items-center gap-3 ${CARD_FRAME} p-3 text-left shadow-card transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]`}
				aria-label={`${title} — open its history`}
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground">
					{isTyre ? <Disc3 className="size-5" aria-hidden /> : <Wrench className="size-5" aria-hidden />}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm leading-myanmar font-bold text-foreground capitalize">{title}</span>
					<span className="mt-0.5 flex items-baseline gap-1.5 text-xs leading-myanmar text-muted-foreground">
						<span className="truncate">
							<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">S/N</span> {unit.serialNo ?? '—'}
						</span>
						{unit.treadMm != null && (
							<span className={`shrink-0 font-bold tabular-nums ${tone ?? 'text-muted-foreground'}`}>{depthText(unit.treadMm)}mm</span>
						)}
						{position && <span className="shrink-0 font-medium text-muted-foreground">· {position}</span>}
					</span>
				</span>
				<ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</button>
		</li>
	);
}

export interface AssetRegisterProps {
	/** The holder whose belongings this register lists — a person (the same read
	 *  also scopes a truck, which renders through the on-board registry instead). */
	holder: { vehicle?: string; employee?: string };
	/** The empty-state copy for a holder with no belongings. */
	empty?: { title: string; hint: string };
}

const DEFAULT_EMPTY = { title: 'No assets', hint: 'Assets held here appear in this list.' };

export function AssetRegister({ holder, empty = DEFAULT_EMPTY }: AssetRegisterProps) {
	const navigate = useNavigate();
	const vehicle = holder.vehicle ?? '';
	const employee = holder.employee ?? '';
	const key = vehicle ? qk.holderAssetsOf(vehicle) : employee ? qk.holderAssetsOfEmployee(employee) : qk.holderAssets();

	const query = useQuery({
		queryKey: key,
		queryFn: () => fetchHolderAssets({ vehicle: vehicle || null, employee: employee || null }),
		enabled: Boolean(vehicle || employee),
		staleTime: TYRE_STALE_MS,
	});

	// `query.data ?? []` allocates a NEW array every render, so the memo below would
	// re-run on every unrelated re-render (the react-hooks lint flags exactly this).
	// Memoize the fallback once so it depends on a stable value.
	const all = useMemo(() => query.data ?? [], [query.data]);

	const openHistory = (unit: TyreCardModel) => {
		hapticSelection();
		navigate(`/app/tyres/tyre/${unit.id}`, { state: { tyre: unit } });
	};

	return (
		<div className="flex flex-1 flex-col pt-1">
			{query.isPending ? (
				<div className="flex flex-col gap-2.5">
					<div className="h-16.5 animate-pulse rounded-2xl bg-muted/40" />
					<div className="h-16.5 animate-pulse rounded-2xl bg-muted/40" />
				</div>
			) : query.isError ? (
				<div className={`${CARD_FRAME} p-6 text-center`}>
					<p className="text-sm font-semibold text-foreground">Could not load the assets.</p>
					<button
						type="button"
						onClick={() => void query.refetch()}
						className="mt-2 rounded-full bg-primary px-4 py-2 text-xs font-semibold leading-myanmar text-primary-foreground"
					>
						Try again
					</button>
				</div>
			) : all.length > 0 ? (
				<ul className="flex flex-col gap-2.5">
					{all.map((unit) => (
						<RegisterRow key={unit.id} unit={unit} onOpen={openHistory} />
					))}
				</ul>
			) : (
				<EmptyState title={empty.title} hint={empty.hint} />
			)}
		</div>
	);
}

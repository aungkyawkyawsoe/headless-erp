import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@mmbix/design-system/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Check, Search, Truck, X } from 'lucide-react';

import { globalSearchKey, searchGlobal, type GlobalSearchHit } from '@/shared/api/search';
import { STALE_MS } from '@/shared/api/invalidation';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS } from '@/shared/constants';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { useVehicleMasters } from '@/shared/lookups/hooks';

interface VehiclePickerSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The currently-bound vehicle id (renders the check mark), if any. */
	selectedId: string | null;
	/** Fired on tap — the caller commits the id and closes the sheet. */
	onSelect: (vehicleId: string) => void;
	title?: string;
	/** A PRE-FILTERED candidate set (the caller's own rule, memoized). When given,
	 *  the sheet lists these immediately and narrows them locally as the term is
	 *  typed, instead of asking the global search door: a destination the caller's
	 *  rule has ALREADY refused (a truck that cannot seat a tyre, or the one the unit
	 *  sits on) must never come back from a directory lookup — the rule stays the
	 *  gate. */
	candidates?: ReadonlyArray<PickerVehicle>;
}

/** The global search API's default page size — a picker never needs more. */
const SEARCH_LIMIT = 25;

interface PickerVehicle {
	id: string;
	plate_no: string;
}

/**
 * The shared "Select a vehicle" bottom sheet — ONE picker for every form that
 * binds a `veh_fleets` record (licenses / insurances / incidents / maintenance /
 * store requisitions / asset transfers), so the anatomy can never drift between
 * them.
 *
 * TWO modes, ONE anatomy:
 *
 *   · UNBOUNDED (no `candidates`) — SEARCH-FIRST, per the app-wide picker
 *     standard: opening issues NOTHING and the sheet shows a blank prompt — no
 *     directory dump. Once the term reaches `SEARCH_MIN_CHARS` and settles for
 *     `SEARCH_DEBOUNCE_MS`, the GLOBAL SEARCH API (`GET /api/search/global`,
 *     scoped to `veh_fleets`) supplies the matches, UNIONED with the cached
 *     directory's own substring matches (deduped by id). The union is deliberate:
 *     the engine's FTS index is rebuilt by an admin job, so a vehicle added after
 *     the last rebuild would be invisible to the search API alone — the directory
 *     side of the union keeps the picker correct either way, and it is a cached
 *     master read (no request per keystroke).
 *   · BOUNDED (`candidates`) — the caller has already applied its own rule, so
 *     the list is shown immediately and filtered locally: no API round trip, and
 *     no way for a lookup to widen a list the rule meant to close.
 */
export function VehiclePickerSheet({
	open,
	onOpenChange,
	selectedId,
	onSelect,
	title = 'Select a vehicle',
	candidates,
}: VehiclePickerSheetProps) {
	const [term, setTerm] = useState('');
	// Re-opening starts a fresh search, not the previous session's term.
	useEffect(() => {
		if (!open) setTerm('');
	}, [open]);

	const trimmed = term.trim();
	const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
	// A BOUNDED sheet is always ready (its list is already in memory); an unbounded
	// one waits for a settled term long enough to be worth a search.
	const bounded = candidates != null;
	const ready = bounded || debounced.length >= SEARCH_MIN_CHARS;

	const vehicles = useVehicleMasters();
	const directory = useMemo(
		() =>
			(vehicles.data ?? [])
				.filter((vehicle) => vehicle.plate_no?.trim())
				.map((vehicle) => ({ id: vehicle.id, plate_no: vehicle.plate_no as string })),
		[vehicles.data],
	);

	// The global search API — one query per settled term, cached per term. Never
	// consulted in bounded mode: the caller's rule is the only source of options.
	const search = useQuery({
		queryKey: globalSearchKey('veh_fleets', debounced),
		queryFn: () => searchGlobal({ q: debounced, collections: ['veh_fleets'], limit: SEARCH_LIMIT }),
		enabled: open && ready && !bounded,
		staleTime: STALE_MS.list,
	});

	const options: PickerVehicle[] = useMemo(() => {
		if (!ready) return [];
		const needle = debounced.toLowerCase();
		if (candidates) {
			return candidates
				.filter((vehicle) => !needle || vehicle.plate_no.toLowerCase().includes(needle))
				.sort((a, b) => a.plate_no.localeCompare(b.plate_no));
		}
		// Directory-side matches (covers rows the FTS index hasn't picked up yet).
		const local = directory.filter((vehicle) => vehicle.plate_no.toLowerCase().includes(needle));
		const merged = new Map(local.map((vehicle) => [vehicle.id, vehicle]));
		const toPickerVehicle = (hit: GlobalSearchHit): PickerVehicle => ({
			id: hit.id,
			plate_no: (typeof hit.fields?.plate_no === 'string' && hit.fields.plate_no.trim()) || hit.title || hit.id,
		});
		for (const hit of search.data ?? []) {
			if (hit.collection === 'veh_fleets' && !merged.has(hit.id)) merged.set(hit.id, toPickerVehicle(hit));
		}
		return [...merged.values()].sort((a, b) => a.plate_no.localeCompare(b.plate_no));
	}, [ready, candidates, debounced, directory, search.data]);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="bottom" className="max-h-[50dvh] gap-0 overflow-hidden p-0">
				<SheetHeader className="px-5 pb-3 pr-12 pt-4">
					<SheetTitle>{title}</SheetTitle>
				</SheetHeader>
				{/* Search — queries the global search API as the term is typed. */}
				<div className="px-5 pb-3">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
						<Input
							value={term}
							onChange={(e) => setTerm(e.target.value)}
							placeholder="Search plate no…"
							aria-label="Search vehicles"
							className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
						/>
						{term && (
							<button
								type="button"
								aria-label="Clear search"
								onClick={() => setTerm('')}
								className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
							>
								<X className="size-4" aria-hidden />
							</button>
						)}
					</div>
				</div>
				<div className="min-h-0 overflow-y-auto px-5 pb-safe pt-1">
					{!ready ? (
						<PickerSearchHint noun="find a vehicle" />
					) : search.isPending && options.length === 0 ? (
						<p className="px-2 py-6 text-center text-sm leading-myanmar text-muted-foreground">Searching…</p>
					) : (
						<>
							{options.map((vehicle) => (
								<button
									key={vehicle.id}
									type="button"
									onClick={() => onSelect(vehicle.id)}
									className="flex items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium leading-myanmar text-foreground hover:bg-muted"
								>
									<span className="inline-flex items-center gap-2">
										<Truck className="size-4 text-muted-foreground" aria-hidden />
										{vehicle.plate_no}
									</span>
									{selectedId === vehicle.id && <Check className="size-4 text-primary" aria-hidden />}
								</button>
							))}
							{options.length === 0 && (
								<p className="px-2 py-6 text-center text-sm leading-myanmar text-muted-foreground">No vehicles match “{trimmed}”.</p>
							)}
						</>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

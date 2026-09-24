import { useMemo, useState } from 'react';
import { ArrowRightLeft, Check, ChevronDown, Disc3, LoaderCircle, Truck, User, Warehouse, X } from 'lucide-react';

import { Textarea } from '@mmbix/design-system/textarea';

import { FormField } from '@/shared/components/form-field';
import { LocationPickerSheet } from '@/shared/components/location-picker-sheet';
import { MRO_LOCATION_LABELS } from '@/shared/mro';

import { custodyDestinationKinds, transferTargetTrucks, type CustodyDestinationKind } from '@/modules/tyres/data/transfer-targets';
import { treadBandOf } from '@/modules/tyres/data/readings';
import { TyreStatusPill } from '@/modules/tyres/components/tyre-status-pill';
import { TYRE_STATUS_META } from '@/modules/tyres/data/status';
import type { TyreCardModel } from '@/modules/tyres/data/types';
import { fileAssetTransfer } from '../data/api';
import { VehiclePickerSheet } from '@/shared/components/vehicle-picker-sheet';
import { PersonnelPickerSheet } from '@/shared/components/personnel-picker-sheet';
import { useVehicleMasters } from '@/shared/lookups/hooks';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';

const labelClass = 'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground';

/** A store value → the one English label the app renders (unknown values fall back to
 *  their own value, never to a blank). */
const storeLabelOf = (value: string): string => MRO_LOCATION_LABELS[value] ?? value;

/** One measured depth — plain mm text (4.2 / 12.9 …). */
function depthText(treadMm: number): string {
	const rounded = Math.round(treadMm * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** The tread-band tone for a measured depth (null → muted). */
function bandTone(treadMm: number | null): string {
	const band = treadBandOf(treadMm);
	if (band === 'good') return 'text-status-success';
	if (band === 'warn') return 'text-status-warning';
	if (band === 'danger') return 'text-status-danger';
	return 'text-muted-foreground';
}

/** A compact status pill — matches the register / search rows. */
function StatusPill({ status }: { status: TyreCardModel['status'] }) {
	return <TyreStatusPill status={status} size="xs" />;
}

/** The destination-holder chooser's own copy — ONE entry per kind. */
const DESTINATION_META: Record<CustodyDestinationKind, { label: string; hint: string }> = {
	vehicle: { label: 'Another truck', hint: 'It rides in that truck’s inventory and is worn there later.' },
	employee: { label: 'Another employee', hint: 'That person becomes accountable for it.' },
	store: { label: 'Back to store', hint: 'It leaves the holder and returns to a store balance as in-stock.' },
};

/**
 * The full-screen CUSTODY REQUEST form (`/app/tyres/vehicle/:id/action/transfer/
 * :tyreId`) — the ONE filer for every governed custody change, opened from the
 * unit's action menu (a truck/tray spare) or a serial's own detail page.
 *
 * A custody change that must pass a superior is not performed here: it is FILED
 * as an `mro_asset_requests` row (the SOURCE is recorded, so execute is pinned to
 * it), then the approval center decides and executes it. The requester never
 * names `requested_by` — the server stamps it from the signed session, which is
 * what makes the superior's check meaningful.
 *
 * WHAT IT OFFERS is the engine's own rule, not a menu this screen invents
 * (`custodyDestinationKinds`, the pure rule, pinned by its spec):
 *
 *   · truck-held  → another truck | back to store
 *   · person-held → another employee | back to store
 *
 * A truck↔person move is offered by NEITHER list, because no writer exists for
 * it: the engine refuses that direction on every path, and the honest route is
 * return-to-store then issue. The form says that instead of showing a form that
 * cannot succeed.
 *
 * The destination TRUCK is an INVENTORY, not a wheel position: no seat is picked
 * here, so the unit lands in the receiving truck's tray and is worn LATER from
 * that truck's own wheel picker. That is why a truck request carries no
 * `to_slot` and why the pure rule drops the truck already holding the unit.
 */
export function TransferRequestSection({ tyre, onDone }: { tyre: TyreCardModel; onDone: (serialIds: readonly string[]) => void }) {
	const vehicles = useVehicleMasters();

	// The destination HOLDER this request names — derived once from where the unit
	// is now. `null` until the operator picks one of the offered kinds.
	const kinds = useMemo(
		() => custodyDestinationKinds({ plateNo: tyre.plateNo, employeeId: tyre.employeeId ?? null }),
		[tyre.plateNo, tyre.employeeId],
	);
	const [destKind, setDestKind] = useState<CustodyDestinationKind | null>(kinds.length === 1 ? kinds[0] : null);

	// The destination's own value — a truck id, or an employee id.
	const [vehId, setVehId] = useState<string | null>(null);
	const [employeeId, setEmployeeId] = useState('');
	const [employeeName, setEmployeeName] = useState('');
	// NO default store: the destination is NAMED like it is for a truck or a person —
	// a return filed into the wrong store is a stock error, and the picker is one tap.
	const [storeLocation, setStoreLocation] = useState<string>('');

	const [note, setNote] = useState('');
	const [vehiclePickerOpen, setVehiclePickerOpen] = useState(false);
	const [employeePickerOpen, setEmployeePickerOpen] = useState(false);
	const [storePickerOpen, setStorePickerOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filed, setFiled] = useState<string | null>(null);

	// Only an issued unit can be requested for transfer (the engine's rule for both
	// the governed request and the direct move).
	const canRequest = tyre.status === 'issued';

	// The CURRENT holder — the source the request records. A truck is resolved to its
	// id (the request stores the m2o), a person comes off the unit itself.
	const sourceVehicleId = useMemo(
		() => (tyre.plateNo ? ((vehicles.data ?? []).find((v) => v.plate_no?.trim() === tyre.plateNo)?.id ?? null) : null),
		[tyre.plateNo, vehicles.data],
	);
	const sourceLabel = tyre.plateNo
		? `${tyre.plateNo}${tyre.slot ? ` · ${tyre.slot}` : ' · spare'}`
		: (tyre.employeeName ?? 'In use (no holder)');

	// The trucks this request may name — the pure rule (`transferTargetTrucks`), so
	// the picker can never offer a truck the writer would refuse. Memoized once: the
	// picker's bounded mode compares this array by identity.
	const trucks = useMemo<ReadonlyArray<{ id: string; plate_no: string }>>(
		() =>
			transferTargetTrucks(tyre.kind, vehicles.data ?? [], tyre.plateNo).map((v) => ({
				id: v.id,
				plate_no: (v.plate_no ?? '').trim(),
			})),
		[tyre.kind, tyre.plateNo, vehicles.data],
	);
	const plateOf = useMemo(() => new Map(trucks.map((v) => [v.id, v.plate_no])), [trucks]);

	// The person list is only needed once an employee destination is chosen — and the
	// picker is SEARCH-FIRST, so nothing is read until the sheet opens.

	if (!canRequest) {
		return (
			<div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
				<p className="text-sm font-semibold text-foreground">This unit cannot be transferred</p>
				<p className="mt-1 text-xs leading-snug text-muted-foreground">
					Only an issued unit can be requested for a move. Status: {TYRE_STATUS_META[tyre.status].label}.
				</p>
			</div>
		);
	}

	// A unit held by nobody has no governed destination at all: from the store every
	// path (fit to a wheel, issue to a person) is direct. Say so rather than render
	// an empty chooser.
	if (kinds.length === 0) {
		return (
			<div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
				<p className="text-sm font-semibold text-foreground">No request needed</p>
				<p className="mt-1 text-xs leading-snug text-muted-foreground">
					This unit is in store. Fit it to a wheel or issue it to a person directly from the store — those moves need no approval.
				</p>
			</div>
		);
	}

	const pickKind = (kind: CustodyDestinationKind) => {
		hapticSelection();
		setDestKind(kind);
		setVehId(null);
		setEmployeeId('');
		setEmployeeName('');
		setStoreLocation('');
		setError(null);
	};

	/** The chosen destination's value is complete enough to file. */
	const destinationReady = destKind === 'store' ? Boolean(storeLocation) : destKind === 'vehicle' ? Boolean(vehId) : Boolean(employeeId);

	/** The one thing still missing, as the submit button's own copy. */
	const missingHint = () => {
		if (!destKind) return 'Choose where it goes';
		if (destKind === 'vehicle') return vehId ? null : 'Choose a destination truck';
		if (destKind === 'employee') return employeeId ? null : 'Choose the employee';
		return storeLocation ? null : 'Choose the store to return it to';
	};
	const hint = missingHint();

	const submit = async () => {
		setError(null);
		// The source must resolve before filing: a request with a missing source
		// would pin the execute to nothing.
		if (tyre.plateNo && !sourceVehicleId) {
			setError('Could not resolve the current truck — reload the page and try again.');
			return;
		}
		if (!destKind || !destinationReady) {
			setError(hint ?? 'Choose a destination.');
			return;
		}
		setBusy(true);
		try {
			const res = await fileAssetTransfer({
				serial: tyre.id,
				fromVehicle: sourceVehicleId,
				fromSlot: tyre.slot ?? null,
				fromEmployee: tyre.employeeId ?? null,
				// Exactly ONE destination holdership is set — the engine derives the
				// request's kind from which one arrives, so the form must never send two.
				toVehicle: destKind === 'vehicle' ? vehId : null,
				// No wheel position: the unit joins the destination truck's inventory and
				// is worn later from that truck's own fitment picker.
				toSlot: null,
				toEmployee: destKind === 'employee' ? employeeId : null,
				toLocation: destKind === 'store' ? storeLocation : null,
				note,
			});
			hapticImpact('medium');
			setFiled(res.display_number ?? '');
		} catch (err) {
			hapticImpact('light');
			console.error('[asset-transfers] file failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not file the request — try again.');
		} finally {
			setBusy(false);
		}
	};

	// A filed request leaves nothing behind to look at on the truck (the change itself
	// happens when a superior executes it), so the page confirms with the request's
	// own number instead of silently popping back.
	if (filed != null) {
		return (
			<div className="rounded-2xl border border-status-success/30 bg-status-success-soft px-4 py-6 text-center">
				<Check className="mx-auto size-6 text-status-success" aria-hidden />
				<p className="mt-2 text-sm font-bold text-status-success">{filed ? `${filed} filed` : 'Request filed'}</p>
				<p className="mt-1 text-xs leading-snug text-status-success/90">
					A recorded superior decides it in the Approval center → Transfers, and the change runs only when they execute it.
				</p>
				<button
					type="button"
					onClick={() => onDone([])}
					className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
				>
					Back to the truck
				</button>
			</div>
		);
	}

	const isReturn = destKind === 'store';

	return (
		<div className="flex flex-col gap-3">
			{/* What is moving — the exact unit the operator acted on, so the form never
			    re-asks which one. */}
			<div className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-card p-3">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted/70 text-muted-foreground">
					<Disc3 className="size-4" aria-hidden />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sub font-bold tracking-tight text-foreground">{tyre.serialNo ?? '—'}</span>
					<span className="mt-0.5 block truncate text-meta font-medium text-muted-foreground">
						{tyre.modelName ?? 'Tyre'}
						{tyre.treadMm != null ? (
							<span className={`font-bold tabular-nums ${bandTone(tyre.treadMm)}`}> · {depthText(tyre.treadMm)}mm</span>
						) : null}
					</span>
				</span>
				<StatusPill status={tyre.status} />
			</div>

			{/* The source — READ-ONLY: it is recorded on the request so the execute is
			    pinned to the exact position the decision was made about. */}
			<dl className="rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
				<dt className={labelClass}>From</dt>
				<dd className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold leading-snug text-foreground">
					{tyre.employeeId ? (
						<User className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
					) : (
						<Truck className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
					)}
					{sourceLabel}
				</dd>
			</dl>

			{/* WHERE it goes — the holder KINDS the engine actually accepts for a unit in
			    this position. A single-option list renders as no choice at all. */}
			<section>
				<p className={labelClass}>Where should it go?</p>
				<div className="mt-1.5 flex flex-wrap gap-1.5">
					{kinds.map((kind) => (
						<button
							key={kind}
							type="button"
							onClick={() => pickKind(kind)}
							aria-pressed={destKind === kind}
							className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-meta font-semibold leading-none transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 ${
								destKind === kind ? 'border-ring/60 bg-primary/10 text-primary' : 'border-border/70 bg-muted/30 text-foreground'
							}`}
						>
							{kind === 'vehicle' ? (
								<Truck className="size-3.5" aria-hidden />
							) : kind === 'employee' ? (
								<User className="size-3.5" aria-hidden />
							) : (
								<Warehouse className="size-3.5" aria-hidden />
							)}
							{DESTINATION_META[kind].label}
						</button>
					))}
				</div>
				{destKind ? <p className="mt-1.5 text-meta leading-snug text-muted-foreground">{DESTINATION_META[destKind].hint}</p> : null}
			</section>

			{/* The destination's VALUE — ONE field, changing with the chosen kind. */}
			{destKind === 'vehicle' ? (
				<section>
					<FormField label="Destination truck">
						{(f) => (
							<div className="mt-1.5 flex items-center gap-2">
								<button
									{...f}
									type="button"
									onClick={() => {
										hapticSelection();
										setVehiclePickerOpen(true);
									}}
									className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-card px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<span className="flex min-w-0 items-center gap-2">
										<Truck className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										{vehId ? (
											<span className="truncate font-semibold text-foreground">{plateOf.get(vehId) ?? vehId}</span>
										) : (
											<span className="truncate text-muted-foreground">Choose a truck…</span>
										)}
									</span>
									<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								</button>
								{vehId ? (
									<button
										type="button"
										aria-label="Clear destination truck"
										onClick={() => {
											hapticImpact('light');
											setVehId(null);
											setError(null);
										}}
										className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-transform duration-150 outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
									>
										<X className="size-4" aria-hidden />
									</button>
								) : null}
							</div>
						)}
					</FormField>
					<p className="mt-1.5 text-meta leading-snug text-muted-foreground">
						No wheel position to pick — the unit joins the destination truck’s inventory and is worn there later.
					</p>
				</section>
			) : destKind === 'employee' ? (
				<section>
					<FormField label="Destination employee">
						{(f) => (
							<div className="mt-1.5 flex items-center gap-2">
								<button
									{...f}
									type="button"
									onClick={() => {
										hapticSelection();
										setEmployeePickerOpen(true);
									}}
									className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-card px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<span className="flex min-w-0 items-center gap-2">
										<User className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										{employeeId ? (
											<span className="truncate font-semibold leading-myanmar text-foreground">{employeeName}</span>
										) : (
											<span className="truncate text-muted-foreground">Choose an employee…</span>
										)}
									</span>
									<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								</button>
								{employeeId ? (
									<button
										type="button"
										aria-label="Clear destination employee"
										onClick={() => {
											hapticImpact('light');
											setEmployeeId('');
											setEmployeeName('');
											setError(null);
										}}
										className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-transform duration-150 outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
									>
										<X className="size-4" aria-hidden />
									</button>
								) : null}
							</div>
						)}
					</FormField>
					<p className="mt-1.5 text-meta leading-snug text-muted-foreground">
						That person becomes accountable for the unit once a superior approves and executes the request.
					</p>
				</section>
			) : destKind === 'store' ? (
				<section>
					{/* The destination NAMED like the truck/person are: the SAME chooser
					    anatomy (a labelled trigger opening a picker sheet), because "back to
					    store" is not a choice of one — there are five stores. */}
					<FormField label="Destination store">
						{(f) => (
							<div className="mt-1.5 flex items-center gap-2">
								<button
									{...f}
									type="button"
									onClick={() => {
										hapticSelection();
										setStorePickerOpen(true);
									}}
									className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-card px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<span className="flex min-w-0 items-center gap-2">
										<Warehouse className="size-4 shrink-0 text-muted-foreground" aria-hidden />
										{storeLocation ? (
											<span className="truncate font-semibold text-foreground">{storeLabelOf(storeLocation)}</span>
										) : (
											<span className="truncate text-muted-foreground">Choose a store…</span>
										)}
									</span>
									<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
								</button>
								{storeLocation ? (
									<button
										type="button"
										aria-label="Clear destination store"
										onClick={() => {
											hapticImpact('light');
											setStoreLocation('');
											setError(null);
										}}
										className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-transform duration-150 outline-none active:scale-95 focus-visible:ring-2 focus-visible:ring-ring"
									>
										<X className="size-4" aria-hidden />
									</button>
								) : null}
							</div>
						)}
					</FormField>
					<p className="mt-1.5 text-meta leading-snug text-muted-foreground">
						{storeLocation
							? tyre.plateNo && tyre.slot
								? `It comes off ${tyre.plateNo} (${tyre.slot}) and goes into ${storeLabelOf(storeLocation)} as in-stock.`
								: `It leaves ${sourceLabel} and goes into ${storeLabelOf(storeLocation)} as in-stock.`
							: 'Pick the store it physically goes back to.'}
					</p>
				</section>
			) : null}

			<label htmlFor="atr-note" className={`${labelClass} block`}>
				Note (optional)
			</label>
			<Textarea
				id="atr-note"
				value={note}
				onChange={(event) => setNote(event.target.value)}
				rows={2}
				placeholder="Why is this needed?"
				className="-mt-1.5 w-full resize-none rounded-xl border border-input bg-card px-3 py-2 text-sm leading-myanmar text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
			/>

			<button
				type="button"
				disabled={busy || !destinationReady}
				onClick={() => void submit()}
				className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:opacity-60"
			>
				{busy ? (
					<LoaderCircle className="size-4 animate-spin" aria-hidden />
				) : isReturn ? (
					<Warehouse className="size-4" aria-hidden />
				) : (
					<ArrowRightLeft className="size-4" aria-hidden />
				)}
				{busy ? 'Filing…' : (hint ?? (isReturn ? 'Send return request' : 'Send transfer request'))}
			</button>

			{error ? <p className="rounded-lg bg-status-danger-soft px-3 py-2 text-xs leading-snug text-status-danger">{error}</p> : null}

			<VehiclePickerSheet
				open={vehiclePickerOpen}
				onOpenChange={setVehiclePickerOpen}
				selectedId={vehId}
				onSelect={(id) => {
					hapticImpact('light');
					setVehId(id);
					setError(null);
					setVehiclePickerOpen(false);
				}}
				candidates={trucks}
				title="Destination truck"
			/>

			<PersonnelPickerSheet
				open={employeePickerOpen}
				onOpenChange={setEmployeePickerOpen}
				value={employeeId && employeeName ? [{ id: employeeId, name: employeeName, photo: null }] : []}
				onToggle={(person) => {
					setEmployeeId(person.id);
					setEmployeeName(person.name);
					setError(null);
					setEmployeePickerOpen(false);
				}}
				title="Destination employee"
				singleSelect
			/>

			<LocationPickerSheet
				open={storePickerOpen}
				onOpenChange={setStorePickerOpen}
				value={storeLocation || null}
				onSelect={(store) => {
					setStoreLocation(store);
					setError(null);
					setStorePickerOpen(false);
				}}
				title="Destination store"
			/>
		</div>
	);
}

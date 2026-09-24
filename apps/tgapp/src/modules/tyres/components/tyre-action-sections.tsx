import { useMemo, useState } from 'react';
import { ArrowRightLeft, Check, PackageOpen, ShieldAlert, Trash2 } from 'lucide-react';

import { swapTyreSeats, unseatTyreToTray } from '../data/api';
import { requireActorId } from '../data/actor';
import { EventDateField, todayMmt } from './event-date-field';
import type { TyreCardModel } from '../data/types';
import { ConfirmSheet } from '@/shared/components/confirm-sheet';
import { useSubmitGuard } from '@/shared/components/form-state';
import { useVehicleMasters } from '@/shared/lookups/hooks';
import { fileAssetTransfer } from '@/modules/asset-transfers/data/api';
import { hapticImpact, hapticSelection } from '@/shared/platform/haptics';

/**
 * The ONE-PER-ACTION bodies of the wheel manage flow — each writes exactly one
 * lifecycle transition on a mounted tyre and reports the serials it changed.
 *
 * They are reached from the unit's action menu (`board-unit-actions.tsx`), whose
 * rows route to them as FULL-SCREEN pages (`TyreActionPage`) with the app bar's
 * real back affordance. The menu replaced the old wheel-plan bottom sheet, and the
 * sheet's in-place step machine before it: a write form now owns the whole screen
 * instead of being squeezed under a menu's chrome. The `onDone` contract is
 * unchanged: the caller invalidates the serials and leaves the screen.
 */

/** Every action the manage menu can open — the page's route segment, verbatim. The
 *  `transfer` and `scrap` segments are the governed FILERS (a superior decides and
 *  executes); the other four are one direct write each. */
export const TYRE_ACTION_KINDS = ['inspect', 'move', 'unseat', 'swap', 'scrap', 'transfer'] as const;

export type TyreActionKind = (typeof TYRE_ACTION_KINDS)[number];

/** The action's page title — the terse app-bar form of the menu row's name (the
 *  menu can be more descriptive; the app bar has one line to work with). */
export const TYRE_ACTION_TITLE: Record<TyreActionKind, string> = {
	inspect: 'Record inspection',
	move: 'Move to a wheel position',
	unseat: 'Take off wheel',
	swap: 'Swap with another tyre',
	scrap: 'Request write-off',
	transfer: 'Request a transfer',
};

/** Narrow a raw route param to a known action (a bad URL renders nothing). */
export function isTyreActionKind(value: string | undefined): value is TyreActionKind {
	return value != null && (TYRE_ACTION_KINDS as readonly string[]).includes(value);
}

/** Sub-page: rotate TWO seated tyres on the same truck — each takes the other's
 *  wheel position. The partner list is this truck's OTHER mounted tyres only: a
 *  cross-truck exchange is an approval-gated transfer request, so the board never
 *  offers one and the writer refuses one. */
export function SwapSection({
	tyre,
	partners,
	onDone,
}: {
	tyre: TyreCardModel;
	/** The truck's OTHER mounted tyres (never another truck's). */
	partners: TyreCardModel[];
	onDone: (serialIds: readonly string[]) => void;
}) {
	const [partner, setPartner] = useState<TyreCardModel | null>(null);
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	const swap = async () => {
		if (!partner || !submitGuard.begin()) return;
		setBusy(true);
		setError(null);
		try {
			const actorId = await requireActorId();
			await swapTyreSeats(tyre.id, partner.id, {
				actorId,
				note: `Swapped ${tyre.slot ?? ''} ↔ ${partner.slot ?? ''} on ${tyre.plateNo ?? ''}`,
			});
			onDone([tyre.id, partner.id]);
		} catch (err) {
			hapticImpact('light');
			console.error('[tyres] swap failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not swap the tyres — try again.');
			setBusy(false);
			submitGuard.end();
		}
	};

	return (
		<div>
			<p className="px-0.5 text-[12px] leading-snug text-muted-foreground">
				Pick the OTHER mounted tyre on <b>{tyre.plateNo}</b> to exchange with. Both stay on this truck — each takes the other’s wheel
				position and a <b>rotation</b> is logged for both.
			</p>
			<div className="mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto pr-0.5">
				{partners.map((other) => (
					<button
						key={other.id}
						type="button"
						onClick={() => {
							hapticSelection();
							setPartner(other);
							setError(null);
						}}
						className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
							partner?.id === other.id ? 'border-ring/60 bg-primary/10' : 'border-border/70 bg-card active:bg-muted/60'
						}`}
					>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-sub font-bold tracking-tight text-foreground">{other.serialNo ?? '—'}</span>
							<span className="block truncate text-meta font-medium text-muted-foreground">
								{other.modelName ?? 'Tyre'} · {other.slot ?? '—'}
							</span>
						</span>
						{partner?.id === other.id ? <Check className="size-4 shrink-0 text-primary" aria-hidden /> : null}
					</button>
				))}
			</div>
			<button
				type="button"
				disabled={busy || !partner}
				onClick={() => setConfirming(true)}
				className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
			>
				<ArrowRightLeft className="size-4" aria-hidden />
				{partner ? `Swap with ${partner.serialNo ?? 'that tyre'}` : 'Choose the other tyre'}
			</button>
			<ConfirmSheet
				open={confirming}
				title="Swap these two tyres?"
				description={`${tyre.serialNo ?? 'This tyre'} (${tyre.slot ?? '—'}) and ${partner?.serialNo ?? 'the other tyre'} (${partner?.slot ?? '—'}) take each other's wheel position. Both stay on ${tyre.plateNo ?? 'this truck'} and a rotation is logged for each.`}
				confirmLabel="Swap"
				busy={busy}
				error={error}
				onConfirm={() => void swap()}
				onClose={() => {
					setConfirming(false);
					setError(null);
				}}
			/>
		</div>
	);
}

/**
 * Sub-page: ask a superior to WRITE THE UNIT OFF where it sits — a write-off
 * REQUEST.
 *
 * A worn-out unit is not scrapped by whoever noticed it: the write-off is FILED as
 * an `mro_asset_requests` row (`write_off`, and therefore no destination), a
 * recorded superior approves it, and the execute performs the scrap. There is no
 * direct write-off path left — the engine refuses one (`scrapMountedSerial` demands
 * the asset-request token) — so this body must not pretend to be a writer.
 */
export function ScrapRequestSection({ tyre, onDone }: { tyre: TyreCardModel; onDone: (serialIds: readonly string[]) => void }) {
	const [note, setNote] = useState('');
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [filed, setFiled] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// The truck holding this unit must be resolved to its id — the request records it
	// so the execute is pinned to the exact truck the decision was made about.
	const vehicles = useVehicleMasters();
	const sourceVehicleId = useMemo(
		() => (tyre.plateNo ? ((vehicles.data ?? []).find((v) => v.plate_no?.trim() === tyre.plateNo)?.id ?? null) : null),
		[tyre.plateNo, vehicles.data],
	);

	const canRequest = tyre.status === 'issued' && (tyre.plateNo != null || tyre.employeeId != null);

	const submit = async () => {
		if (!submitGuard.begin()) return;
		setBusy(true);
		setError(null);
		try {
			if (tyre.plateNo && !sourceVehicleId) {
				setError('Could not resolve the current truck — reload the page and try again.');
				setBusy(false);
				submitGuard.end();
				return;
			}
			const res = await fileAssetTransfer({
				serial: tyre.id,
				fromVehicle: sourceVehicleId,
				fromSlot: tyre.slot ?? null,
				fromEmployee: tyre.employeeId ?? null,
				// The flag IS the request's kind: no destination is named, because a
				// write-off ends the unit where it already is.
				writeOff: true,
				note: note.trim() || `Write off from ${tyre.plateNo ?? tyre.employeeName ?? 'custody'}`,
			});
			setConfirming(false);
			setFiled(res.display_number ?? '');
		} catch (err) {
			hapticImpact('light');
			console.error('[tyres] write-off request failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not file the write-off request — try again.');
			setBusy(false);
			submitGuard.end();
		}
	};

	if (!canRequest) {
		return (
			<div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
				<p className="text-sm font-semibold text-foreground">This unit cannot be written off</p>
				<p className="mt-1 text-xs leading-snug text-muted-foreground">
					Only an issued unit (on a truck or held by a person) can be written off.
				</p>
			</div>
		);
	}

	if (filed != null) {
		return (
			<div className="rounded-2xl border border-status-success/30 bg-status-success-soft px-4 py-6 text-center">
				<Check className="mx-auto size-6 text-status-success" aria-hidden />
				<p className="mt-2 text-sm font-bold text-status-success">{filed ? `${filed} filed` : 'Write-off request filed'}</p>
				<p className="mt-1 text-xs leading-snug text-status-success/90">
					A recorded superior decides it in the Approval center → Transfers, and the unit is scrapped only when they execute it.
				</p>
				<button
					type="button"
					onClick={() => onDone([])}
					className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
				>
					Done
				</button>
			</div>
		);
	}

	return (
		<div>
			<div className="flex items-start gap-2.5 rounded-xl border border-status-danger/40 bg-status-danger-soft/60 px-3 py-2.5">
				<ShieldAlert className="mt-0.5 size-4 shrink-0 text-status-danger" aria-hidden />
				<p className="text-xs leading-snug text-foreground">
					{tyre.serialNo ?? 'This unit'} is <b>written off where it sits</b> — it leaves {tyre.plateNo ?? tyre.employeeName ?? 'its holder'}
					{tyre.slot ? ` (${tyre.slot})` : ''}, flips to <b>scrapped</b> and can never be fitted again. This needs a{' '}
					<b>superior’s approval</b> — you are filing a request, not scrapping it now.
				</p>
			</div>
			<label className="mt-3 flex flex-col gap-1">
				<span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Reason (optional)</span>
				<input
					value={note}
					onChange={(e) => setNote(e.target.value)}
					placeholder="e.g. tread below 3 mm / blowout"
					className="h-10 w-full rounded-lg border border-input bg-card px-2 text-sm font-medium text-foreground outline-none focus:border-ring/60"
				/>
			</label>
			<button
				type="button"
				disabled={busy}
				onClick={() => setConfirming(true)}
				className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-status-danger px-4 py-2.5 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
			>
				<Trash2 className="size-4" aria-hidden />
				Send write-off request
			</button>
			<ConfirmSheet
				open={confirming}
				title="File a write-off request?"
				description={`${tyre.serialNo ?? 'This unit'} (${tyre.plateNo ?? 'truck'} · ${tyre.slot ?? '—'}) is scrapped and can never be fitted again, and the unit is gone from the truck. A superior must approve and execute it — the write-off happens then, not now.`}
				confirmLabel="File request"
				tone="destructive"
				busy={busy}
				error={error}
				onConfirm={() => void submit()}
				onClose={() => {
					setConfirming(false);
					setError(null);
				}}
			/>
		</div>
	);
}

/** Sub-page: take a SEATED tyre OFF its wheel — it stays on the SAME truck, not on a
 *  wheel. It is the ONLY un-seat surface — the rig tile's corner ✕ and the menu's
 *  `Take off` row both land here — so the physical date is picked once, here. */
export function UnseatSection({ tyre, onDone }: { tyre: TyreCardModel; onDone: (serialIds: readonly string[]) => void }) {
	const [date, setDate] = useState(todayMmt());
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	const submit = async () => {
		if (!submitGuard.begin()) return;
		setBusy(true);
		setError(null);
		try {
			const actorId = await requireActorId();
			await unseatTyreToTray(tyre.id, {
				actorId,
				note: `Taken off ${tyre.slot ?? ''} on ${tyre.plateNo ?? ''} — not on a wheel`,
				eventDate: date,
			});
			onDone([tyre.id]);
		} catch (err) {
			hapticImpact('light');
			console.error('[tyres] unseat failed', err);
			setError(err instanceof Error && err.message ? err.message : 'Could not take this tyre off — try again.');
			setBusy(false);
			submitGuard.end();
		}
	};

	return (
		<div>
			<div className="flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/25 px-3 py-2.5">
				<PackageOpen className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
				<p className="text-xs leading-snug text-foreground">
					This tyre comes off <b>{tyre.plateNo}</b> (<b>{tyre.slot}</b>) and stays on the SAME truck — <b>not on a wheel</b> any more. No
					store balance moves — you can fit it onto another wheel of this truck, move it to another truck, or return it to the store later.
					An <b>unseated</b> history event is logged.
				</p>
			</div>
			<div className="mt-3">
				<EventDateField value={date} onChange={setDate} />
			</div>
			<button
				type="button"
				disabled={busy || !date}
				onClick={() => setConfirming(true)}
				className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
			>
				<PackageOpen className="size-4" aria-hidden />
				{`Take ${tyre.serialNo ?? 'this tyre'} off the wheel`}
			</button>
			<ConfirmSheet
				open={confirming}
				title="Take this tyre off the wheel?"
				description={`${tyre.serialNo ?? 'This tyre'} comes off ${tyre.plateNo ?? 'the truck'} (${tyre.slot ?? '—'}) and stays on the same truck — not on a wheel. No store balance moves — an unseated event is logged.`}
				confirmLabel="Take it off"
				busy={busy}
				error={error}
				onConfirm={() => void submit()}
				onClose={() => {
					setConfirming(false);
					setError(null);
				}}
			/>
		</div>
	);
}

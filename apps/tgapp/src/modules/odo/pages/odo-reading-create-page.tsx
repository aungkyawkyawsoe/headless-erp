import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, RefreshCw } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';

import { createOdoLog, fetchOdoCurrent, fetchOdoFleetIdentity } from '../data/api';
import { rejectOdoReading } from '../data/reading-guard';
import { qk } from '../data/query-keys';
import { qk as fleetsQk } from '@/modules/fleets/data/query-keys';
import { qk as fluidsQk } from '@/modules/fluids/data/query-keys';
import { FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { formatEnglishDayMonth, todayMmtDate } from '@/shared/time/myanmar';

/** The compact caption this page's fields use — the association is owned by
 *  `FormField`, so only the presentation is overridden. */
const COMPACT_LABEL_CLASS = 'mb-1 block text-meta font-semibold uppercase tracking-wide leading-myanmar text-muted-foreground';

/**
 * The record form — date (today default) + a reading that must be append-only:
 * never dated before the vehicle's last reading, never below its km. The submit
 * is the NATIVE Telegram MainButton on Android/Desktop (Apple clients fall back
 * to the in-page bar — native iOS clips Burmese labels); never both.
 */
function ReadingRecorder({
	vehicleId,
	currentOdo,
	currentDate,
	onSaved,
}: {
	vehicleId: string;
	currentOdo: number | null;
	/** The last reading's date (`YYYY-MM-DD`) — the earliest a new one may be. */
	currentDate: string | null;
	onSaved: () => void;
}) {
	const [date, setDate] = useState(todayMmtDate());
	const [odo, setOdo] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// The ONE admission rule (date not before the last reading, km not below it)
	// lives in the pure `rejectOdoReading` so the form can never append an entry
	// the newest-date board would hide.
	const rejection = rejectOdoReading({ date, odo, lastOdo: currentOdo, lastDate: currentDate });
	// Dirty gate — a create starts blank (today's date, no reading), so nothing is
	// submittable until the operator enters a value.
	const dirty = useFormDirty({ date: todayMmtDate(), odo: '' }, { date, odo });
	const canSave = !saving && rejection === null && dirty;

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		setSaving(true);
		setError(null);
		try {
			await createOdoLog(vehicleId, { reading_date: date, odometer: Number(odo) });
			onSaved();
		} catch (err) {
			console.error('[odo] save failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this reading — try again.");
			setSaving(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	const isMainButton = useTelegramMainButton({
		text: saving ? 'Saving…' : 'Save reading',
		onClick: () => void submit(),
		disabled: !canSave,
		loading: saving,
	});

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				void submit();
			}}
		>
			{/* Date over Odometer, stacked — side by side squeezed both fields on a
			    narrow phone (and the odometer input is numeric, so it never needed
			    the extra width the pairing bought). */}
			<div className="grid grid-cols-1 gap-3">
				<FormField
					label="Date"
					labelClassName={COMPACT_LABEL_CLASS}
					error={
						rejection === 'before-last-date' ? `Can't be dated before the last reading (${formatEnglishDayMonth(currentDate)}).` : null
					}
				>
					{(_f, h) => <DateField value={date} onChange={setDate} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />}
				</FormField>
				<FormField
					label="Odometer (km)"
					labelClassName={COMPACT_LABEL_CLASS}
					error={rejection === 'below-last-odo' ? `Must not go below the last reading (${currentOdo?.toLocaleString()} km).` : null}
				>
					{(f) => (
						<Input
							{...f}
							type="number"
							inputMode="numeric"
							min={0}
							value={odo}
							onChange={(e) => setOdo(e.target.value)}
							placeholder={currentOdo != null ? `${currentOdo.toLocaleString()}+` : 'e.g. 120000'}
							className={fieldClass}
							disabled={saving}
						/>
					)}
				</FormField>
			</div>
			<FormError error={error} />
			<FormSubmitBar
				label="Save reading"
				type="submit"
				isMainButton={isMainButton}
				disabled={!canSave}
				submitting={saving}
				icon={<Check className="size-4" aria-hidden />}
			/>
		</form>
	);
}

/**
 * Daily ODO — the RECORD PAGE (`/app/daily-odo/:id/reading/new`), the vehicle
 * page's bottom bar's + destination.
 *
 * A REAL route (not a `?tab=record` view swapped in behind the bottom bar) so
 * the form owns the whole screen: no floating toolbar competes for the bottom
 * edge, and the save action is the native Telegram MainButton (`ModuleShell`
 * reserves its bottom clearance — same anatomy as the Fluid record page).
 * The board read (`qk.board`, shared with the vehicle page) supplies the
 * append-only floor; one lean identity read titles the header with the plate.
 *
 * A save appends the reading, invalidates the board + month ledger + the
 * Daily ODO register + the fleet/fluid lists, and pops back to the vehicle.
 */
export default function OdoReadingCreatePage() {
	const navigate = useNavigate();
	const { id } = useParams<{ id: string }>();
	const vehicleId = id ?? '';
	const backTo = vehicleId ? `/app/daily-odo/${vehicleId}` : '/app/daily-odo';
	const queryClient = useQueryClient();

	// The vehicle's CURRENT odo + last reading's date — the form's floor (the
	// same lean board the vehicle page reads, so arriving from there is free).
	const board = useQuery({
		queryKey: qk.board(vehicleId),
		queryFn: () => fetchOdoCurrent(vehicleId),
		enabled: vehicleId !== '',
	});

	// The plate — the header's title (ONE lean master read, shared with the
	// vehicle page's deep-link identity). Only a title: the FORM gates on board.
	const identity = useQuery({
		queryKey: qk.fleet(vehicleId),
		queryFn: () => fetchOdoFleetIdentity(vehicleId),
		enabled: vehicleId !== '',
	});

	// A save changes the vehicle's latest reading → this board, the month ledger,
	// the Daily ODO register, and the FLEET + FLUID lists (their care chips are
	// derived from the fleet-care columns). The unmounted LISTS are STALE-MARKED
	// only (`refetchType: 'none'`) — they refetch once on the user's next visit.
	const handleSaved = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: qk.board(vehicleId), refetchType: 'active' });
		void queryClient.invalidateQueries({ queryKey: qk.history(vehicleId), refetchType: 'active' });
		void queryClient.invalidateQueries({ queryKey: qk.list(), refetchType: 'none' });
		void queryClient.invalidateQueries({ queryKey: fleetsQk.fleets(), refetchType: 'none' });
		void queryClient.invalidateQueries({ queryKey: fluidsQk.list(), refetchType: 'none' });
		notifySaved('Reading recorded');
		popBack(navigate, backTo);
	}, [queryClient, vehicleId, navigate, backTo]);

	// No bound vehicle (a bare open of the route) — nothing to record against.
	if (vehicleId === '') {
		return (
			<ModuleShell title="Record reading" backTo="/app/daily-odo">
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">No vehicle selected for this reading.</p>
					<button
						type="button"
						onClick={() => popBack(navigate, '/app/daily-odo')}
						className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold leading-myanmar text-foreground transition-transform duration-150 active:scale-95"
					>
						Back to list
					</button>
				</div>
			</ModuleShell>
		);
	}

	// The board gates the form: the append-only floor must be known before the
	// fields seed (a fresh vehicle legitimately floors at null).
	if (board.isPending) {
		return (
			<ModuleShell title="Record reading" backTo={backTo}>
				<section aria-hidden className="flex flex-col gap-4 pt-2">
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="h-24 rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (board.isError || !board.data) {
		return (
			<ModuleShell title="Record reading" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this vehicle's odometer.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void board.refetch()}
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

	const title = identity.data?.plateNo && identity.data.plateNo !== '—' ? identity.data.plateNo : 'Record reading';

	return (
		<ModuleShell title={title} backTo={backTo}>
			<div className="flex flex-1 flex-col gap-4 pt-2">
				{board.data.currentOdo != null ? (
					<p className="text-meta leading-myanmar text-muted-foreground">
						Last reading: {board.data.currentOdo.toLocaleString()} km
						{board.data.latestOdoDate ? ` · ${formatEnglishDayMonth(board.data.latestOdoDate)}` : ''}
					</p>
				) : null}
				<ReadingRecorder
					vehicleId={vehicleId}
					currentOdo={board.data.currentOdo}
					currentDate={board.data.latestOdoDate}
					onSaved={handleSaved}
				/>
			</div>
		</ModuleShell>
	);
}

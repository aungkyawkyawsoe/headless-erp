import { useCallback, useState } from 'react';
import { CARD_FRAME } from '@/shared/components/card';
import { FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Gauge, RefreshCw } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';

import { fetchOdoReadingForEdit, updateLastOdoReading } from '../data/api';
import { rejectOdoReading } from '../data/reading-guard';
import { qk } from '../data/query-keys';
import type { VehOdoReading } from '@/modules/fleets/data/types';
import { qk as fleetsQk } from '@/modules/fleets/data/query-keys';
import { qk as fluidsQk } from '@/modules/fluids/data/query-keys';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { ModuleShell } from '@/shared/components/module-shell';
import { Shimmer } from '@/shared/components/skeletons';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { formatEnglishDayMonth } from '@/shared/time/myanmar';

/** The correction form — date + km of the newest reading, floored by the
 *  reading BEFORE it (a correction may sit below its own old value, never below
 *  the previous record). */
function ReadingEditor({
	vehicleId,
	latest,
	previous,
	onSaved,
}: {
	vehicleId: string;
	latest: VehOdoReading;
	previous: VehOdoReading | null;
	onSaved: () => void;
}) {
	const [date, setDate] = useState(latest.date);
	const [odo, setOdo] = useState(String(latest.odo));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	const rejection = rejectOdoReading({ date, odo, lastOdo: previous?.odo ?? null, lastDate: previous?.date ?? null });
	// Dirty gate — a correction must differ from the reading being corrected.
	const dirty = useFormDirty({ date: latest.date, odo: String(latest.odo) }, { date, odo });
	const canSave = !saving && rejection === null && dirty;

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		setSaving(true);
		setError(null);
		try {
			await updateLastOdoReading(vehicleId, { original: latest, date, odometer: Number(odo) });
			onSaved();
		} catch (err) {
			console.error('[odo] reading correction failed', err);
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
			<div className="grid grid-cols-1 gap-3">
				<FormField
					label="Date"
					error={
						rejection === 'before-last-date'
							? `Can't be dated before the previous reading (${formatEnglishDayMonth(previous?.date ?? null)}).`
							: null
					}
				>
					{(_f, h) => <DateField value={date} onChange={setDate} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />}
				</FormField>
				<FormField
					label="Odometer (km)"
					error={
						rejection === 'below-last-odo'
							? `Must not go below the previous reading (${previous?.odo.toLocaleString()} km).`
							: rejection === 'invalid-odo'
								? 'Enter a valid odometer.'
								: null
					}
				>
					{(f) => (
						<Input
							{...f}
							type="number"
							inputMode="numeric"
							min={0}
							value={odo}
							onChange={(e) => setOdo(e.target.value)}
							placeholder="e.g. 120000"
							className={fieldClass}
						/>
					)}
				</FormField>
			</div>

			{previous && (
				<p className="text-meta leading-myanmar text-muted-foreground">
					Previous reading: {previous.odo.toLocaleString()} km · {formatEnglishDayMonth(previous.date)}
				</p>
			)}
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
 * Daily ODO → the NEWEST reading's CORRECTION screen
 * (`/app/daily-odo/:id/reading/edit`, reached from the Odometer card's pencil).
 *
 * A reading has no row id — it lives inside its `(vehicle, month)` bucket's JSON
 * array — so the screen ALWAYS targets the vehicle's current reading (read fresh
 * here) rather than an id. The corrected value may be lower than its own old
 * number (that is the point of a correction) but not below the reading before
 * it; a corrected DATE that crosses a month boundary moves the entry to its new
 * bucket. Saving pops back to the vehicle page.
 */
export default function OdoReadingEditPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { id } = useParams<{ id: string }>();
	const vehicleId = id ?? '';
	const backTo = `/app/daily-odo/${vehicleId}`;

	const context = useQuery({
		queryKey: ['odo', 'reading-edit', vehicleId] as const,
		queryFn: () => fetchOdoReadingForEdit(vehicleId),
		enabled: vehicleId !== '',
	});

	const handleSaved = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: qk.board(vehicleId), refetchType: 'active' });
		void queryClient.invalidateQueries({ queryKey: qk.history(vehicleId), refetchType: 'active' });
		void queryClient.invalidateQueries({ queryKey: qk.list(), refetchType: 'none' });
		void queryClient.invalidateQueries({ queryKey: fleetsQk.fleets(), refetchType: 'none' });
		void queryClient.invalidateQueries({ queryKey: fluidsQk.list(), refetchType: 'none' });
		notifySaved('Reading updated');
		popBack(navigate, backTo);
	}, [queryClient, navigate, backTo, vehicleId]);

	if (context.isPending) {
		return (
			<ModuleShell title="Edit reading" backTo={backTo}>
				<section aria-hidden className={`${CARD_FRAME} p-4 shadow-card`}>
					<Shimmer className="h-11 rounded-lg" />
					<Shimmer className="mt-3 h-11 rounded-lg" />
					<Shimmer className="mt-5 h-11 w-full rounded-lg" />
				</section>
			</ModuleShell>
		);
	}

	if (context.isError || !context.data) {
		return (
			<ModuleShell title="Edit reading" backTo={backTo}>
				<div className="flex flex-1 flex-col items-center gap-3 pt-16 text-center">
					<p className="text-sm font-medium leading-myanmar text-status-danger">Could not load this reading.</p>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => void context.refetch()}
							className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold leading-myanmar text-primary-foreground shadow-sm transition-transform duration-150 active:scale-95"
						>
							<RefreshCw className="size-3.5" strokeWidth={2.2} aria-hidden />
							Retry
						</button>
						<button
							type="button"
							onClick={() => popBack(navigate, '/app/daily-odo')}
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
		<ModuleShell title="Edit reading" backTo={backTo}>
			<section className={`${CARD_FRAME} p-4 shadow-card`}>
				<div className="mb-4 flex items-center gap-2">
					<Gauge className="size-4 text-muted-foreground" aria-hidden />
					<div>
						<p className="text-base font-bold leading-myanmar text-foreground">Edit last reading</p>
						<p className="mt-0.5 text-xs leading-myanmar text-muted-foreground">Correct the vehicle's newest odometer reading.</p>
					</div>
				</div>
				<ReadingEditor vehicleId={vehicleId} latest={context.data.latest} previous={context.data.previous} onSaved={handleSaved} />
			</section>
			<div className="h-10" aria-hidden />
		</ModuleShell>
	);
}

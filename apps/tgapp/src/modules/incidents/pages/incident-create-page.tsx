import { useMemo, useState } from 'react';
import { FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';
import { ChevronDown, X } from 'lucide-react';

import { createIncident } from '../data/api';
import { qk, incidentsListKey } from '../data/query-keys';
import { SEVERITY_META } from '../data/status';
import type { IncidentKind, IncidentSeverity } from '../data/types';
import { PersonnelField } from '../components/personnel-field';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { useVehicleMasters } from '@/shared/lookups/hooks';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { ModuleShell } from '@/shared/components/module-shell';
import type { PersonnelOption } from '@/shared/components/personnel-picker-sheet';
import { VehiclePickerSheet } from '@/shared/components/vehicle-picker-sheet';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { todayMmtDate } from '@/shared/time/myanmar';

/**
 * Log accident / incident — the real `veh_incidents` create form (`/app/incidents/+`).
 *
 * One engine-native POST bound to a `veh_fleets` vehicle; the reporter (m2o →
 * `hrm_employees`) is the CURRENT logged-in employee resolved at submit (same
 * session→employee resolution the adjustments / store-request forms use). The
 * personnel (crew) is picked into the `personnel` m2m; the kind toggle picks
 * Accident | Incident; date defaults to today (MMT).
 *
 * Submit via the Telegram MainButton on Android/Desktop (Apple clients /
 * browsers get the in-page fallback — never both, see `use-main-button.ts`).
 */
export default function IncidentCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	// The shared fleet directory — the bound-vehicle picker source.
	const vehicles = useVehicleMasters();
	const vehicleOptions = useMemo(
		() =>
			(vehicles.data ?? [])
				.filter((vehicle) => vehicle.plate_no?.trim())
				.sort((a, b) => (a.plate_no as string).localeCompare(b.plate_no as string)),
		[vehicles.data],
	);

	const [kind, setKind] = useState<IncidentKind>('incident');
	const [vehicleId, setVehicleId] = useState<string | null>(null);
	const [vehicleOpen, setVehicleOpen] = useState(false);
	const [title, setTitle] = useState('');
	const [description, setDescription] = useState('');
	const [incidentDate, setIncidentDate] = useState<string>(todayMmtDate());
	const [severity, setSeverity] = useState<IncidentSeverity>('medium');
	const [location, setLocation] = useState('');
	const [estCost, setEstCost] = useState('');
	const [personnel, setPersonnel] = useState<PersonnelOption[]>([]);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	const selectedPlate = vehicleSelectVehicle(vehicleId, vehicleOptions);
	// Dirty gate — a create starts from the blank defaults, so nothing is
	// submittable until the operator enters something. The vehicle picker's open
	// state is UI-only and excluded.
	const dirty = useFormDirty(
		{
			kind: 'incident' as IncidentKind,
			vehicleId: null,
			title: '',
			description: '',
			incidentDate: todayMmtDate(),
			severity: 'medium' as IncidentSeverity,
			location: '',
			estCost: '',
			personnel: [] as PersonnelOption[],
		},
		{ kind, vehicleId, title, description, incidentDate, severity, location, estCost, personnel },
	);
	const canSubmit = (kind === 'accident' || kind === 'incident') && title.trim().length > 0 && dirty;

	const submit = async () => {
		if (!canSubmit || !submitGuard.begin()) return;
		setSubmitting(true);
		setError(null);
		try {
			const me = await fetchCurrentEmployee();
			if (!me) throw new Error('No employee account is linked to this session — ask your admin to link it.');
			const cost = Number.parseFloat(estCost.replace(/[, ]/g, ''));
			await createIncident({
				vehicle: vehicleId ?? undefined,
				kind,
				reported_by: me.id,
				title: title.trim(),
				...(description.trim() ? { description: description.trim() } : {}),
				...{ incident_date: incidentDate || undefined },
				severity,
				...(location.trim() ? { location: location.trim() } : {}),
				...(Number.isFinite(cost) && estCost.trim() !== '' ? { est_cost: cost } : {}),
				...(personnel.length > 0 ? { personnel: personnel.map((person) => person.id) } : {}),
			});
			void queryClient.invalidateQueries({ queryKey: incidentsListKey, refetchType: 'active' });
			// The created truck's per-truck record feed too — a re-open right after
			// saving must show the new record (not the pre-create file).
			if (vehicleId) void queryClient.invalidateQueries({ queryKey: qk.truck(vehicleId), refetchType: 'active' });
			notifySaved('Incident recorded');
			popBack(navigate, '/app/incidents');
		} catch (err) {
			console.error('[incidents] create failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this record — try again.");
			setSubmitting(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	// The vehicle picker sheet covers the native MainButton — tuck it away for
	// the picker's lifetime (the in-page fallback is disabled instead).
	const isMainButton = useTelegramMainButton({
		text: submitting ? 'Saving…' : 'Save record',
		onClick: () => void submit(),
		visible: !vehicleOpen,
		disabled: !canSubmit || submitting,
		loading: submitting,
	});

	return (
		<ModuleShell title="Log accident / incident" backTo="/app/incidents">
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{/* 1 — Kind — Accident / Incident segmented toggle. */}
				<section>
					<FormField label="Type" group>
						{() => (
							<div className="grid grid-cols-2 gap-2">
								{(['accident', 'incident'] as const).map((value) => (
									<button
										key={value}
										type="button"
										aria-pressed={kind === value}
										onClick={() => setKind(value)}
										className={`rounded-xl border px-3 py-2.5 text-sm font-semibold leading-myanmar ${
											kind === value ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
										}`}
									>
										{value === 'accident' ? 'Accident' : 'Incident'}
									</button>
								))}
							</div>
						)}
					</FormField>
				</section>

				{/* 2 — Vehicle (optional) — picker over the shared fleet directory. */}
				<section>
					{/* Composite picker → a GROUP caption; the clear control is a sibling of the
					    picker button (nested buttons are invalid HTML). */}
					<FormField label="Vehicle (optional)" group>
						{() => (
							<>
								<div className={`flex w-full items-center gap-2 ${fieldClass}`}>
									<button
										type="button"
										onClick={() => setVehicleOpen(true)}
										className={`min-w-0 flex-1 truncate text-left ${selectedPlate ? 'text-foreground' : 'text-muted-foreground'}`}
									>
										{selectedPlate ?? 'Select a truck…'}
									</button>
									{vehicleId ? (
										<button
											type="button"
											aria-label="Clear vehicle"
											onClick={() => setVehicleId(null)}
											className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
										>
											<X className="size-4" aria-hidden />
										</button>
									) : (
										<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
									)}
								</div>
								<VehiclePickerSheet
									open={vehicleOpen}
									onOpenChange={setVehicleOpen}
									selectedId={vehicleId}
									onSelect={(id) => {
										setVehicleId(id);
										setVehicleOpen(false);
									}}
								/>
							</>
						)}
					</FormField>
				</section>

				{/* 3 — Title + description. */}
				<section>
					<FormField label="Title">
						{(f) => (
							<Input
								{...f}
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								placeholder="e.g. — Rear bumper scrape on gate exit"
								className={fieldClass}
							/>
						)}
					</FormField>
				</section>
				<section>
					<FormField label="Description">
						{(f) => (
							<Textarea
								{...f}
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								rows={3}
								placeholder="What happened…"
								className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
							/>
						)}
					</FormField>
				</section>

				{/* 4 — Date + severity + location + estimated cost. */}
				<section className="grid grid-cols-2 gap-3">
					<FormField label="Date">
						{(_f, h) => <DateField value={incidentDate} onChange={setIncidentDate} ariaLabel={h.ariaLabel} className={fieldClass} />}
					</FormField>
					<FormField label="Estimated cost">
						{(f) => (
							<Input
								{...f}
								inputMode="numeric"
								value={estCost}
								onChange={(e) => setEstCost(e.target.value)}
								placeholder="0"
								className={fieldClass}
							/>
						)}
					</FormField>
				</section>
				<section>
					<FormField label="Severity" group>
						{() => (
							<div className="grid grid-cols-3 gap-2">
								{(['high', 'medium', 'low'] as const).map((value) => (
									<button
										key={value}
										type="button"
										aria-pressed={severity === value}
										onClick={() => setSeverity(value)}
										className={`rounded-xl border px-2 py-2 text-sm font-semibold leading-myanmar ${
											severity === value ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
										}`}
									>
										{SEVERITY_META[value].label}
									</button>
								))}
							</div>
						)}
					</FormField>
				</section>
				<section>
					<FormField label="Location">
						{(f) => (
							<Input
								{...f}
								value={location}
								onChange={(e) => setLocation(e.target.value)}
								placeholder="Where it happened"
								className={fieldClass}
							/>
						)}
					</FormField>
				</section>

				{/* Personnel — the crew m2m (driver, conductor, others involved). */}
				<section>
					<FormField label="Personnel" group>
						{() => <PersonnelField value={personnel} onChange={setPersonnel} disabled={submitting} />}
					</FormField>
				</section>

				<FormError error={error} />

				<FormSubmitBar
					label="Save record"
					isMainButton={isMainButton}
					disabled={!canSubmit}
					submitting={submitting}
					wrapClassName="pb-safe pt-1"
					onSubmit={() => void submit()}
				/>
			</div>
		</ModuleShell>
	);
}

/** Resolve the builder input (`vehicleId`) back to its plate label. */
function vehicleSelectVehicle(vehicleId: string | null, options: Array<{ id: string; plate_no?: string | null }>): string | null {
	if (!vehicleId) return null;
	return options.find((o) => o.id === vehicleId)?.plate_no ?? null;
}

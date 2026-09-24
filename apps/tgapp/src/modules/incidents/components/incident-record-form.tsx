import { useEffect, useState } from 'react';
import { FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';

import { createIncident, personnelEntries, updateIncident } from '../data/api';
import { incidentsListKey, qk } from '../data/query-keys';
import { SEVERITY_META } from '../data/status';
import type { IncidentKind, IncidentRow, IncidentSeverity } from '../data/types';
import { PersonnelField } from './personnel-field';
import { fetchCurrentEmployee } from '@/modules/attendance/data/api';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import type { PersonnelOption } from '@/shared/components/personnel-picker-sheet';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { todayMmtDate } from '@/shared/time/myanmar';

/** The input field style — the incident create-page vocabulary. */

/** `YYYY-MM-DD` (or `''` for "not set") from a stored date value — the DateField
 *  contract. A full timestamp is narrowed to its date part. */
function dateValueOf(value: string | null | undefined): string {
	const match = value?.trim().match(/^\d{4}-\d{2}-\d{2}/);
	return match ? match[0] : '';
}

/** The stored cost as plain number text for the input (separators dropped). */
function costValueOf(value: string | number | null | undefined): string {
	if (value == null || value === '') return '';
	const amount = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
	return Number.isFinite(amount) ? String(amount) : '';
}

/** The stored crew projected onto the picker's option shape (id + display identity). */
function personnelOptionsOf(rows: IncidentRow['personnel']): PersonnelOption[] {
	return personnelEntries(rows).map((person) => ({ id: person.id, name: person.name, photo: person.photo }));
}

/** The record's owning `veh_fleets` id — the truck feed to refresh after an edit. */
export function vehicleIdOfRecord(record: IncidentRow | null | undefined): string | null {
	const vehicle = record?.vehicle;
	if (vehicle && typeof vehicle === 'object') return vehicle.id ?? null;
	if (typeof vehicle === 'string' && vehicle) return vehicle;
	return null;
}

interface IncidentRecordFormProps {
	/** CREATE mode — the truck the new record is bound to (the per-truck page). */
	vehicleId?: string;
	/** EDIT mode — the existing record, RAW (see `fetchIncidentRecord`). Passing it
	 *  switches the form from "create for this truck" to "update this record". */
	record?: IncidentRow;
	/** Called after a successful write — the page decides where to go next. */
	onSaved: () => void;
	/** Use the Telegram native MainButton as the submit affordance. Default true;
	 *  the per-truck page passes false — its own BottomActionBar owns the bottom
	 *  edge, so a native button would overlap it. */
	nativeSubmit?: boolean;
}

/**
 * ONE accident/incident record form — the create AND edit surface for a
 * `veh_incidents` row:
 *
 *  - CREATE (`vehicleId`, the per-truck page `/app/incidents/vehicle/:id`): a NEW record
 *    for THAT truck (the vehicle is fixed). The reporter is not collected — it
 *    resolves to the CURRENT logged-in employee at submit.
 *  - EDIT (`record`, the record screen `/app/incidents/record/:id`): the SAME
 *    fields prefilled from the stored row and written back as an update. The
 *    owning vehicle and the original reporter are never reassigned.
 *
 * Fields mirror the `veh_incidents` schema: Type (Accident | Incident) · Title ·
 * Description · Date (MMT calendar) · Severity · Location · Estimated cost ·
 * Personnel (the crew `personnel` m2m). Every save invalidates the incidents
 * register AND the owning truck's record feed before handing back to the page.
 */
export function IncidentRecordForm({ vehicleId, record, onSaved, nativeSubmit = true }: IncidentRecordFormProps) {
	const queryClient = useQueryClient();
	const editing = record != null;

	const [kind, setKind] = useState<IncidentKind>(record?.kind ?? 'incident');
	const [title, setTitle] = useState(record?.title ?? '');
	const [description, setDescription] = useState(record?.description ?? '');
	const [incidentDate, setIncidentDate] = useState(record ? dateValueOf(record.incident_date) : todayMmtDate());
	const [severity, setSeverity] = useState<IncidentSeverity>(record?.severity ?? 'medium');
	const [location, setLocation] = useState(record?.location ?? '');
	const [estCost, setEstCost] = useState(record ? costValueOf(record.est_cost) : '');
	const [personnel, setPersonnel] = useState<PersonnelOption[]>(() => personnelOptionsOf(record?.personnel));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — re-seed from a fresh row whenever the loaded row's identity
	// changes (TanStack v5 can serve a cached row while revalidating); create
	// mode has no `record` — the effect stays dormant.
	useEffect(() => {
		if (!editing || !record) return;
		setKind(record.kind ?? 'incident');
		setTitle(record.title ?? '');
		setDescription(record.description ?? '');
		setIncidentDate(dateValueOf(record.incident_date));
		setSeverity(record.severity ?? 'medium');
		setLocation(record.location ?? '');
		setEstCost(costValueOf(record.est_cost));
		setPersonnel(personnelOptionsOf(record.personnel));
		setError(null);
	}, [record]);

	// Dirty gate — baseline mirrors the `useState` seeders above (same
	// `dateValueOf` / `costValueOf` / `personnelOptionsOf` helpers), so an
	// untouched incident cannot be re-saved.
	const dirty = useFormDirty(
		{
			kind: record?.kind ?? 'incident',
			title: record?.title ?? '',
			description: record?.description ?? '',
			incidentDate: record ? dateValueOf(record.incident_date) : todayMmtDate(),
			severity: record?.severity ?? 'medium',
			location: record?.location ?? '',
			estCost: record ? costValueOf(record.est_cost) : '',
			personnel: personnelOptionsOf(record?.personnel),
		},
		{ kind, title, description, incidentDate, severity, location, estCost, personnel },
	);

	const canSave = !saving && title.trim().length > 0 && dirty;

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		setSaving(true);
		setError(null);
		try {
			const cost = Number.parseFloat(estCost.replace(/[, ]/g, ''));
			const hasCost = Number.isFinite(cost) && estCost.trim() !== '';

			if (record) {
				// EDIT — the record's own columns only; the vehicle and the original
				// reporter stay untouched. Cleared fields are written as null. The crew is
				// replaced with the picked set (an empty pick clears the junctions).
				await updateIncident(record.id, {
					kind,
					title: title.trim(),
					description: description.trim() || null,
					incident_date: incidentDate || null,
					severity,
					location: location.trim() || null,
					est_cost: hasCost ? cost : null,
					personnel: personnel.map((person) => person.id),
				});
			} else {
				const me = await fetchCurrentEmployee();
				if (!me) throw new Error('No employee account is linked to this session — ask your admin to link it.');
				await createIncident({
					vehicle: vehicleId,
					kind,
					reported_by: me.id,
					title: title.trim(),
					...(description.trim() ? { description: description.trim() } : {}),
					...(incidentDate ? { incident_date: incidentDate } : {}),
					severity,
					...(location.trim() ? { location: location.trim() } : {}),
					...(hasCost ? { est_cost: cost } : {}),
					...(personnel.length > 0 ? { personnel: personnel.map((person) => person.id) } : {}),
				});
			}

			// The register (the edited/new record's card) + the owning truck's feed.
			void queryClient.invalidateQueries({ queryKey: incidentsListKey, refetchType: 'active' });
			const truckId = vehicleId ?? vehicleIdOfRecord(record);
			if (truckId) void queryClient.invalidateQueries({ queryKey: qk.truck(truckId), refetchType: 'active' });

			if (!record) {
				setKind('incident');
				setTitle('');
				setDescription('');
				setIncidentDate(todayMmtDate());
				setSeverity('medium');
				setLocation('');
				setEstCost('');
				setPersonnel([]);
			}
			setSaving(false);
			onSaved();
		} catch (err) {
			console.error('[incidents] record save failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this record — try again.");
			setSaving(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	const isMainButton = useTelegramMainButton({
		text: saving ? 'Saving…' : editing ? 'Save changes' : 'Save record',
		onClick: () => void submit(),
		visible: nativeSubmit,
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
			{/* Type — Accident / Incident segmented toggle. */}
			<FormField label="Type" group>
				{() => (
					<div className="grid grid-cols-2 gap-2">
						{(['accident', 'incident'] as const).map((value) => (
							<button
								key={value}
								type="button"
								aria-pressed={kind === value}
								onClick={() => setKind(value)}
								disabled={saving}
								className={`rounded-xl border px-3 py-2.5 text-sm font-semibold leading-myanmar transition-colors duration-150 ${
									kind === value ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
								}`}
							>
								{value === 'accident' ? 'Accident' : 'Incident'}
							</button>
						))}
					</div>
				)}
			</FormField>

			{/* Title + description. */}
			<FormField label="Title">
				{(f) => (
					<Input
						{...f}
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="e.g. — Rear bumper scrape on gate exit"
						disabled={saving}
						className={fieldClass}
					/>
				)}
			</FormField>
			<FormField label="Description">
				{(f) => (
					<Textarea
						{...f}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						rows={3}
						placeholder="What happened…"
						disabled={saving}
						className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
					/>
				)}
			</FormField>

			{/* Date + estimated cost. */}
			<div className="grid grid-cols-1 gap-3">
				<FormField label="Date">
					{(_f, h) => (
						<DateField value={incidentDate} onChange={setIncidentDate} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />
					)}
				</FormField>
				<FormField label="Estimated cost">
					{(f) => (
						<Input
							{...f}
							inputMode="numeric"
							value={estCost}
							onChange={(e) => setEstCost(e.target.value)}
							placeholder="0"
							disabled={saving}
							className={fieldClass}
						/>
					)}
				</FormField>
			</div>

			{/* Severity. */}
			<FormField label="Severity" group>
				{() => (
					<div className="grid grid-cols-3 gap-2">
						{(['high', 'medium', 'low'] as const).map((value) => (
							<button
								key={value}
								type="button"
								aria-pressed={severity === value}
								onClick={() => setSeverity(value)}
								disabled={saving}
								className={`rounded-xl border px-2 py-2 text-sm font-semibold leading-myanmar transition-colors duration-150 ${
									severity === value ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
								}`}
							>
								{SEVERITY_META[value].label}
							</button>
						))}
					</div>
				)}
			</FormField>

			<FormField label="Location">
				{(f) => (
					<Input
						{...f}
						value={location}
						onChange={(e) => setLocation(e.target.value)}
						placeholder="Where it happened"
						disabled={saving}
						className={fieldClass}
					/>
				)}
			</FormField>

			{/* Personnel — the crew m2m (driver, conductor, others involved). */}
			<FormField label="Personnel" group>
				{() => <PersonnelField value={personnel} onChange={setPersonnel} disabled={saving} />}
			</FormField>

			<FormError error={error} />

			<FormSubmitBar
				label={editing ? 'Save changes' : 'Save record'}
				type="submit"
				isMainButton={isMainButton}
				disabled={!canSave}
				submitting={saving}
				icon={<Check className="size-4" aria-hidden />}
			/>
		</form>
	);
}

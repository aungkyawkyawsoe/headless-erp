import { useEffect, useState } from 'react';
import { FIELD_CLASS as fieldClass, PICKER_FIELD_CLASS as pickerFieldClass } from '@/shared/components/form-styles';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, X } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';

import { createMaintenanceLog, updateMaintenanceLog } from '../data/api';
import { maintenanceListKey, qk } from '../data/query-keys';
import { VENDOR_TYPE_META } from '../data/status';
import type { MaintenanceLogRow, VendorType } from '../data/types';
import { IssueTypeField } from './issue-type-field';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { PersonnelPickerSheet, type PersonnelOption } from '@/shared/components/personnel-picker-sheet';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { todayMmtDate } from '@/shared/time/myanmar';

/** A picker-type control: same skin as `fieldClass` but laid out as one row, so the
 *  value and its clear/chevron affordance sit side by side (mirrors `IssueTypeField`). */

/** `YYYY-MM-DD` (or `''`) from a stored date — the DateField contract. */
function dateValueOf(value: string | null | undefined): string {
	const match = value?.trim().match(/^\d{4}-\d{2}-\d{2}/);
	return match ? match[0] : '';
}

/** The stored cost as plain number text for the input (separators dropped). */
function costValueOf(value: number | string | null | undefined): string {
	if (value == null || value === '') return '';
	const amount = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
	return Number.isFinite(amount) ? String(amount) : '';
}

/** Parse a cost input → a finite number, else null (blank / garbage). */
function parseCost(text: string): number | null {
	const amount = Number.parseFloat(text.replace(/[, ]/g, ''));
	return Number.isFinite(amount) && text.trim() !== '' ? amount : null;
}

/** The record's owning `veh_fleets` id (from an expanded or bare `fleet`). */
export function vehicleIdOfLog(record: MaintenanceLogRow | null | undefined): string | null {
	const fleet = record?.fleet;
	if (fleet && typeof fleet === 'object') return fleet.id ?? null;
	if (typeof fleet === 'string' && fleet) return fleet;
	return null;
}

/** The record's cited job id (expanded or bare `issues_type`). */
function issueTypeIdOf(record: MaintenanceLogRow | null | undefined): string | null {
	const issue = record?.issues_type;
	if (issue && typeof issue === 'object') return issue.id ?? null;
	if (typeof issue === 'string' && issue) return issue;
	return null;
}

/** The record's cited job display name — the expanded row's English (Burmese
 *  fallback). Lets the edit form label a bound job before its catalog loads. */
function issueTypeLabelOf(record: MaintenanceLogRow | null | undefined): string | null {
	const issue = record?.issues_type;
	if (issue && typeof issue === 'object') return issue.name_en?.trim() || issue.name_mm?.trim() || null;
	return null;
}

/** The record's driver as a picker option — the expanded `hrm_employees` row's
 *  display name. Null for a bare id (unexpanded) or a nameless row. */
function driverOptionOf(record: MaintenanceLogRow | null | undefined): PersonnelOption | null {
	const person = record?.driver;
	if (person && typeof person === 'object') {
		const name = person.name_en?.trim() || person.name_mm?.trim();
		if (person.id && name) return { id: person.id, name, photo: null };
	}
	return null;
}

/** The `hrm_designations.name` fragment that marks a driver — matches BOTH
 *  “Driver” and “Ferry Driver”, so the driver field never offers a non-driver.
 *  (One source for the rule; the picker resolves it server-side.) */
const DRIVER_DESIGNATION = 'driver';

/** The driver picker row — the form's control look, opening the shared
 *  single-select person sheet (the same search-first directory lookup the
 *  incident crew picker uses, so a 200+ row directory is never walked). */
function DriverField({
	value,
	onChange,
	disabled,
	onOpenChange,
}: {
	value: PersonnelOption | null;
	onChange: (next: PersonnelOption | null) => void;
	disabled: boolean;
	/** Reports the sheet's open state to the form so the native MainButton can be
	 *  tucked away while the sheet covers it. */
	onOpenChange?: (open: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const setSheetOpen = (next: boolean) => {
		setOpen(next);
		onOpenChange?.(next);
	};
	return (
		<>
			<div className={pickerFieldClass}>
				<button
					type="button"
					onClick={() => setSheetOpen(true)}
					disabled={disabled}
					className="flex min-w-0 flex-1 items-center self-stretch text-left outline-none disabled:opacity-60"
				>
					<span className={`truncate ${value ? 'text-foreground' : 'text-muted-foreground'}`}>{value?.name ?? 'Select a driver…'}</span>
				</button>
				{value ? (
					<button
						type="button"
						aria-label="Clear driver"
						disabled={disabled}
						onClick={() => onChange(null)}
						className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-60"
					>
						<X className="size-4" aria-hidden />
					</button>
				) : (
					<button
						type="button"
						aria-label="Select driver"
						disabled={disabled}
						onClick={() => setSheetOpen(true)}
						className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-60"
					>
						<ChevronDown className="size-4" aria-hidden />
					</button>
				)}
			</div>
			<PersonnelPickerSheet
				open={open}
				onOpenChange={setSheetOpen}
				value={value ? [value] : []}
				onToggle={onChange}
				singleSelect
				designationFilter={DRIVER_DESIGNATION}
				title="Select the driver"
			/>
		</>
	);
}

interface MaintenanceLogFormProps {
	/** CREATE mode — the truck the new log is bound to. */
	vehicleId?: string;
	/** CREATE mode — the vehicle's current odometer (passed by the page after fetching). */
	initialOdo?: number | null;
	/** EDIT mode — the existing RAW log (`fetchMaintenanceLog`). Passing it switches
	 *  the form to "update this log"; the owning truck is never reassigned. */
	record?: MaintenanceLogRow;
	/** Called after a successful write — the page decides where to go next. */
	onSaved: () => void;
	/** Hide the native MainButton — e.g. while the page's vehicle picker sheet
	 *  covers the submit affordance (the in-page fallback is disabled instead). */
	hideMainButton?: boolean;
}

/**
 * ONE maintenance log form — the create AND edit surface for a
 * `veh_maintenance_logs` row:
 *
 *  - CREATE (`vehicleId`): a new job for THAT truck (the fleet is fixed).
 *  - EDIT (`record`): the SAME fields prefilled and written back as an update.
 *
 * Fields mirror the collection: Job (`veh_issue_types`) · Started · Ended · Odo ·
 * Parts cost · Labor cost · Vendor · Technician · Note. The TOTAL is shown as a
 * live read-only preview of the engine's stored formula (parts + labor) — it is
 * never submitted; the engine recomputes it on write.
 */
/** Extract the vehicle's current odometer from an expanded fleet row. */
function currentOdoOf(record: MaintenanceLogRow | null | undefined): number | null {
	const fleet = record?.fleet;
	if (fleet && typeof fleet === 'object') return fleet.last_odo ?? null;
	return null;
}

/** Initial odometer value: vehicle's current odo for new logs (from prop), or vehicle's current odo for edits (not the log's stored odo). */
function computeInitialOdo(
	record: MaintenanceLogRow | undefined,
	_vehicleId: string | undefined,
	initialOdoProp: number | null | undefined,
): string {
	if (record) {
		const currentOdo = currentOdoOf(record);
		if (currentOdo != null) return String(currentOdo);
		return record.odo != null ? String(record.odo) : '';
	}
	// Create mode — use the prop passed by the page
	if (initialOdoProp != null) return String(initialOdoProp);
	return '';
}

export function MaintenanceLogForm({ vehicleId, record, initialOdo, onSaved, hideMainButton = false }: MaintenanceLogFormProps) {
	const queryClient = useQueryClient();
	const editing = record != null;

	const [issueTypeId, setIssueTypeId] = useState<string | null>(() => issueTypeIdOf(record));
	const [startedAt, setStartedAt] = useState(record ? dateValueOf(record.started_at) : todayMmtDate());
	const [endAt, setEndAt] = useState(record ? dateValueOf(record.end_at) : '');
	const [odo, setOdo] = useState(() => computeInitialOdo(record, vehicleId, initialOdo));
	const [partsCost, setPartsCost] = useState(costValueOf(record?.parts_cost));
	const [laborCost, setLaborCost] = useState(costValueOf(record?.labor_cost));
	const [vendorType, setVendorType] = useState<VendorType>(record?.vendor_type ?? 'in_house');
	const [driver, setDriver] = useState<PersonnelOption | null>(() => driverOptionOf(record));
	const [technician, setTechnician] = useState(record?.technician ?? '');
	const [note, setNote] = useState(record?.note ?? '');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The driver sheet covers the bottom edge — the native MainButton must go with
	// it (the page's vehicle sheet does the same through `hideMainButton`).
	const [driverSheetOpen, setDriverSheetOpen] = useState(false);
	const submitGuard = useSubmitGuard();

	// Edit mode — re-seed from a fresh row whenever the loaded row's identity
	// changes (TanStack v5 can serve a cached row while revalidating); create
	// mode has no `record` — the effect stays dormant.
	useEffect(() => {
		if (!editing || !record) return;
		setIssueTypeId(issueTypeIdOf(record));
		setStartedAt(dateValueOf(record.started_at));
		setEndAt(dateValueOf(record.end_at));
		const currentOdo = currentOdoOf(record);
		setOdo(currentOdo != null ? String(currentOdo) : record.odo != null ? String(record.odo) : '');
		setPartsCost(costValueOf(record.parts_cost));
		setLaborCost(costValueOf(record.labor_cost));
		setVendorType(record.vendor_type ?? 'in_house');
		setDriver(driverOptionOf(record));
		setTechnician(record.technician ?? '');
		setNote(record.note ?? '');
		setError(null);
	}, [record]);

	// Create mode — update odometer when the vehicle's current odo becomes available
	// (e.g. user picks a different truck via the picker).
	useEffect(() => {
		if (editing || !initialOdo) return;
		setOdo(String(initialOdo));
	}, [initialOdo, editing]);

	const parts = parseCost(partsCost);
	const labor = parseCost(laborCost);
	const total = (parts ?? 0) + (labor ?? 0);
	const totalLabel = total > 0 ? `MMK ${total.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—';

	// Real-time date validation — end date must not be before start date.
	const dateError = endAt !== '' && startedAt !== '' && endAt < startedAt ? 'End date cannot be earlier than start date' : null;

	// Dirty gate — baseline mirrors the `useState` seeders above (reusing the same
	// `issueTypeIdOf` / `dateValueOf` / `costValueOf` / `driverOptionOf` helpers),
	// so an untouched log cannot be re-saved.
	const dirty = useFormDirty(
		{
			issueTypeId: issueTypeIdOf(record),
			startedAt: record ? dateValueOf(record.started_at) : todayMmtDate(),
			endAt: record ? dateValueOf(record.end_at) : '',
			odo: computeInitialOdo(record, vehicleId, initialOdo),
			partsCost: costValueOf(record?.parts_cost),
			laborCost: costValueOf(record?.labor_cost),
			vendorType: record?.vendor_type ?? 'in_house',
			driver: driverOptionOf(record),
			technician: record?.technician ?? '',
			note: record?.note ?? '',
		},
		{ issueTypeId, startedAt, endAt, odo, partsCost, laborCost, vendorType, driver, technician, note },
	);

	const canSave = !saving && issueTypeId != null && startedAt !== '' && dirty && !dateError;
	const boundVehicleId = vehicleId ?? vehicleIdOfLog(record);

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		if (!editing && !boundVehicleId) {
			setError('This truck is unknown — reopen it from the search.');
			submitGuard.end();
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const payload = {
				issues_type: issueTypeId,
				started_at: startedAt,
				end_at: endAt || null,
				odo: odo.trim() || null,
				parts_cost: parts,
				labor_cost: labor,
				vendor_type: vendorType,
				technician: technician.trim() || null,
				note: note.trim() || null,
				driver: driver?.id ?? null,
			};
			if (record) {
				await updateMaintenanceLog(record.id, payload);
			} else {
				await createMaintenanceLog({ fleet: boundVehicleId as string, ...payload });
			}

			// The register + the owning truck's feed refresh before the page returns.
			void queryClient.invalidateQueries({ queryKey: maintenanceListKey, refetchType: 'active' });
			if (boundVehicleId) void queryClient.invalidateQueries({ queryKey: qk.truck(boundVehicleId), refetchType: 'active' });

			if (!record) {
				setIssueTypeId(null);
				setStartedAt(todayMmtDate());
				setEndAt('');
				setOdo('');
				setPartsCost('');
				setLaborCost('');
				setVendorType('in_house');
				setDriver(null);
				setTechnician('');
				setNote('');
			}
			setSaving(false);
			onSaved();
		} catch (err) {
			console.error('[maintenances] log save failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this log — try again.");
			setSaving(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	// Hidden while the page's vehicle picker sheet OR this form's driver sheet is
	// open — a bottom sheet covers the native button.
	const isMainButton = useTelegramMainButton({
		text: saving ? 'Saving…' : editing ? 'Save changes' : 'Save log',
		onClick: () => void submit(),
		visible: !hideMainButton && !driverSheetOpen,
		disabled: !canSave,
		loading: saving,
	});

	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			{/* Job — the standard maintenance job this log cites. */}
			<FormField label="Job" group>
				{() => <IssueTypeField value={issueTypeId} onChange={setIssueTypeId} disabled={saving} fallbackLabel={issueTypeLabelOf(record)} />}
			</FormField>

			{/* Downtime window. */}
			<div className="grid grid-cols-1 gap-3">
				<FormField label="Started">
					{(_f, h) => (
						<DateField value={startedAt} onChange={setStartedAt} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />
					)}
				</FormField>
				<FormField label="Ended (optional)" error={dateError}>
					{(_f, h) => <DateField value={endAt} onChange={setEndAt} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />}
				</FormField>
			</div>

			{/* Odometer at the job. */}
			<FormField label="Odometer (optional)">
				{(f) => (
					<Input
						{...f}
						inputMode="numeric"
						value={odo}
						onChange={(event) => setOdo(event.target.value)}
						placeholder="e.g. 184500"
						disabled={saving}
						className={fieldClass}
					/>
				)}
			</FormField>

			{/* Parts + labour cost. */}
			<div className="grid grid-cols-2 gap-3">
				<FormField label="Parts cost">
					{(f) => (
						<Input
							{...f}
							inputMode="numeric"
							value={partsCost}
							onChange={(event) => setPartsCost(event.target.value)}
							placeholder="0"
							disabled={saving}
							className={fieldClass}
						/>
					)}
				</FormField>
				<FormField label="Labor cost">
					{(f) => (
						<Input
							{...f}
							inputMode="numeric"
							value={laborCost}
							onChange={(event) => setLaborCost(event.target.value)}
							placeholder="0"
							disabled={saving}
							className={fieldClass}
						/>
					)}
				</FormField>
			</div>
			<div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/40 px-3.5 py-2.5">
				<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total (auto)</span>
				<span className="text-sm font-extrabold tabular-nums text-foreground">{totalLabel}</span>
			</div>

			{/* Who did the job. */}
			<FormField label="Vendor" group>
				{() => (
					<div className="grid grid-cols-2 gap-2">
						{(['in_house', 'external'] as const).map((value) => (
							<button
								key={value}
								type="button"
								aria-pressed={vendorType === value}
								onClick={() => setVendorType(value)}
								disabled={saving}
								className={`rounded-xl border px-3 py-2.5 text-sm font-semibold leading-myanmar transition-colors duration-150 ${
									vendorType === value ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
								}`}
							>
								{VENDOR_TYPE_META[value].label}
							</button>
						))}
					</div>
				)}
			</FormField>

			<FormField label="Driver (optional)" group>
				{() => <DriverField value={driver} onChange={setDriver} disabled={saving} onOpenChange={setDriverSheetOpen} />}
			</FormField>

			<FormField label="Technician (optional)">
				{(f) => (
					<Input
						{...f}
						value={technician}
						onChange={(event) => setTechnician(event.target.value)}
						placeholder="Who performed the job"
						disabled={saving}
						className={fieldClass}
					/>
				)}
			</FormField>

			<FormField label="Note (optional)">
				{(f) => (
					<Textarea
						{...f}
						value={note}
						onChange={(event) => setNote(event.target.value)}
						rows={3}
						placeholder="Work done, parts replaced…"
						disabled={saving}
						className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
					/>
				)}
			</FormField>

			<FormError error={error} />

			<FormSubmitBar
				label={editing ? 'Save changes' : 'Save log'}
				type="submit"
				isMainButton={isMainButton}
				disabled={!canSave}
				submitting={saving}
				icon={<Check className="size-4" aria-hidden />}
			/>
		</form>
	);
}

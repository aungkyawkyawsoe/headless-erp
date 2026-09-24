import { useMemo, useState } from 'react';
import { FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@mmbix/design-system/input';
import { ChevronDown, X } from 'lucide-react';

import { createPermit } from '../data/api';
import { qk } from '../data/query-keys';
import { useVehicleMasters } from '@/shared/lookups/hooks';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { ModuleShell } from '@/shared/components/module-shell';
import { VehiclePickerSheet } from '@/shared/components/vehicle-picker-sheet';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';
import { todayMmtDate } from '@/shared/time/myanmar';

/**
 * Add a license — the real `veh_permits` create form (`/app/licenses/+`), in
 * the SAME anatomy as the incident/record form: one engine-native POST bound to
 * the `veh_fleets` plate directory via the picker sheet. All labels are English
 * across the ops UI.
 */
export default function LicenseCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const vehicles = useVehicleMasters();
	const vehicleOptions = useMemo(
		() =>
			(vehicles.data ?? [])
				.filter((vehicle) => vehicle.plate_no?.trim())
				.sort((a, b) => (a.plate_no as string).localeCompare(b.plate_no as string)),
		[vehicles.data],
	);

	const [vehicleId, setVehicleId] = useState<string | null>(null);
	const [vehicleOpen, setVehicleOpen] = useState(false);
	const [licenseNo, setLicenseNo] = useState('');
	const [place, setPlace] = useState('');
	const [issueDate, setIssueDate] = useState<string>(todayMmtDate());
	const [expiryDate, setExpiryDate] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	const selectedPlate = vehicleOptions.find((o) => o.id === vehicleId)?.plate_no ?? null;
	// Dirty gate — a create starts blank, so an untouched form cannot be submitted
	// even once a vehicle is chosen. The picker's open state is UI-only.
	const dirty = useFormDirty(
		{ vehicleId: null, licenseNo: '', place: '', issueDate: todayMmtDate(), expiryDate: '' },
		{ vehicleId, licenseNo, place, issueDate, expiryDate },
	);
	const canSubmit = !!vehicleId && dirty;

	const submit = async () => {
		if (!canSubmit || !submitGuard.begin()) return;
		setSubmitting(true);
		setError(null);
		try {
			await createPermit({
				vehicle: vehicleId as string,
				...(licenseNo.trim() ? { license_no: licenseNo.trim() } : {}),
				...(place.trim() ? { place: place.trim() } : {}),
				...(issueDate ? { issue_date: issueDate } : {}),
				...(expiryDate ? { expiry_date: expiryDate } : {}),
			});
			void queryClient.invalidateQueries({ queryKey: qk.licenses(), refetchType: 'active' });
			// The created truck's per-truck history feed too — a re-open right after
			// saving must show the new policy (not the pre-create file).
			if (vehicleId) void queryClient.invalidateQueries({ queryKey: qk.truck(vehicleId), refetchType: 'active' });
			notifySaved('License saved');
			popBack(navigate, '/app/licenses');
		} catch (err) {
			console.error('[licenses] create failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this license — try again.");
			setSubmitting(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	// Tucked away while the vehicle picker sheet is open so it cannot be tapped
	// behind the sheet's backdrop.
	const isMainButton = useTelegramMainButton({
		text: submitting ? 'Saving…' : 'Save license',
		onClick: () => void submit(),
		visible: !vehicleOpen,
		disabled: !canSubmit,
		loading: submitting,
	});

	return (
		<ModuleShell title="Add license" backTo="/app/licenses">
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{/* Vehicle (required) — picker over the shared fleet directory. */}
				<section>
					{/* A composite picker (not one input), so the caption is wired as a
					    GROUP label — an `htmlFor` would point at nothing. */}
					<FormField label="Vehicle" required group>
						{() => (
							<>
								{/* The row is a div with a DISPLAY button + a separate clear button:
								    nesting the clear <button> inside the picker <button> is invalid
								    HTML and made activation unreliable (it relied on
								    stopPropagation). */}
								<div className={`flex w-full items-center gap-2 ${fieldClass}`}>
									<button
										type="button"
										onClick={() => setVehicleOpen(true)}
										className={`min-w-0 flex-1 truncate text-left ${selectedPlate ? 'text-foreground' : 'text-muted-foreground'}`}
									>
										{selectedPlate ?? 'Select a vehicle…'}
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

				{/* License number + issuing place. */}
				<section>
					<FormField label="License no">
						{(f) => (
							<Input
								{...f}
								value={licenseNo}
								onChange={(e) => setLicenseNo(e.target.value)}
								placeholder="e.g. YGN/2026/118"
								className={fieldClass}
							/>
						)}
					</FormField>
				</section>
				<section>
					<FormField label="Issued place">
						{(f) => (
							<Input {...f} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Yangon" className={fieldClass} />
						)}
					</FormField>
				</section>

				{/* Issue + expiry dates. */}
				<section className="grid grid-cols-2 gap-3">
					<FormField label="Issue date">
						{(_f, h) => <DateField value={issueDate} onChange={setIssueDate} ariaLabel={h.ariaLabel} className={fieldClass} />}
					</FormField>
					<FormField label="Expiry date">
						{(_f, h) => <DateField value={expiryDate} onChange={setExpiryDate} ariaLabel={h.ariaLabel} className={fieldClass} />}
					</FormField>
				</section>

				<FormError error={error} />

				<FormSubmitBar
					label="Save license"
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

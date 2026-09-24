import { useMemo, useState } from 'react';
import { FIELD_CLASS as fieldClass, NOTE_CLASS as noteClass } from '@/shared/components/form-styles';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';
import { ChevronDown, X } from 'lucide-react';

import { createPolicy } from '../data/api';
import { qk } from '../data/query-keys';
import { ProviderField } from '../components/provider-picker-sheet';
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

/** Parse a money input — undefined when blank, so an untouched field is never
 *  sent; non-finite text (impossible via `type=number`) is dropped too. */
function moneyOf(raw: string): number | undefined {
	const t = raw.trim();
	if (t === '') return undefined;
	const n = Number(t);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Add an insurance policy — the real `veh_insurances` create form
 * (`/app/insurances/+`), in the SAME anatomy as the license/record form: one
 * engine-native POST bound to a `veh_fleets` vehicle via the picker sheet, with
 * the full policy field set the `veh_insurances` schema ships — a Provider
 * BOTTOM-SHEET picker (required) · policy no · expiry date · premium amount ·
 * sum insured · windscreen cover · betterment · note. Every field is full width
 * except the two money terms, which read as one comparison and stay paired. All
 * labels are English across the ops UI.
 */
export default function InsuranceCreatePage() {
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
	const [provider, setProvider] = useState('');
	const [policyNo, setPolicyNo] = useState('');
	const [expiryDate, setExpiryDate] = useState('');
	const [premiumAmount, setPremiumAmount] = useState('');
	const [sumInsured, setSumInsured] = useState('');
	const [windscreenCover, setWindscreenCover] = useState('');
	const [betterment, setBetterment] = useState(false);
	const [note, setNote] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	const selectedPlate = vehicleOptions.find((o) => o.id === vehicleId)?.plate_no ?? null;
	// Dirty gate — an untouched create cannot be submitted even with a vehicle
	// chosen. The picker's open state is UI-only and excluded.
	const dirty = useFormDirty(
		{
			vehicleId: null,
			provider: '',
			policyNo: '',
			expiryDate: '',
			premiumAmount: '',
			sumInsured: '',
			windscreenCover: '',
			betterment: false,
			note: '',
		},
		{ vehicleId, provider, policyNo, expiryDate, premiumAmount, sumInsured, windscreenCover, betterment, note },
	);
	// The vehicle AND a provider are required (the backend `provider` select is a
	// required column).
	const canSubmit = !!vehicleId && provider !== '' && dirty;

	const submit = async () => {
		if (!canSubmit || !submitGuard.begin()) return;
		setSubmitting(true);
		setError(null);
		try {
			const premium = moneyOf(premiumAmount);
			const sumInsuredN = moneyOf(sumInsured);
			const windscreen = moneyOf(windscreenCover);
			await createPolicy({
				vehicle: vehicleId as string,
				provider,
				...(policyNo.trim() ? { policy_no: policyNo.trim() } : {}),
				...(expiryDate ? { expiry_date: expiryDate } : {}),
				betterment,
				...(premium != null ? { premium_amount: premium } : {}),
				...(sumInsuredN != null ? { sum_insured: sumInsuredN } : {}),
				...(windscreen != null ? { windscreen_cover: windscreen } : {}),
				...(note.trim() ? { note: note.trim() } : {}),
			});
			void queryClient.invalidateQueries({ queryKey: qk.insurances(), refetchType: 'active' });
			// The created truck's per-truck history feed too — a re-open right after
			// saving must show the new policy (not the pre-create file).
			if (vehicleId) void queryClient.invalidateQueries({ queryKey: qk.truck(vehicleId), refetchType: 'active' });
			notifySaved('Policy saved');
			popBack(navigate, '/app/insurances');
		} catch (err) {
			console.error('[insurances] create failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this policy — try again.");
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
		text: submitting ? 'Saving…' : 'Save policy',
		onClick: () => void submit(),
		visible: !vehicleOpen,
		disabled: !canSubmit,
		loading: submitting,
	});

	return (
		<ModuleShell title="Add policy" backTo="/app/insurances">
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{/* Vehicle (required) — picker over the shared fleet directory. */}
				<section>
					{/* A composite picker (not one input): the caption is wired as a GROUP
					    label, and the clear control is a SIBLING of the picker button rather
					    than nested inside it (nested buttons are invalid HTML). */}
					<FormField label="Vehicle" required group>
						{() => (
							<>
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

				{/* Provider — the BOTTOM-SHEET picker over the insurers the backend
					`provider` select declares; a choice is required before the policy
					can save. */}
				<section>
					<FormField label="Provider" required group>
						{(_f, h) => <ProviderField provider={provider} onProviderChange={setProvider} disabled={submitting} ariaLabel={h.ariaLabel} />}
					</FormField>
				</section>
				<section>
					<FormField label="Policy no">
						{(f) => (
							<Input
								{...f}
								value={policyNo}
								onChange={(e) => setPolicyNo(e.target.value)}
								placeholder="e.g. AYA/YGN/118"
								className={fieldClass}
							/>
						)}
					</FormField>
				</section>
				<section>
					<FormField label="Expiry date">
						{(_f, h) => <DateField value={expiryDate} onChange={setExpiryDate} ariaLabel={h.ariaLabel} className={fieldClass} />}
					</FormField>
				</section>

				{/* The two money terms read as ONE comparison, so they stay paired. */}
				<section className="grid grid-cols-2 gap-3">
					<FormField label="Premium amount">
						{(f) => (
							<Input
								{...f}
								type="number"
								inputMode="numeric"
								min={0}
								step="any"
								value={premiumAmount}
								onChange={(e) => setPremiumAmount(e.target.value)}
								placeholder="Ks"
								className={fieldClass}
							/>
						)}
					</FormField>
					<FormField label="Sum insured">
						{(f) => (
							<Input
								{...f}
								type="number"
								inputMode="numeric"
								min={0}
								step="any"
								value={sumInsured}
								onChange={(e) => setSumInsured(e.target.value)}
								placeholder="Ks"
								className={fieldClass}
							/>
						)}
					</FormField>
				</section>

				<section>
					<FormField label="Windscreen cover">
						{(f) => (
							<Input
								{...f}
								type="number"
								inputMode="numeric"
								min={0}
								step="any"
								value={windscreenCover}
								onChange={(e) => setWindscreenCover(e.target.value)}
								placeholder="Ks"
								className={fieldClass}
							/>
						)}
					</FormField>
				</section>

				<section>
					<FormField label="Betterment" group>
						{() => (
							<div className="grid h-11 grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
								{([false, true] as const).map((value) => (
									<button
										key={String(value)}
										type="button"
										aria-pressed={betterment === value}
										onClick={() => setBetterment(value)}
										className={`rounded-md px-2 text-sm font-semibold leading-myanmar transition-colors ${
											betterment === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground'
										}`}
									>
										{value ? 'Yes' : 'No'}
									</button>
								))}
							</div>
						)}
					</FormField>
				</section>

				<section>
					<FormField label="Note">
						{(f) => (
							<Textarea
								{...f}
								rows={3}
								value={note}
								onChange={(e) => setNote(e.target.value)}
								placeholder="Add a note..."
								disabled={submitting}
								className={noteClass}
							/>
						)}
					</FormField>
				</section>

				<FormError error={error} />

				<FormSubmitBar
					label="Save policy"
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

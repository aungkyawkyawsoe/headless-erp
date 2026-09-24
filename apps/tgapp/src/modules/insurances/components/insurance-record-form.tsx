import { useEffect, useState } from 'react';
import { FIELD_CLASS as fieldClass, NOTE_CLASS as noteClass } from '@/shared/components/form-styles';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Textarea } from '@mmbix/design-system/textarea';

import { createPolicy, updatePolicy } from '../data/api';
import { qk } from '../data/query-keys';
import { ProviderField } from './provider-picker-sheet';
import { DateField } from '@/shared/components/date-field';
import { FormField } from '@/shared/components/form-field';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';

/** The input field style — the policy create-page vocabulary. */

/** Parse a money input — undefined when blank, so an untouched field is never
 *  sent; null/NaN text (impossible via `type=number`) is dropped too. */
function moneyOf(raw: string): number | undefined {
	const t = raw.trim();
	if (t === '') return undefined;
	const n = Number(t);
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** The raw field values the form starts from when CORRECTING an existing policy
 *  (the create form starts blank). `id` is the row being updated. */
export interface InsuranceFormInitial {
	id: string;
	provider: string;
	policyNo: string;
	expiryDate: string;
	premiumAmount: string;
	sumInsured: string;
	windscreenCover: string;
	betterment: boolean;
	note: string;
}

/**
 * ONE truck's record form — the per-truck page's form-first view (`/app/insurances/:id`):
 * a NEW policy for THAT truck (the vehicle is fixed — it never rides the picker
 * the standalone `+` page uses). Fields (mirroring the `veh_insurances` schema —
 * no coverage anymore): Provider (a BOTTOM-SHEET picker over the declared
 * insurers + any providers already on this truck's file — required) · Policy no ·
 * Expiry date · Premium amount · Sum insured · Windscreen cover · Betterment ·
 * Note. Every field is FULL WIDTH except the two money terms, which read as one
 * comparison and stay paired. Every save writes a `veh_insurances` row bound to
 * the truck, then invalidates the truck's history feed AND the insurances
 * overview (the truck card's current line + pill refresh the moment the user
 * returns) before handing back to the page.
 *
 * When `initial` is set the SAME form corrects that policy in place (`updatePolicy`)
 * — the record-edit screen's only difference is the prefill + the update call, so
 * the fields can never drift between recording and correcting.
 */
export function InsuranceRecordForm({
	vehicleId,
	existingProviders = [],
	initial,
	onSaved,
	nativeSubmit = true,
}: {
	vehicleId: string;
	/** Provider labels already on this truck's policy file — the combo suggests
	 *  them beside the predefined insurers (so a legacy provider stays pickable). */
	existingProviders?: ReadonlyArray<string>;
	/** Set to CORRECT this policy (the vehicle's newest record) instead of creating. */
	initial?: InsuranceFormInitial;
	onSaved: () => void;
	/** Use the Telegram native MainButton as the submit affordance. Default true;
	 *  the per-truck page passes false — its own BottomActionBar owns the bottom
	 *  edge, so a native button would overlap it. */
	nativeSubmit?: boolean;
}) {
	const queryClient = useQueryClient();
	const editing = initial != null;

	const [provider, setProvider] = useState(initial?.provider ?? '');
	const [policyNo, setPolicyNo] = useState(initial?.policyNo ?? '');
	const [expiryDate, setExpiryDate] = useState(initial?.expiryDate ?? '');
	const [premiumAmount, setPremiumAmount] = useState(initial?.premiumAmount ?? '');
	const [sumInsured, setSumInsured] = useState(initial?.sumInsured ?? '');
	const [windscreenCover, setWindscreenCover] = useState(initial?.windscreenCover ?? '');
	const [betterment, setBetterment] = useState(initial?.betterment ?? false);
	const [note, setNote] = useState(initial?.note ?? '');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — re-seed from a fresh row whenever the loaded row's identity
	// changes (TanStack v5 can serve a cached row while revalidating); create
	// mode has no `initial` — the effect stays dormant.
	useEffect(() => {
		if (!editing || !initial) return;
		setProvider(initial.provider ?? '');
		setPolicyNo(initial.policyNo ?? '');
		setExpiryDate(initial.expiryDate ?? '');
		setPremiumAmount(initial.premiumAmount ?? '');
		setSumInsured(initial.sumInsured ?? '');
		setWindscreenCover(initial.windscreenCover ?? '');
		setBetterment(initial.betterment ?? false);
		setNote(initial.note ?? '');
		setError(null);
	}, [initial]);

	// Dirty gate — the baseline is the record being corrected (or the blank
	// defaults on create), so an untouched form cannot be submitted. The baseline
	// mirrors the `useState` initializers above one-for-one.
	const dirty = useFormDirty(
		{
			provider: initial?.provider ?? '',
			policyNo: initial?.policyNo ?? '',
			expiryDate: initial?.expiryDate ?? '',
			premiumAmount: initial?.premiumAmount ?? '',
			sumInsured: initial?.sumInsured ?? '',
			windscreenCover: initial?.windscreenCover ?? '',
			betterment: initial?.betterment ?? false,
			note: initial?.note ?? '',
		},
		{ provider, policyNo, expiryDate, premiumAmount, sumInsured, windscreenCover, betterment, note },
	);

	// The backend's `provider` select is REQUIRED — a policy can't save without
	// picking one of the predefined insurers. `dirty` keeps a no-op re-save from
	// being possible.
	const canSave = !saving && provider !== '' && dirty;

	const submit = async () => {
		if (!canSave || !submitGuard.begin()) return;
		setSaving(true);
		setError(null);
		try {
			const premium = moneyOf(premiumAmount);
			const sumInsuredN = moneyOf(sumInsured);
			const windscreen = moneyOf(windscreenCover);
			if (editing && initial) {
				await updatePolicy(initial.id, {
					provider,
					policy_no: policyNo.trim() || null,
					expiry_date: expiryDate || null,
					betterment,
					windscreen_cover: windscreen ?? null,
					premium_amount: premium ?? null,
					sum_insured: sumInsuredN ?? null,
					note: note.trim() || null,
				});
			} else {
				await createPolicy({
					vehicle: vehicleId,
					provider,
					...(policyNo.trim() ? { policy_no: policyNo.trim() } : {}),
					...(expiryDate ? { expiry_date: expiryDate } : {}),
					betterment,
					...(premium != null ? { premium_amount: premium } : {}),
					...(sumInsuredN != null ? { sum_insured: sumInsuredN } : {}),
					...(windscreen != null ? { windscreen_cover: windscreen } : {}),
					...(note.trim() ? { note: note.trim() } : {}),
				});
			}
			// The truck's history feed (new policy on top) + the insurances overview
			// (the truck card's current line + pill must flip to the new record).
			void queryClient.invalidateQueries({ queryKey: qk.truck(vehicleId), refetchType: 'active' });
			void queryClient.invalidateQueries({ queryKey: qk.current(vehicleId), refetchType: 'active' });
			void queryClient.invalidateQueries({ queryKey: qk.insurances(), refetchType: 'active' });
			if (initial) void queryClient.invalidateQueries({ queryKey: qk.record(initial.id), refetchType: 'active' });
			if (!editing) {
				setProvider('');
				setPolicyNo('');
				setExpiryDate('');
				setPremiumAmount('');
				setSumInsured('');
				setWindscreenCover('');
				setBetterment(false);
				setNote('');
			}
			setSaving(false);
			onSaved();
		} catch (err) {
			console.error('[insurances] truck record failed', err);
			setError(err instanceof Error && err.message ? err.message : "Couldn't save this policy — try again.");
			setSaving(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	const isMainButton = useTelegramMainButton({
		text: saving ? 'Saving…' : 'Save policy',
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
			{/* Provider — the bottom-sheet picker over the `veh_insurances.provider`
				select's declared insurers (+ this truck's existing ones); a choice is
				required before the form can save. */}
			<FormField label="Provider" required group>
				{(_f, h) => (
					<ProviderField
						provider={provider}
						onProviderChange={setProvider}
						existingProviders={existingProviders}
						disabled={saving}
						ariaLabel={h.ariaLabel}
					/>
				)}
			</FormField>

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

			<FormField label="Expiry date">
				{(_f, h) => (
					<DateField value={expiryDate} onChange={setExpiryDate} disabled={saving} ariaLabel={h.ariaLabel} className={fieldClass} />
				)}
			</FormField>

			{/* The two money terms read as ONE comparison, so they stay paired. */}
			<div className="grid grid-cols-2 gap-3">
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
			</div>

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

			<FormField label="Note">
				{(f) => (
					<Textarea
						{...f}
						rows={3}
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="Add a note..."
						disabled={saving}
						className={noteClass}
					/>
				)}
			</FormField>

			<FormError error={error} />

			<FormSubmitBar
				label="Save policy"
				type="submit"
				isMainButton={isMainButton}
				disabled={!canSave}
				submitting={saving}
				icon={<Check className="size-4" aria-hidden />}
			/>
		</form>
	);
}

import { useEffect, useState, type ReactNode } from 'react';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { Input } from '@mmbix/design-system/input';

import { RequiredMark } from '@/shared/components/required-mark';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { hapticImpact } from '@/shared/platform/haptics';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';

/**
 * The supplier master form — the ONE layout a supplier is created (or edited)
 * with, shared by every host that has to add one:
 *
 *   - the masters hub's New Supplier page (`/app/mro-categories/suppliers/+`)
 *     and its edit page;
 *   - the inbound (GRN) form's supplier picker, which renders it IN the picker
 *     sheet (`inSheet`) so an operator filing a receipt can add the supplier
 *     without losing the draft they already typed.
 *
 * It lives in `shared/components` precisely because two modules render it — a
 * per-module copy would drift on what a supplier is.
 *
 * The master carries the two contact facts a GRN operator needs (`mobile` +
 * `address`) beside the required name. Submit via the Telegram MainButton
 * (browsers get the in-page fallback — never both); an `inSheet` host gets the
 * in-page button ONLY, because the sheet physically covers the native one.
 * Success lives in the caller's `save` (it folds the row through the shared
 * directory and returns/pops back — this form unmounts with it); on failure
 * `save` throws and an inline error shows — never silent.
 */
interface SupplierMasterFormProps {
	/** Edit mode seeds the fields with the row's current values (create omits). */
	initial?: { name?: string | null; mobile?: string | null; address?: string | null };
	/**
	 * CREATE-mode seed that does NOT establish the change baseline — the name a
	 * picker already collected (e.g. the inbound supplier sheet's search box).
	 * Passing it as `initial` would mark the form “unchanged” and disable Add, so
	 * a prefilled create goes through here instead (see `useFormDirty`).
	 */
	prefill?: { name?: string | null; mobile?: string | null; address?: string | null };
	/** The idle submit label (… Add / Save). */
	submitLabel: string;
	/** The busy submit label. */
	savingLabel: string;
	/** The inline error shown when `save` rejects. */
	errorMessage: string;
	/** Persist — create or update; must fold its list cache and pop back on
	 *  success, throw on failure. */
	save: (value: { name: string; mobile?: string; address?: string }) => Promise<void>;
	/** Optional destructive action rendered below the submit (edit mode only). */
	deleteAction?: ReactNode;
	/**
	 * Render the submit IN-PAGE, ignoring the native MainButton. Set by a host
	 * that renders this form inside a bottom sheet: the sheet sits over the
	 * native button, so taking it over would leave the operator without a
	 * reachable submit (and the stale binding could fire behind the backdrop).
	 */
	inSheet?: boolean;
}

/** A labeled field block — the required mark rides on `name` only. */
function Field({
	id,
	label,
	required,
	...input
}: {
	id: string;
	label: string;
	required?: boolean;
} & Omit<Parameters<typeof Input>[0], 'id'>) {
	return (
		<section>
			<label htmlFor={id} className={labelClass}>
				{label}
				{required && <RequiredMark />}
			</label>
			<Input id={id} {...input} className={fieldClass} />
		</section>
	);
}

export function SupplierMasterForm({
	initial,
	prefill,
	submitLabel,
	savingLabel,
	errorMessage,
	save,
	deleteAction,
	inSheet = false,
}: SupplierMasterFormProps) {
	// The field seed: the edit row when there is one, else the create prefill.
	// The BASELINE below stays `initial`-only, so a prefilled create is still
	// “changed” and its Add is live.
	const seedName = (initial?.name ?? prefill?.name ?? '').trim();
	const seedMobile = (initial?.mobile ?? prefill?.mobile ?? '').trim();
	const seedAddress = (initial?.address ?? prefill?.address ?? '').trim();
	const [name, setName] = useState(seedName);
	const [mobile, setMobile] = useState(seedMobile);
	const [address, setAddress] = useState(seedAddress);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	// Edit mode — the edit page's `useQuery` can hand the form a CACHED row before
	// the fresh fetch lands (TanStack v5 background revalidation); re-seed whenever
	// the loaded initial changes so the fields never freeze on stale data. Create
	// mode passes no `initial` — the effect stays dormant and typed input wins.
	const initialKey = `${initial?.name ?? ''}|${initial?.mobile ?? ''}|${initial?.address ?? ''}`;
	useEffect(() => {
		if (typeof initial?.name !== 'string') return;
		setName(initial.name.trim());
		setMobile(initial.mobile?.trim() ?? '');
		setAddress(initial.address?.trim() ?? '');
		setError(null);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialKey]);

	const trimmedName = name.trim();
	const trimmedMobile = mobile.trim();
	const trimmedAddress = address.trim();
	// Dirty gate — baseline mirrors the `useState` seeders (trimmed to match the
	// re-seed effect), so an untouched supplier cannot be submitted.
	const dirty = useFormDirty(
		{ name: initial?.name?.trim() ?? '', mobile: initial?.mobile?.trim() ?? '', address: initial?.address?.trim() ?? '' },
		{ name: trimmedName, mobile: trimmedMobile, address: trimmedAddress },
	);
	const canSubmit = trimmedName !== '' && !submitting && dirty;

	const submit = async () => {
		if (trimmedName === '' || submitting || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		try {
			await save({
				name: trimmedName,
				mobile: trimmedMobile || undefined,
				address: trimmedAddress || undefined,
			});
			// Success navigation lives in `save` — this form unmounts with it.
		} catch {
			setError(errorMessage);
			setSubmitting(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	// An `inSheet` host passes `visible: false`, so the hook returns false and
	// the in-page button renders (the sheet covers the native one).
	const isMainButton = useTelegramMainButton({
		text: submitting ? savingLabel : submitLabel,
		onClick: () => void submit(),
		visible: !inSheet,
		disabled: !canSubmit,
		loading: submitting,
	});

	return (
		<div className="flex flex-1 flex-col gap-5 pt-2">
			<Field
				id="supplier-name"
				label="Supplier name"
				required
				value={name}
				onChange={(e) => setName(e.target.value)}
				placeholder="e.g. — Global Tyre Co., Ltd."
				autoComplete="off"
				maxLength={120}
				disabled={submitting}
			/>

			<Field
				id="supplier-mobile"
				label="Mobile"
				value={mobile}
				onChange={(e) => setMobile(e.target.value)}
				placeholder="e.g. — 09-7xx-xxx-xxx"
				inputMode="tel"
				autoComplete="off"
				maxLength={40}
				disabled={submitting}
			/>

			<Field
				id="supplier-address"
				label="Address"
				value={address}
				onChange={(e) => setAddress(e.target.value)}
				placeholder="e.g. — No. 12, Bahan Tsp, Yangon"
				autoComplete="off"
				maxLength={200}
				disabled={submitting}
			/>

			<FormError error={error} />

			<FormSubmitBar
				label={submitLabel}
				isMainButton={isMainButton}
				disabled={!canSubmit}
				submitting={submitting}
				submittingLabel={savingLabel}
				onSubmit={() => void submit()}
			/>

			{/* Destructive action — edit mode only (create omits it). */}
			{deleteAction}
		</div>
	);
}

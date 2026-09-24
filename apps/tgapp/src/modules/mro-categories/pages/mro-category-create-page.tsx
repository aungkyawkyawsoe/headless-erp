import { useState } from 'react';
import { FIELD_LABEL_CLASS as labelClass, FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@mmbix/design-system/input';

import { createItemName } from '../data/api';
import { qk } from '../data/query-keys';
import { MRO_ITEM_NAMES_QUERY_KEY, upsertMasterDirectory } from '@/shared/hooks/use-mro-masters';
import { MRO_ITEM_MODELS_QUERY_KEY } from '@/shared/hooks/use-mro-item-models';
import { ModuleShell } from '@/shared/components/module-shell';
import { FormField } from '@/shared/components/form-field';
import { FormError, FormSubmitBar } from '@/shared/components/form-submit';
import { RequiredMark } from '@/shared/components/required-mark';
import { useFormDirty, useSubmitGuard } from '@/shared/components/form-state';
import { MRO_TRACKING, MRO_TRACKING_LABELS, type MroTracking } from '@/shared/mro';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifySaved } from '@/shared/save-feedback';
import { popBack } from '@/shared/platform/history';
import { useTelegramMainButton } from '@/shared/platform/use-main-button';

/**
 * New Item Group — the item-name master create form (`/app/mro-categories/+`,
 * behind the group page's bottom-bar + button).
 *
 * The form creates a `mro_item_name` row — the generic part name (Bulb, Clutch,
 * Tyre, …) that SKUs hang under, AND the OWNER of the stock tracking policy. So
 * THREE fields: the English name (name_en), the Myanmar name (name_mm) and the
 * tracking policy (standard/batch/serial) every SKU under this group inherits.
 * The policy is set ONCE here — a SKU form never asks for it — so an operator
 * must be able to get it right at creation time.
 *
 * Submit via the Telegram MainButton (Apple clients / browsers get the in-page
 * fallback — never both). Success invalidates the group list cache and returns
 * to the previous screen (falling back to `/app/mro-categories`); failures show
 * an inline error — never silent.
 */

/** The policy card copy — what each choice means for the group's stock. */
const POLICY_HINTS: Record<MroTracking, string> = {
	standard: 'No batch/serial — tracks stock quantity only',
	batch: 'Each lot tracked with its own expiry',
	serial: 'Each unit tracked separately by serial number',
};

export default function MroCategoryCreatePage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const [nameEn, setNameEn] = useState('');
	const [nameMm, setNameMm] = useState('');
	const [tracking, setTracking] = useState<MroTracking>('standard');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const submitGuard = useSubmitGuard();

	const trimmedEn = nameEn.trim();
	const trimmedMm = nameMm.trim();
	// Dirty gate — a create starts from the blank defaults, so nothing is
	// submittable until the operator types (or changes the tracking policy).
	const dirty = useFormDirty({ nameEn: '', nameMm: '', tracking: 'standard' as MroTracking }, { nameEn, nameMm, tracking });
	const canSubmit = trimmedEn !== '' && trimmedMm !== '' && !submitting && dirty;

	const submit = async () => {
		if (trimmedEn === '' || trimmedMm === '' || submitting || !submitGuard.begin()) return;
		hapticImpact('medium');
		setSubmitting(true);
		setError(null);
		try {
			const row = await createItemName(trimmedEn, trimmedMm, tracking);
			// Write-through the item-names directory — the created row is the server's
			// own answer, so the hub tab (and every picker sharing that cache) renders
			// it the moment this page pops back, with no refetch round trip.
			upsertMasterDirectory(queryClient, MRO_ITEM_NAMES_QUERY_KEY, {
				id: row.id,
				name: row.name_en ?? trimmedEn,
				tracking: row.tracking ?? tracking,
			});
			// The groups AGGREGATE embeds live-SKU counts (derived data this write
			// affects) — invalidate it; it refetches behind the paint.
			void queryClient.invalidateQueries({ queryKey: qk.groups(), refetchType: 'active' });
			// The shared SKU directory carries each SKU's inherited policy, so a new
			// master's policy must land there too (no page reload).
			void queryClient.invalidateQueries({ queryKey: MRO_ITEM_MODELS_QUERY_KEY });
			// Pop (not push): a pushed list entry would leave the create page beneath
			// it, so back from the list would re-open a fresh empty form.
			notifySaved('Category saved');
			popBack(navigate, '/app/mro-categories');
		} catch {
			setError("Couldn't add the new item group. Please try again.");
			setSubmitting(false);
			submitGuard.end();
		}
	};

	// The submit affordance: the native MainButton on Android/Desktop Telegram
	// (Apple clients fall back — native iOS clips Burmese labels); the in-page
	// button everywhere else. Never both — same rule as the BackButton pill.
	const isMainButton = useTelegramMainButton({
		text: submitting ? 'Adding…' : 'Add',
		onClick: () => void submit(),
		disabled: !canSubmit,
		loading: submitting,
	});

	return (
		<ModuleShell title="New Item Group" backTo="/app/mro-categories">
			<div className="flex flex-1 flex-col gap-5 pt-2">
				{/* 1 — Item group name (EN, required). */}
				<section>
					<label htmlFor="item-name-en" className={labelClass}>
						Item Group Name (English)
						<RequiredMark />
					</label>
					<Input
						id="item-name-en"
						value={nameEn}
						onChange={(e) => setNameEn(e.target.value)}
						placeholder="e.g. — Bulb, Clutch, Tyre"
						autoComplete="off"
						maxLength={120}
						disabled={submitting}
						className={fieldClass}
					/>
				</section>

				{/* 2 — Item group name (MM, required). */}
				<section>
					<label htmlFor="item-name-mm" className={labelClass}>
						Item Group Name (Myanmar)
						<RequiredMark />
					</label>
					<Input
						id="item-name-mm"
						value={nameMm}
						onChange={(e) => setNameMm(e.target.value)}
						placeholder="e.g. — the group name in Myanmar"
						autoComplete="off"
						maxLength={120}
						disabled={submitting}
						className={fieldClass}
					/>
				</section>

				{/* 3 — Tracking policy — the group's OWN stock policy, inherited by every
					SKU under it. Set once here; the SKU form never asks. */}
				<section>
					<FormField label="Tracking" required group>
						{() => (
							<div className="flex flex-col gap-2">
								{MRO_TRACKING.map((option) => {
									const active = tracking === option.value;
									return (
										<button
											key={option.value}
											type="button"
											aria-pressed={active}
											disabled={submitting}
											onClick={() => {
												hapticImpact('light');
												setTracking(option.value);
											}}
											className={`flex w-full flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${
												active ? 'border-primary bg-primary/5' : 'border-border bg-card'
											}`}
										>
											<span className="text-sm font-semibold leading-6 text-foreground">{MRO_TRACKING_LABELS[option.value]}</span>
											<span className="text-xs leading-5 text-muted-foreground">{POLICY_HINTS[option.value]}</span>
										</button>
									);
								})}
							</div>
						)}
					</FormField>
					<p className="mt-1.5 text-xs leading-myanmar text-muted-foreground">
						All items under this group inherit this policy automatically — it cannot be changed later.
					</p>
				</section>

				<FormError error={error} />

				<FormSubmitBar
					label="Add"
					isMainButton={isMainButton}
					disabled={!canSubmit}
					submitting={submitting}
					submittingLabel="Adding…"
					onSubmit={() => void submit()}
				/>
			</div>
		</ModuleShell>
	);
}

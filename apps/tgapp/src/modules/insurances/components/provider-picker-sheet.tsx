import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';
import { Check, ChevronDown } from 'lucide-react';

import { INSURANCE_PROVIDER_OPTIONS } from '../data/status';
import { hapticSelection } from '@/shared/platform/haptics';

/** One picker row — `value` is what gets SAVED on the policy (the backend
 *  select's stored value, e.g. `AYI` → displayed as "AYA"). */
export interface ProviderOption {
	value: string;
	label: string;
}

/** The field's own look — kept here so the create and edit forms cannot drift. */
const TRIGGER_CLASS =
	'flex h-11 w-full items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm leading-myanmar text-foreground outline-none transition-colors focus-visible:border-ring/60';

/**
 * The rows the picker offers: every insurer the `veh_insurances.provider` select
 * DECLARES (the schema's options), then any provider already on this truck's
 * policy file — so a legacy row whose insurer predates the select stays
 * pickable, and a stored raw string that happens to equal a declared LABEL
 * resolves back to that option's stored value (the policy keeps the canonical
 * code). Deduped by stored value, so declaring an option twice is impossible.
 *
 * Pure — unit-tested in `provider-picker-sheet.spec.tsx`.
 */
export function providerOptionsOf(existingProviders: ReadonlyArray<string> = []): ProviderOption[] {
	const seen = new Set<string>();
	const options: ProviderOption[] = [];
	const push = (value: string, label: string) => {
		const key = value.trim().toLowerCase();
		if (!key || seen.has(key)) return;
		seen.add(key);
		options.push({ value, label });
	};

	for (const declared of INSURANCE_PROVIDER_OPTIONS) push(declared.value, declared.label);

	for (const raw of existingProviders) {
		const clean = String(raw ?? '').trim();
		if (!clean) continue;
		const declared = INSURANCE_PROVIDER_OPTIONS.find(
			(option) => option.value.toLowerCase() === clean.toLowerCase() || option.label.toLowerCase() === clean.toLowerCase(),
		);
		push(declared?.value ?? clean, declared?.label ?? clean);
	}

	return options;
}

/**
 * The insurance Provider picker — a BOTTOM SHEET over the same options the
 * `veh_insurances.provider` select declares (plus this truck's existing
 * providers). Tapping a row takes that value and closes the sheet: the list is
 * short and fixed, so there is nothing to search for and no text to type.
 */
export function ProviderPickerSheet({
	open,
	onOpenChange,
	value,
	onSelect,
	existingProviders = [],
	title = 'Select provider',
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The currently stored provider value — its row renders the check mark. */
	value: string;
	onSelect: (value: string) => void;
	/** Provider values already on this truck's policy file — offered too. */
	existingProviders?: ReadonlyArray<string>;
	title?: string;
}) {
	const options = providerOptionsOf(existingProviders);

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="bottom" className="max-h-[70dvh] overflow-hidden p-0">
				<SheetHeader>
					<SheetTitle className="px-5 pt-4">{title}</SheetTitle>
				</SheetHeader>

				<ul role="listbox" aria-label="Providers" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-2">
					{options.map((option) => {
						const selected = value !== '' && value === option.value;
						return (
							<li key={option.value}>
								<button
									type="button"
									role="option"
									aria-selected={selected}
									onClick={() => {
										hapticSelection();
										onSelect(option.value);
										onOpenChange(false);
									}}
									className="flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring active:bg-muted/60"
								>
									<span className="min-w-0 flex-1 truncate text-sm font-medium leading-myanmar text-foreground">{option.label}</span>
									{selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
								</button>
							</li>
						);
					})}
				</ul>

				<div className="border-t border-border/60 px-5 py-3 pb-safe">
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="w-full rounded-2xl bg-foreground px-4 py-3 text-sm font-semibold leading-myanmar text-background transition-transform duration-150 active:scale-[0.98]"
					>
						Cancel
					</button>
				</div>
			</SheetContent>
		</Sheet>
	);
}

/**
 * The provider FORM FIELD — the tappable trigger every insurance form uses
 * (create + edit), opening the picker sheet above. It mirrors the vehicle
 * picker's trigger: a field-height button showing the chosen insurer, with a
 * chevron affordance. `provider` is required by the schema, so there is no
 * clear control — the forms gate their Save on a non-empty value instead.
 */
export function ProviderField({
	provider,
	onProviderChange,
	existingProviders = [],
	disabled = false,
	ariaLabel,
}: {
	/** The stored provider value ('' = nothing chosen yet). */
	provider: string;
	onProviderChange: (value: string) => void;
	existingProviders?: ReadonlyArray<string>;
	disabled?: boolean;
	/** The visible label, supplied by `FormField` so the trigger is named. */
	ariaLabel?: string;
}) {
	const [open, setOpen] = useState(false);
	// Show the option's LABEL for a stored value; a legacy raw value displays
	// itself, and an empty value shows the prompt.
	const selectedLabel = providerOptionsOf(existingProviders).find((option) => option.value === provider)?.label ?? null;

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				disabled={disabled}
				aria-label={ariaLabel}
				aria-haspopup="listbox"
				className={`${TRIGGER_CLASS} disabled:opacity-50 ${selectedLabel ? '' : 'text-muted-foreground'}`}
			>
				<span className="min-w-0 flex-1 truncate text-left">{selectedLabel ?? 'Select provider…'}</span>
				<ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
			</button>

			<ProviderPickerSheet
				open={open}
				onOpenChange={setOpen}
				value={provider}
				onSelect={onProviderChange}
				existingProviders={existingProviders}
			/>
		</>
	);
}

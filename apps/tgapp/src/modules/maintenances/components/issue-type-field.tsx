import { useEffect, useState } from 'react';
import { PICKER_FIELD_CLASS as fieldClass } from '@/shared/components/form-styles';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, LoaderCircle, Search, Wrench, X } from 'lucide-react';
import { Input } from '@mmbix/design-system/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@mmbix/design-system/sheet';

import { ISSUE_TYPES_STALE_MS, fetchIssueTypesSearch } from '../data/api';
import { qk } from '../data/query-keys';
import type { IssueTypeOption } from '../data/types';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_CHARS } from '@/shared/constants';
import { PickerSearchHint } from '@/shared/components/picker-search-hint';
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value';

interface IssueTypeFieldProps {
	/** The selected `veh_issue_types` id, or null when unset. */
	value: string | null;
	onChange: (id: string | null) => void;
	disabled?: boolean;
	/** Display name for the CURRENT id when the search that resolved it is gone — an
	 *  edit prefill keeps its job label instead of reading "Select a job…". Ignored
	 *  once the id is cleared. */
	fallbackLabel?: string | null;
}

/** The form field's control look — mirrors the incident log form's inputs. */

/**
 * Issue-type picker — the maintenance log form's "standard job" field.
 *
 * SEARCH-FIRST, per the app-wide picker standard: opening the sheet issues NO
 * query and shows a blank prompt. Once the term reaches `SEARCH_MIN_CHARS`
 * and settles for `SEARCH_DEBOUNCE_MS`, ONE server-side `?search=` matches
 * the `veh_issue_types` master (name / code / category), so an idle sheet costs
 * nothing and a short term never scans the catalog.
 *
 * The picked label is remembered locally: the search results are transient, so
 * the bound job must keep its name even after the list changes (and an edit
 * prefill falls back to the record's own name).
 */
export function IssueTypeField({ value, onChange, disabled = false, fallbackLabel = null }: IssueTypeFieldProps) {
	const [open, setOpen] = useState(false);
	const [term, setTerm] = useState('');
	// The name of the job THIS field picked — survives the search list changing.
	const [pickedLabel, setPickedLabel] = useState<string | null>(null);
	// Re-opening starts fresh, not the previous session's term.
	useEffect(() => {
		if (!open) setTerm('');
	}, [open]);
	// An external clear (a save reset, a form reset) drops the remembered name.
	useEffect(() => {
		if (value == null) setPickedLabel(null);
	}, [value]);

	const trimmed = term.trim();
	const debounced = useDebouncedValue(trimmed, SEARCH_DEBOUNCE_MS);
	const ready = debounced.length >= SEARCH_MIN_CHARS;

	const issueTypes = useQuery({
		queryKey: qk.issueTypeSearch(debounced),
		queryFn: () => fetchIssueTypesSearch(debounced),
		staleTime: ISSUE_TYPES_STALE_MS,
		enabled: open && ready,
	});

	const options = issueTypes.data ?? [];

	/** The bound job's label — the remembered pick first, then the record's own
	 *  name for an edit prefill. A CLEARED field (no id) never shows a stale label. */
	const selectedLabel = value ? (pickedLabel ?? fallbackLabel) : null;

	return (
		<>
			<div className={fieldClass}>
				<button
					type="button"
					onClick={() => setOpen(true)}
					disabled={disabled}
					className="flex min-w-0 flex-1 items-center self-stretch text-left outline-none disabled:opacity-60"
				>
					<span className={`truncate ${selectedLabel ? 'text-foreground' : 'text-muted-foreground'}`}>
						{selectedLabel ?? 'Select a job…'}
					</span>
				</button>
				{value ? (
					<button
						type="button"
						aria-label="Clear job"
						disabled={disabled}
						onClick={() => {
							setPickedLabel(null);
							onChange(null);
						}}
						className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
					>
						<X className="size-4" aria-hidden />
					</button>
				) : (
					<button
						type="button"
						aria-label="Select job"
						disabled={disabled}
						onClick={() => setOpen(true)}
						className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
					>
						<ChevronDown className="size-4" aria-hidden />
					</button>
				)}
			</div>

			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="bottom" className="max-h-[60dvh] gap-0 overflow-hidden p-0">
					<SheetHeader className="px-5 pb-3 pr-12 pt-4">
						<SheetTitle>Select a maintenance job</SheetTitle>
					</SheetHeader>
					<div className="px-5 pb-3">
						<div className="relative">
							<Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
							<Input
								value={term}
								onChange={(event) => setTerm(event.target.value)}
								placeholder="Search job name / code…"
								aria-label="Search maintenance jobs"
								className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60"
							/>
							{term && (
								<button
									type="button"
									aria-label="Clear search"
									onClick={() => setTerm('')}
									className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
								>
									<X className="size-4" aria-hidden />
								</button>
							)}
						</div>
					</div>
					<div className="min-h-0 overflow-y-auto px-5 pb-safe pt-1">
						{!ready ? (
							<PickerSearchHint noun="find a job" />
						) : issueTypes.isPending ? (
							<p className="flex items-center justify-center gap-2 px-2 py-6 text-sm leading-myanmar text-muted-foreground">
								<LoaderCircle className="size-4 animate-spin" aria-hidden /> Searching…
							</p>
						) : issueTypes.isError ? (
							<button
								type="button"
								onClick={() => void issueTypes.refetch()}
								className="mx-auto rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
							>
								Couldn’t load jobs — retry
							</button>
						) : options.length === 0 ? (
							<p className="px-2 py-6 text-center text-sm leading-myanmar text-muted-foreground">No jobs match “{trimmed}”.</p>
						) : (
							options.map((option) => (
								<IssueTypeRowButton
									key={option.id}
									option={option}
									selected={option.id === value}
									onSelect={() => {
										setPickedLabel(option.name);
										onChange(option.id);
										setOpen(false);
									}}
								/>
							))
						)}
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}

/** One catalog row — job name over its code + category, with the check on select. */
function IssueTypeRowButton({ option, selected, onSelect }: { option: IssueTypeOption; selected: boolean; onSelect: () => void }) {
	// The category label comes from the `mro_item_categories` master the job files
	// under (the m2o's names), Myanmar first — the picker never hardcodes families.
	const categoryLabel = option.category ? option.category.nameMm?.trim() || option.category.nameEn?.trim() || null : null;
	return (
		<button
			type="button"
			onClick={onSelect}
			className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted"
		>
			<span className="flex min-w-0 items-center gap-2.5">
				<span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
					<Wrench className="size-3.5" strokeWidth={2.2} aria-hidden />
				</span>
				<span className="min-w-0">
					<span className="block truncate text-sm font-semibold text-foreground">{option.name}</span>
					<span className="block truncate text-meta text-muted-foreground">
						{[option.jobCode, categoryLabel].filter(Boolean).join(' · ') || '—'}
					</span>
				</span>
			</span>
			{selected && <Check className="size-4 shrink-0 text-primary" aria-hidden />}
		</button>
	);
}

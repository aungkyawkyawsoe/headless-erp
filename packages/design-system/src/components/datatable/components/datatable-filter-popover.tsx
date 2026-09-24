'use client';

import * as React from 'react';
import { ListSortDescendingIcon, PlusIcon, XIcon } from 'lucide-react';
import { Button } from '@/button';
import { Input } from '@/input';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, useComboboxAnchor } from '@/combobox';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/popover';
import { DatePicker, DateRangePicker } from '@/datepicker';
import type { ActiveFilter, ColumnDef, DataTableLabels, FilterDef, FilterOperator, FilterType } from '../core/types';
import type { RowData } from '@tanstack/react-table';

// ── Operator labels (human-readable) ─────────────────────

const OPERATOR_LABELS: Record<FilterOperator, string> = {
	equals: 'Equals',
	'not-equals': 'Not equals',
	contains: 'Contains',
	'not-contains': "Doesn't contain",
	'starts-with': 'Starts with',
	'ends-with': 'Ends with',
	gt: 'Greater than',
	gte: 'Greater or equal',
	lt: 'Less than',
	lte: 'Less or equal',
	between: 'Between',
	in: 'Is one of',
	'not-in': 'Is not one of',
	'is-empty': 'Is empty',
	'is-not-empty': 'Is not empty',
};

// ── Operators available per filter type ──────────────────

const OPERATORS_BY_TYPE: Record<FilterType, FilterOperator[]> = {
	text: ['contains', 'not-contains', 'equals', 'not-equals', 'starts-with', 'ends-with', 'is-empty', 'is-not-empty'],
	number: ['equals', 'not-equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is-empty', 'is-not-empty'],
	select: ['equals', 'not-equals', 'in', 'not-in', 'is-empty', 'is-not-empty'],
	'multi-select': ['in', 'not-in', 'is-empty', 'is-not-empty'],
	date: ['equals', 'gt', 'gte', 'lt', 'lte', 'between', 'is-empty', 'is-not-empty'],
	'date-range': ['between'],
	boolean: ['equals', 'is-empty', 'is-not-empty'],
};

// ── Draft filter (local popover state) ───────────────────

interface DraftFilter {
	/** Unique key for React rendering */
	_key: string;
	columnId: string;
	operator: FilterOperator;
	value: unknown;
	valueTo?: unknown;
}

let _draftKeyCounter = 0;
function nextDraftKey(): string {
	return `draft-${++_draftKeyCounter}`;
}

// ── Helpers ──────────────────────────────────────────────

/** Get the FilterDef for a column, or undefined. */
function getFilterDef<TData extends RowData>(columns: ColumnDef<TData>[], columnId: string): FilterDef | undefined {
	return columns.find((c) => c.id === columnId)?.filter;
}

/** Build a human-readable label from a column's header. */
function columnLabel<TData extends RowData>(col: ColumnDef<TData>): string {
	const raw = typeof col.header === 'string' ? col.header : col.id;
	// Only capitalize if the first char is a Latin letter (not Burmese / CJK / emoji)
	if (/^[a-z]/.test(raw)) {
		return raw.charAt(0).toUpperCase() + raw.slice(1);
	}
	return raw;
}

/** Check if the operator needs a value input (vs. is-empty / is-not-empty). */
function operatorNeedsValue(op: FilterOperator): boolean {
	return op !== 'is-empty' && op !== 'is-not-empty';
}

/** Format a Date as YYYY-MM-DD in local time (no timezone shift). */
function toDateString(d: Date): string {
	const yyyy = d.getFullYear();
	const mm = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}

// ── Props ────────────────────────────────────────────────

interface DataTableFilterPopoverProps<TData extends RowData> {
	columns: ColumnDef<TData>[];
	activeFilters: ActiveFilter[];
	labels?: DataTableLabels;
	onApply: (filters: ActiveFilter[]) => void;
	onClear: () => void;
}

// ── Component ────────────────────────────────────────────

export function DataTableFilterPopover<TData extends RowData>({
	columns,
	activeFilters,
	labels,
	onApply,
	onClear,
}: DataTableFilterPopoverProps<TData>) {
	const filterableColumns = React.useMemo(() => columns.filter((c) => c.filter != null), [columns]);

	// ── Draft state (initialized from activeFilters on open) ──
	const [drafts, setDrafts] = React.useState<DraftFilter[]>(() =>
		activeFilters.map((f) => ({
			_key: nextDraftKey(),
			columnId: f.id,
			operator: f.operator,
			value: f.value,
			valueTo: f.valueTo,
		})),
	);
	const [open, setOpen] = React.useState(false);

	// ── Draft mutation helpers ──────────────────────────

	const addDraft = React.useCallback(() => {
		// Pick the first filterable column not yet in drafts
		const usedIds = new Set(drafts.map((d) => d.columnId));
		const nextCol = filterableColumns.find((c) => !usedIds.has(c.id));
		if (!nextCol || !nextCol.filter) return;

		const def = nextCol.filter;
		setDrafts((prev) => [
			...prev,
			{
				_key: nextDraftKey(),
				columnId: nextCol.id,
				operator: def.operator ?? OPERATORS_BY_TYPE[def.type][0],
				value: '',
				valueTo: undefined,
			},
		]);
	}, [drafts, filterableColumns]);

	const updateDraft = React.useCallback(
		(key: string, patch: Partial<Omit<DraftFilter, '_key'>>) => {
			setDrafts((prev) =>
				prev.map((d) => {
					if (d._key !== key) return d;

					// If column changed, reset operator + value to the new column's defaults
					if (patch.columnId !== undefined && patch.columnId !== d.columnId) {
						// If clearing the column, keep the operator but reset value
						if (!patch.columnId) {
							return { ...d, columnId: '', value: '', valueTo: undefined };
						}
						const def = getFilterDef(columns, patch.columnId);
						if (def) {
							return {
								...d,
								columnId: patch.columnId,
								operator: def.operator ?? OPERATORS_BY_TYPE[def.type][0],
								value: '',
								valueTo: undefined,
							};
						}
					}

					// If operator changed to a no-value op, clear value
					if (patch.operator !== undefined && !operatorNeedsValue(patch.operator)) {
						return { ...d, ...patch, value: '', valueTo: undefined };
					}

					return { ...d, ...patch };
				}),
			);
		},
		[columns],
	);

	const removeDraft = React.useCallback((key: string) => {
		setDrafts((prev) => prev.filter((d) => d._key !== key));
	}, []);

	// ── Apply / Clear ───────────────────────────────────

	const handleApply = React.useCallback(() => {
		const filters: ActiveFilter[] = drafts
			.filter((d) => {
				// Skip drafts with no value unless operator is empty-check
				if (operatorNeedsValue(d.operator)) {
					if (d.value === '' || d.value == null) return false;
				}
				return true;
			})
			.map((d) => ({
				id: d.columnId,
				operator: d.operator,
				value: d.value,
				valueTo: d.valueTo,
			}));
		onApply(filters);
		setOpen(false);
	}, [drafts, onApply]);

	const handleClear = React.useCallback(() => {
		onClear();
		// Reset to a single empty row from the first available column
		if (filterableColumns.length > 0) {
			const def = filterableColumns[0].filter!;
			setDrafts([
				{
					_key: nextDraftKey(),
					columnId: filterableColumns[0].id,
					operator: def.operator ?? OPERATORS_BY_TYPE[def.type][0],
					value: '',
					valueTo: undefined,
				},
			]);
		}
	}, [onClear, filterableColumns]);

	const handleOpenChange = React.useCallback(
		(next: boolean) => {
			if (next) {
				// Opening: seed drafts from activeFilters (batched with setOpen below)
				const seeded = activeFilters.map((f) => ({
					_key: nextDraftKey(),
					columnId: f.id,
					operator: f.operator,
					value: f.value,
					valueTo: f.valueTo,
				}));
				// Always show at least one row — pick first available column if empty
				if (seeded.length === 0 && filterableColumns.length > 0) {
					const def = filterableColumns[0].filter!;
					seeded.push({
						_key: nextDraftKey(),
						columnId: filterableColumns[0].id,
						operator: def.operator ?? OPERATORS_BY_TYPE[def.type][0],
						value: '',
						valueTo: undefined,
					});
				}
				setDrafts(seeded);
			}
			// Closing without applying → discard local edits. Drafts will be
			// re-seeded from activeFilters when the popover opens again.
			setOpen(next);
		},
		[activeFilters, filterableColumns],
	);

	// ── Can add another filter? ──────────────────────────
	const usedIds = new Set(drafts.map((d) => d.columnId));
	const canAddMore = filterableColumns.some((c) => !usedIds.has(c.id));

	// ── Render ──────────────────────────────────────────

	const filterCount = activeFilters.length;

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger
				nativeButton={false}
				render={
					<div className="flex shrink-0 items-center gap-1.5">
						<Button
							variant="outline"
							size="sm"
							className="gap-1.5 rounded-sm"
							aria-label={`Filters${filterCount > 0 ? ` (${filterCount} active)` : ''}`}
						>
							<ListSortDescendingIcon className="size-3.5" />
							<span>{labels?.filters ?? 'Filter'}</span>
							{filterCount > 0 && (
								<span className="ml-0.5 flex size-4 items-center justify-center rounded-full bg-muted-foreground/20 text-[10px] font-semibold">
									{filterCount}
								</span>
							)}
						</Button>
						{filterCount > 0 && (
							<Button
								variant="outline"
								size="icon-sm"
								className="rounded-sm"
								onClick={(e) => {
									e.stopPropagation();
									handleClear();
								}}
								aria-label="Clear all filters"
							>
								<XIcon className="size-3.5" />
							</Button>
						)}
					</div>
				}
			/>
			<PopoverContent align="end" side="bottom" sideOffset={8} className="w-143 max-w-[calc(100vw-2rem)] p-3">
				<div data-slot="filter-popover" className="flex flex-col gap-2.5">
					{/* ── Filter rows ──────────────────────── */}
					<div className="flex flex-col gap-2">
						{drafts.map((draft) => (
							<FilterRow
								key={draft._key}
								columns={filterableColumns}
								draft={draft}
								usedColumnIds={usedIds}
								onChange={(patch) => updateDraft(draft._key, patch)}
								onRemove={() => removeDraft(draft._key)}
							/>
						))}
					</div>

					{/* ── Footer ────────────────────────────── */}
					<div className="mt-2 flex items-center justify-between border-t pt-3">
						<Button variant="ghost" size="sm" onClick={addDraft} disabled={!canAddMore}>
							<PlusIcon className="size-3" />
							Add Filter
						</Button>
						<div className="flex items-center gap-1.5">
							<Button variant="secondary" size="sm" onClick={handleClear}>
								{labels?.clearFilters ?? 'Clear'}
							</Button>
							<Button variant="default" size="sm" onClick={handleApply}>
								Apply
							</Button>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

// ── FilterRow sub-component ──────────────────────────────

interface FilterRowProps<TData extends RowData> {
	columns: ColumnDef<TData>[];
	draft: DraftFilter;
	usedColumnIds: Set<string>;
	onChange: (patch: Partial<Omit<DraftFilter, '_key'>>) => void;
	onRemove: () => void;
}

function FilterRow<TData extends RowData>({ columns, draft, usedColumnIds, onChange, onRemove }: FilterRowProps<TData>) {
	const filterDef = getFilterDef(columns, draft.columnId);
	const operators = filterDef ? OPERATORS_BY_TYPE[filterDef.type] : OPERATORS_BY_TYPE.text;
	const needsValue = operatorNeedsValue(draft.operator);
	const isBetween = draft.operator === 'between';

	// ── Field combobox state ────────────────────
	const anchorRef = useComboboxAnchor();

	// Auto-select when only one column matches the query
	const selectedLabel = React.useMemo(() => {
		const col = columns.find((c) => c.id === draft.columnId) ?? columns[0];
		return columnLabel(col);
	}, [columns, draft.columnId]);

	return (
		<div className="flex items-center gap-1.5">
			{/* ── Field combobox ────────────────────────── */}
			<div ref={anchorRef} className="w-40 min-w-0 shrink-0">
				<Combobox
					items={columns.map((c) => c.id)}
					value={draft.columnId}
					autoHighlight
					onValueChange={(val) => {
						onChange({ columnId: val ?? '' });
					}}
					itemToStringLabel={(colId) => {
						const col = columns.find((c) => c.id === colId);
						return col ? columnLabel(col) : colId;
					}}
				>
					<ComboboxInput
						placeholder={selectedLabel}
						showTrigger={false}
						showClear
						className="h-7 w-full has-[[data-slot=input-group-control]:focus-visible]:ring-2"
					/>
					<ComboboxContent anchor={anchorRef}>
						<ComboboxEmpty>No columns found.</ComboboxEmpty>
						<ComboboxList>
							{(colId) => {
								const col = columns.find((c) => c.id === colId);
								return (
									<ComboboxItem key={colId} value={colId} disabled={usedColumnIds.has(colId) && colId !== draft.columnId}>
										{col ? columnLabel(col) : colId}
									</ComboboxItem>
								);
							}}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</div>

			{/* ── Operator select ─────────────────────── */}
			<Select
				value={draft.operator}
				onValueChange={(val) => {
					if (val) onChange({ operator: val as FilterOperator });
				}}
			>
				<SelectTrigger size="sm" className="h-7 w-32.5 min-w-0 shrink-0">
					<SelectValue className="min-w-0 truncate">{OPERATOR_LABELS[draft.operator] ?? draft.operator}</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{operators.map((op) => (
							<SelectItem key={op} value={op}>
								{OPERATOR_LABELS[op]}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>

			{/* ── Value input ─────────────────────────── */}
			{needsValue && <FilterValueInput filterDef={filterDef} draft={draft} isBetween={isBetween} onChange={onChange} />}

			{/* Spacer to push remove button */}

			{/* ── Remove ──────────────────────────────── */}
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={onRemove}
				className="shrink-0 text-muted-foreground hover:text-foreground"
				aria-label="Remove filter"
			>
				<XIcon className="size-3" />
			</Button>
		</div>
	);
}

// ── Dynamic value input ──────────────────────────────────

interface FilterValueInputProps {
	filterDef: FilterDef | undefined;
	draft: DraftFilter;
	isBetween: boolean;
	onChange: (patch: Partial<Omit<DraftFilter, '_key'>>) => void;
}

function FilterValueInput({ filterDef, draft, isBetween, onChange }: FilterValueInputProps) {
	const type = filterDef?.type ?? 'text';

	// ── Boolean type ──────────────────────────────
	if (type === 'boolean') {
		return (
			<Select
				value={String(draft.value ?? 'true')}
				onValueChange={(val) => {
					if (val) onChange({ value: val === 'true' });
				}}
			>
				<SelectTrigger size="sm" className="h-7 min-w-0 flex-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						<SelectItem value="true">True</SelectItem>
						<SelectItem value="false">False</SelectItem>
					</SelectGroup>
				</SelectContent>
			</Select>
		);
	}

	// ── Select / Multi-select type ────────────────
	if (type === 'select') {
		return (
			<Select
				value={String(draft.value ?? '')}
				onValueChange={(val) => {
					if (val != null) onChange({ value: val });
				}}
			>
				<SelectTrigger size="sm" className="h-7 min-w-0 flex-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{filterDef?.options?.map((opt) => (
							<SelectItem key={opt.value} value={opt.value}>
								{opt.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
		);
	}

	// ── Date / Date-range type ────────────────────
	if (type === 'date' || type === 'date-range') {
		if (isBetween) {
			const rangeValue =
				draft.value || draft.valueTo
					? {
							from: draft.value ? new Date(String(draft.value)) : undefined,
							to: draft.valueTo ? new Date(String(draft.valueTo)) : undefined,
						}
					: undefined;
			return (
				<DateRangePicker
					value={rangeValue}
					onValueChange={(range) => {
						onChange({
							value: range?.from ? toDateString(range.from) : '',
							valueTo: range?.to ? toDateString(range.to) : '',
						});
					}}
					className="h-7 min-w-0 flex-1 text-xs"
				/>
			);
		}
		return (
			<DatePicker
				value={draft.value ? new Date(String(draft.value)) : undefined}
				onValueChange={(date) => {
					onChange({ value: date ? toDateString(date) : '' });
				}}
				className="h-7 min-w-0 flex-1 text-xs"
			/>
		);
	}

	// ── Number type ───────────────────────────────
	if (type === 'number') {
		if (isBetween) {
			return (
				<div className="flex min-w-0 flex-1 items-center gap-1">
					<Input
						type="number"
						value={String(draft.value ?? '')}
						onChange={(e) => onChange({ value: e.target.value })}
						placeholder="Min"
						className="h-7 min-w-0 flex-1 px-1.5 text-xs"
					/>
					<span className="text-xs text-muted-foreground">–</span>
					<Input
						type="number"
						value={String(draft.valueTo ?? '')}
						onChange={(e) => onChange({ valueTo: e.target.value })}
						placeholder="Max"
						className="h-7 min-w-0 flex-1 px-1.5 text-xs"
					/>
				</div>
			);
		}
		return (
			<Input
				type="number"
				value={String(draft.value ?? '')}
				onChange={(e) => onChange({ value: e.target.value })}
				placeholder="Value"
				className="h-7 min-w-0 flex-1 px-1.5 text-xs"
			/>
		);
	}

	// ── Text (default) ────────────────────────────
	return (
		<Input
			type="text"
			value={String(draft.value ?? '')}
			onChange={(e) => onChange({ value: e.target.value })}
			placeholder="Value"
			className="h-7 min-w-0 flex-1 px-1.5 text-xs"
		/>
	);
}

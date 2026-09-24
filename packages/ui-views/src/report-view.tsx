/**
 * ReportView — renders a `ReportDefinition` in every context.
 *
 * The single renderer behind page blocks, `?view=pivot`, record-context embeds
 * and saved-report pages (design == runtime). Data comes through an injected
 * `dataSource` — the host decides how to fetch (typically `/api/reports/execute`).
 *
 * - pivot   → the DS `PivotTable` (sorting/search/pagination/visibility/totals)
 * - grouped → a compact token-based summary table
 */

import { useEffect, useMemo, useState } from 'react';
import * as React from 'react';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@mmbix/design-system';
import { PivotTable, type PivotCellClick, type PivotLabels } from '@mmbix/design-system/pivot';
import type { ReportDefinition, ReportMeasure, ReportMeasureOp, ReportResult } from '@mmbix/types';

/** The host's report executor — must return a full ReportResult. */
export type ReportDataSource = (def: ReportDefinition) => Promise<ReportResult>;

/** One selectable measure (Odoo-style) — key + label + the measure itself. */
export interface MeasureOption {
	key: string;
	label: string;
	measure: ReportMeasure;
}

const MEASURE_LABELS: Record<string, string> = {
	sum: 'Sum',
	count: 'Count',
	avg: 'Average',
	min: 'Min',
	max: 'Max',
	count_distinct: 'Count distinct',
};

const NUMERIC_FIELD_TYPES = new Set(['number', 'currency', 'integer', 'bigint', 'percent', 'duration']);
const DATE_FIELD_TYPES = new Set(['date', 'datetime', 'timestamp']);
const DATE_BUCKETS = ['month', 'week', 'quarter', 'year'] as const;

/**
 * Build the axis picker options for the customize panel: every physical field,
 * plus date-bucket variants (`month(field)`) for date fields.
 */
export function buildDimensionOptions(
	fields: Array<{ name: string; type: string; label?: string }>,
): Array<{ value: string; label: string }> {
	const out: Array<{ value: string; label: string }> = [];
	for (const f of fields) {
		out.push({ value: f.name, label: f.label ?? f.name });
		if (DATE_FIELD_TYPES.has(f.type)) {
			for (const b of DATE_BUCKETS) {
				out.push({ value: `${b}(${f.name})`, label: `${b[0].toUpperCase()}${b.slice(1)} of ${f.label ?? f.name}` });
			}
		}
	}
	return out;
}

/**
 * Build the Odoo-style measure picker list for a pivot: the report's own
 * measures first (so the designed one stays selected), then every numeric
 * field × aggregation, plus a global Count.
 */
export function buildMeasureOptions(
	report: ReportDefinition,
	fields: Array<{ name: string; type: string; label?: string }>,
): MeasureOption[] {
	const ops: ReportMeasureOp[] = ['sum', 'avg', 'min', 'max'];
	const out: MeasureOption[] = [];
	const seen = new Set<string>();
	for (const m of report.measures) {
		const key = m.alias ?? `${m.op}_${m.field === '*' ? 'all' : m.field}`;
		seen.add(key);
		out.push({ key, label: m.label ?? `${MEASURE_LABELS[m.op] ?? m.op} of ${m.field === '*' ? 'all' : m.field}`, measure: m });
	}
	for (const f of fields) {
		if (!NUMERIC_FIELD_TYPES.has(f.type)) continue;
		for (const op of ops) {
			const key = `${op}_${f.name}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const label = `${MEASURE_LABELS[op]} of ${f.label ?? f.name}`;
			out.push({ key, label, measure: { op, field: f.name, alias: key, label } });
		}
	}
	if (!seen.has('count_all')) {
		out.unshift({ key: 'count_all', label: 'Count', measure: { op: 'count', field: '*', alias: 'count_all', label: 'Count' } });
	}
	return out;
}

const MUTED = 'var(--mmbix-muted-foreground, #6b7280)';
const BORDER = 'var(--mmbix-border, #e5e7eb)';

function measureLabel(m: ReportDefinition['measures'][number]): string {
	return m.label ?? `${m.op}(${m.field === '*' ? 'all' : m.field})`;
}

/** A removable dimension chip inside the customize panel. */
function AxisChip({ label, onRemove }: { label: string; onRemove: () => void }) {
	return (
		<span
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 4,
				padding: '2px 6px',
				border: '1px solid var(--mmbix-border, #e5e7eb)',
				borderRadius: 6,
				background: 'var(--mmbix-muted, #f8fafc)',
				fontSize: '0.72rem',
				color: 'var(--mmbix-foreground, #1f2937)',
			}}
		>
			{label}
			<button
				type="button"
				onClick={onRemove}
				aria-label={`Remove ${label}`}
				style={{
					border: 'none',
					background: 'transparent',
					cursor: 'pointer',
					color: '#9ca3af',
					padding: 0,
					fontSize: '0.85rem',
					lineHeight: 1,
				}}
			>
				×
			</button>
		</span>
	);
}

/** One axis editor (Y rows / X columns): chips + a searchable add-combobox. */
function AxisEditor({
	title,
	dims,
	options,
	onChange,
}: {
	title: string;
	dims: string[];
	options: Array<{ value: string; label: string }>;
	onChange: (next: string[]) => void;
}) {
	// Remount after every pick: Base UI fills the input with the picked label on
	// selection, so the key bump resets it to a clean add-picker (Data Studio style)
	// instead of leaving the last dimension sitting in the search box.
	const [resetKey, setResetKey] = React.useState(0);
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<label
				style={{
					fontSize: '0.68rem',
					fontWeight: 700,
					textTransform: 'uppercase',
					letterSpacing: '0.04em',
					color: 'var(--mmbix-muted-foreground, #6b7280)',
				}}
			>
				{title}
			</label>
			{dims.length > 0 && (
				<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
					{dims.map((d, i) => (
						<AxisChip key={d} label={d} onRemove={() => onChange(dims.filter((_, j) => j !== i))} />
					))}
				</div>
			)}
			<Combobox
				key={resetKey}
				items={options.map((o) => o.value)}
				itemToStringLabel={(v) => options.find((o) => o.value === String(v))?.label ?? String(v)}
				onValueChange={(v) => {
					const picked = String(v ?? '');
					if (picked && !dims.includes(picked)) onChange([...dims, picked]);
					setResetKey((k) => k + 1);
				}}
			>
				<ComboboxInput
					showTrigger
					placeholder={`Search ${title.toLowerCase()}…`}
					aria-label={`Add ${title}`}
					style={{ fontSize: '0.72rem' }}
					className="w-full"
				/>
				<ComboboxContent align="start" sideOffset={4} style={{ width: 240 }}>
					<ComboboxList>
						{(v: string) => {
							const o = options.find((x) => x.value === v);
							if (!o) return null;
							return (
								<ComboboxItem key={o.value} value={o.value}>
									{o.label}
								</ComboboxItem>
							);
						}}
					</ComboboxList>
					<ComboboxEmpty>No matching fields</ComboboxEmpty>
				</ComboboxContent>
			</Combobox>
		</div>
	);
}

/** Data-Studio-style pivot customize panel — Y axis, X axis, measure. */
function CustomizePanel({
	rows,
	cols,
	measureKey,
	measureOptions,
	fields,
	onRowsChange,
	onColsChange,
	onMeasureChange,
	onClose,
}: {
	rows: string[];
	cols: string[];
	measureKey: string;
	measureOptions: MeasureOption[];
	fields: Array<{ name: string; type: string; label?: string }>;
	onRowsChange: (next: string[]) => void;
	onColsChange: (next: string[]) => void;
	onMeasureChange: (key: string) => void;
	onClose: () => void;
}) {
	const options = React.useMemo(() => buildDimensionOptions(fields), [fields]);
	return (
		<aside
			style={{
				flex: '0 0 264px',
				width: 264,
				minHeight: 0,
				overflowY: 'auto',
				alignSelf: 'stretch',
				background: 'var(--mmbix-card, #ffffff)',
				borderLeft: '1px solid var(--mmbix-border, #e5e7eb)',
				padding: '0.75rem',
				display: 'flex',
				flexDirection: 'column',
				gap: '0.7rem',
				fontSize: '0.78rem',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<strong style={{ fontSize: '0.8rem' }}>Customize pivot</strong>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close customize"
					style={{
						border: 'none',
						background: 'transparent',
						cursor: 'pointer',
						color: '#9ca3af',
						fontSize: '1rem',
						lineHeight: 1,
						padding: 0,
					}}
				>
					×
				</button>
			</div>
			<AxisEditor title="Y axis (rows)" dims={rows} options={options} onChange={onRowsChange} />
			<AxisEditor title="X axis (columns)" dims={cols} options={options} onChange={onColsChange} />
			<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
				<label
					style={{
						fontSize: '0.68rem',
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.04em',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
					}}
				>
					Measure
				</label>
				<Combobox
					value={measureKey}
					items={measureOptions.map((o) => o.key)}
					itemToStringLabel={(k) => measureOptions.find((o) => o.key === String(k))?.label ?? String(k)}
					onValueChange={(k) => {
						const key = String(k ?? '');
						if (key) onMeasureChange(key);
					}}
					onInputValueChange={() => {}}
				>
					<ComboboxInput showTrigger aria-label="Measure" style={{ fontSize: '0.72rem' }} className="w-full" />
					<ComboboxContent align="start" sideOffset={4} style={{ width: 240 }}>
						<ComboboxList>
							{(k: string) => {
								const o = measureOptions.find((x) => x.key === k);
								if (!o) return null;
								return (
									<ComboboxItem key={o.key} value={o.key}>
										{o.label}
									</ComboboxItem>
								);
							}}
						</ComboboxList>
						<ComboboxEmpty>No matching measures</ComboboxEmpty>
					</ComboboxContent>
				</Combobox>
			</div>
		</aside>
	);
}

function GroupedReportTable({ report, result }: { report: ReportDefinition; result: ReportResult }) {
	const headers = [...report.rowDimensions.map((d) => d.replace(/_/g, ' ')), ...report.measures.map(measureLabel)];
	const numericCols = new Set(report.measures.map(measureLabel));

	return (
		<div style={{ overflowX: 'auto' }}>
			<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
				<thead>
					<tr>
						{headers.map((h, i) => (
							<th
								key={i}
								style={{
									textAlign: 'left',
									padding: '0.4rem 0.6rem',
									fontSize: '0.68rem',
									fontWeight: 700,
									textTransform: 'uppercase',
									letterSpacing: '0.04em',
									color: MUTED,
									borderBottom: `1px solid ${BORDER}`,
									background: 'var(--mmbix-muted, #f8fafc)',
									...(numericCols.has(h) ? { textAlign: 'right' as const } : {}),
								}}
							>
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{result.data.map((row, i) => (
						<tr key={i}>
							{headers.map((h, j) => {
								// Header ↔ value mapping: row dims by index, measures by label.
								const key =
									j < report.rowDimensions.length
										? report.rowDimensions[j]
										: (report.measures[j - report.rowDimensions.length].alias ??
											measureLabel(report.measures[j - report.rowDimensions.length]));
								return (
									<td
										key={j}
										style={{
											padding: '0.4rem 0.6rem',
											borderBottom: `1px solid ${BORDER}`,
											fontWeight: j < report.rowDimensions.length ? 600 : undefined,
											color: 'var(--mmbix-foreground, #1f2937)',
											...(numericCols.has(h) ? { textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const } : {}),
										}}
									>
										{row[key] == null || row[key] === '' ? '\u2014' : String(row[key])}
									</td>
								);
							})}
						</tr>
					))}
					{result.data.length === 0 && (
						<tr>
							<td colSpan={headers.length} style={{ padding: '1.5rem', textAlign: 'center', color: MUTED }}>
								No data
							</td>
						</tr>
					)}
				</tbody>
			</table>
		</div>
	);
}

/**
 * Render a report definition — pivot or grouped — through the injected data
 * source. Handles loading / error states; the host supplies `dataSource`.
 */
export function ReportView({
	report,
	dataSource,
	onExport,
	showExport = false,
	exportFormats,
	labels,
	onCellClick,
	measureOptions,
	fields,
	className,
}: {
	report: ReportDefinition;
	dataSource: ReportDataSource;
	/** Pivot mode: show the toolbar Export button (calls `onExport`). */
	showExport?: boolean;
	/** Export formats offered by the toolbar (one = plain button, two = menu). */
	exportFormats?: Array<'csv' | 'xlsx'>;
	/** Pivot mode: download handler — receives the chosen format. */
	onExport?: (format?: 'csv' | 'xlsx') => void;
	/** i18n labels — defaults are English. */
	labels?: PivotLabels;
	/** Pivot mode: drill-down hook — fired on value/row-label cell clicks. */
	onCellClick?: (cell: PivotCellClick, activeDef: ReportDefinition) => void;
	/**
	 * Odoo-style measure picker: when provided, the pivot toolbar shows a measure
	 * dropdown and switching re-executes the report with the chosen measure.
	 */
	measureOptions?: MeasureOption[];
	/**
	 * Schema fields — when provided (and the report is a pivot), the toolbar gains
	 * a Customize trigger opening a Data-Studio-style panel to define the Y axis
	 * (rows), X axis (columns) and measure at runtime.
	 */
	fields?: Array<{ name: string; type: string; label?: string }>;
	className?: string;
}) {
	const [result, setResult] = useState<ReportResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [measure, setMeasure] = useState<string | null>(null);
	const [flipped, setFlipped] = useState(false);
	const [customizeOpen, setCustomizeOpen] = useState(false);
	// Runtime axis overrides (Data-Studio-style panel) — null = use the report's own.
	const [dims, setDims] = useState<{ rows: string[]; cols: string[] } | null>(null);

	// Reset runtime view state whenever the report definition changes.
	useEffect(() => {
		setMeasure(null);
		setFlipped(false);
		setDims(null);
	}, [report]);

	const rows = dims?.rows ?? report.rowDimensions;
	// Memoized so the `?? []` fallback doesn't hand useMemo below a fresh array
	// every render (which would invalidate activeDef each time).
	const cols = useMemo(() => dims?.cols ?? report.columnDimensions ?? [], [dims, report.columnDimensions]);

	const updateDims = (patch: Partial<{ rows: string[]; cols: string[] }>) => {
		setDims((prev) => {
			const base = prev ?? { rows: report.rowDimensions, cols: report.columnDimensions ?? [] };
			return { ...base, ...patch };
		});
		setFlipped(false);
	};

	// The active definition = the runtime axes → flip → selected measure.
	const activeDef = useMemo(() => {
		let def: ReportDefinition = { ...report, rowDimensions: rows, columnDimensions: cols.length ? cols : undefined };
		if (flipped && (def.columnDimensions?.length ?? 0) > 0) {
			def = { ...def, rowDimensions: def.columnDimensions ?? [], columnDimensions: def.rowDimensions };
		}
		if (!measureOptions?.length) return def;
		const chosen =
			measureOptions.find((o) => o.key === measure) ??
			measureOptions.find((o) => o.key === (report.measures[0]?.alias ?? '')) ??
			measureOptions[0];
		if (!chosen || chosen.measure === report.measures[0]) return def;
		return { ...def, measures: [chosen.measure] };
	}, [report, rows, cols, flipped, measure, measureOptions]);

	useEffect(() => {
		let cancelled = false;
		setResult(null);
		setError(null);
		dataSource(activeDef)
			.then((r) => {
				if (!cancelled) setResult(r);
			})
			.catch((err) => {
				if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report');
			});
		return () => {
			cancelled = true;
		};
	}, [dataSource, activeDef]);

	if (error) {
		return (
			<div className={className} style={{ padding: '1rem', color: 'var(--mmbix-destructive, #dc2626)', fontSize: '0.8rem' }}>
				{error}
			</div>
		);
	}

	if (report.type === 'pivot') {
		return (
			<div className={className} style={{ display: 'flex', alignItems: 'stretch', width: '100%', height: '100%', minHeight: 0 }}>
				{/* Table — shrinks when the customize column is open; scrolls internally. */}
				<div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
					<PivotTable
						fillHeight
						rows={result?.data ?? []}
						columns={result?.columns ?? []}
						rowLabel={activeDef.rowDimensions[0] ?? 'value'}
						isLoading={result === null}
						showTotals={report.layout.showTotals}
						density={report.layout.density}
						striped={report.layout.striped}
						stickyHeader={report.layout.stickyHeader}
						showExport={showExport}
						exportFormats={exportFormats}
						onExport={onExport}
						onCellClick={onCellClick ? (cell) => onCellClick(cell, activeDef) : undefined}
						measures={measureOptions?.map((o) => ({ key: o.key, label: o.label }))}
						measure={activeDef.measures[0]?.alias}
						onMeasureChange={setMeasure}
						onFlipAxis={(report.columnDimensions?.length ?? 0) > 0 ? () => setFlipped((f) => !f) : undefined}
						onCustomize={fields ? () => setCustomizeOpen((o) => !o) : undefined}
						customizeActive={customizeOpen}
						labels={labels}
					/>
				</div>
				{/* Right-side customize column (Data-Studio style) — pushes the table. */}
				{customizeOpen && fields && (
					<CustomizePanel
						rows={rows}
						cols={cols}
						measureKey={activeDef.measures[0]?.alias ?? ''}
						measureOptions={measureOptions ?? []}
						fields={fields}
						onRowsChange={(next) => updateDims({ rows: next })}
						onColsChange={(next) => updateDims({ cols: next })}
						onMeasureChange={setMeasure}
						onClose={() => setCustomizeOpen(false)}
					/>
				)}
			</div>
		);
	}

	return (
		<div className={className}>
			<GroupedReportTable
				report={report}
				result={
					result ?? {
						data: [],
						columns: [],
						meta: { collection: report.collection, rowDimensions: report.rowDimensions, columnDimensions: [], measures: [], totalRows: 0 },
					}
				}
			/>
		</div>
	);
}

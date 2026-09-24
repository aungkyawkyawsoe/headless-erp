import { useEffect, useMemo, useState } from 'react';
import { Input, NativeSelect, NativeSelectOption } from '@mmbix/design-system';
import { PivotTable } from '@mmbix/design-system/pivot';
import { X } from 'lucide-react';
import { starterPivotDef, type ReportDefinition, type ReportMeasureOp } from '@mmbix/types';
import { useBuilder } from './PageBuilderContext';
import { useReportPreview } from '../lib/use-report-preview';
import { SYSTEM_FIELD_NAMES } from '../lib/api';
import { IconBtn, PropCombobox, PropRow, PropSection, SwitchRow } from './formlayout/properties';

/**
 * PivotViewConfigEditor — the pivot view's property panel (Data-Studio style).
 *
 * Edits the view's `pivot` config (a ReportDefinition) with a LIVE preview
 * executed against the API (design == runtime). Supports multiple row/column
 * dimensions (plain fields or date buckets), multiple measures, limits
 * (rowLimit / top-N columns / subtotals) and layout options. Mirrored to
 * schema_json.pivot_view on save.
 */

const DATE_TYPES = new Set(['date', 'datetime', 'timestamp']);
const DATE_BUCKETS = ['month', 'week', 'quarter', 'year'] as const;

const MEASURE_OPS: Array<{ value: ReportMeasureOp; label: string }> = [
	{ value: 'count', label: 'Count' },
	{ value: 'sum', label: 'Sum' },
	{ value: 'avg', label: 'Average' },
	{ value: 'min', label: 'Min' },
	{ value: 'max', label: 'Max' },
	{ value: 'count_distinct', label: 'Count distinct' },
];

/** Pretty-print a dimension key: `month(claim_date)` → `Month of claim_date`. */
function dimLabel(d: string): string {
	const m = d.match(/^(month|week|quarter|year)\((.+)\)$/);
	if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} of ${m[2]}`;
	return d;
}

/** Small removable chip for a row/column dimension. */
function DimChip({ label, onRemove }: { label: string; onRemove: () => void }) {
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

export default function PivotViewConfigEditor({ view = 'pivot', compact: _compact = false }: { view?: string; compact?: boolean }) {
	const { viewConfigs, setViewConfig, collections, schemas, fetchSchema, token } = useBuilder();
	const vc = viewConfigs[view] ?? {};
	// The designer's config wins; otherwise start from the collection's BAKED
	// pivot_view (schema_json.pivot_view — seeded by the module demos or saved
	// from a previous session), so the editor opens on the runtime config.
	const designed = vc.pivot as ReportDefinition | undefined;
	// Schema source: the view's collection first, then the designed def's own
	// collection (kept in sync by the picker below), then the baked pivot's.
	const schemaSource = vc.collection ?? designed?.collection ?? '';
	const schema = schemaSource ? (schemas[schemaSource] ?? null) : null;

	useEffect(() => {
		if (schemaSource && !schemas[schemaSource]) void fetchSchema(schemaSource);
	}, [schemaSource, schemas, fetchSchema]);

	// User (non-system) fields — engine audit columns (deleted_at/created_at/…)
	// are never report dimensions, matching the runtime admin's field list.
	const fields = useMemo(
		() =>
			(schema?.schema_json.fields ?? []).filter(
				(f) => !['o2m', 'm2m', 'm2a', 'table', 'formula'].includes(f.type) && !SYSTEM_FIELD_NAMES.has(f.name),
			),
		[schema],
	);
	const baked = schema ? (schema.schema_json as { pivot_view?: ReportDefinition } | undefined)?.pivot_view : undefined;
	const starter = schema ? starterPivotDef(schemaSource, fields) : null;
	const pv = designed ?? baked ?? starter;
	const displayCollection = vc.collection ?? designed?.collection ?? baked?.collection ?? starter?.collection ?? '';
	// The def's collection mirrors the view's collection — the picker below syncs
	// both so the live preview and the saved pivot_view stay consistent.
	const set = (patch: Partial<ReportDefinition>) => setViewConfig(view, { pivot: { ...(pv ?? EMPTY_PIVOT), ...patch } });

	const { result, error } = useReportPreview(
		token,
		pv && pv.rowDimensions.length > 0
			? {
					collection: pv.collection || displayCollection || '',
					rowDimensions: pv.rowDimensions,
					...(pv.columnDimensions?.length ? { columnDimensions: pv.columnDimensions } : {}),
					measures: pv.measures,
				}
			: null,
	);

	// ── Field options (plain fields + date buckets for date fields) ──
	const fieldOptions = useMemo(() => {
		const out: Array<{ value: string; label: string }> = [];
		for (const f of fields) {
			out.push({ value: f.name, label: f.label || f.name });
			if (DATE_TYPES.has(f.type)) {
				for (const b of DATE_BUCKETS) {
					out.push({ value: `${b}(${f.name})`, label: `${b[0].toUpperCase()}${b.slice(1)} of ${f.label || f.name}` });
				}
			}
		}
		return out;
	}, [fields]);

	// ── Row / column dimensions ──
	const rows = pv?.rowDimensions ?? [];
	const cols = pv?.columnDimensions ?? [];
	const [addRow, setAddRow] = useState('');
	const [addCol, setAddCol] = useState('');
	const addDimension = (list: string[], setList: (next: string[]) => void, value: string) => {
		if (value && !list.includes(value)) setList([...list, value]);
	};

	// ── Measures ──
	const measures = pv?.measures ?? EMPTY_PIVOT.measures;
	const [addMeasure, setAddMeasure] = useState('');
	const updateMeasure = (i: number, patch: Partial<{ op: ReportMeasureOp; field: string }>) => {
		const next = measures.map((m, j) => {
			if (j !== i) return m;
			const merged = { ...m, ...patch };
			return { ...merged, alias: `${merged.op}_${merged.field === '*' ? 'all' : merged.field}` };
		});
		set({ measures: next });
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
			<PropSection title="Data">
				<PropRow label="Collection">
					<PropCombobox
						value={displayCollection}
						options={collections.map((c) => ({ value: c.slug, label: `${c.name} (${c.slug})` }))}
						onChange={(v) =>
							setViewConfig(view, {
								collection: v,
								// Sync the report definition's collection so the live preview and the
								// mirrored schema_json.pivot_view execute against the right table.
								pivot: { ...(pv ?? EMPTY_PIVOT), collection: v },
							})
						}
						placeholder="Pick a collection"
					/>
				</PropRow>

				{/* Rows — multiple dimensions (fields or date buckets) */}
				<PropRow label="Rows">
					<div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
						{rows.length > 0 && (
							<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
								{rows.map((d, i) => (
									<DimChip key={d} label={dimLabel(d)} onRemove={() => set({ rowDimensions: rows.filter((_, j) => j !== i) })} />
								))}
							</div>
						)}
						<PropCombobox
							value={addRow}
							options={fieldOptions}
							onChange={(v) => {
								addDimension(rows, (next) => set({ rowDimensions: next }), v);
								setAddRow('');
							}}
							placeholder="+ Add dimension"
						/>
					</div>
				</PropRow>

				{/* Columns — multiple dimensions (cross-tab headers) */}
				<PropRow label="Columns">
					<div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
						{cols.length > 0 && (
							<div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
								{cols.map((d, i) => (
									<DimChip key={d} label={dimLabel(d)} onRemove={() => set({ columnDimensions: cols.filter((_, j) => j !== i) })} />
								))}
							</div>
						)}
						<PropCombobox
							value={addCol}
							options={fieldOptions}
							onChange={(v) => {
								addDimension(cols, (next) => set({ columnDimensions: next.length ? next : undefined }), v);
								setAddCol('');
							}}
							placeholder="+ Add column dimension"
						/>
					</div>
				</PropRow>

				{/* Metrics — multiple measures */}
				<PropRow label="Metrics">
					<div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
						{measures.map((m, i) => (
							<div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
								<NativeSelect
									value={m.op}
									onChange={(e) => updateMeasure(i, { op: e.target.value as ReportMeasureOp })}
									aria-label={`Metric ${i + 1} operation`}
									style={{ height: 26, fontSize: '0.72rem', flex: '0 0 88px' }}
								>
									{MEASURE_OPS.map((o) => (
										<NativeSelectOption key={o.value} value={o.value}>
											{o.label}
										</NativeSelectOption>
									))}
								</NativeSelect>
								<div style={{ flex: 1, minWidth: 0 }}>
									<PropCombobox
										value={m.field === '*' ? '' : m.field}
										options={[{ value: '*', label: '* (all records)' }, ...fieldOptions]}
										onChange={(v) => updateMeasure(i, { field: v || '*' })}
										placeholder="Field"
									/>
								</div>
								<IconBtn title="Remove metric" danger onClick={() => set({ measures: measures.filter((_, j) => j !== i) })}>
									<X size={12} />
								</IconBtn>
							</div>
						))}
						<PropCombobox
							value={addMeasure}
							options={fieldOptions}
							onChange={(v) => {
								if (v) set({ measures: [...measures, { op: 'count', field: v, alias: `count_${v === '*' ? 'all' : v}` }] });
								setAddMeasure('');
							}}
							placeholder="+ Add metric"
						/>
					</div>
				</PropRow>

				{/* Limits — engine-side truncation */}
				<PropRow label="Row limit">
					<Input
						type="number"
						min={0}
						value={pv?.rowLimit ?? ''}
						onChange={(e) => set({ rowLimit: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
						placeholder="Keep top rows"
						style={{ height: 28 }}
					/>
				</PropRow>
				<PropRow label="Top N columns">
					<Input
						type="number"
						min={0}
						value={pv?.topNColumns ?? ''}
						onChange={(e) => set({ topNColumns: e.target.value === '' ? undefined : Math.max(1, Number(e.target.value)) })}
						placeholder="Rest into Other"
						style={{ height: 28 }}
					/>
				</PropRow>
				<SwitchRow label="Subtotals" checked={pv?.subtotals === true} onChange={(subtotals) => set({ subtotals })} />
			</PropSection>

			<PropSection title="Layout">
				<SwitchRow
					label="Totals"
					checked={pv?.layout.showTotals === true}
					onChange={(showTotals) => set({ layout: { ...(pv?.layout ?? DEFAULT_LAYOUT), showTotals } })}
				/>
				<SwitchRow
					label="Sticky header"
					checked={pv?.layout.stickyHeader !== false}
					onChange={(stickyHeader) => set({ layout: { ...(pv?.layout ?? DEFAULT_LAYOUT), stickyHeader } })}
				/>
				<SwitchRow
					label="Striped"
					checked={pv?.layout.striped === true}
					onChange={(striped) => set({ layout: { ...(pv?.layout ?? DEFAULT_LAYOUT), striped } })}
				/>
			</PropSection>

			{error ? (
				<div
					style={{
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						borderRadius: 8,
						padding: '0.6rem 0.8rem',
						fontSize: '0.78rem',
						color: 'var(--mmbix-destructive, #dc2626)',
					}}
				>
					{error}
				</div>
			) : (
				<div style={{ border: '1px solid var(--mmbix-border, #e5e7eb)', borderRadius: 8, padding: 8 }}>
					<p
						style={{
							margin: '0 0 6px',
							fontSize: '0.68rem',
							fontWeight: 700,
							textTransform: 'uppercase',
							letterSpacing: '0.04em',
							color: 'var(--mmbix-muted-foreground, #6b7280)',
						}}
					>
						Live preview
					</p>
					{pv?.collection && pv.rowDimensions.length > 0 ? (
						<PivotTable
							rows={result?.data ?? []}
							columns={result?.columns ?? []}
							rowLabel={pv.rowDimensions[0]}
							showTotals={pv.layout.showTotals}
							density={pv.layout.density}
							striped={pv.layout.striped}
							stickyHeader={pv.layout.stickyHeader}
							showToolbar={false}
							isLoading={result === null}
							labels={{ emptyCell: '—' }}
						/>
					) : (
						<p style={{ margin: 0, color: 'var(--mmbix-muted-foreground, #9ca3af)', fontSize: '0.78rem' }}>
							Pick a collection + at least one row dimension to preview.
						</p>
					)}
				</div>
			)}
		</div>
	);
}

const DEFAULT_LAYOUT = { showTotals: false, density: 'comfortable' as const, striped: false, stickyHeader: true };
const EMPTY_PIVOT: ReportDefinition = {
	type: 'pivot',
	collection: '',
	rowDimensions: [],
	measures: [{ op: 'count', field: '*', alias: 'count_all' }],
	layout: DEFAULT_LAYOUT,
};

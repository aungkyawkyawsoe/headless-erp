import { useEffect, useState, type KeyboardEvent } from 'react';
import {
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
} from '@mmbix/design-system';
import { Eye, EyeOff } from 'lucide-react';
import { SYSTEM_FIELD_NAMES } from '../lib/api';
import { useBuilder } from './PageBuilderContext';
import { PropCombobox, PropRow, PropSection, Segmented, SwitchRow, IconBtn } from './formlayout/properties';
import { tableColumnsOf, type TableColumnMeta, type TableViewConfig } from '@mmbix/ui-views';

/**
 * TableConfigEditor — the table view's property panel (right pane).
 * Edits the view's `table` config: data (collection, page size, sort),
 * columns (order / visibility / label / width / align / pin), rows
 * (density, actions, selection) and advanced (summary, presets).
 */
export default function TableConfigEditor({
	view,
	showData = true,
	showColumns = true,
	showRows = true,
	compact = false,
}: {
	view: string;
	showData?: boolean;
	showColumns?: boolean;
	showRows?: boolean;
	/** Compact (right-pane) layout: the Data grid drops from 4 columns to 2. */
	compact?: boolean;
}) {
	const { viewConfigs, setViewConfig, collections, schemas, tableColSel } = useBuilder();
	const vc = viewConfigs[view] ?? {};
	const schema = vc.collection ? (schemas[vc.collection] ?? null) : null;
	const fields = (schema?.schema_json.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const lv = vc.table ?? {};

	// Clicking a card selects it (highlight); Q opens the quick-edit dialog for the selected field.
	// A column clicked on the canvas header selects the matching field here.
	const [selected, setSelected] = useState<string | null>(null);
	const [quickField, setQuickField] = useState<string | null>(null);
	useEffect(() => {
		if (tableColSel) setSelected(tableColSel);
	}, [tableColSel]);

	// Keep the configured column list in sync with the schema's fields.
	const columns = tableColumnsOf(lv, fields);

	const patch = (p: Partial<TableViewConfig>) => setViewConfig(view, { table: { ...lv, ...p } });

	// Column mutations — the full ordered list (visible + hidden) lives in `columns`.
	const setCol = (name: string, meta: Partial<TableColumnMeta>) => {
		const next = columns.map((c) => (c.name === name ? { ...c, ...meta } : c));
		patch({ columns: next });
	};

	const preset = (mode: 'all' | 'minimal' | 'reset') => {
		if (mode === 'reset') {
			// Restore defaults: every field visible, default widths, no pins.
			patch({
				columns: undefined,
				density: undefined,
				striped: undefined,
				searchable: undefined,
				rowActions: undefined,
				selection: undefined,
				summary: undefined,
				defaultSort: undefined,
				pageSize: undefined,
			});
			return;
		}
		const next = fields.map((f) => ({
			name: f.name,
			visible: mode === 'all' ? true : ['name', 'title', 'label', 'code', 'display_number'].includes(f.name) || (f.required ? true : false),
			...(mode === 'minimal' && f.type === 'longtext' ? { width: '200px' } : {}),
		}));
		patch({ columns: next });
	};

	// 2-column (column-major) grid: index i sits at row `i % rows`, column `floor(i / rows)`.
	const rows = Math.ceil(columns.length / 2);
	const selIndex = selected ? columns.findIndex((c) => c.name === selected) : -1;

	/** Grid neighbour of index i in direction dir (stays in place at the edges). */
	const navTarget = (i: number, dir: 'up' | 'down' | 'left' | 'right') => {
		const n = columns.length;
		if (dir === 'up') return i % rows > 0 ? i - 1 : i;
		if (dir === 'down') return i + 1 < n && i % rows < rows - 1 ? i + 1 : i;
		if (dir === 'left') return i >= rows ? i - rows : i;
		return i + rows < n ? i + rows : i;
	};
	const selectAt = (i: number) => {
		const col = columns[Math.max(0, Math.min(columns.length - 1, i))];
		if (col) setSelected(col.name);
	};
	// Move the selected field one grid step (W/A/S/D) — swaps it with its neighbour.
	const moveField = (i: number, dir: 'up' | 'down' | 'left' | 'right') => {
		const j = navTarget(i, dir);
		if (j === i) return;
		const next = [...columns];
		[next[i], next[j]] = [next[j], next[i]];
		patch({ columns: next });
		setSelected(columns[i].name); // selection follows the moved field
	};
	// Arrow keys move the selection; W/A/S/D moves the selected field;
	// Space toggles the selected field's visibility. Ignored while typing.
	const onListKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
		if (selIndex < 0) return;
		if (e.key.startsWith('Arrow')) e.preventDefault();
		switch (e.key) {
			case 'ArrowUp':
				selectAt(navTarget(selIndex, 'up'));
				break;
			case 'ArrowDown':
				selectAt(navTarget(selIndex, 'down'));
				break;
			case 'ArrowLeft':
				selectAt(navTarget(selIndex, 'left'));
				break;
			case 'ArrowRight':
				selectAt(navTarget(selIndex, 'right'));
				break;
			case ' ': {
				// A focused checkbox already toggles on Space — don't double-toggle.
				if (t?.closest('[role="checkbox"]')) break;
				e.preventDefault();
				const c = columns[selIndex];
				setCol(c.name, { visible: c.visible === false });
				break;
			}
			case 'q':
			case 'Q': {
				// Quick-edit dialog for the selected field.
				const c = columns[selIndex];
				if (c) setQuickField(c.name);
				break;
			}
			case 'w':
			case 'W':
				moveField(selIndex, 'up');
				break;
			case 's':
			case 'S':
				moveField(selIndex, 'down');
				break;
			case 'a':
			case 'A':
				moveField(selIndex, 'left');
				break;
			case 'd':
			case 'D':
				moveField(selIndex, 'right');
				break;
		}
	};

	// Keep the selected card in view while navigating with the keyboard.
	useEffect(() => {
		if (selected) document.querySelector(`[data-col="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
	}, [selected]);

	const sortField = lv.defaultSort?.id ?? '';
	const sortDir = lv.defaultSort?.direction ?? 'desc';
	const visibleCount = columns.filter((c) => c.visible !== false).length;
	const hidden = columns.filter((c) => c.visible === false);
	const qf = quickField ? columns.find((c) => c.name === quickField) : null;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
			{showData && (
				<PropSection title="Data" defaultOpen>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: compact ? '1fr' : 'repeat(4, minmax(0, 1fr))',
							gap: '0.7rem',
							alignItems: 'start',
						}}
					>
						<PropRow label="Collection">
							<PropCombobox
								value={vc.collection ?? ''}
								options={collections.map((c) => ({ value: c.slug, label: `${c.name} (${c.slug})` }))}
								onChange={(v) => setViewConfig(view, { collection: v })}
								placeholder="Pick a collection"
							/>
						</PropRow>
						{vc.collection && (
							<PropRow label="Page size">
								<Segmented
									value={lv.pageSize ?? 25}
									options={[10, 25, 50, 100].map((n) => ({ value: n, label: n }))}
									onChange={(pageSize) => patch({ pageSize })}
								/>
							</PropRow>
						)}
						{vc.collection && (
							<PropRow label="Default sort" hint="Order of records when the table opens.">
								<PropCombobox
									value={sortField}
									options={fields.map((f) => ({ value: f.name, label: f.label || f.name }))}
									onChange={(id) => patch({ defaultSort: id ? { id, direction: sortDir } : undefined })}
									placeholder="Sort by…"
								/>
								{sortField && (
									<div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4 }}>
										<Segmented
											value={sortDir}
											options={[
												{ value: 'asc', label: 'A→Z' },
												{ value: 'desc', label: 'Z→A' },
											]}
											onChange={(direction) => patch({ defaultSort: { id: sortField, direction } })}
										/>
										<IconBtn title="Clear sort" onClick={() => patch({ defaultSort: undefined })}>
											<EyeOff size={11} />
										</IconBtn>
									</div>
								)}
							</PropRow>
						)}
						{vc.collection && (
							<PropRow label="Group by" hint="Group rows under a header by this column's value.">
								<PropCombobox
									value={lv.groupBy ?? ''}
									options={fields.map((f) => ({ value: f.name, label: f.label || f.name }))}
									onChange={(groupBy) => patch({ groupBy: groupBy || undefined })}
									placeholder="None — flat list"
								/>
								{lv.groupBy && (
									<div style={{ display: 'flex', marginTop: 4 }}>
										<IconBtn title="Clear group by" onClick={() => patch({ groupBy: undefined })}>
											<EyeOff size={11} />
										</IconBtn>
									</div>
								)}
							</PropRow>
						)}
					</div>
				</PropSection>
			)}

			{showColumns && vc.collection && fields.length > 0 && (
				<PropSection title={`Columns`} count={`${visibleCount} shown`} defaultOpen header={false}>
					<div style={{ display: 'flex', gap: 6 }}>
						<Button variant="outline" size="xs" onClick={() => preset('all')} style={{ flex: 1 }}>
							<Eye size={12} /> Show all
						</Button>
						<Button variant="outline" size="xs" onClick={() => preset('minimal')} style={{ flex: 1 }}>
							Minimal
						</Button>
						<Button variant="outline" size="xs" onClick={() => preset('reset')} style={{ flex: 1, color: '#dc2626' }}>
							Reset
						</Button>
					</div>
					<div
						tabIndex={0}
						onKeyDown={onListKeyDown}
						style={{
							display: 'grid',
							gridTemplateRows: `repeat(${Math.ceil(columns.length / 2)}, auto)`,
							gridAutoFlow: 'column',
							gap: 3,
							marginTop: 2,
							alignItems: 'start',
							outline: 'none',
						}}
					>
						{columns.map((c, i) => {
							const isVisible = c.visible !== false;
							return (
								<div
									key={c.name}
									data-col={c.name}
									style={{
										border: `1px solid ${selected === c.name ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-border, #e5e7eb)'}`,
										borderRadius: 8,
										background:
											selected === c.name ? 'var(--mmbix-muted, #f0fdfa)' : isVisible ? 'var(--mmbix-card, #ffffff)' : 'rgba(0,0,0,0.02)',
										opacity: isVisible ? 1 : 0.6,
									}}
								>
									{/* Row header — number + label + visibility checkbox */}
									<div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0.3rem 0.5rem' }}>
										<span style={{ fontSize: '0.66rem', fontWeight: 600, color: '#9ca3af', width: 15, flexShrink: 0, textAlign: 'center' }}>
											{i + 1}
										</span>
										<button
											type="button"
											title="Select · press Q for quick edit"
											onClick={() => setSelected(c.name)}
											style={{
												flex: 1,
												minWidth: 0,
												border: 'none',
												background: 'none',
												cursor: 'pointer',
												padding: 0,
												textAlign: 'left',
												fontSize: '0.78rem',
												fontWeight: isVisible ? 600 : 400,
												color: 'var(--mmbix-foreground, #374151)',
												overflow: 'hidden',
												textOverflow: 'ellipsis',
												whiteSpace: 'nowrap',
											}}
										>
											{c.label || fields.find((f) => f.name === c.name)?.label || c.name}
											{c.pinned && (
												<span style={{ fontSize: '0.6rem', color: 'var(--mmbix-primary, #2563eb)', marginLeft: 4 }}>● {c.pinned}</span>
											)}
											{c.width && <span style={{ fontSize: '0.6rem', color: '#9ca3af', marginLeft: 4 }}>{c.width}</span>}
										</button>
										<Checkbox
											checked={isVisible}
											onCheckedChange={(v) => setCol(c.name, { visible: !!v })}
											aria-label={isVisible ? `Hide ${c.name}` : `Show ${c.name}`}
										/>
									</div>
								</div>
							);
						})}
					</div>
					{hidden.length > 0 && (
						<p style={{ fontSize: '0.68rem', color: '#9ca3af', margin: '0.3rem 0 0' }}>
							{hidden.length} hidden — tick the checkbox to bring them back.
						</p>
					)}
				</PropSection>
			)}

			{showRows && vc.collection && (
				<PropSection title="Rows" count={[lv.rowActions, lv.selection, lv.summary].filter(Boolean).length || undefined}>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
						<SwitchRow
							label="Row actions"
							checked={lv.rowActions === true}
							onChange={(rowActions) => patch({ rowActions })}
							hint="Edit/open button on each row."
						/>
						<SwitchRow
							label="Inline edit"
							checked={lv.inlineEdit === true}
							onChange={(inlineEdit) => patch({ inlineEdit })}
							hint="Double-click a cell to edit it in place (runtime)."
						/>
						<SwitchRow
							label="Selection"
							checked={lv.selection === true}
							onChange={(selection) => patch({ selection })}
							hint={lv.groupBy ? 'Selection is disabled while rows are grouped.' : 'Checkboxes + bulk-actions bar.'}
							disabled={!!lv.groupBy}
						/>
						<SwitchRow
							label="Summary row"
							checked={lv.summary === true}
							onChange={(summary) => patch({ summary })}
							hint="Record count + totals of numeric columns in the toolbar."
						/>
						<SwitchRow
							label="Search toolbar"
							checked={lv.searchable !== false}
							onChange={(searchable) => patch({ searchable })}
							hint="Global search box in the toolbar."
						/>
						<SwitchRow label="Striped rows" checked={lv.striped === true} onChange={(striped) => patch({ striped })} />
						<SwitchRow label="Sticky header" checked={lv.stickyHeader !== false} onChange={(stickyHeader) => patch({ stickyHeader })} />
					</div>
					<PropRow label="Density">
						<PropCombobox
							value={lv.density ?? 'compact'}
							options={[
								{ value: 'compact', label: 'Compact' },
								{ value: 'comfortable', label: 'Comfortable' },
								{ value: 'spacious', label: 'Spacious' },
							]}
							onChange={(density) => patch({ density: (density || undefined) as TableViewConfig['density'] })}
							placeholder="Density"
						/>
					</PropRow>
				</PropSection>
			)}

			{/* Quick edit dialog — Q on a selected field opens it; changes apply live. */}
			{qf && (
				<Dialog
					open
					onOpenChange={(o) => {
						if (!o) setQuickField(null);
					}}
				>
					<DialogContent style={{ width: 360 }}>
						<DialogHeader>
							<DialogTitle>{qf.label || fields.find((f) => f.name === qf.name)?.label || qf.name}</DialogTitle>
							<DialogDescription>Quick edit this column — changes apply live to the table.</DialogDescription>
						</DialogHeader>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
							<PropRow label="Display label">
								<Input
									value={qf.label ?? ''}
									onChange={(e) => setCol(qf.name, { label: e.target.value || undefined })}
									placeholder={fields.find((f) => f.name === qf.name)?.label ?? qf.name}
									style={{ height: 28, fontSize: '0.8rem' }}
								/>
							</PropRow>
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
								<PropRow label="Width">
									<Input
										value={qf.width ?? ''}
										onChange={(e) => setCol(qf.name, { width: e.target.value.trim() || undefined })}
										placeholder="e.g. 140px"
										style={{ height: 28, fontSize: '0.8rem' }}
									/>
								</PropRow>
								<PropRow label="Align">
									<Segmented
										value={qf.align ?? 'left'}
										options={[
											{ value: 'left', label: 'L' },
											{ value: 'center', label: 'C' },
											{ value: 'right', label: 'R' },
										]}
										onChange={(align) => setCol(qf.name, { align: align === 'left' ? undefined : align })}
									/>
								</PropRow>
							</div>
							<PropRow label="Pin">
								<Segmented
									value={qf.pinned ?? ''}
									options={[
										{ value: '', label: 'None' },
										{ value: 'left', label: 'Left' },
										{ value: 'right', label: 'Right' },
									]}
									onChange={(pinned) => setCol(qf.name, { pinned: pinned === '' ? undefined : pinned })}
								/>
							</PropRow>
							<SwitchRow label="Sortable" checked={qf.sortable !== false} onChange={(sortable) => setCol(qf.name, { sortable })} />
						</div>
						<DialogFooter>
							<Button size="sm" onClick={() => setQuickField(null)}>
								Done
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</div>
	);
}

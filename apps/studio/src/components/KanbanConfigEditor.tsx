import { useEffect } from 'react';
import { Input } from '@mmbix/design-system';
import { SYSTEM_FIELD_NAMES } from '../lib/api';
import { useBuilder } from './PageBuilderContext';
import { OptionsEditor, PropCombobox, PropRow, PropSection, SwitchRow } from './formlayout/properties';
import type { KanbanViewConfig } from '@mmbix/ui-views';

/**
 * KanbanConfigEditor — the kanban view's property panel (right pane).
 * Edits the view's `kanban` config: data (collection), board (group-by field,
 * column order, metric) and cards (title/amount/info/tags/assignee, drag).
 * The middle canvas renders a pure live preview (KanbanBoard).
 */
export default function KanbanConfigEditor({ view = 'kanban', compact: _compact = false }: { view?: string; compact?: boolean }) {
	const { viewConfigs, setViewConfig, collections, schemas, fetchSchema } = useBuilder();
	const vc = viewConfigs[view] ?? {};
	const schema = vc.collection ? (schemas[vc.collection] ?? null) : null;

	useEffect(() => {
		if (vc.collection && !schemas[vc.collection]) void fetchSchema(vc.collection);
	}, [vc.collection, schemas, fetchSchema]);

	const fields = (schema?.schema_json.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const kv = vc.kanban ?? {};
	const patch = (p: Partial<KanbanViewConfig>) => setViewConfig(view, { kanban: { ...kv, ...p } });

	// Group-by candidates — select/text fields make sensible columns.
	const groupCandidates = fields.filter((f) => ['select', 'text', 'longtext', 'tags', 'integer', 'slug'].includes(f.type));
	const groupOptions = [{ value: '', label: 'None' }, ...groupCandidates.map((f) => ({ value: f.name, label: f.label || f.name }))];
	const groupByDef = fields.find((f) => f.name === kv.groupBy);
	const selectOptions =
		groupByDef?.type === 'select' && Array.isArray(groupByDef.options)
			? (groupByDef.options as Array<{ label?: string; value?: string }>)
			: null;

	// Field-picker options for the card slots — '' = none (clears the slot).
	const pickerOptions = [{ value: '', label: 'None' }, ...fields.map((f) => ({ value: f.name, label: f.label || f.name }))];
	const titleOptions = [{ value: '', label: 'Auto' }, ...fields.map((f) => ({ value: f.name, label: f.label || f.name }))];

	// Set one slot of a list config (infoFields/tagFields) — gaps collapse.
	const setSlot = (key: 'infoFields' | 'tagFields', index: number, value: string) => {
		const next = [...(kv[key] ?? [])];
		next[index] = value || '';
		const cleaned = next.filter(Boolean);
		patch({ [key]: cleaned.length > 0 ? cleaned : undefined } as Partial<KanbanViewConfig>);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
			<PropSection title="Data" defaultOpen>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
					<PropRow label="Collection">
						<PropCombobox
							value={vc.collection ?? ''}
							options={collections.map((c) => ({ value: c.slug, label: `${c.name} (${c.slug})` }))}
							onChange={(v) => setViewConfig(view, { collection: v })}
							placeholder="Pick a collection"
						/>
					</PropRow>
					{vc.collection && (
						<>
							<PropRow
								label="Group by"
								hint="Field that builds the columns (e.g. stage, status). Select fields also seed the column order."
							>
								<PropCombobox
									value={kv.groupBy ?? ''}
									options={groupOptions}
									onChange={(v) =>
										patch({
											groupBy: v || undefined,
											columns: v && selectOptions ? selectOptions.map((o) => o.value ?? '') : undefined,
										})
									}
									placeholder="Pick a field"
								/>
							</PropRow>
							{selectOptions && kv.groupBy ? (
								<PropRow label="Column order" hint="Reorder the pipeline columns — values not listed here appear at the end.">
									<OptionsEditor
										options={
											kv.columns?.length
												? kv.columns.map((v) => ({
														label: selectOptions.find((o) => o.value === v)?.label ?? v,
														value: v,
													}))
												: selectOptions
										}
										onChange={(next) => patch({ columns: next.map((o) => (typeof o === 'string' ? o : (o.value ?? ''))).filter(Boolean) })}
									/>
								</PropRow>
							) : null}
							<PropRow label="Title field" hint="Rendered as the card's heading — auto-picks the collection's display field when empty.">
								<PropCombobox
									value={kv.titleField ?? ''}
									options={titleOptions}
									onChange={(v) => patch({ titleField: v || undefined })}
									placeholder="Auto"
								/>
							</PropRow>
							<PropRow label="Amount field" hint="Numeric/currency field — summed per column and shown in the column header (e.g. 3.3 M).">
								<PropCombobox
									value={kv.amountField ?? ''}
									options={pickerOptions}
									onChange={(v) => patch({ amountField: v || undefined })}
									placeholder="None"
								/>
							</PropRow>
						</>
					)}
				</div>
			</PropSection>
			{vc.collection && (
				<PropSection title="Cards" defaultOpen>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
						<PropRow
							label="Info fields"
							hint="Muted lines under the title/amount (customer, contact, …) — phone/email/dates get icons — up to 4."
						>
							<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
								{([0, 1, 2, 3] as const).map((i) => (
									<PropCombobox
										key={i}
										value={kv.infoFields?.[i] ?? ''}
										options={pickerOptions}
										onChange={(v) => setSlot('infoFields', i, v)}
										placeholder="None"
									/>
								))}
							</div>
						</PropRow>
						<PropRow label="Tag fields" hint="Soft pills on the card (source, category, tags, …) — up to 3.">
							<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
								{([0, 1, 2] as const).map((i) => (
									<PropCombobox
										key={i}
										value={kv.tagFields?.[i] ?? ''}
										options={pickerOptions}
										onChange={(v) => setSlot('tagFields', i, v)}
										placeholder="None"
									/>
								))}
							</div>
						</PropRow>
						<PropRow label="Assigned to field" hint="m2o field whose record avatar appears on each card (e.g. assigned_to).">
							<PropCombobox
								value={kv.assignedToField ?? ''}
								options={pickerOptions}
								onChange={(v) => patch({ assignedToField: v || undefined })}
								placeholder="None"
							/>
						</PropRow>
						<PropRow label="Column width" hint="Board column width in px.">
							<Input
								type="number"
								value={kv.columnWidth ?? 300}
								onChange={(e) => patch({ columnWidth: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })}
								style={{ height: 26, fontSize: '0.72rem', width: 90 }}
							/>
						</PropRow>
						<SwitchRow
							label="Drag cards"
							hint="Allow dragging cards between columns — the runtime persists the group field."
							checked={kv.dragEnabled === true}
							onChange={(v) => patch({ dragEnabled: v || undefined })}
						/>
					</div>
				</PropSection>
			)}
		</div>
	);
}

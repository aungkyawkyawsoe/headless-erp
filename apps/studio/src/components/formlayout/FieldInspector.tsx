import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Label, Tabs, TabsContent, TabsList, TabsTrigger, Textarea } from '@mmbix/design-system';
import { ArrowDownRight, Copy, Plus, Trash2, X } from 'lucide-react';
import { type FieldCondition, type FieldDefinition, type FieldTypeDef, type ValidationRule } from '../../lib/api';
import { useRelatedSchema } from '../../lib/collection-table-filters';
import { ConditionBuilder, FieldTypeBadge, OptionsEditor, PropCombobox, PropRow, Segmented, SwitchRow } from './properties';
import { FieldTypeIcon } from './FieldTypeIcon';

/** Relation-like field types — get the Relation section. */
const RELATION_TYPES = new Set(['m2o', 'o2m', 'm2m', 'm2a', 'table']);

/** Sentinel option value for the "let the engine pick the default display field" choice. */
const AUTO_DISPLAY = '__auto__';

/** Number-like field types — get Min/Max/Step. */
const NUMBER_TYPES = new Set(['number', 'integer', 'bigint']);

const CURRENCIES = ['MMK', 'USD', 'EUR', 'GBP', 'SGD', 'THB', 'JPY', 'CNY', 'AUD', 'INR', 'KRW', 'VND'];

/** The 12 validation rule types — enforced by FieldValidator at the API. */
const VALIDATION_TYPES: Array<{ value: ValidationRule['type']; label: string }> = [
	{ value: 'required', label: 'Required' },
	{ value: 'min', label: 'Min value' },
	{ value: 'max', label: 'Max value' },
	{ value: 'min_length', label: 'Min length' },
	{ value: 'max_length', label: 'Max length' },
	{ value: 'regex', label: 'Regex pattern' },
	{ value: 'email', label: 'Email format' },
	{ value: 'url', label: 'URL format' },
	{ value: 'unique', label: 'Unique' },
	{ value: 'in', label: 'In list' },
	{ value: 'expression', label: 'Expression' },
	{ value: 'required_if', label: 'Required if' },
];

/** Validation-rule editor — one card per rule with type-specific params. */
function ValidationRulesEditor({
	rules,
	fields,
	onChange,
}: {
	rules: ValidationRule[];
	fields: FieldDefinition[];
	onChange: (r: ValidationRule[]) => void;
}) {
	const small: React.CSSProperties = { height: 26, fontSize: '0.74rem', width: '100%' };
	const upd = (i: number, patch: ValidationRule) => {
		const next = rules.slice();
		next[i] = patch;
		onChange(next);
	};
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
			{rules.length === 0 && (
				<span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
					No validation rules — values are only checked for required/type constraints.
				</span>
			)}
			{rules.map((rule, i) => (
				<div
					key={i}
					style={{
						display: 'flex',
						flexDirection: 'column',
						gap: 4,
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						borderRadius: 8,
						padding: '0.4rem',
					}}
				>
					<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
						<div style={{ flex: 1, minWidth: 0 }}>
							<PropCombobox
								value={rule.type}
								options={VALIDATION_TYPES.map((t) => ({ value: t.value, label: t.label }))}
								onChange={(t) => upd(i, { type: t as ValidationRule['type'] } as ValidationRule)}
								placeholder="Rule"
							/>
						</div>
						<button
							type="button"
							onClick={() => onChange(rules.filter((_, j) => j !== i))}
							title="Remove rule"
							style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', padding: 4, display: 'inline-flex' }}
						>
							<X size={13} />
						</button>
					</div>
					{['min', 'max', 'min_length', 'max_length'].includes(rule.type) && (
						<Input
							type="number"
							value={String((rule as { value?: number }).value ?? '')}
							onChange={(e) => upd(i, { ...rule, value: Number(e.target.value) || 0 } as ValidationRule)}
							placeholder={rule.type}
							style={small}
						/>
					)}
					{rule.type === 'regex' && (
						<Input
							value={rule.pattern ?? ''}
							onChange={(e) => upd(i, { ...rule, pattern: e.target.value })}
							placeholder="^[A-Z]{2}-\\d{4}$"
							style={small}
						/>
					)}
					{rule.type === 'in' && (
						<Input
							value={(rule.values ?? []).join(', ')}
							onChange={(e) =>
								upd(i, {
									...rule,
									values: e.target.value
										.split(',')
										.map((s) => s.trim())
										.filter(Boolean),
								})
							}
							placeholder="draft, published, archived"
							style={small}
						/>
					)}
					{rule.type === 'expression' && (
						<Input
							value={rule.formula ?? ''}
							onChange={(e) => upd(i, { ...rule, formula: e.target.value })}
							placeholder="value > 0 && value < 100"
							style={small}
						/>
					)}
					{rule.type === 'required_if' && (
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
							<PropCombobox
								value={rule.field ?? ''}
								options={fields.map((f) => ({ value: f.name, label: f.label || f.name }))}
								onChange={(f) => upd(i, { ...rule, field: f } as ValidationRule)}
								placeholder="Field"
							/>
							<Input
								value={String(rule.value ?? '')}
								onChange={(e) => upd(i, { ...rule, value: e.target.value } as ValidationRule)}
								placeholder="value"
								style={small}
							/>
						</div>
					)}
					<Input
						value={rule.message ?? ''}
						onChange={(e) => upd(i, { ...rule, message: e.target.value } as ValidationRule)}
						placeholder="Error message (optional)"
						style={small}
					/>
				</div>
			))}
			<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
				<Plus size={12} style={{ color: '#9ca3af', flexShrink: 0 }} />
				<div style={{ flex: 1, minWidth: 0 }}>
					<PropCombobox
						value=""
						options={VALIDATION_TYPES.map((t) => ({ value: t.value, label: t.label }))}
						onChange={(t) => onChange([...rules, { type: t as ValidationRule['type'] } as ValidationRule])}
						placeholder="Add rule…"
					/>
				</div>
			</div>
		</div>
	);
}

/** Full field property inspector — type-aware property groups as line tabs.
 *  Identity → Appearance → Behavior → Validation → Relation → Linkage → Advanced. */
export function FieldInspector({
	field,
	fields,
	update,
	remove,
	onDuplicate,
	groupOptions,
	onMoveToGroup,
	currentGroupId,
	fieldTypes,
	token,
}: {
	field: FieldDefinition;
	fields: FieldDefinition[];
	update: (patch: Partial<FieldDefinition>) => void;
	remove: () => void;
	onDuplicate?: (name: string) => void;
	groupOptions?: Array<{ id: string; title: string; tab: string }>;
	onMoveToGroup?: (name: string, gid: string) => void;
	currentGroupId?: string;
	/** Field-type catalog from the backend (`/api/field-types`) — the single source of truth. */
	fieldTypes?: FieldTypeDef[];
	/** Auth token — used to load the related collection's fields for the Display-field dropdown. */
	token?: string;
}) {
	// Changing type may drop type-specific config — confirm before applying.
	const changeType = (t: string) => {
		if (!t || t === field.type) return;
		const drops = field.options?.length ? 'its options' : field.related_collection ? 'its relation settings' : null;
		if (drops && !window.confirm(`Changing the type will drop ${drops}. Continue?`)) return;
		update({ type: t });
	};
	// Related collection's own fields — powers the "Display field" dropdown.
	const relatedSchema = useRelatedSchema(token ?? '', RELATION_TYPES.has(field.type) ? field.related_collection : undefined);
	const displayField = displayFieldOf(field.display_template);
	// A hand-written multi-field template (e.g. `{{eid}} — {{name}}`) isn't a single
	// field name — keep it selectable so the dropdown never silently clobbers it.
	const customTemplate = field.display_template && !displayField ? field.display_template : '';
	const displayFieldOptions = useMemo(() => {
		const options = [
			{ value: AUTO_DISPLAY, label: 'Default (auto)' },
			...(relatedSchema?.schema_json.fields ?? []).map((f) => ({ value: f.name, label: f.label || f.name })),
		];
		if (customTemplate) options.push({ value: customTemplate, label: `Custom: ${customTemplate}` });
		return options;
	}, [relatedSchema, customTemplate]);

	const appearanceActive =
		field.widget ||
		field.placeholder ||
		field.help ||
		field.options?.length ||
		field.min !== undefined ||
		field.max !== undefined ||
		field.step !== undefined ||
		field.currency ||
		field.file_accept ||
		field.max_size !== undefined ||
		field.rating_max !== undefined;

	// Content-set signals — a small dot on a tab means that section holds settings.
	const behaviorCount = [field.required, field.read_only, field.unique, field.index, field.encrypted].filter(Boolean).length;
	const validationCount = field.validation?.length ?? 0;
	const linkageCount = [field.visible_when, field.readonly_when, field.required_when].filter(Boolean).length;
	const relationActive = Boolean(field.cascade_delete || field.no_create || field.no_open);
	// Tab body style — matches the previous PropSection content box.
	const panelStyle: React.CSSProperties = { padding: '0.35rem 0.9rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' };
	const tabDot = (on: unknown) =>
		on ? (
			<span
				aria-hidden
				style={{
					width: 5,
					height: 5,
					borderRadius: 999,
					flexShrink: 0,
					background: 'var(--mmbix-primary, #0f766e)',
				}}
			/>
		) : null;

	return (
		<div style={{ display: 'flex', flexDirection: 'column' }}>
			{/* Identity header — icon + label + type badge (always visible). */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.75rem 0.9rem 0.5rem' }}>
				<FieldTypeIcon type={field.type} size={17} />
				<span
					style={{
						fontSize: '0.9rem',
						fontWeight: 700,
						color: 'var(--mmbix-foreground, #111827)',
						minWidth: 0,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{field.label || field.name}
				</span>
				<span style={{ marginLeft: 'auto' }}>
					<FieldTypeBadge type={field.type} />
				</span>
			</div>

			<Tabs defaultValue="identity">
				<TabsList variant="line" style={{ paddingLeft: '0.9rem', paddingRight: '0.9rem' }}>
					<TabsTrigger value="identity">Identity</TabsTrigger>
					<TabsTrigger value="appearance">
						Appearance
						{tabDot(appearanceActive)}
					</TabsTrigger>
					<TabsTrigger value="behavior">
						Behavior
						{tabDot(behaviorCount)}
					</TabsTrigger>
					<TabsTrigger value="validation">
						Validation
						{tabDot(validationCount)}
					</TabsTrigger>
					{RELATION_TYPES.has(field.type) && (
						<TabsTrigger value="relation">
							Relation
							{tabDot(relationActive)}
						</TabsTrigger>
					)}
					<TabsTrigger value="linkage">
						Linkage rules
						{tabDot(linkageCount)}
					</TabsTrigger>
					<TabsTrigger value="advanced">Advanced</TabsTrigger>
				</TabsList>

				<TabsContent value="identity">
					<div style={panelStyle}>
						<PropRow label="Field label">
							<Input
								value={field.label ?? ''}
								onChange={(e) => update({ label: e.target.value })}
								placeholder="Field label"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
						<PropRow label="Type">
							<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
								<FieldTypeIcon type={field.type} size={14} />
								<div style={{ flex: 1, minWidth: 0 }}>
									<PropCombobox
										value={field.type}
										options={(fieldTypes ?? []).map((t) => ({ value: t.type, label: t.label }))}
										onChange={(t) => changeType(t)}
										placeholder="Type"
									/>
								</div>
							</div>
						</PropRow>
						<PropRow label="Technical name" hint="Renaming would migrate data — not allowed in the Studio.">
							<Input
								value={field.name}
								readOnly
								style={{
									height: 28,
									fontSize: '0.78rem',
									background: 'var(--mmbix-muted, #f3f4f6)',
									fontFamily: 'ui-monospace, monospace',
								}}
							/>
						</PropRow>
					</div>
				</TabsContent>

				<TabsContent value="appearance">
					<div style={panelStyle}>
						<PropRow label="Placeholder">
							<Input
								value={field.placeholder ?? ''}
								onChange={(e) => update({ placeholder: e.target.value })}
								placeholder="e.g. Enter value…"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
						<PropRow label="Help tooltip">
							<Input
								value={field.help ?? ''}
								onChange={(e) => update({ help: e.target.value })}
								placeholder="Shown under the field"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
						{field.type === 'datetime' && (
							<PropRow label="Widget">
								<PropCombobox
									value={field.widget ?? 'datetime'}
									options={[
										{ value: 'datetime', label: 'Date & Time' },
										{ value: 'date', label: 'Date only' },
										{ value: 'date_range', label: 'Date Range' },
										{ value: 'remaining_days', label: 'Remaining Days countdown' },
									]}
									onChange={(widget) => update({ widget: widget || 'datetime' })}
								/>
							</PropRow>
						)}
						{field.type === 'select' && (
							<PropRow
								label="Options"
								hint="Each option: a stored value + a display label (blank label shows the value). The form stores the value on records and shows the label in dropdowns."
							>
								<OptionsEditor options={field.options ?? []} onChange={(options) => update({ options })} />
							</PropRow>
						)}
						{NUMBER_TYPES.has(field.type) && (
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.45rem' }}>
								<PropRow label="Min">
									<NumInput value={field.min} onChange={(v) => update({ min: v })} />
								</PropRow>
								<PropRow label="Max">
									<NumInput value={field.max} onChange={(v) => update({ max: v })} />
								</PropRow>
								<PropRow label="Step">
									<NumInput value={field.step} onChange={(v) => update({ step: v })} />
								</PropRow>
							</div>
						)}
						{field.type === 'currency' && (
							<PropRow label="Currency">
								<PropCombobox
									value={field.currency ?? 'MMK'}
									options={CURRENCIES.map((c) => ({ value: c, label: c }))}
									onChange={(currency) => update({ currency: currency || 'MMK' })}
								/>
							</PropRow>
						)}
						{field.type === 'file' && (
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.45rem' }}>
								<PropRow label="Accept extensions" hint="Comma-separated, e.g. png,jpg,pdf">
									<Input
										value={field.file_accept ?? ''}
										onChange={(e) => update({ file_accept: e.target.value.trim() })}
										placeholder="png,jpg,pdf"
										style={{ height: 28, fontSize: '0.8rem' }}
									/>
								</PropRow>
								<PropRow label="Max size (MB)">
									<NumInput value={field.max_size} onChange={(v) => update({ max_size: v })} />
								</PropRow>
							</div>
						)}
						{field.type === 'rating' && (
							<PropRow label="Maximum stars">
								<Segmented
									value={field.rating_max ?? 5}
									options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: n, label: n }))}
									onChange={(rating_max) => update({ rating_max })}
								/>
							</PropRow>
						)}
					</div>
				</TabsContent>

				<TabsContent value="behavior">
					<div style={panelStyle}>
						<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
							<SwitchRow
								label="Required"
								checked={!!field.required}
								onChange={(c) => update({ required: c })}
								hint="The field must have a value before saving."
							/>
							<SwitchRow
								label="Read-only"
								checked={!!field.read_only}
								onChange={(c) => update({ read_only: c })}
								hint="Users can view but not edit this field."
							/>
							<SwitchRow
								label="Unique"
								checked={!!field.unique}
								onChange={(c) => update({ unique: c })}
								hint="No two records may share the same value."
							/>
							<SwitchRow
								label="Indexed"
								checked={!!field.index}
								onChange={(c) => update({ index: c })}
								hint="Speeds up filtering/sorting on this column."
							/>
							<SwitchRow
								label="Encrypted"
								checked={!!field.encrypted}
								onChange={(c) => update({ encrypted: c })}
								hint="Encrypt at rest (AES-256-GCM) — requires ENCRYPTION_KEY."
							/>
						</div>
					</div>
				</TabsContent>

				<TabsContent value="validation">
					<div style={panelStyle}>
						<ValidationRulesEditor
							rules={field.validation ?? []}
							fields={fields}
							onChange={(validation) => update({ validation: validation.length > 0 ? validation : undefined })}
						/>
					</div>
				</TabsContent>

				{RELATION_TYPES.has(field.type) && (
					<TabsContent value="relation">
						<div style={panelStyle}>
							<PropRow label="Related collection" hint="The collection this field references. Type a collection, or collection.field.">
								<RelationInput field={field} update={update} />
							</PropRow>
							<PropRow
								label="Display field"
								hint={
									field.related_collection
										? "Which field of the related record to show. Empty = the related collection's default display field."
										: 'Optional template using {{field}} placeholders (e.g. {{name}}).'
								}
							>
								{field.related_collection ? (
									<PropCombobox
										value={customTemplate || displayField || AUTO_DISPLAY}
										options={displayFieldOptions}
										onChange={(v) => {
											if (v === customTemplate) return; // keep the hand-written template
											update({ display_template: v && v !== AUTO_DISPLAY ? `{{${v}}}` : undefined });
										}}
										placeholder="Default (auto)"
									/>
								) : (
									<Input
										value={field.display_template ?? ''}
										onChange={(e) => update({ display_template: e.target.value || undefined })}
										placeholder="e.g. {{name}}"
										style={{ height: 28, fontSize: '0.8rem' }}
									/>
								)}
							</PropRow>
							<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
								<SwitchRow
									label="No create"
									checked={!!field.no_create}
									onChange={(c) => update({ no_create: c })}
									hint="Don't offer 'Create new' in the picker."
								/>
								<SwitchRow
									label="No open"
									checked={!!field.no_open}
									onChange={(c) => update({ no_open: c })}
									hint="Don't let users open the related record."
								/>
								<SwitchRow
									label="Cascade delete"
									checked={!!field.cascade_delete}
									onChange={(c) => update({ cascade_delete: c })}
									hint="Deleting the parent deletes related records."
								/>
							</div>
						</div>
					</TabsContent>
				)}

				<TabsContent value="linkage">
					<div style={panelStyle}>
						<ConditionBuilder
							title="Show only when"
							condition={field.visible_when}
							fields={fields}
							exclude={field.name}
							onChange={(c) => update({ visible_when: c })}
						/>
						<ConditionBuilder
							title="Read-only when"
							condition={field.readonly_when}
							fields={fields}
							exclude={field.name}
							onChange={(c) => update({ readonly_when: c })}
						/>
						<ConditionBuilder
							title="Required when"
							condition={field.required_when}
							fields={fields}
							exclude={field.name}
							onChange={(c) => update({ required_when: c })}
						/>
					</div>
				</TabsContent>

				<TabsContent value="advanced">
					<div style={panelStyle}>
						<PropRow label="Default value" hint="Applied on create — supports $NOW, $UUID, $USER_ID, or =expression.">
							<Input
								value={field.default?.toString() ?? ''}
								onChange={(e) => update({ default: e.target.value })}
								placeholder="e.g. $NOW or =qty * rate"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
						<PropRow
							label="Computed formula"
							hint="Safe expression over fields — qty * rate, SUM(items.amount), COUNT(items), related.name."
						>
							<Textarea
								value={field.formula ?? ''}
								onChange={(e) => update({ formula: e.target.value || undefined })}
								placeholder="qty * rate - discount"
								rows={6}
								style={{
									fontSize: '0.8rem',
									fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
									lineHeight: 1.5,
								}}
							/>
						</PropRow>
						<PropRow label="Formula type">
							<div style={{ width: 140 }}>
								<PropCombobox
									value={field.formula_type ?? 'expression'}
									options={[
										{ value: 'expression', label: 'expr' },
										{ value: 'lookup', label: 'lookup' },
									]}
									onChange={(t) => update({ formula_type: (t || 'expression') as 'expression' | 'lookup' })}
									placeholder="expr"
								/>
							</div>
						</PropRow>
						<PropRow
							label="Store computed value"
							hint="Materialize into a real column (filterable/sortable/indexable), recomputed on every write. Off = virtual, computed on read only."
						>
							<div style={{ display: 'flex', gap: 4 }}>
								<SwitchRow label="Store" checked={field.store === true} onChange={(v) => update({ store: v })} />
								<div style={{ width: 120 }}>
									<PropCombobox
										value={field.result_type ?? 'number'}
										options={['number', 'string', 'boolean', 'json'].map((v) => ({ value: v, label: v }))}
										onChange={(t) => update({ result_type: (t || 'number') as 'number' | 'string' | 'boolean' | 'json' })}
										placeholder="number"
									/>
								</div>
							</div>
						</PropRow>
						<PropRow
							label="Precision / rounding"
							hint="Round numeric results to N decimals (enterprise totals: 2). half_up = invoices/Excel, half_even = banker, up/down = ceiling/floor."
						>
							<div style={{ display: 'flex', gap: 4 }}>
								<Input
									type="number"
									min={0}
									max={10}
									value={field.precision?.toString() ?? ''}
									onChange={(e) => update({ precision: e.target.value === '' ? undefined : Number(e.target.value) })}
									placeholder="decimals"
									style={{ width: 84, height: 28, fontSize: '0.8rem' }}
								/>
								<div style={{ width: 120 }}>
									<PropCombobox
										value={field.rounding ?? 'half_up'}
										options={['half_up', 'half_even', 'up', 'down'].map((v) => ({ value: v, label: v }))}
										onChange={(t) => update({ rounding: (t || 'half_up') as 'half_up' | 'half_even' | 'up' | 'down' })}
										placeholder="half_up"
									/>
								</div>
							</div>
						</PropRow>
						<PropRow label="Display template" hint="Full label template — {{ name }} — {{ code }} (double braces).">
							<Input
								value={field.display_template ?? ''}
								onChange={(e) => update({ display_template: e.target.value || undefined })}
								placeholder="{{ name }} — {{ code }}"
								style={{ height: 28, fontSize: '0.8rem' }}
							/>
						</PropRow>
					</div>
				</TabsContent>
			</Tabs>

			<div
				style={{
					display: 'flex',
					flexDirection: 'column',
					gap: '0.45rem',
					padding: '0.75rem 0.9rem 1rem',
					borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
					marginTop: '0.25rem',
				}}
			>
				{onMoveToGroup &&
					groupOptions &&
					currentGroupId &&
					(() => {
						const targets = groupOptions.filter((g) => g.id !== currentGroupId);
						if (targets.length === 0) return null;
						return (
							<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
								<Label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
									Move to group
								</Label>
								<div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 160, overflowY: 'auto' }}>
									{targets.map((g) => (
										<button
											key={g.id}
											type="button"
											onClick={() => onMoveToGroup(field.name, g.id)}
											style={{
												display: 'flex',
												alignItems: 'center',
												gap: 6,
												padding: '0.3rem 0.5rem',
												border: '1px solid transparent',
												borderRadius: 6,
												background: 'none',
												cursor: 'pointer',
												fontSize: '0.76rem',
												textAlign: 'left',
												color: 'var(--mmbix-foreground, #374151)',
											}}
										>
											<ArrowDownRight size={12} style={{ color: '#9ca3af' }} /> {g.title || 'Untitled'}
											<span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: '#9ca3af' }}>{g.tab}</span>
										</button>
									))}
								</div>
							</div>
						);
					})()}
				<div style={{ display: 'flex', gap: 6 }}>
					{onDuplicate && (
						<Button variant="outline" size="sm" onClick={() => onDuplicate(field.name)} style={{ flex: 1 }}>
							<Copy size={12} /> Duplicate
						</Button>
					)}
					<Button variant="destructive" size="sm" onClick={remove} style={{ flex: 1 }}>
						<Trash2 size={12} /> Remove
					</Button>
				</div>
			</div>
		</div>
	);
}

/* ── Relation `collection.fieldname` input ── */
function RelationInput({ field, update }: { field: FieldDefinition; update: (p: Partial<FieldDefinition>) => void }) {
	const simple = displayFieldOf(field.display_template);
	const combined = field.related_collection ? field.related_collection + (simple ? `.${simple}` : '') : '';
	const [text, setText] = useState(combined);

	// Sync when the field changes from outside (undo / refresh / display-field input).
	useEffect(() => {
		setText(combined);
	}, [combined]);

	// Commit on blur / Enter — typing stays local so the draft isn't clobbered.
	const commit = (v: string) => {
		setText(v);
		const t = v.trim();
		if (!t) {
			update({ related_collection: '', display_template: undefined });
			return;
		}
		const dot = t.indexOf('.');
		if (dot > 0 && dot < t.length - 1) {
			update({ related_collection: t.slice(0, dot).trim(), display_template: `{{${t.slice(dot + 1).trim()}}}` });
		} else if (dot > 0) {
			update({ related_collection: t.slice(0, dot).trim() });
		} else {
			update({ related_collection: t });
		}
	};

	return (
		<Input
			value={text}
			onChange={(e) => setText(e.target.value)}
			onBlur={(e) => commit(e.target.value)}
			onKeyDown={(e) => {
				if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
			}}
			placeholder="departments or departments.name"
			style={{ height: 28, fontSize: '0.8rem', fontFamily: 'ui-monospace, monospace' }}
		/>
	);
}

/** Extract a plain `{{ field }}` template → "field"; empty for complex templates. */
function displayFieldOf(template?: string): string {
	if (!template) return '';
	const m = template.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
	return m ? m[1] : '';
}

/** Compact numeric property input (empty → undefined). */
function NumInput({ value, onChange }: { value?: number | string; onChange: (v: number | undefined) => void }) {
	return (
		<Input
			type="number"
			value={value?.toString() ?? ''}
			onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
			placeholder="—"
			style={{ height: 28, fontSize: '0.8rem' }}
		/>
	);
}

export { ConditionBuilder };
export type { FieldCondition };

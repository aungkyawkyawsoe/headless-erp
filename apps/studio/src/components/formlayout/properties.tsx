import {
	Badge,
	Button,
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	Input,
	Label,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Switch,
	ToggleGroup,
	ToggleGroupItem,
} from '@mmbix/design-system';
import { ChevronDown, Plus, X } from 'lucide-react';
import { GroupIcon } from '@mmbix/ui-views';
import type { ReactNode } from 'react';
import IconPicker from '../IconPicker';
import { FieldTypeIcon } from './FieldTypeIcon';
import type { FieldCondition, FieldDefinition } from '../../lib/api';

/* ─────────────────────────────────────────────────────────────────────
 * Shared property-pane primitives (Odoo-style inspector).
 * Every control is a small, focused unit: label + control + optional hint.
 * ───────────────────────────────────────────────────────────────────── */

/** One property row — label above, control below, optional muted hint. */
export function PropRow({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			<Label style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{label}</Label>
			{children}
			{hint && <span style={{ fontSize: '0.66rem', color: '#9ca3af', lineHeight: 1.4 }}>{hint}</span>}
		</div>
	);
}

/** Collapsible property section with an uppercase title + optional count badge. */
export function PropSection({
	title,
	count,
	defaultOpen = false,
	header = true,
	children,
}: {
	title: string;
	count?: string | number;
	defaultOpen?: boolean;
	header?: boolean;
	children: ReactNode;
}) {
	if (!header) {
		// Headerless mode: content always visible, no collapsible trigger.
		return <div style={{ padding: '0.35rem 0.9rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>{children}</div>;
	}
	return (
		<Collapsible defaultOpen={defaultOpen}>
			<CollapsibleTrigger
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 6,
					width: '100%',
					padding: '0.45rem 0.9rem',
					border: 'none',
					background: 'none',
					cursor: 'pointer',
					textAlign: 'left',
				}}
			>
				<ChevronDown size={12} style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)', flexShrink: 0 }} />
				<span
					style={{
						fontSize: '0.7rem',
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
					}}
				>
					{title}
				</span>
				{count !== undefined && (
					<Badge variant="outline" style={{ marginLeft: 'auto', fontSize: '0.6rem' }}>
						{count}
					</Badge>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent>
				<div style={{ padding: '0.35rem 0.9rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>{children}</div>
			</CollapsibleContent>
		</Collapsible>
	);
}

/** Full-width searchable picker built on the design-system Combobox (replaces native <select>). */
export function PropCombobox({
	value,
	options,
	onChange,
	placeholder,
}: {
	value: string;
	options: Array<{ value: string; label: string }>;
	onChange: (v: string) => void;
	placeholder?: string;
}) {
	return (
		<Combobox
			value={value}
			items={options.map((o) => o.value)}
			onValueChange={(v) => onChange(v == null ? '' : String(v))}
			onInputValueChange={() => {}}
			itemToStringLabel={(v) => options.find((o) => o.value === String(v))?.label ?? String(v)}
		>
			<ComboboxInput showTrigger placeholder={placeholder ?? 'Pick…'} style={{ width: '100%', height: 28, fontSize: '0.78rem' }} />
			<ComboboxContent align="start" sideOffset={4} style={{ minWidth: 200 }}>
				<ComboboxList>
					{(item: string) => {
						const o = options.find((opt) => opt.value === item);
						return (
							<ComboboxItem key={item} value={item}>
								{o?.label ?? item}
							</ComboboxItem>
						);
					}}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}

/** A labelled Switch (behavior toggles — required, read-only, …). */
export function SwitchRow({
	label,
	checked,
	onChange,
	hint,
	disabled,
}: {
	label: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	hint?: string;
	disabled?: boolean;
}) {
	return (
		<div
			style={{
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'space-between',
				gap: 8,
				padding: '0.4rem 0.55rem',
				border: '1px solid var(--mmbix-border, #e5e7eb)',
				borderRadius: 8,
				background: 'var(--mmbix-card, #ffffff)',
				opacity: disabled ? 0.55 : 1,
			}}
			title={hint}
		>
			<span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--mmbix-foreground, #374151)' }}>{label}</span>
			<Switch
				checked={checked}
				onCheckedChange={(c) => {
					if (!disabled) onChange(c === true);
				}}
				size="sm"
				disabled={disabled}
			/>
		</div>
	);
}

/** Segmented toggle-group — e.g. grid columns 1/2/3/4. */
export function Segmented<T extends string | number>({
	value,
	options,
	onChange,
	label,
}: {
	value: T;
	options: Array<{ value: T; label: ReactNode; title?: string }>;
	onChange: (v: T) => void;
	label?: string;
}) {
	return (
		<ToggleGroup
			value={[String(value)]}
			onValueChange={(vals) => {
				const v = vals?.[0] ?? null;
				if (v !== null) onChange(v as unknown as T);
			}}
			aria-label={label}
		>
			{options.map((o) => (
				<ToggleGroupItem
					key={String(o.value)}
					value={String(o.value)}
					title={o.title}
					style={{ width: 30, height: 26, fontSize: '0.72rem' }}
				>
					{o.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

/** Visual icon picker for group labels — same CDN-based lucide library picker
 *  used in the New App dialog (1700+ icons, searchable), never a hardcoded set. */
export function GroupIconPicker({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
	return (
		<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
			<span
				title={value ?? 'No icon'}
				style={{
					width: 30,
					height: 30,
					borderRadius: 8,
					border: `1px solid ${value ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-border, #e5e7eb)'}`,
					background: value ? 'var(--mmbix-muted, #f0fdfa)' : 'var(--mmbix-card, #ffffff)',
					display: 'inline-flex',
					alignItems: 'center',
					justifyContent: 'center',
					color: 'var(--mmbix-primary, #2563eb)',
					flexShrink: 0,
				}}
			>
				{value ? <GroupIcon name={value} size={17} /> : <X size={13} style={{ color: '#9ca3af' }} />}
			</span>
			<Popover>
				<PopoverTrigger
					render={
						<button
							type="button"
							style={{
								flex: 1,
								height: 28,
								borderRadius: 6,
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								background: 'var(--mmbix-card, #ffffff)',
								cursor: 'pointer',
								fontSize: '0.76rem',
								color: 'var(--mmbix-foreground, #374151)',
							}}
						>
							{value ? 'Change icon…' : 'Choose icon…'}
						</button>
					}
				/>
				<PopoverContent side="left" sideOffset={6} style={{ width: 300, padding: '0.6rem' }}>
					<IconPicker value={value ?? ''} onChange={(name) => onChange(name)} />
					{value && (
						<Button variant="ghost" size="sm" onClick={() => onChange(undefined)} style={{ marginTop: 6, color: '#dc2626' }}>
							<X size={12} /> Remove icon
						</Button>
					)}
				</PopoverContent>
			</Popover>
		</div>
	);
}

/** Field type badge — colored type icon + type name (identity header). */
export function FieldTypeBadge({ type }: { type: string }) {
	return (
		<span
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 5,
				fontSize: '0.72rem',
				fontWeight: 600,
				color: '#6b7280',
				background: 'var(--mmbix-muted, #f3f4f6)',
				borderRadius: 999,
				padding: '0.15rem 0.55rem 0.15rem 0.35rem',
			}}
		>
			<FieldTypeIcon type={type} size={12} /> {type}
		</span>
	);
}

/* ─────────────────────────────────────────────────────────────────────
 * ConditionBuilder — linkage rules (visible_when / readonly_when /
 * required_when / group-level visible_when). The value input adapts to the
 * chosen field's type when possible (select → dropdown of its options, etc.).
 * ───────────────────────────────────────────────────────────────────── */

export const CONDITION_OPS = [
	{ value: 'eq', label: 'equals' },
	{ value: 'neq', label: 'not equals' },
	{ value: 'in', label: 'in list' },
	{ value: 'nin', label: 'not in list' },
	{ value: 'gt', label: 'greater than' },
	{ value: 'gte', label: 'greater or equal' },
	{ value: 'lt', label: 'less than' },
	{ value: 'lte', label: 'less or equal' },
	{ value: 'contains', label: 'contains' },
	{ value: 'starts_with', label: 'starts with' },
	{ value: 'is_empty', label: 'is empty' },
	{ value: 'is_not_empty', label: 'is not empty' },
] as const;

export function ConditionBuilder({
	title,
	condition,
	fields,
	exclude,
	onChange,
}: {
	title: string;
	condition?: FieldCondition;
	fields: FieldDefinition[];
	exclude: string;
	onChange: (c: FieldCondition | undefined) => void;
}) {
	const has = !!condition?.field;
	const needsValue = !!condition?.op && !['is_empty', 'is_not_empty'].includes(condition.op);
	const targetField = fields.find((f) => f.name === condition?.field);
	const isListOp = condition?.op === 'in' || condition?.op === 'nin';
	const isBoolean = targetField?.type === 'boolean';
	const selectOptions = targetField?.type === 'select' ? (targetField.options ?? []) : [];

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: '0.4rem',
				padding: '0.55rem 0.6rem',
				border: `1px dashed ${has ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-border, #e5e7eb)'}`,
				borderRadius: 8,
				background: has ? 'rgba(15, 118, 110, 0.04)' : 'transparent',
			}}
		>
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
				<span
					style={{
						fontSize: '0.72rem',
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
					}}
				>
					{title}
				</span>
				<Button variant="ghost" size="icon-xs" onClick={() => onChange(undefined)} title="Clear condition">
					{has ? <X size={12} /> : null}
				</Button>
			</div>
			{has ? (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
						<PropCombobox
							value={condition.field}
							options={fields.filter((f) => f.name !== exclude).map((f) => ({ value: f.name, label: f.label || f.name }))}
							onChange={(field) => onChange({ ...condition, field })}
							placeholder="Field"
						/>
						<PropCombobox
							value={condition.op}
							options={CONDITION_OPS.map((o) => ({ value: o.value, label: o.label }))}
							onChange={(op) => onChange({ ...condition, op: (op || 'eq') as FieldCondition['op'] })}
							placeholder="Operator"
						/>
					</div>
					{needsValue && (
						<ValueInput condition={condition} isListOp={isListOp} isBoolean={isBoolean} selectOptions={selectOptions} onChange={onChange} />
					)}
				</div>
			) : (
				<Button
					variant="outline"
					size="sm"
					onClick={() => onChange({ field: fields.find((f) => f.name !== exclude)?.name ?? '', op: 'eq', value: '' })}
					style={{ justifyContent: 'flex-start' }}
				>
					<Plus size={13} /> Add condition
				</Button>
			)}
		</div>
	);
}

/** Type-aware condition value input. */
function ValueInput({
	condition,
	isListOp,
	isBoolean,
	selectOptions,
	onChange,
}: {
	condition: FieldCondition;
	isListOp: boolean;
	isBoolean: boolean;
	selectOptions: Array<string | { label?: string; value?: string }>;
	onChange: (c: FieldCondition) => void;
}) {
	// Boolean target → Yes / No / Blank segmented picker.
	if (isBoolean && !isListOp) {
		const boolValue = String(condition.value);
		const opts = [
			{ v: 'true', label: 'Yes' },
			{ v: 'false', label: 'No' },
			{ v: '', label: 'Empty' },
		];
		return (
			<Segmented
				value={boolValue}
				options={opts.map((o) => ({ value: o.v, label: o.label }))}
				onChange={(v) => onChange({ ...condition, value: v === '' ? '' : v === 'true' })}
			/>
		);
	}
	// Select target → dropdown of its options (faster + fewer typos).
	if (selectOptions.length > 0 && !isListOp) {
		return (
			<PropCombobox
				value={String(condition.value ?? '')}
				options={[
					{ value: '', label: '—' },
					...selectOptions.map((o) => {
						const v = typeof o === 'string' ? o : String(o.value ?? o.label ?? '');
						return { value: v, label: typeof o === 'string' ? o : (o.label ?? o.value ?? '') };
					}),
				]}
				onChange={(value) => onChange({ ...condition, value })}
				placeholder="Value"
			/>
		);
	}
	return (
		<Input
			value={Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '')}
			onChange={(e) => {
				const val = isListOp
					? e.target.value
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					: e.target.value;
				onChange({ ...condition, value: val });
			}}
			placeholder={isListOp ? 'comma, separated, values' : 'value'}
		/>
	);
}

/* ─────────────────────────────────────────────────────────────────────
 * OptionsEditor — reorderable select-options list (add / remove / move).
 * ───────────────────────────────────────────────────────────────────── */

export function OptionsEditor({
	options,
	onChange,
}: {
	options: Array<string | { label?: string; value?: string }>;
	onChange: (next: Array<string | { label?: string; value?: string }>) => void;
}) {
	const move = (i: number, dir: -1 | 1) => {
		const next = [...options];
		const j = i + dir;
		if (j < 0 || j >= next.length) return;
		[next[i], next[j]] = [next[j], next[i]];
		onChange(next);
	};
	// Row model: every option stores a `value` (what gets saved on records) and a
	// display `label` (what the dropdowns show). Legacy plain-string options and
	// the auto "option_N" placeholders read as both — they only become
	// { value, label } objects once edited.
	const rowOf = (o: string | { label?: string; value?: string }): { value: string; label: string } =>
		typeof o === 'string' ? { value: o, label: o } : { value: String(o.value ?? o.label ?? ''), label: String(o.label ?? '') };
	const set = (i: number, patch: { value?: string; label?: string }) => {
		const prev = rowOf(options[i]);
		const value = patch.value !== undefined ? patch.value : prev.value;
		const label = patch.label !== undefined ? patch.label : prev.label;
		const next = [...options];
		// A blank label is dropped so renderers fall back to the value (an option
		// with no label simply displays its value). The value is always stored.
		next[i] = label ? { value, label } : { value };
		onChange(next);
	};
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
			{options.map((o, i) => {
				const { value, label } = rowOf(o);
				return (
					// Key by INDEX, not by value/label text: the inputs hold the editable
					// values, so text-derived keys would remount the row on every
					// keystroke (focus lost after each character). Inputs are fully
					// controlled — index keys keep the DOM stable while typing and still
					// render fresh values on reorder.
					<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
						<Input
							value={value}
							onChange={(e) => set(i, { value: e.target.value })}
							placeholder="value"
							title="Stored value — what gets saved on the record"
							style={{ height: 26, fontSize: '0.75rem', flex: 1, minWidth: 0 }}
						/>
						<Input
							value={label}
							onChange={(e) => set(i, { label: e.target.value })}
							placeholder="label"
							title="Display label — blank shows the value"
							style={{ height: 26, fontSize: '0.75rem', flex: 1, minWidth: 0 }}
						/>
						<IconBtn title="Move up" onClick={() => move(i, -1)} disabled={i === 0}>
							<span style={{ fontSize: '0.72rem' }}>↑</span>
						</IconBtn>
						<IconBtn title="Move down" onClick={() => move(i, 1)} disabled={i === options.length - 1}>
							<span style={{ fontSize: '0.72rem' }}>↓</span>
						</IconBtn>
						<IconBtn title="Remove option" onClick={() => onChange(options.filter((_, x) => x !== i))} danger>
							<X size={11} />
						</IconBtn>
					</div>
				);
			})}
			<Button
				variant="outline"
				size="sm"
				onClick={() => onChange([...options, `option_${options.length + 1}`])}
				style={{ justifyContent: 'flex-start' }}
			>
				<Plus size={12} /> Add option
			</Button>
		</div>
	);
}

/** Tiny square icon button (reorder / remove rows). */
export function IconBtn({
	title,
	onClick,
	disabled,
	danger,
	children,
}: {
	title: string;
	onClick: () => void;
	disabled?: boolean;
	danger?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			disabled={disabled}
			onClick={onClick}
			style={{
				width: 22,
				height: 22,
				borderRadius: 5,
				border: '1px solid var(--mmbix-border, #e5e7eb)',
				background: 'var(--mmbix-card, #ffffff)',
				cursor: disabled ? 'default' : 'pointer',
				opacity: disabled ? 0.4 : 1,
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				color: danger ? '#dc2626' : '#6b7280',
				padding: 0,
				flexShrink: 0,
			}}
		>
			{children}
		</button>
	);
}

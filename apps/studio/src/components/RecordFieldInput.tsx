import { useId } from 'react';
import {
	Button,
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxValue,
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLabel,
	Input,
	Label,
	Switch,
	Textarea,
	TimePicker,
	useComboboxAnchor,
} from '@mmbix/design-system';
import { DatePicker } from '@mmbix/design-system/datepicker';
import { selectDisplayLabel } from '@mmbix/ui-views';
import { X } from 'lucide-react';
import type { FieldDefinition } from '../lib/api';
import { mmtDateOf, mmtTimeOf, toUtcDatetime } from '../lib/datetime';
import { m2mIds } from '../lib/record-label';
import { ImageFieldInput } from './ImageFieldInput';

/** JSON field value → editor text. The API decodes JSON columns into real
 *  objects/arrays (decodeJsonFields) — String() on those renders the useless
 *  "[object Object],…" and saving it back would corrupt the row — so structured
 *  values pretty-print here; raw JSON strings pass through untouched. */
function jsonEditorText(v: unknown): string {
	if (v === null || v === undefined || v === '') return '';
	if (typeof v === 'string') return v;
	try {
		return JSON.stringify(v, null, 2) ?? '';
	} catch {
		return String(v);
	}
}

/** 'YYYY-MM-DD…' prefix (date or datetime) → a LOCAL-midnight Date — parsing via
 *  `new Date('YYYY-MM-DD')` would land on UTC midnight and shift a day in
 *  negative-offset timezones; component-based construction avoids that drift. */
function ymdOf(v: unknown): Date | undefined {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
	if (!m) return undefined;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isNaN(d.getTime()) ? undefined : d;
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

/** Local Date → 'YYYY-MM-DD' (what the engine stores for date/datetime). */
function toYmd(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 'HH:MM' out of a time ('09:00') or datetime ('2026-09-03T17:25:00Z') value. */
function hhmmOf(v: unknown): string {
	const s = String(v ?? '');
	const t = s.includes('T') ? s.slice(s.indexOf('T') + 1) : s;
	const m = /^(\d{2}):(\d{2})/.exec(t);
	return m ? `${m[1]}:${m[2]}` : '';
}

/** Compact ✕ — the DS pickers have no clear affordance (the native inputs they
 *  replace could be cleared), so optional temporal fields get one. */
function ClearButton({ label, onClear }: { label: string; onClear: () => void }) {
	return (
		<Button
			type="button"
			variant="ghost"
			onClick={onClear}
			title={`Clear ${label}`}
			aria-label={`Clear ${label}`}
			style={{ flexShrink: 0, width: 30, height: 30, padding: 0 }}
		>
			<X size={13} />
		</Button>
	);
}

/** Design-system form field control for one editable schema field.
 *
 *  Shared by the create/edit dialogs and the Directus-style record detail view so
 *  both render identically (no duplicated select/combobox logic). Dropdowns
 *  (select / m2o / m2m) always use the design-system Combobox — never a native
 *  <select>. m2o renders a single-select, m2m a multi-select chip field.
 */
export function RecordFieldInput({
	field,
	value,
	onChange,
	options,
	token,
	readOnly = false,
	required,
	error,
	onBlur,
}: {
	field: FieldDefinition;
	value: unknown;
	onChange: (v: unknown) => void;
	/** Related (m2o/m2m) row options — { id, label } pairs. */
	options?: Array<{ id: string; label: string }>;
	/** Auth token — required only for media-type fields (image) that upload. */
	token?: string;
	/** Linkage state — the field is shown (visible_when held) but not editable
	 *  (readonly_when / static read_only); every control renders disabled. */
	readOnly?: boolean;
	/** Linkage-aware required — from fieldRuntimeState; falls back to the field's
	 *  static flag when omitted (the common no-condition case). */
	required?: boolean;
	/** Inline validation message (from validateField). When set the control is
	 *  marked aria-invalid and described by the message; omitted = no error. */
	error?: string;
	/** Fired when focus LEAVES the whole field (not on an internal move such as the
	 *  date→time pair of a datetime control). The parent validates on this. */
	onBlur?: () => void;
}) {
	const label = field.label || field.name;
	const isRequired = required ?? Boolean(field.required);
	const helper = field.help;
	// One id per rendered field instance — the inline message is announced through
	// `aria-describedby` on the control (empty `error`/omitted = no error).
	const errorId = useId();
	const invalid = Boolean(error);
	const describedBy = invalid ? errorId : undefined;
	const ariaProps = { 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy };

	/** Blur bubbles (focusout) — ignore a move that stays INSIDE this field so the
	 *  datetime date→time pair doesn't validate mid-edit. */
	function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
		if (!onBlur) return;
		const next = e.relatedTarget as Node | null;
		if (next && e.currentTarget.contains(next)) return;
		onBlur();
	}
	// Anchor for the m2m chips popup (the DS ComboboxInput auto-anchors itself;
	// the chips variant needs an explicit ref passed to ComboboxContent).
	const chipsAnchor = useComboboxAnchor();

	// Select options are either plain strings or Studio-style { label, value } objects.
	const selectOptions = (field.options ?? []).map((o) =>
		typeof o === 'string' ? { value: o, label: o } : { value: o.value ?? o.label ?? '', label: o.label ?? o.value ?? '' },
	);

	const control = (() => {
		if (field.type === 'boolean') {
			return (
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<Switch checked={Boolean(value)} disabled={readOnly} onCheckedChange={(c) => onChange(Boolean(c))} />
					<Label style={{ fontSize: '0.8rem' }}>{label}</Label>
				</div>
			);
		}
		if (field.type === 'select') {
			// Store the raw option value, display the label — an explicit option
			// label wins, otherwise lowercase enum tokens render humanized
			// (`male` → `Male`) exactly like the table cells and runtime pages.
			const displayLabel = (v: string) => selectDisplayLabel(v, field.options);
			return (
				<Combobox
					value={String(value ?? '')}
					items={selectOptions.map((o) => o.value)}
					disabled={readOnly}
					onValueChange={(v) => onChange(String(v ?? ''))}
					onInputValueChange={() => {}}
					itemToStringLabel={(v) => displayLabel(String(v))}
				>
					<ComboboxInput
						{...ariaProps}
						showTrigger
						placeholder={field.placeholder ?? 'Pick…'}
						style={{ width: '100%', fontSize: '0.8rem' }}
					/>
					<ComboboxContent align="start" sideOffset={4} style={{ minWidth: 200 }}>
						<ComboboxList>
							{(item: string) => (
								<ComboboxItem key={item} value={item}>
									{displayLabel(item)}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			);
		}
		if (field.type === 'm2m') {
			const opts = options ?? [];
			// Related rows arrive expanded ({ id, … } objects) from '*.*' reads — the
			// form stores just the selected ids, matching the engine's payload contract.
			const selected = m2mIds(value);
			const labelOf = (id: string) => opts.find((o) => o.id === id)?.label ?? id;
			return (
				<Combobox
					multiple
					items={opts.map((o) => o.id)}
					value={selected}
					disabled={readOnly}
					onValueChange={(v) => onChange(Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x)))) : [])}
					onInputValueChange={() => {}}
					itemToStringLabel={(id) => labelOf(String(id))}
					itemToStringValue={(id) => labelOf(String(id))}
				>
					<ComboboxChips ref={chipsAnchor} style={{ width: '100%', fontSize: '0.8rem' }}>
						<ComboboxValue>
							{selected.map((id) => (
								<ComboboxChip key={id} title={labelOf(id)}>
									{labelOf(id)}
								</ComboboxChip>
							))}
						</ComboboxValue>
						<ComboboxChipsInput {...ariaProps} placeholder={field.placeholder ?? 'Pick…'} />
					</ComboboxChips>
					<ComboboxContent anchor={chipsAnchor} align="start" sideOffset={4} style={{ minWidth: 220 }}>
						<ComboboxEmpty>No options found.</ComboboxEmpty>
						<ComboboxList>
							{(item: string) => (
								<ComboboxItem key={item} value={item}>
									{labelOf(item)}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			);
		}
		if (field.type === 'm2o') {
			return (
				<Combobox
					value={String(value ?? '')}
					items={(options ?? []).map((o) => o.id)}
					disabled={readOnly}
					onValueChange={(v) => onChange(String(v ?? ''))}
					onInputValueChange={() => {}}
					itemToStringLabel={(v) => (options ?? []).find((o) => o.id === String(v))?.label ?? String(v)}
				>
					<ComboboxInput
						{...ariaProps}
						showTrigger
						placeholder={field.placeholder ?? 'Pick…'}
						style={{ width: '100%', fontSize: '0.8rem' }}
					/>
					<ComboboxContent align="start" sideOffset={4} style={{ minWidth: 200 }}>
						<ComboboxList>
							{(item: string) => (
								<ComboboxItem key={item} value={item}>
									{(options ?? []).find((o) => o.id === item)?.label ?? item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			);
		}
		if (field.type === 'longtext' || field.type === 'text_editor' || field.type === 'markdown' || field.type === 'code') {
			return (
				<Textarea
					{...ariaProps}
					value={String(value ?? '')}
					onChange={(e) => onChange(e.target.value)}
					placeholder={field.placeholder}
					rows={3}
					disabled={readOnly}
					style={{ fontSize: '0.8rem' }}
				/>
			);
		}
		if (field.type === 'json') {
			// Monospace JSON editor — formatted for viewing, editable as text. The
			// payload stays the editor text (a JSON string) so untouched saves round-
			// trip: the engine stores json values verbatim and re-parses them on read.
			return (
				<Textarea
					{...ariaProps}
					value={jsonEditorText(value)}
					onChange={(e) => onChange(e.target.value)}
					placeholder={field.placeholder ?? '{ "key": "value" }'}
					rows={7}
					spellCheck={false}
					disabled={readOnly}
					style={{
						fontSize: '0.78rem',
						lineHeight: 1.5,
						fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
						whiteSpace: 'pre',
						minHeight: 150,
					}}
				/>
			);
		}
		if (
			field.type === 'number' ||
			field.type === 'integer' ||
			field.type === 'bigint' ||
			field.type === 'currency' ||
			field.type === 'percent' ||
			field.type === 'rating' ||
			field.type === 'duration' ||
			field.type === 'progress'
		) {
			return (
				<Input
					{...ariaProps}
					type="number"
					min={field.min}
					max={field.max}
					step={field.step}
					value={value === undefined || value === null ? '' : String(value)}
					onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
					placeholder={field.placeholder}
					disabled={readOnly}
					style={{ fontSize: '0.8rem' }}
				/>
			);
		}
		if (field.type === 'date') {
			const date = ymdOf(value);
			return (
				<div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
					<div style={{ flex: 1, minWidth: 0 }}>
						<DatePicker
							value={date}
							onValueChange={(d) => onChange(d ? toYmd(d) : null)}
							placeholder={field.placeholder ?? 'Pick a date'}
							disabled={readOnly}
							className="w-full"
						/>
					</div>
					{date && !readOnly && <ClearButton label={label} onClear={() => onChange(null)} />}
				</div>
			);
		}
		if (field.type === 'time') {
			const time = hhmmOf(value);
			return (
				<div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
					<div style={{ flex: 1, minWidth: 0 }}>
						<TimePicker
							value={time}
							onValueChange={(v) => onChange(v)}
							placeholder={field.placeholder ?? 'Pick a time'}
							disabled={readOnly}
							className="w-full"
						/>
					</div>
					{time && !readOnly && <ClearButton label={label} onClear={() => onChange(null)} />}
				</div>
			);
		}
		if (field.type === 'datetime' || field.type === 'timestamp') {
			// A stored UTC instant is edited in Myanmar time (MMT, +6:30) and
			// round-tripped back to the UTC ISO string the engine stores — the
			// operator sees the same wall clock as the table cells and the mini
			// app, while the stored value stays timezone-free.
			const date = mmtDateOf(value);
			const time = mmtTimeOf(value);
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
					<div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
						<div style={{ flex: 1, minWidth: 0 }}>
							<DatePicker
								value={date}
								onValueChange={(d) => onChange(d ? toUtcDatetime(toYmd(d), time || '00:00') : null)}
								placeholder={field.placeholder ?? 'Pick a date'}
								disabled={readOnly}
								className="w-full"
							/>
						</div>
						{date && !readOnly && <ClearButton label={label} onClear={() => onChange(null)} />}
					</div>
					<TimePicker
						value={time}
						disabled={readOnly || !date}
						onValueChange={(t) => onChange(t && date ? toUtcDatetime(toYmd(date), t) : null)}
						placeholder="Pick a time"
						className="w-full"
					/>
				</div>
			);
		}
		if (field.type === 'image') {
			// ImageFieldInput has no disabled prop of its own — block pointer access when
			// the field is linkage read-only so its Upload/Gallery controls can't be used.
			return (
				<div style={readOnly ? { pointerEvents: 'none', opacity: 0.6 } : undefined} aria-disabled={readOnly || undefined}>
					<ImageFieldInput value={value} onChange={onChange} token={token} />
				</div>
			);
		}
		return (
			<Input
				{...ariaProps}
				type="text"
				value={String(value ?? '')}
				onChange={(e) => onChange(e.target.value)}
				placeholder={field.placeholder}
				required={isRequired}
				disabled={readOnly}
				style={{ fontSize: '0.8rem' }}
			/>
		);
	})();

	return (
		<Field orientation="vertical" data-invalid={invalid || undefined} onBlur={handleBlur}>
			<FieldLabel style={{ fontSize: '0.78rem' }}>
				{label}
				{isRequired && <span style={{ color: 'var(--mmbix-destructive, #dc2626)' }}> *</span>}
			</FieldLabel>
			<FieldContent>
				{control}
				{helper && <FieldDescription style={{ fontSize: '0.72rem' }}>{helper}</FieldDescription>}
				{invalid && (
					<FieldError id={errorId} style={{ fontSize: '0.72rem' }}>
						{error}
					</FieldError>
				)}
			</FieldContent>
		</Field>
	);
}

import { useEffect, useRef, useState } from 'react';
import { Input, NativeSelect, NativeSelectOption, Switch, Textarea } from '@mmbix/design-system';
import { selectDisplayLabel } from '@mmbix/ui-views';
import { updateItem, type FieldDefinition } from '../lib/api';
import { mmtDateOf, mmtTimeOf, toUtcDatetime } from '../lib/datetime';
import { DataCell } from './DataCell';

/**
 * Inline editing for a collection-table cell — fix a typo (or set a value)
 * in place, without opening the record dialog.
 *
 * Only the SIMPLE, single-control types are editable here. A type that cannot be
 * edited safely from a one-cell control (relations, media, json, computed, …)
 * falls back to the read-only `DataCell` — the component never guesses an editor
 * for a type it does not fully understand.
 *
 * Interaction (matching the create/edit form's expectations):
 *   - double-click, or Enter/Space when the cell is focused → open the editor;
 *   - Enter commits (Cmd/Ctrl+Enter in a longtext), Esc cancels, blur commits;
 *   - a failed save ROLLS BACK to the previous value and shows the error, so the
 *     cell never displays a value the server did not persist.
 *
 * The write reuses the existing record-update API (`updateItem`) — the page owns
 * the permission gate (`readOnly`) and the refresh (`onSaved`), so no policy or
 * query logic is duplicated here.
 */

/** The SIMPLE field types an inline cell may edit in place. */
export const INLINE_EDITABLE_TYPES: ReadonlySet<string> = new Set([
	'text',
	'longtext',
	'number',
	'integer',
	'boolean',
	'date',
	'datetime',
	'select',
]);

export function isInlineEditableType(field: FieldDefinition): boolean {
	return INLINE_EDITABLE_TYPES.has(field.type);
}

export interface InlineCellEditorProps {
	field: FieldDefinition;
	value: unknown;
	/** The record's id — a write targets `/api/entities/:slug/:id`. */
	recordId: string;
	/** The collection the record belongs to. */
	collectionSlug: string;
	/** Auth token for the write. */
	token: string;
	/** Permission / write-lock gate from the page — a field the operator may not
	 *  write stays a read-only cell (least privilege). */
	readOnly?: boolean;
	/** Fired after a SUCCESSFUL save so the page can refresh its rows. */
	onSaved?: (value: unknown) => void;
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

function ymdOf(d: Date): string {
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** The stored value → the editor's text. `date` is a calendar value (`YYYY-MM-DD`,
 *  timezone-free); `datetime` is a UTC instant edited in Myanmar time — the same
 *  wall clock the table cells show and the same round-trip the form uses. */
function editorText(field: FieldDefinition, value: unknown): string {
	if (value === null || value === undefined) return '';
	if (field.type === 'datetime') {
		const d = mmtDateOf(value);
		return d ? `${ymdOf(d)}T${mmtTimeOf(value) || '00:00'}` : '';
	}
	if (field.type === 'date') return String(value).slice(0, 10);
	return String(value);
}

/** The editor's text → what the API stores (empty optional values clear to null). */
function storedValue(field: FieldDefinition, text: string): unknown {
	if (field.type === 'number' || field.type === 'integer') return text === '' ? null : Number(text);
	if (field.type === 'date') return text === '' ? null : text;
	if (field.type === 'datetime') {
		if (text === '') return null;
		const [day, time] = text.split('T');
		return toUtcDatetime(day, time || '00:00');
	}
	// text / longtext / select store the string as typed.
	return text;
}

const ERROR_STYLE = { display: 'block', marginTop: 2, fontSize: '0.68rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)' };
const HINT_STYLE = { display: 'block', marginTop: 2, fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #6b7280)' };

export function InlineCellEditor({ field, value, recordId, collectionSlug, token, readOnly = false, onSaved }: InlineCellEditorProps) {
	// A type we cannot edit safely, or a field the operator may not write, stays read-only.
	const editable = !readOnly && field.read_only !== true && isInlineEditableType(field);

	const [shown, setShown] = useState<unknown>(value);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	// True only while an edit is in flight — guards a blur-commit racing an unmount.
	const activeRef = useRef(false);
	// Synchronous re-entry guard (the `saving` state lags a same-tick double event).
	const savingRef = useRef(false);
	const lastValueRef = useRef(value);

	// Adopt a value the parent pushes (e.g. after a refresh) — the server is truth.
	useEffect(() => {
		if (lastValueRef.current !== value) {
			lastValueRef.current = value;
			setShown(value);
		}
	}, [value]);

	// Focus the freshly-mounted control (and select its text). querySelector so it
	// works for input / textarea / native select / switch with no ref plumbing.
	useEffect(() => {
		if (!editing) return;
		const el = containerRef.current?.querySelector<HTMLElement>('input, textarea, select, button');
		if (!el) return;
		el.focus();
		if (el instanceof HTMLInputElement && el.type !== 'checkbox') el.select();
	}, [editing]);

	if (!editable) return <DataCell field={field} value={value} />;

	function beginEdit() {
		if (savingRef.current) return;
		setError(null);
		setDraft(field.type === 'boolean' ? String(Boolean(shown)) : editorText(field, shown));
		activeRef.current = true;
		setEditing(true);
	}

	function cancel() {
		activeRef.current = false;
		setError(null);
		setEditing(false);
	}

	/** Persist `next` (or just close when nothing changed). On failure the cell
	 *  rolls back to the previous value and shows the error. */
	async function persist(next: unknown, unchanged: boolean) {
		if (!activeRef.current || savingRef.current) return;
		if (unchanged) {
			activeRef.current = false;
			setEditing(false);
			return;
		}
		savingRef.current = true;
		setSaving(true);
		setError(null);
		try {
			await updateItem(token, collectionSlug, recordId, { [field.name]: next });
			setShown(next);
			onSaved?.(next);
		} catch (e) {
			// Never leave an unpersisted value on screen.
			setError(e instanceof Error ? e.message : 'Save failed');
		} finally {
			savingRef.current = false;
			activeRef.current = false;
			setSaving(false);
			setEditing(false);
		}
	}

	function commit() {
		if (field.type === 'boolean') {
			const next = draft === 'true';
			void persist(next, Boolean(shown) === next);
			return;
		}
		void persist(storedValue(field, draft), draft === editorText(field, shown));
	}

	if (editing) {
		const control = (() => {
			switch (field.type) {
				case 'longtext':
					return (
						<Textarea
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							rows={2}
							disabled={saving}
							style={{ fontSize: '0.8rem', minHeight: 0 }}
						/>
					);
				case 'number':
				case 'integer':
					return (
						<Input
							type="number"
							value={draft}
							min={field.min}
							max={field.max}
							step={field.step}
							onChange={(e) => setDraft(e.target.value)}
							disabled={saving}
							style={{ fontSize: '0.8rem' }}
						/>
					);
				case 'boolean':
					return (
						<Switch
							checked={draft === 'true'}
							disabled={saving}
							onCheckedChange={(c) => {
								const next = Boolean(c);
								setDraft(String(next));
								activeRef.current = true;
								void persist(next, Boolean(shown) === next);
							}}
						/>
					);
				case 'select':
					return (
						<NativeSelect
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							disabled={saving}
							size="sm"
							className="w-full"
							style={{ fontSize: '0.8rem' }}
						>
							<NativeSelectOption value="">—</NativeSelectOption>
							{(field.options ?? []).map((o) => {
								const v = typeof o === 'string' ? o : (o.value ?? o.label ?? '');
								return (
									<NativeSelectOption key={v} value={v}>
										{selectDisplayLabel(v, field.options)}
									</NativeSelectOption>
								);
							})}
						</NativeSelect>
					);
				case 'date':
					return (
						<Input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={saving} style={{ fontSize: '0.8rem' }} />
					);
				case 'datetime':
					return (
						<Input
							type="datetime-local"
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							disabled={saving}
							style={{ fontSize: '0.8rem' }}
						/>
					);
				default:
					return (
						<Input type="text" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={saving} style={{ fontSize: '0.8rem' }} />
					);
			}
		})();

		return (
			<div
				ref={containerRef}
				onClick={(e) => e.stopPropagation()}
				onKeyDown={(e) => {
					if (e.key === 'Escape') {
						e.preventDefault();
						e.stopPropagation();
						cancel();
						return;
					}
					if (e.key === 'Enter') {
						// A longtext needs Enter for newlines — commit is Cmd/Ctrl+Enter there.
						if (field.type === 'longtext' && !(e.metaKey || e.ctrlKey)) return;
						e.preventDefault();
						e.stopPropagation();
						commit();
					}
				}}
				onBlur={(e) => {
					if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
					commit();
				}}
				style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}
			>
				{control}
				{saving && <span style={HINT_STYLE}>Saving…</span>}
				{error && (
					<span role="alert" style={ERROR_STYLE}>
						{error}
					</span>
				)}
			</div>
		);
	}

	return (
		<span style={{ display: 'block' }}>
			<span
				role="button"
				tabIndex={0}
				aria-label={`Edit ${field.label || field.name}`}
				title="Double-click to edit"
				data-inline-editable="true"
				onClick={(e) => e.stopPropagation()}
				onDoubleClick={(e) => {
					e.stopPropagation();
					beginEdit();
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						beginEdit();
					}
				}}
				style={{ display: 'block', cursor: 'text', borderRadius: 4 }}
			>
				<DataCell field={field} value={shown} />
			</span>
			{error && (
				<span role="alert" style={ERROR_STYLE}>
					{error}
				</span>
			)}
		</span>
	);
}

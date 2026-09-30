import { useEffect, useMemo, useState } from 'react';
import { Alert, AlertDescription, Button } from '@mmbix/design-system';
import { X } from 'lucide-react';
import { createItem, updateItem, SYSTEM_FIELD_NAMES, type EntitySchema } from '../lib/api';
import { RECORD_EDITABLE_TYPES, docStatusLabel } from '../lib/record-edit-types';
import { fieldRuntimeState, type FieldRuntimeState } from '../lib/linkage';
import { validateField } from '../lib/field-validation';
import { m2mIds } from '../lib/record-label';
import { createRelatedRowsLoader, toRelatedOptions } from '../lib/related-rows';
import { RecordFieldInput } from './RecordFieldInput';

interface RecordFormDialogProps {
	token: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	collection: { slug: string; name: string };
	schema: EntitySchema;
	/** When set, the view edits this record (prefilled); otherwise it creates a new one. */
	record?: Record<string, unknown> | null;
	/**
	 * Values merged over defaults when CREATING (ignored in edit mode) — lets
	 * callers open a prefilled child create form, e.g. a join row with the
	 * back-reference already set ({ superior: '<employee-id>' }) so only the
	 * remaining required fields need user input.
	 */
	initialValues?: Record<string, unknown>;
	/**
	 * Fired with the created record after a successful CREATE (never in edit
	 * mode) — lets callers open the fresh record's detail view, where o2m
	 * children can be added now that the parent exists.
	 */
	onCreated?: (record: Record<string, unknown>) => void;
	onSaved: () => void;
	/** Browse-only — the collection rejects generic writes (its domain service owns
	 *  them), so submit is disabled rather than failing with a 403. */
	readOnly?: boolean;
}

/** Generic record form — renders editable fields from the collection's schema
 *  (m2o/m2m fields become selects / multi-select chips populated from the related
 *  collection — m2m ids are written to the junction tables by the engine in the
 *  same create request). Creates a new record when `record` is null, otherwise
 *  edits the given record. Rendered as a full inline layout (not a modal dialog)
 *  from the table view's Create button and row edit action. */
export default function RecordFormDialog({
	token,
	open,
	onOpenChange,
	collection,
	schema,
	record,
	initialValues,
	onCreated,
	onSaved,
	readOnly = false,
}: RecordFormDialogProps) {
	const editing = Boolean(record);
	// Engine-managed system fields (doc_status, display_number, audit columns) are
	// never shown in the generic record form — the engine fills them on insert
	// (draft status, auto display_number) and drives them via its status machine.
	const fields = useMemo(
		() =>
			(schema?.schema_json?.fields ?? []).filter(
				(f) => RECORD_EDITABLE_TYPES.has(f.type) && !f.read_only && !f.no_create && !SYSTEM_FIELD_NAMES.has(f.name),
			),
		[schema],
	);
	// System document fields (doc_status / display_number) are rendered as a
	// read-only "document bar" when the collection opted into them — the engine
	// owns their values (create always lands on draft; display_number comes from
	// the naming series), so they are never editable inputs here.
	const docStatusEnabled = useMemo(() => (schema?.schema_json?.fields ?? []).some((f) => f.name === 'doc_status'), [schema]);
	const displayNumberEnabled = useMemo(() => (schema?.schema_json?.fields ?? []).some((f) => f.name === 'display_number'), [schema]);
	const docMetaShown = docStatusEnabled || displayNumberEnabled;
	// One-to-many fields — they need the record to exist before children can be
	// linked, so they aren't inputs on a fresh record; the note below tells the
	// user where they appear (the record's detail view opens right after save).
	const o2mFields = useMemo(() => (schema?.schema_json?.fields ?? []).filter((f) => f.type === 'o2m' && f.related_collection), [schema]);
	const [values, setValues] = useState<Record<string, unknown>>({});
	// Options for m2o selects AND m2m chip pickers (related rows of each field).
	// A session loader memoizes by collection+fields: fields sharing a related
	// collection collapse into ONE bounded (100-row, tight-projection) fetch per
	// open instead of one `'*.*'` read per field.
	const [relationOptions, setRelationOptions] = useState<Record<string, Array<{ id: string; label: string }>>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Inline per-field validation messages (keyed by field name), shown under the
	// control after the field is blurred — never while typing (onChange clears).
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	// Live linkage state per field — recomputed on every value change so a rule on
	// one field immediately shows/hides/disables/requires another. Purely derived
	// from the field's conditions + current form values (no state of its own).
	const runtime = useMemo(() => {
		const map: Record<string, FieldRuntimeState> = {};
		for (const f of fields) map[f.name] = fieldRuntimeState(f, values);
		return map;
	}, [fields, values]);
	const visibleFields = useMemo(() => fields.filter((f) => runtime[f.name]?.visible !== false), [fields, runtime]);
	// One loader per auth session — stateless, so it is memoized by the session
	// token (it must never outlive the session: a re-login changes the token and
	// recreates it; a new open reuses the same stateless loader).
	const loadRelatedRows = useMemo(() => createRelatedRowsLoader(token), [token]);

	// Reset the form + load m2o options each time the view opens.
	useEffect(() => {
		if (!open) return;
		setError(null);
		setBusy(false);
		setFieldErrors({});
		const initial: Record<string, unknown> = {};
		for (const f of fields) {
			if (editing) {
				const raw = record?.[f.name];
				// m2o values arrive expanded ({ id, … }) — store the related id for the select.
				if (f.type === 'm2o' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
					initial[f.name] = String((raw as { id?: unknown }).id ?? '');
				} else if (f.type === 'm2m') {
					// m2m values arrive as an array of expanded rows — keep just the ids.
					initial[f.name] = m2mIds(raw);
				} else {
					initial[f.name] = raw ?? '';
				}
			} else if (initialValues && initialValues[f.name] !== undefined && initialValues[f.name] !== null && initialValues[f.name] !== '') {
				initial[f.name] = initialValues[f.name];
			} else if (f.type === 'm2m') {
				// Multi-select chips start empty on create — the payload omits no-ops.
				initial[f.name] = [];
			} else if (f.default !== undefined) {
				initial[f.name] = f.default;
			} else if (f.type === 'boolean') {
				initial[f.name] = false;
			}
		}
		setValues(initial);

		const relationFields = fields.filter((f) => (f.type === 'm2o' || f.type === 'm2m') && f.related_collection);
		let alive = true;
		Promise.all(
			relationFields.map(async (f) => {
				try {
					const rows = await loadRelatedRows(f.related_collection!, f.display_template);
					return [f.name, toRelatedOptions(rows, f.display_template)] as const;
				} catch {
					return [f.name, []] as const;
				}
			}),
		).then((entries) => {
			if (alive) setRelationOptions(Object.fromEntries(entries));
		});
		return () => {
			alive = false;
		};
	}, [open, fields, token, editing, record, initialValues, loadRelatedRows]);

	function setValue(name: string, v: unknown) {
		setValues((prev) => ({ ...prev, [name]: v }));
		// Typing clears the field's error — blur re-validates. (Only touch state when
		// an error actually stands, so a keystroke is not a re-render storm.)
		setFieldErrors((prev) => {
			if (!(name in prev)) return prev;
			const next = { ...prev };
			delete next[name];
			return next;
		});
	}

	/** Blur trigger — validate ONE field. Linkage-hidden fields are never validated
	 *  (they are not on screen), and a linkage-required field is validated as
	 *  required by composing the runtime flag into the field the validator sees. */
	function handleBlur(name: string) {
		const f = fields.find((x) => x.name === name);
		if (!f) return;
		const state = fieldRuntimeState(f, values);
		if (!state.visible) return;
		const message = validateField({ ...f, required: state.required }, values[name]);
		setFieldErrors((prev) => {
			const next = { ...prev };
			if (message) next[name] = message;
			else delete next[name];
			return next;
		});
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (readOnly || busy) return;
		// Block submit while any visible field is invalid — the same pure validator as
		// blur, so the two can never disagree. Hidden fields are skipped entirely.
		const errors: Record<string, string> = {};
		for (const f of fields) {
			const state = fieldRuntimeState(f, values);
			if (!state.visible) continue;
			const message = validateField({ ...f, required: state.required }, values[f.name]);
			if (message) errors[f.name] = message;
		}
		if (Object.keys(errors).length > 0) {
			setFieldErrors(errors);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const body: Record<string, unknown> = {};
			for (const f of fields) {
				const state = fieldRuntimeState(f, values);
				// A hidden field is not on screen (and may not be fillable) — never submit its
				// value, or a stale/hidden entry would silently ride along with the write.
				if (!state.visible) continue;
				const v = values[f.name];
				// undefined / '' = untouched (omit: never overwrite the stored value).
				// null = explicit clear: send it so the server wipes the column (e.g.
				// removing an image/date/number leaves the row empty after Save).
				if (v === undefined || v === '') continue;
				body[f.name] = v;
			}
			if (editing && record?.id) {
				await updateItem(token, collection.slug, String(record.id), body);
			} else {
				const created = await createItem(token, collection.slug, body);
				// Let the caller open the fresh record (o2m children need the parent to
				// exist first, so they become manageable in the record's detail view).
				onCreated?.(created);
			}
			onOpenChange(false);
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : editing ? 'Save failed' : 'Create failed');
		} finally {
			setBusy(false);
		}
	}

	// Esc closes the view.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && e.key === 'Escape') return;
			if (e.key === 'Escape') onOpenChange(false);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [open, onOpenChange]);

	if (!open) return null;

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
			{/* Header — title + cancel/save + close (✕) at the top right. */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 8,
					padding: '0.5rem 0.75rem',
					borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
				}}
			>
				<h2
					style={{
						fontSize: '1.05rem',
						fontWeight: 700,
						margin: 0,
						flex: 1,
						minWidth: 0,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{editing ? `Edit ${collection.name}` : `Add ${collection.name}`}
				</h2>
				<div style={{ display: 'flex', gap: 6 }}>
					<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
						Cancel
					</Button>
					<Button type="submit" form="record-form" disabled={busy || readOnly}>
						{busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create'}
					</Button>
					<Button
						variant="outline"
						title="Close (Esc)"
						aria-label="Close"
						onClick={() => onOpenChange(false)}
						disabled={busy}
						style={{ width: 32, height: 32, borderRadius: '50%', padding: 0 }}
					>
						<X size={16} />
					</Button>
				</div>
			</div>

			{error && (
				<Alert variant="destructive" style={{ margin: '0.75rem 0.75rem 0' }}>
					<AlertDescription style={{ fontSize: '0.78rem' }}>{error}</AlertDescription>
				</Alert>
			)}

			{/* Body — scrollable 2-column fields grid. */}
			<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '1rem' }}>
				<form id="record-form" onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
					{/* Engine-owned document identity (ERP-style): status is set to Draft on
					 * create and display_number is assigned from the naming series — shown so
					 * the form matches the record's schema instead of silently dropping fields. */}
					{docMetaShown && (
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
							{docStatusEnabled && (
								<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
									<span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
										Document Status
									</span>
									<span
										style={{
											display: 'inline-flex',
											alignItems: 'center',
											gap: 6,
											padding: '6px 10px',
											borderRadius: 6,
											border: '1px solid var(--mmbix-border, #e5e7eb)',
											background: 'var(--mmbix-muted, #f9fafb)',
											fontSize: '0.8rem',
											color: 'var(--mmbix-muted-foreground, #6b7280)',
											alignSelf: 'flex-start',
										}}
									>
										<span
											style={{
												width: 7,
												height: 7,
												borderRadius: '50%',
												background: 'var(--mmbix-muted-foreground, #9ca3af)',
											}}
										/>
										{docStatusLabel(editing ? String(record?.doc_status ?? '') : 'draft')}
									</span>
									<span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
										{editing ? 'Engine-driven — change it from the record view' : 'Set to Draft automatically on save'}
									</span>
								</div>
							)}
							{displayNumberEnabled && (
								<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
									<span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
										Document Number
									</span>
									<span
										style={{
											display: 'inline-flex',
											alignItems: 'center',
											padding: '6px 10px',
											borderRadius: 6,
											border: '1px dashed var(--mmbix-border, #e5e7eb)',
											background: 'var(--mmbix-muted, #f9fafb)',
											fontSize: '0.8rem',
											color: 'var(--mmbix-muted-foreground, #6b7280)',
											alignSelf: 'flex-start',
										}}
									>
										{editing ? String(record?.display_number ?? '—') : '—'}
									</span>
									<span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
										{editing ? 'Assigned from the naming series' : 'Assigned from the naming series on save'}
									</span>
								</div>
							)}
						</div>
					)}
					{visibleFields.length === 0 && !docMetaShown && (
						<p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: 0 }}>No editable fields.</p>
					)}
					{/* Fields render in one flat grid — this view does not use the form-layout
					 *  group tree, so FormGroup.visible_when (group-level) has no group to gate
					 *  here; only per-field linkage is evaluated. */}
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
						{visibleFields.map((f) => {
							const state = runtime[f.name];
							return (
								<RecordFieldInput
									key={f.name}
									field={f}
									value={values[f.name]}
									options={relationOptions[f.name]}
									onChange={(v) => setValue(f.name, v)}
									onBlur={() => handleBlur(f.name)}
									error={fieldErrors[f.name]}
									token={token}
									readOnly={state?.readOnly}
									required={state?.required}
								/>
							);
						})}
					</div>
					{o2mFields.length > 0 && (
						<div
							style={{
								fontSize: '0.72rem',
								color: 'var(--mmbix-muted-foreground, #6b7280)',
								padding: '0.5rem 0.6rem',
								borderRadius: 6,
								border: '1px dashed var(--mmbix-border, #e5e7eb)',
								background: 'var(--mmbix-muted, #f9fafb)',
							}}
						>
							{o2mFields.map((f) => `${f.label || f.name} (${f.related_collection})`).join(' · ')} — add related records after this one is
							saved.
						</div>
					)}
				</form>
			</div>
		</div>
	);
}

import { useEffect, useMemo, useState } from 'react';
import {
	Alert,
	AlertDescription,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	NativeSelect,
	NativeSelectOption,
	Switch,
	Textarea,
} from '@mmbix/design-system';
import { selectDisplayLabel } from '@mmbix/ui-views';
import { updateItem, SYSTEM_FIELD_NAMES, type EntitySchema, type FieldDefinition } from '../lib/api';
import { createRelatedRowsLoader, toRelatedOptions } from '../lib/related-rows';

/** Field types the generic batch form can edit. Everything else is skipped. */
const BATCH_TYPES = new Set([
	'text',
	'longtext',
	'slug',
	'email',
	'phone',
	'url',
	'color',
	'number',
	'integer',
	'currency',
	'percent',
	'boolean',
	'select',
	'date',
	'datetime',
	'time',
	'm2o',
]);

interface BatchEditDialogProps {
	token: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	collection: { slug: string; name: string };
	schema: EntitySchema;
	rows: Array<Record<string, unknown>>;
	onSaved: () => void;
}

/** Directus-style batch edit — set one or more fields on all selected rows at once. */
export default function BatchEditDialog({ token, open, onOpenChange, collection, schema, rows, onSaved }: BatchEditDialogProps) {
	// Engine-managed system fields (doc_status, display_number, audit columns) are
	// never offered in bulk edit — the engine owns their values.
	const fields = useMemo(
		() =>
			(schema?.schema_json?.fields ?? []).filter(
				(f) => BATCH_TYPES.has(f.type) && !f.read_only && !f.no_create && !SYSTEM_FIELD_NAMES.has(f.name),
			),
		[schema],
	);
	const [values, setValues] = useState<Record<string, unknown>>({});
	const [m2oOptions, setM2oOptions] = useState<Record<string, Array<{ id: string; label: string }>>>({});
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// One loader per auth session — stateless, so it is memoized by the session
	// token (it must never outlive the session: a re-login changes the token and
	// recreates it; a new open reuses the same stateless loader).
	const loadRelatedRows = useMemo(() => createRelatedRowsLoader(token), [token]);

	useEffect(() => {
		if (!open) return;
		setError(null);
		setBusy(false);
		setValues({});

		const m2oFields = fields.filter((f) => f.type === 'm2o' && f.related_collection);
		let alive = true;
		Promise.all(
			m2oFields.map(async (f) => {
				try {
					const rows = await loadRelatedRows(f.related_collection!, f.display_template);
					return [f.name, toRelatedOptions(rows, f.display_template)] as const;
				} catch {
					return [f.name, []] as const;
				}
			}),
		).then((entries) => {
			if (alive) setM2oOptions(Object.fromEntries(entries));
		});
		return () => {
			alive = false;
		};
	}, [open, fields, token, loadRelatedRows]);

	function setValue(name: string, v: unknown) {
		setValues((prev) => ({ ...prev, [name]: v }));
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		if (busy) return;
		const keys = Object.keys(values).filter((k) => values[k] !== undefined && values[k] !== null && values[k] !== '');
		if (keys.length === 0) return;
		setBusy(true);
		setError(null);
		try {
			for (const row of rows) {
				const body: Record<string, unknown> = {};
				for (const k of keys) body[k] = values[k];
				await updateItem(token, collection.slug, String(row.id), body);
			}
			onOpenChange(false);
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Batch edit failed');
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent style={{ maxWidth: 560, width: 'calc(100vw - 3rem)', maxHeight: '85vh', overflowY: 'auto' }}>
				<DialogHeader>
					<DialogTitle>
						Edit {rows.length} {collection.name}
					</DialogTitle>
					<DialogDescription>Set fields below — they apply to all selected records. Leave a field empty to skip it.</DialogDescription>
				</DialogHeader>
				<form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
					{fields.map((f) => (
						<FieldInput key={f.name} field={f} value={values[f.name]} options={m2oOptions[f.name]} onChange={(v) => setValue(f.name, v)} />
					))}
					{error && (
						<Alert variant="destructive">
							<AlertDescription style={{ fontSize: '0.78rem' }}>{error}</AlertDescription>
						</Alert>
					)}
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							Cancel
						</Button>
						<Button
							type="submit"
							disabled={
								busy || Object.keys(values).filter((k) => values[k] !== undefined && values[k] !== null && values[k] !== '').length === 0
							}
						>
							{busy ? 'Saving…' : 'Save changes'}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function FieldInput({
	field,
	value,
	options,
	onChange,
}: {
	field: FieldDefinition;
	value: unknown;
	options?: Array<{ id: string; label: string }>;
	onChange: (v: unknown) => void;
}) {
	const label = field.label || field.name;

	switch (field.type) {
		case 'boolean':
			return (
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<Switch checked={Boolean(value)} onCheckedChange={(c) => onChange(Boolean(c))} />
					<Label style={{ fontSize: '0.8rem' }}>{label}</Label>
				</div>
			);
		case 'select':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
					<Label style={{ fontSize: '0.78rem' }}>{label}</Label>
					<NativeSelect value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
						<NativeSelectOption value="">—</NativeSelectOption>
						{(field.options ?? []).map((o) => {
							const v = typeof o === 'string' ? o : (o.value ?? o.label ?? '');
							// Same display rule as the create/edit form: distinct option label
							// wins, else the token humanizes (`male` → `Male`).
							const l = selectDisplayLabel(v, field.options);
							return (
								<NativeSelectOption key={v} value={v}>
									{l}
								</NativeSelectOption>
							);
						})}
					</NativeSelect>
				</div>
			);
		case 'm2o':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
					<Label style={{ fontSize: '0.78rem' }}>{label}</Label>
					<NativeSelect value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={{ width: '100%' }}>
						<NativeSelectOption value="">—</NativeSelectOption>
						{(options ?? []).map((o) => (
							<NativeSelectOption key={o.id} value={o.id}>
								{o.label}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
			);
		case 'longtext':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
					<Label style={{ fontSize: '0.78rem' }}>{label}</Label>
					<Textarea value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} rows={3} style={{ fontSize: '0.8rem' }} />
				</div>
			);
		case 'number':
		case 'integer':
		case 'currency':
		case 'percent':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
					<Label style={{ fontSize: '0.78rem' }}>{label}</Label>
					<Input
						type="number"
						value={value === undefined || value === null ? '' : String(value)}
						onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
						style={{ fontSize: '0.8rem' }}
					/>
				</div>
			);
		case 'date':
		case 'datetime':
		case 'time':
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
					<Label style={{ fontSize: '0.78rem' }}>{label}</Label>
					<Input
						type={field.type === 'datetime' ? 'datetime-local' : field.type}
						value={String(value ?? '')}
						onChange={(e) => onChange(e.target.value)}
						style={{ fontSize: '0.8rem' }}
					/>
				</div>
			);
		default:
			return (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
					<Label style={{ fontSize: '0.78rem' }}>{label}</Label>
					<Input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} style={{ fontSize: '0.8rem' }} />
				</div>
			);
	}
}

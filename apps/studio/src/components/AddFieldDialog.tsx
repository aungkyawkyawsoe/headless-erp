import { useEffect, useMemo, useState } from 'react';
import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Switch,
	Textarea,
} from '@mmbix/design-system';
import type { FieldConfigEntry, FieldDefinition, EntitySchema, FieldTypeDef } from '../lib/api';
import { useRelatedSchema } from '../lib/collection-table-filters';
import { OptionsEditor, PropCombobox } from './formlayout/properties';

/** Sentinel option value for the "let the engine pick the default display field" choice. */
const AUTO_DISPLAY = '__auto__';

/** Human label → snake_case API identifier: "Phone Number (Mobile)" → "phone_number_mobile". */
function toSnake(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}

/** Extract a plain `{{ field }}` template → "field"; empty for complex templates. */
function displayFieldOf(template?: string): string {
	if (!template) return '';
	const m = template.match(/^\{\{\s*([a-zA-Z0-9_]+)\s*\}\}$/);
	return m ? m[1] : '';
}

/**
 * AddFieldDialog — type-aware field creation.
 * Base properties (label / required) plus the picked type's `config_schema`
 * rendered dynamically: collection-picker, field-picker, select, checkbox,
 * options editor, multi-select, etc. Create stays disabled until every
 * required entry is filled. The API name is auto-derived from the label
 * (snake_case, de-duplicated) — no manual technical name needed.
 */
export default function AddFieldDialog({
	def,
	collectionName,
	currentCollection,
	collections,
	fields,
	schemas,
	token,
	onCreate,
	onClose,
}: {
	def: FieldTypeDef | null;
	collectionName: string;
	currentCollection: string;
	collections: Array<{ slug: string; name: string }>;
	fields: FieldDefinition[];
	schemas: Record<string, EntitySchema>;
	/** Auth token — used to lazily load a related collection's fields for the Display dropdown. */
	token?: string;
	onCreate: (field: FieldDefinition) => Promise<void>;
	onClose: () => void;
}) {
	const [label, setLabel] = useState('');
	const [required, setRequired] = useState(false);
	const [config, setConfig] = useState<Record<string, unknown>>({});
	const [creating, setCreating] = useState(false);

	// Seed draft config from the type's schema whenever a type is picked.
	useEffect(() => {
		if (!def) return;
		setLabel(def.label);
		setRequired(false);
		const seed: Record<string, unknown> = {};
		for (const e of def.config_schema ?? []) {
			if (e.default !== undefined) seed[e.key] = e.default;
			else if (e.type === 'checkbox' || e.type === 'key-value-editor' || e.type === 'multi-select')
				seed[e.key] = e.type === 'checkbox' ? false : [];
		}
		setConfig(seed);
	}, [def]);

	// Auto API name: snake_case of the label, de-duplicated; fallback x_<type>_<n>.
	const apiName = useMemo(() => {
		const existing = new Set(fields.map((f) => f.name));
		const base = toSnake(label);
		if (base && !/^\d/.test(base)) {
			let name = base;
			let i = 2;
			while (existing.has(name)) {
				name = `${base}_${i}`;
				i += 1;
			}
			return name;
		}
		const fb = `x_${def?.type ?? 'field'}`;
		let n = fields.length + 1;
		let name = `${fb}_${n}`;
		while (existing.has(name)) {
			n += 1;
			name = `${fb}_${n}`;
		}
		return name;
	}, [label, fields, def]);

	const setVal = (key: string, v: unknown) => setConfig((c) => ({ ...c, [key]: v }));
	// The relation "Display Template" entry points at the collection picker it depends on
	// (`depends_on: 'related_collection'`) — load that collection's fields so the control
	// can offer a dropdown of them instead of a free-text box.
	const templateParentKey = def?.config_schema?.find((e) => e.type === 'template-editor')?.depends_on;
	const relatedSlug = templateParentKey ? String(config[templateParentKey] ?? '') : '';
	const relatedSchema = useRelatedSchema(token ?? '', relatedSlug);

	// Entries that still block creation (required + empty, and not deferred by depends_on).
	const missing = (def?.config_schema ?? []).filter((e) => {
		if (!e.required) return false;
		if (e.depends_on && !config[e.depends_on]) return false;
		const v = config[e.key];
		if (Array.isArray(v)) return v.length === 0;
		return v === undefined || v === null || v === '';
	});

	const canCreate = !!def && !!apiName && missing.length === 0 && !creating;

	/** Options for a field-picker — o2m foreign key prefers m2o fields pointing back here. */
	const fieldOptions = (collectionSlug?: string): Array<{ value: string; label: string }> => {
		if (collectionSlug) {
			const schema = schemas[collectionSlug];
			if (schema) {
				const back = schema.schema_json.fields.filter((f) => f.type === 'm2o' && f.related_collection === currentCollection);
				const src = back.length > 0 ? back : schema.schema_json.fields;
				return src.map((f) => ({ value: f.name, label: f.label || f.name }));
			}
		}
		return fields.map((f) => ({ value: f.name, label: f.label || f.name }));
	};

	const renderControl = (e: FieldConfigEntry) => {
		switch (e.type) {
			case 'number':
				return (
					<Input
						type="number"
						value={String(config[e.key] ?? '')}
						onChange={(ev) => setVal(e.key, ev.target.value)}
						placeholder={e.placeholder}
						style={{ height: 28, fontSize: '0.8rem' }}
					/>
				);
			case 'select': {
				const isBool = e.options?.length === 2 && e.options.includes('true') && e.options.includes('false');
				const opts = (e.options ?? []).map((o) => ({ value: o, label: isBool ? (o === 'true' ? 'Yes' : 'No') : o }));
				return (
					<PropCombobox value={String(config[e.key] ?? '')} options={opts} onChange={(v) => setVal(e.key, v)} placeholder={e.placeholder} />
				);
			}
			case 'checkbox':
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
						}}
					>
						<span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--mmbix-foreground, #374151)' }}>{e.label}</span>
						<Switch checked={!!config[e.key]} onCheckedChange={(c) => setVal(e.key, c === true)} aria-label={e.label} />
					</div>
				);
			case 'textarea':
			case 'json-editor':
				return (
					<Textarea
						value={String(config[e.key] ?? '')}
						onChange={(ev) => setVal(e.key, ev.target.value)}
						placeholder={e.placeholder}
						style={{ fontSize: '0.8rem', fontFamily: e.type === 'json-editor' ? 'ui-monospace, monospace' : undefined, minHeight: 72 }}
					/>
				);
			case 'key-value-editor':
				return (
					<OptionsEditor
						options={(Array.isArray(config[e.key]) ? config[e.key] : []) as Array<string | { label?: string; value?: string }>}
						onChange={(o) => setVal(e.key, o)}
					/>
				);
			case 'collection-picker':
				return (
					<PropCombobox
						value={String(config[e.key] ?? '')}
						options={collections.map((c) => ({ value: c.slug, label: `${c.name} (${c.slug})` }))}
						onChange={(v) => setVal(e.key, v)}
						placeholder="Pick a collection"
					/>
				);
			case 'field-picker': {
				const parent = e.depends_on ? String(config[e.depends_on] ?? '') : undefined;
				const opts = fieldOptions(parent);
				return (
					<PropCombobox
						value={String(config[e.key] ?? '')}
						options={opts}
						onChange={(v) => setVal(e.key, v)}
						placeholder={parent ? (opts.length > 0 ? 'Pick a field' : 'No candidates') : 'Pick a field'}
					/>
				);
			}
			case 'multi-select': {
				const sel = (Array.isArray(config[e.key]) ? config[e.key] : []) as string[];
				return (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: 2,
							maxHeight: 150,
							overflowY: 'auto',
							border: '1px solid var(--mmbix-border, #e5e7eb)',
							borderRadius: 8,
							padding: '0.35rem',
						}}
					>
						{collections.length === 0 && <p style={{ margin: 0, fontSize: '0.75rem', color: '#9ca3af' }}>No collections available</p>}
						{collections.map((c) => (
							<label
								key={c.slug}
								style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem', padding: '0.25rem 0.3rem', cursor: 'pointer' }}
							>
								<input
									type="checkbox"
									checked={sel.includes(c.slug)}
									onChange={(ev) => setVal(e.key, ev.target.checked ? [...sel, c.slug] : sel.filter((s) => s !== c.slug))}
								/>
								<span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
								<span style={{ marginLeft: 'auto', fontSize: '0.62rem', color: '#9ca3af' }}>{c.slug}</span>
							</label>
						))}
					</div>
				);
			}
			case 'template-editor': {
				// Offer the related collection's fields as a dropdown. When there is no single
				// related collection to draw fields from — m2a (many targets), or the picker is
				// still empty — fall back to a free-text template box.
				const relSchema = schemas[relatedSlug] ?? relatedSchema;
				const relFields = relSchema?.schema_json.fields ?? [];
				if (!relatedSlug) {
					return (
						<Input
							value={String(config[e.key] ?? '')}
							onChange={(ev) => setVal(e.key, ev.target.value)}
							placeholder={e.placeholder}
							style={{ height: 28, fontSize: '0.8rem' }}
						/>
					);
				}
				const current = String(config[e.key] ?? '');
				const currentField = displayFieldOf(current);
				const custom = current && !currentField ? current : '';
				const opts = [
					{ value: AUTO_DISPLAY, label: 'Default (auto)' },
					...relFields.map((f) => ({ value: f.name, label: f.label || f.name })),
				];
				if (custom) opts.push({ value: custom, label: `Custom: ${custom}` });
				return (
					<PropCombobox
						value={custom || currentField || AUTO_DISPLAY}
						options={opts}
						onChange={(v) => {
							if (v === custom) return; // keep the hand-written template
							setVal(e.key, v && v !== AUTO_DISPLAY ? `{{${v}}}` : '');
						}}
						placeholder="Default (auto)"
					/>
				);
			}
			default: // input
				return (
					<Input
						value={String(config[e.key] ?? '')}
						onChange={(ev) => setVal(e.key, ev.target.value)}
						placeholder={e.placeholder}
						style={{ height: 28, fontSize: '0.8rem' }}
					/>
				);
		}
	};

	const submit = async () => {
		if (!def || !canCreate) return;
		const field: Record<string, unknown> = { name: apiName, type: def.type, label: label.trim() || def.label, required };
		for (const e of def.config_schema ?? []) {
			const v = config[e.key];
			if (v === undefined || v === null || v === '') continue;
			field[e.key] = e.type === 'number' ? Number(v) : v;
		}
		// Backend config calls it max_stars; the runtime reads rating_max.
		if ('max_stars' in field) {
			field.rating_max = field.max_stars;
			delete field.max_stars;
		}
		setCreating(true);
		try {
			await onCreate(field as unknown as FieldDefinition);
		} finally {
			setCreating(false);
		}
	};

	return (
		<Dialog
			open={!!def}
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
		>
			<DialogContent style={{ width: 560, maxWidth: 'calc(100vw - 2rem)', maxHeight: '82vh', overflowY: 'auto' }}>
				<DialogHeader>
					<DialogTitle>Add {def?.label ?? ''} field</DialogTitle>
					<DialogDescription>Fill in the field properties — it will be added to “{collectionName}”.</DialogDescription>
				</DialogHeader>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
						<Label htmlFor="af-label">Field label</Label>
						<Input
							id="af-label"
							autoFocus
							value={label}
							onChange={(e) => setLabel(e.target.value)}
							placeholder={`e.g. ${def?.label ?? ''}`}
						/>
						<span style={{ fontSize: '0.68rem', color: '#9ca3af' }}>
							API: <code style={{ background: 'var(--mmbix-muted, #f3f4f6)', padding: '0 4px', borderRadius: 4 }}>{apiName}</code>
						</span>
					</div>
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'space-between',
							gap: 8,
							padding: '0.4rem 0.55rem',
							border: '1px solid var(--mmbix-border, #e5e7eb)',
							borderRadius: 8,
						}}
					>
						<span style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--mmbix-foreground, #374151)' }}>Required</span>
						<Switch checked={required} onCheckedChange={(c) => setRequired(c === true)} aria-label="Required" />
					</div>
					{(def?.config_schema?.length ?? 0) > 0 && (
						<div
							style={{
								display: 'flex',
								flexDirection: 'column',
								gap: '0.6rem',
								borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
								paddingTop: '0.6rem',
							}}
						>
							{def!
								.config_schema!.filter((e) => !e.depends_on || !!config[e.depends_on])
								.map((e) => (
									<div key={e.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
										<Label style={{ fontSize: '0.72rem', fontWeight: 600 }}>
											{e.label}
											{e.required ? <span style={{ color: '#dc2626' }}> *</span> : null}
										</Label>
										{renderControl(e)}
										{e.help && <span style={{ fontSize: '0.66rem', color: '#9ca3af', lineHeight: 1.4 }}>{e.help}</span>}
									</div>
								))}
						</div>
					)}
				</div>
				<DialogFooter>
					<Button type="button" variant="outline" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button size="sm" disabled={!canCreate} onClick={() => void submit()}>
						{creating ? 'Creating…' : 'Create field'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

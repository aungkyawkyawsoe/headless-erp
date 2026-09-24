import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
	Alert,
	AlertDescription,
	Button,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@mmbix/design-system';
import { Check, ChevronLeft, Copy, MoreVertical, Plus, Trash2, X } from 'lucide-react';
import {
	updateItem,
	listItems,
	createItem,
	deleteItem,
	duplicateItem,
	SYSTEM_FIELD_NAMES,
	type EntitySchema,
	type FieldDefinition,
} from '../lib/api';
import { collectionQuery } from '../lib/queries';
import { rowLabel, renderTemplate, m2oLabel, m2mIds } from '../lib/record-label';
import { RECORD_EDITABLE_TYPES, docStatusLabel, nextDocStatuses } from '../lib/record-edit-types';
import { createRelatedRowsLoader, relatedRowsProjection, toRelatedOptions, RELATED_ROWS_LIMIT } from '../lib/related-rows';
import { RecordFieldInput } from './RecordFieldInput';

interface RelatedField {
	field: FieldDefinition;
	slug: string;
	schema: EntitySchema;
	rows: Array<Record<string, unknown>>;
	/**
	 * Join-style inline picker — present when the child collection links this
	 * record to exactly ONE other m2o side and nothing else blocks a bare
	 * { foreign_key: record.id, <side>: picked } insert (e.g. employee_links).
	 * The sidebar section then renders this picker directly (no "+ / create
	 * form"); picking an option immediately creates the link row.
	 */
	counterpart?: { field: FieldDefinition; options: Array<{ id: string; label: string }> };
}

interface RecordDetailViewProps {
	token: string;
	collection: { slug: string; name: string };
	schema: EntitySchema;
	record: Record<string, unknown>;
	onClose: () => void;
	onSaved: () => void;
	/** Open a related record's detail view (recursive edit). */
	onOpenRelated: (collection: { slug: string; name: string }, schema: EntitySchema, record: Record<string, unknown>) => void;
	/**
	 * Open a CREATE form for a related (o2m) child when a bare FK-only insert
	 * can't satisfy the child's required fields (e.g. a join row whose other
	 * side must be picked). The caller owns the form; it receives the child
	 * collection/schema plus the FK prefilled to this record.
	 */
	onAddRelated?: (collection: { slug: string; name: string }, schema: EntitySchema, initialValues: Record<string, unknown>) => void;
	/**
	 * Browse-only — the collection is NOT generically writable (a `service` /
	 * `append_only` write policy), so the engine would 403 every write. Save /
	 * Duplicate / Delete are hidden and every write path is guarded.
	 */
	readOnly?: boolean;
}

/**
 * Label for a related (o2m) child chip. Resolution order:
 *   1. The o2m field's own display_template when it resolves — same contract as
 *      the m2o/m2m pickers (e.g. `{{name}}` on a child doc), so configuring the
 *      field also relabels its children;
 *   2. The child row's conventional display column (name/code/…) — real child
 *      docs carry their own identity and read better than a join of their
 *      related selects;
 *   3. join/link rows (whose own columns are only m2o ids, e.g. employee_links)
 *      render the child schema's OTHER expanded m2o values — the back-reference
 *      to the record being viewed is excluded so a link row reads as its
 *      counterpart ("Subordinates" lists the subordinate employee, not a link id);
 *   4. the shared row label (raw id as last resort).
 */
function joinRowLabel(rf: RelatedField, row: Record<string, unknown>): string {
	const templated = renderTemplate(rf.field.display_template, row);
	if (templated) return templated;
	const ownLabel = m2oLabel(row);
	if (ownLabel) return ownLabel;
	const backRef = rf.field.foreign_key;
	const labelParts: string[] = [];
	for (const f of rf.schema?.schema_json?.fields ?? []) {
		if (f.type !== 'm2o' || !f.related_collection || f.name === backRef) continue;
		const raw = row[f.name];
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
		const label = renderTemplate(f.display_template, raw as Record<string, unknown>) || m2oLabel(raw) || '';
		if (label) labelParts.push(label);
	}
	return labelParts.length > 0 ? labelParts.join(' · ') : rowLabel(row, rf.field.display_template);
}

/** Directus-style record detail — a full 2-column editable layout (NOT a dialog)
 *  with circular save (✓) and close (✕) buttons at the top right, plus a related-items
 *  sidebar (o2m children with inline add/delete). Row click opens this; saving PUTs
 *  the record, closing returns to the table. ⌘S saves, Esc closes. */
export default function RecordDetailView({
	token,
	collection,
	schema,
	record,
	onClose,
	onSaved,
	onOpenRelated,
	onAddRelated,
	readOnly = false,
}: RecordDetailViewProps) {
	const queryClient = useQueryClient();
	// Engine-managed system fields (doc_status, display_number, audit columns) are
	// never editable in the raw record view — the engine owns their values.
	const fields = useMemo(
		() =>
			(schema?.schema_json?.fields ?? []).filter(
				(f) => RECORD_EDITABLE_TYPES.has(f.type) && !f.read_only && !f.no_create && !SYSTEM_FIELD_NAMES.has(f.name),
			),
		[schema],
	);
	// o2m fields — shown in the related-items sidebar.
	const o2mFields = useMemo(() => (schema?.schema_json?.fields ?? []).filter((f) => f.type === 'o2m' && f.related_collection), [schema]);
	const [values, setValues] = useState<Record<string, unknown>>({});
	// Options for m2o selects AND m2m chip pickers (related rows of each field).
	const [relationOptions, setRelationOptions] = useState<Record<string, Array<{ id: string; label: string }>>>({});
	const [related, setRelated] = useState<RelatedField[]>([]);
	// Controlled value of each join-picker combobox (keyed by o2m field name).
	const [pickValue, setPickValue] = useState<Record<string, string>>({});
	// Staged (unsaved) join-link adds keyed by o2m field name. Picking in the
	// sidebar combobox only stages the counterpart id here — the actual
	// employee_links-style row is created when the record Save (✓) runs, so
	// field edits and link adds commit together under one dirty flag.
	const [pendingAdds, setPendingAdds] = useState<Record<string, string[]>>({});
	const hasPending = Object.values(pendingAdds).some((ids) => ids.length > 0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	// DocStatus of the open record — the engine validates transitions server-side
	// (draft → submitted → approved → cancelled); the combobox offers only legal
	// moves and the save body carries doc_status when it changed.
	const [docStatus, setDocStatus] = useState<string>('draft');
	// Relation-rows loader for the session — memoizes by collection + fields, so
	// several m2o/m2m/o2m-join fields referencing the same collection share ONE
	// bounded (100-row, tight-projection) fetch instead of one `'*.*'` read per
	// field. Stateless: memoized by the auth token (re-created on re-login), never
	// tied to a specific record open.
	const loadRelatedRows = useMemo(() => createRelatedRowsLoader(token), [token]);

	// System document fields — surfaced as a read-only ERP-style document bar
	// (Status transitions + Doc No.) because the engine owns their values.
	const hasDocStatus = useMemo(() => (schema?.schema_json?.fields ?? []).some((f) => f.name === 'doc_status'), [schema]);
	const hasDisplayNumber = useMemo(() => (schema?.schema_json?.fields ?? []).some((f) => f.name === 'display_number'), [schema]);

	// Load the record's values + m2o options + related o2m children.
	useEffect(() => {
		setError(null);
		setBusy(false);
		setDirty(false);
		// A different record may be loaded into this component (AppDetailPage
		// keeps it mounted) — staged picks belong to the previous record only.
		setPickValue({});
		setPendingAdds({});
		setDocStatus(String(record?.doc_status ?? 'draft'));
		const initial: Record<string, unknown> = {};
		for (const f of fields) {
			const raw = record?.[f.name];
			if (f.type === 'm2o' && raw && typeof raw === 'object' && !Array.isArray(raw)) {
				initial[f.name] = String((raw as { id?: unknown }).id ?? '');
			} else if (f.type === 'm2m') {
				// m2m values arrive as an array of expanded rows — keep just the ids so
				// the chip field can render them and echo the set back unchanged on save.
				initial[f.name] = m2mIds(raw);
			} else {
				initial[f.name] = raw ?? '';
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

		// Related o2m children — fetch each related collection's schema, rows and
		// (for join-style children) the counterpart picker options.
		loadRelated().then((res) => {
			if (alive) setRelated(res);
		});
		return () => {
			alive = false;
		};
		// eslint-disable-next-line
	}, [record, fields, o2mFields, token]);

	function setValue(name: string, v: unknown) {
		setValues((prev) => ({ ...prev, [name]: v }));
		setDirty(true);
	}

	function changeDocStatus(v: string) {
		setDocStatus(v);
		setDirty(true);
	}

	async function save() {
		if (readOnly) return;
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			const body: Record<string, unknown> = {};
			for (const f of fields) {
				const v = values[f.name];
				// undefined / '' = untouched (omit: never overwrite the stored value).
				// null = explicit clear: send it so the server wipes the column (e.g.
				// removing an image/date/number leaves the row empty after Save).
				if (v === undefined || v === '') continue;
				body[f.name] = v;
			}
			if (Object.keys(body).length > 0) {
				await updateItem(token, collection.slug, String(record.id), body);
			}
			// Document status transition — only when the schema opted into doc_status
			// and the user moved it (the engine re-validates the transition server-side).
			if (hasDocStatus) {
				const current = String(record?.doc_status ?? 'draft');
				if (docStatus && docStatus !== current) {
					await updateItem(token, collection.slug, String(record.id), { doc_status: docStatus });
				}
			}
			// Commit staged join links (sidebar pickers). Sequential so a failure
			// stops before later rows are created.
			const rfByField = new Map(related.map((r) => [r.field.name, r]));
			for (const [fieldName, ids] of Object.entries(pendingAdds)) {
				const rf = rfByField.get(fieldName);
				if (!rf?.counterpart || !rf.field.foreign_key || ids.length === 0) continue;
				for (const id of ids) {
					await createItem(token, rf.slug, {
						[rf.field.foreign_key]: String(record.id),
						[rf.counterpart.field.name]: id,
					});
				}
			}
			setPendingAdds({});
			setDirty(false);
			setRelated(await loadRelated());
			onSaved();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	}

	async function duplicate() {
		if (readOnly || busy) return;
		setBusy(true);
		setError(null);
		try {
			const created = await duplicateItem(token, collection.slug, record);
			onSaved();
			onOpenRelated(collection, schema, created);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Duplicate failed');
		} finally {
			setBusy(false);
		}
	}

	async function remove() {
		if (readOnly) return;
		if (!confirm(`Delete record “${rowLabel(record)}”?`)) return;
		if (busy) return;
		setBusy(true);
		setError(null);
		try {
			await deleteItem(token, collection.slug, String(record.id));
			onSaved();
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Delete failed');
		} finally {
			setBusy(false);
		}
	}

	// ⌘S save, Esc close.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) && e.key === 'Escape') return;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
				e.preventDefault();
				if (!readOnly && (dirty || hasPending)) void save();
			} else if (e.key === 'Escape') {
				onClose();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	/**
	 * Fetch every o2m section: child schema + filtered rows, plus — when the child
	 * is a single-other-m2o join (employee_links-style) — the counterpart picker
	 * options (rows of the side's related collection, labelled like an m2o field).
	 * Child ROWS always re-fetch (they change with every add/delete); the
	 * counterpart options read the session loader so they never duplicate a fetch
	 * the m2o/m2m fields already made for the same collection.
	 */
	async function loadRelated(): Promise<RelatedField[]> {
		const res = await Promise.all(
			o2mFields.map(async (f) => {
				try {
					const slug = f.related_collection!;
					if (!slug) return null;
					// The child schema first — its m2o names drive the row projection
					// (join-style chips label themselves from the OTHER expanded m2o values,
					// so every non-backref m2o column must arrive expanded). Read through the
					// shared schema cache so a relation already open costs zero requests.
					const schemaRes = await queryClient.fetchQuery(collectionQuery(token, slug));
					const fk = f.foreign_key ?? '';
					const childM2oColumns = (schemaRes.schema_json.fields ?? [])
						.filter((g) => g.type === 'm2o' && g.related_collection && g.name !== fk)
						.map((g) => g.name);
					const rowsRes = await listItems(token, slug, {
						limit: RELATED_ROWS_LIMIT,
						fields: relatedRowsProjection(f.display_template, childM2oColumns),
						filters: { [fk]: { operator: '_eq', value: String(record.id) } },
					});
					const rf: RelatedField = { field: f, slug, schema: schemaRes, rows: rowsRes.rows };

					// Join picker only when the child links to exactly ONE other m2o side
					// and no other required (default-less, editable) field blocks a bare
					// two-field insert — anything more complex keeps the "+ create form".
					const childFields = schemaRes.schema_json.fields ?? [];
					const counterparts = childFields.filter((g) => g.type === 'm2o' && g.related_collection && g.name !== fk);
					const hasGap = childFields.some(
						(g) =>
							g.name !== fk &&
							!counterparts.includes(g) &&
							RECORD_EDITABLE_TYPES.has(g.type) &&
							!g.read_only &&
							!g.no_create &&
							!SYSTEM_FIELD_NAMES.has(g.name) &&
							g.required &&
							g.default === undefined,
					);
					if (counterparts.length === 1 && !hasGap) {
						const cp = counterparts[0];
						const options = toRelatedOptions(await loadRelatedRows(cp.related_collection!, cp.display_template), cp.display_template);
						rf.counterpart = { field: cp, options };
					}
					return rf;
				} catch {
					return null;
				}
			}),
		);
		return res.filter((r): r is RelatedField => Boolean(r));
	}

	async function addRelated(rf: RelatedField) {
		const fk = rf.field.foreign_key;
		if (!fk) return;
		// A bare { [fk]: record.id } insert fails whenever the child has other
		// required fields without defaults (join rows like employee_links need
		// their counterpart picked). Detect that from the child schema and hand
		// over to a prefilled create form instead of the one-shot insert.
		const childNeedsInput = (rf.schema?.schema_json?.fields ?? []).some(
			(f) =>
				f.name !== fk &&
				RECORD_EDITABLE_TYPES.has(f.type) &&
				!f.read_only &&
				!f.no_create &&
				!SYSTEM_FIELD_NAMES.has(f.name) &&
				f.required &&
				f.default === undefined,
		);
		if (childNeedsInput) {
			if (onAddRelated) {
				onAddRelated({ slug: rf.slug, name: rf.schema?.name ?? rf.slug }, rf.schema, { [fk]: String(record.id) });
			} else {
				setError('This related record needs more fields — open it from the table view and fill them in.');
			}
			return;
		}
		try {
			await createItem(token, rf.slug, { [fk]: String(record.id) });
			setRelated(await loadRelated());
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Add failed');
		}
	}

	/**
	 * Stage a sidebar picker choice — the join row is NOT created here. It stays
	 * pending (dirty) until the record Save (✓) commits it alongside field edits.
	 */
	function stageLink(rf: RelatedField, counterpartId: string) {
		setPendingAdds((prev) => ({ ...prev, [rf.field.name]: [...(prev[rf.field.name] ?? []), counterpartId] }));
		setPickValue((prev) => ({ ...prev, [rf.field.name]: '' }));
		setDirty(true);
	}

	/** Drop a staged (unsaved) picker choice again. */
	function unstage(rf: RelatedField, counterpartId: string) {
		setPendingAdds((prev) => ({
			...prev,
			[rf.field.name]: (prev[rf.field.name] ?? []).filter((id) => id !== counterpartId),
		}));
	}

	async function removeRelated(rf: RelatedField, row: Record<string, unknown>) {
		if (readOnly) return;
		if (!confirm(`Delete related record?`)) return;
		try {
			await deleteItem(token, rf.slug, String(row.id));
			setRelated(await loadRelated());
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Delete failed');
		}
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
			{/* Header — title + duplicate + save (✓) + close (✕) at the top right. */}
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 8,
					padding: '0.5rem 0.75rem',
					borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
				}}
			>
				{/* Back — returns to this collection's records list. Esc also closes. */}
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					title="Back to records"
					aria-label="Back to records"
					onClick={onClose}
					disabled={busy}
					style={{ flexShrink: 0 }}
				>
					<ChevronLeft size={16} />
				</Button>
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
					{collection.name}
				</h2>
				{/* Actions — Save (✓) + Back (⟵); Duplicate + Delete live under a
				 * vertical 3-dot (⋯) menu so destructive/rare actions don't clutter the header. */}
				<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
					{readOnly ? (
						/* Browse-only — the collection is written through its domain service,
						   so there is no Save / Duplicate / Delete here. */
						<span
							title="Read-only — this collection is written through its domain service"
							style={{ fontSize: '0.7rem', fontWeight: 600, color: '#9ca3af' }}
						>
							Read-only
						</span>
					) : (
						<>
							<Button
								title="Save changes (⌘S)"
								aria-label="Save changes"
								onClick={() => void save()}
								disabled={(!dirty && !hasPending) || busy}
								style={{ width: 32, height: 32, borderRadius: '50%', padding: 0 }}
							>
								<Check size={16} />
							</Button>
							<DropdownMenu>
								<DropdownMenuTrigger
									title="More actions"
									aria-label="More actions"
									disabled={busy}
									style={{ width: 32, height: 32, borderRadius: '50%', padding: 0 }}
								>
									<MoreVertical size={16} />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" sideOffset={4} style={{ minWidth: 180 }}>
									<DropdownMenuItem onClick={() => void duplicate()} disabled={busy}>
										<Copy size={14} /> Duplicate
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem variant="destructive" onClick={() => void remove()} disabled={busy}>
										<Trash2 size={14} /> Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</>
					)}
				</div>
			</div>

			{/* Engine-owned document bar — Status (legal transitions) + Doc No. Shows
			 * whenever the collection opted into doc_status / display_number. */}
			{(hasDocStatus || hasDisplayNumber) && (
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 16,
						padding: '0.5rem 0.75rem',
						borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
						background: 'var(--mmbix-muted, #f9fafb)',
					}}
				>
					{hasDocStatus && (
						<div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
							<span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' }}>
								Status
							</span>
							{readOnly ? (
								<span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{docStatusLabel(docStatus)}</span>
							) : (
								<Combobox
									value={docStatus}
									items={[docStatus, ...nextDocStatuses(docStatus)]}
									onValueChange={(v) => {
										if (v) changeDocStatus(String(v));
									}}
									onInputValueChange={() => {}}
									itemToStringLabel={(v) => docStatusLabel(String(v))}
								>
									<ComboboxInput showTrigger style={{ width: 160, fontSize: '0.8rem', fontWeight: 600 }} />
									<ComboboxContent align="start" sideOffset={4} style={{ minWidth: 180 }}>
										<ComboboxList>
											{(item: string) => (
												<ComboboxItem key={item} value={item}>
													{docStatusLabel(item)}
												</ComboboxItem>
											)}
										</ComboboxList>
									</ComboboxContent>
								</Combobox>
							)}
						</div>
					)}
					{hasDisplayNumber && (
						<div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
							<span style={{ fontSize: '0.72rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#9ca3af' }}>
								Doc No.
							</span>
							<span
								style={{
									fontSize: '0.8rem',
									fontWeight: 600,
									color: String(record?.display_number ?? '').trim()
										? 'var(--mmbix-foreground, #111827)'
										: 'var(--mmbix-muted-foreground, #9ca3af)',
									whiteSpace: 'nowrap',
									overflow: 'hidden',
									textOverflow: 'ellipsis',
								}}
							>
								{String(record?.display_number ?? '').trim() || '—'}
							</span>
						</div>
					)}
				</div>
			)}

			{error && (
				<Alert variant="destructive" style={{ margin: '0.75rem 0.75rem 0' }}>
					<AlertDescription style={{ fontSize: '0.78rem' }}>{error}</AlertDescription>
				</Alert>
			)}

			{/* Body — 2-column fields grid + related-items sidebar. */}
			<div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
				<div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '1rem' }}>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
						{fields.map((f) => (
							// JSON blobs are wide — a JSON field spans the full form row (and the
							// editor itself is a full-width monospace JSON viewer/editor).
							<div key={f.name} style={f.type === 'json' ? { gridColumn: '1 / -1' } : undefined}>
								<RecordFieldInput
									field={f}
									value={values[f.name]}
									options={relationOptions[f.name]}
									onChange={(v) => setValue(f.name, v)}
									token={token}
								/>
							</div>
						))}
					</div>
				</div>

				{related.length > 0 && (
					<div
						style={{
							width: 300,
							flexShrink: 0,
							borderLeft: '1px solid var(--mmbix-border, #e5e7eb)',
							overflowY: 'auto',
							padding: '0.75rem',
							display: 'flex',
							flexDirection: 'column',
							gap: '1rem',
						}}
					>
						{[...related].reverse().map((rf) => {
							const cp = rf.counterpart;
							const pendingIds = pendingAdds[rf.field.name] ?? [];
							// Candidates exclude the record itself, people already linked (saved
							// rows) and people staged but not yet saved — a duplicate link row is
							// never useful. Re-evaluated on each render.
							const linkedIds = new Set([
								...rf.rows
									.map((row) => {
										const raw = cp ? row[cp.field.name] : null;
										return raw && typeof raw === 'object' && !Array.isArray(raw) ? String((raw as { id?: unknown }).id ?? '') : null;
									})
									.filter((v): v is string => Boolean(v)),
								...pendingIds,
							]);
							const options = (cp?.options ?? []).filter((o) => o.id !== String(record.id) && !linkedIds.has(o.id));
							const sectionLabel = rf.field.label || rf.field.name;
							const counterpartLabel = (id: string) => (cp?.options ?? []).find((o) => o.id === id)?.label ?? id;
							return (
								<div key={rf.field.name}>
									<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: '0.4rem' }}>
										<span
											style={{
												fontSize: '0.72rem',
												fontWeight: 700,
												textTransform: 'uppercase',
												letterSpacing: '0.04em',
												color: 'var(--mmbix-muted-foreground, #6b7280)',
												flex: 1,
											}}
										>
											{sectionLabel}
										</span>
										{!cp && (
											<Button variant="ghost" size="icon-xs" title={`Add ${sectionLabel}`} onClick={() => void addRelated(rf)}>
												<Plus size={13} />
											</Button>
										)}
									</div>
									{cp && (
										// Margin lives on this wrapper div, NOT on the input: the DS
										// ComboboxInput applies its style prop to the bare input element,
										// where an asymmetric bottom margin shifts the placeholder text
										// off-center against the chevron trigger.
										<div style={{ marginBottom: '0.4rem' }}>
											<Combobox
												value={pickValue[rf.field.name] ?? ''}
												items={options.map((o) => o.id)}
												onValueChange={(v) => {
													if (v) stageLink(rf, String(v));
												}}
												onInputValueChange={() => {}}
												itemToStringLabel={(v) => options.find((o) => o.id === String(v))?.label ?? String(v)}
											>
												<ComboboxInput
													showTrigger
													placeholder={`Add ${sectionLabel.toLowerCase()}…`}
													style={{ width: '100%', fontSize: '0.8rem' }}
												/>
												<ComboboxContent align="start" sideOffset={4} style={{ minWidth: 220 }}>
													<ComboboxList>
														{(item: string) => (
															<ComboboxItem key={item} value={item}>
																{options.find((o) => o.id === item)?.label ?? item}
															</ComboboxItem>
														)}
													</ComboboxList>
												</ComboboxContent>
											</Combobox>
										</div>
									)}
									<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
										{rf.rows.length === 0 && !cp && <p style={{ fontSize: '0.72rem', color: '#9ca3af', margin: 0 }}>No related records.</p>}
										{pendingIds.map((id) => (
											<div
												key={`pending-${id}`}
												title="Unsaved — linked when you press Save (✓)"
												style={{
													display: 'flex',
													alignItems: 'center',
													gap: 6,
													padding: '0.35rem 0.5rem',
													borderRadius: 6,
													border: '1px dashed #d97706',
													background: '#fffbeb',
													cursor: 'default',
												}}
											>
												<span
													style={{
														flex: 1,
														minWidth: 0,
														fontSize: '0.78rem',
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														whiteSpace: 'nowrap',
													}}
												>
													{counterpartLabel(id)}
												</span>
												<Button
													variant="ghost"
													size="icon-xs"
													title="Remove (not saved yet)"
													onClick={(e) => {
														e.stopPropagation();
														unstage(rf, id);
													}}
													style={{ color: '#b45309' }}
												>
													<X size={12} />
												</Button>
											</div>
										))}
										{rf.rows.map((row) => (
											<div
												key={String(row.id)}
												style={{
													display: 'flex',
													alignItems: 'center',
													gap: 6,
													padding: '0.35rem 0.5rem',
													borderRadius: 6,
													border: '1px solid var(--mmbix-border, #e5e7eb)',
													background: 'var(--mmbix-card, #ffffff)',
													cursor: 'pointer',
												}}
												onClick={() => onOpenRelated({ slug: rf.slug, name: rf.schema?.name ?? rf.slug }, rf.schema, row)}
											>
												<span
													style={{
														flex: 1,
														minWidth: 0,
														fontSize: '0.78rem',
														overflow: 'hidden',
														textOverflow: 'ellipsis',
														whiteSpace: 'nowrap',
													}}
												>
													{joinRowLabel(rf, row)}
												</span>
												<Button
													variant="ghost"
													size="icon-xs"
													title="Delete related record"
													onClick={(e) => {
														e.stopPropagation();
														void removeRelated(rf, row);
													}}
													style={{ color: '#dc2626' }}
												>
													<Trash2 size={12} />
												</Button>
											</div>
										))}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

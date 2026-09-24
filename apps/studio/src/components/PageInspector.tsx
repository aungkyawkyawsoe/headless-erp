import { useEffect, useState } from 'react';
import * as React from 'react';
import {
	Alert,
	AlertDescription,
	Badge,
	Button,
	Checkbox,
	ColorPicker,
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
	Separator,
	Slider,
	Switch,
} from '@mmbix/design-system';
import { ChevronsRight, Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { SYSTEM_FIELD_NAMES, type CollectionSummary, type PageBlock } from '../lib/api';
import { listSavedReports } from '../lib/api';
import { useBuilder } from './PageBuilderContext';
import { useStudioMeta, type ComponentProp, type ComponentStyle } from '../lib/studioMeta';
import { isContainerType, widgetDefOf, type WidgetPropDef } from '@mmbix/ui-views';
import { PropRow, PropSection, PropCombobox } from './formlayout/properties';
import { DataTab, isDataCapable } from './DataTab';
import { useRightPane } from './StudioLayout';
import TableConfigEditor from './TableConfigEditor';
import CardConfigEditor from './CardConfigEditor';
import KanbanConfigEditor from './KanbanConfigEditor';
import PivotViewConfigEditor from './PivotViewConfigEditor';

/* ── Right pane: block inspector (View / Props / Style / Events tabs) ── */

/** Recursive block tree — containers expand to show their children at any depth. */
function BlockTree({
	blocks,
	selected,
	onSelect,
	onRemove,
	depth,
}: {
	blocks: PageBlock[];
	selected: string | null;
	onSelect: (id: string) => void;
	onRemove: (id: string) => void;
	depth: number;
}) {
	return (
		<>
			{blocks.map((b, i) => {
				const isSel = selected === b.id;
				const isContainer = isContainerType(b.type);
				return (
					<div key={b.id}>
						<div
							onClick={() => onSelect(b.id)}
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 6,
								padding: '0.35rem 0.45rem',
								borderRadius: 6,
								border: `1px solid ${isSel ? 'var(--mmbix-primary, #2563eb)' : 'var(--mmbix-border, #f3f4f6)'}`,
								cursor: 'pointer',
								fontSize: '0.8rem',
								background: isSel ? 'var(--mmbix-muted, #f0fdfa)' : 'transparent',
								marginLeft: depth * 18,
							}}
						>
							<span style={{ width: 14, color: '#9ca3af', fontSize: '0.68rem', flexShrink: 0 }}>{depth === 0 ? i + 1 : '└'}</span>
							<Badge variant="outline" style={{ textTransform: 'capitalize', flexShrink: 0 }}>
								{b.type}
							</Badge>
							<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
								{b.label ?? b.type}
							</span>
							{isContainer && (
								<Badge style={{ background: 'var(--mmbix-muted, #f3f4f6)', color: '#6b7280', flexShrink: 0 }}>
									{b.children?.length ?? 0}
								</Badge>
							)}
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={(e) => {
									e.stopPropagation();
									onRemove(b.id);
								}}
								style={{ color: '#dc2626' }}
								title="Remove"
							>
								<Trash2 size={12} />
							</Button>
						</div>
						{b.children?.length ? (
							<BlockTree blocks={b.children} selected={selected} onSelect={onSelect} onRemove={onRemove} depth={depth + 1} />
						) : null}
					</div>
				);
			})}
		</>
	);
}

/** Render a single config key based on its prop type (from the studio metadata DB). */
function PropField({
	p,
	b,
	collections,
	update,
}: {
	p: ComponentProp;
	b: PageBlock;
	collections: CollectionSummary[];
	update: (id: string, k: string, v: unknown) => void;
}) {
	const c = b.config as Record<string, unknown>;
	const set = (v: unknown) => update(b.id, p.config_key, v);
	const opts = (
		(() => {
			try {
				return JSON.parse(p.options_json ?? '[]');
			} catch {
				return [];
			}
		})() as Array<{ value: string; label: string } | string>
	).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

	// Saved-report picker state — hooks must stay unconditional (the switch below
	// is prop-type driven, so a hook call inside a case would violate hook order).
	const { token } = useBuilder();
	const [reports, setReports] = React.useState<Array<{ id: string; name: string }>>([]);
	React.useEffect(() => {
		if (p.prop_type !== 'report') return;
		let cancelled = false;
		listSavedReports(token)
			.then((r) => {
				if (!cancelled) setReports(r);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [token, p.prop_type]);

	switch (p.prop_type) {
		case 'collection':
			return (
				<PropCombobox
					value={(c[p.config_key] as string) ?? ''}
					options={collections.map((col) => ({ value: col.slug, label: `${col.name} (${col.slug})` }))}
					onChange={set}
					placeholder={p.placeholder ?? 'Pick a collection'}
				/>
			);
		case 'boolean':
			return <Checkbox checked={!!c[p.config_key]} onCheckedChange={(v) => set(!!v)} />;
		case 'toggle':
			return <Checkbox checked={c[p.config_key] === true} onCheckedChange={(v) => set(!!v)} />;
		case 'report':
			// Saved-report picker — reuses a persisted ReportDefinition instead of ad-hoc config.
			return (
				<PropCombobox
					value={(c[p.config_key] as string) ?? ''}
					options={[{ value: '', label: 'None — ad-hoc config' }, ...reports.map((r) => ({ value: r.id, label: r.name }))]}
					onChange={set}
					placeholder="Pick a saved report…"
				/>
			);
		case 'select':
			return (
				<PropCombobox value={(c[p.config_key] as string) ?? ''} options={opts} onChange={set} placeholder={p.placeholder ?? 'Pick…'} />
			);
		case 'number':
			return (
				<Input
					type="number"
					value={(c[p.config_key] as number) ?? 0}
					onChange={(e) => set(Number(e.target.value) || 0)}
					placeholder={p.placeholder ?? ''}
				/>
			);
		case 'json':
		case 'code': {
			const raw = c[p.config_key] === undefined || c[p.config_key] === null ? (p.default_value ?? '') : c[p.config_key];
			const display = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
			return (
				<textarea
					value={display}
					onChange={(e) => {
						const t = e.target.value.trim();
						if (t === '') {
							set(null);
							return;
						}
						try {
							set(JSON.parse(t));
						} catch {
							/* keep last valid value while typing */
						}
					}}
					placeholder={p.placeholder ?? '{}'}
					rows={4}
					style={{
						width: '100%',
						fontFamily: 'monospace',
						fontSize: '0.72rem',
						padding: '0.4rem 0.5rem',
						borderRadius: 6,
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						resize: 'vertical',
					}}
				/>
			);
		}
		default:
			return <Input value={(c[p.config_key] as string) ?? ''} onChange={(e) => set(e.target.value)} placeholder={p.placeholder ?? ''} />;
	}
}

/** One widget prop control — rendered from the shared WidgetPropDef schema. */
function WidgetPropField({
	b,
	collections,
	update,
	propKey,
	prop,
}: {
	b: PageBlock;
	collections: CollectionSummary[];
	update: (id: string, k: string, v: unknown) => void;
	propKey: string;
	prop: WidgetPropDef;
}) {
	const cfg = b.config as Record<string, unknown>;
	const set = (v: unknown) => update(b.id, propKey, v);
	const value = cfg[propKey];
	const { schemas, fetchSchema } = useBuilder();

	// `field`-type props list the fields of the widget's configured collection.
	const collSlug = typeof cfg.collection === 'string' ? cfg.collection : '';
	const schema = collSlug ? (schemas[collSlug] ?? null) : null;
	useEffect(() => {
		if (collSlug && !schema) void fetchSchema(collSlug);
	}, [collSlug, schema, fetchSchema]);
	const fieldOptions = (schema?.schema_json.fields ?? [])
		.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name))
		.map((f) => ({ value: f.name, label: f.label || f.name }));

	switch (prop.type) {
		case 'boolean':
			return <Checkbox checked={!!value} onCheckedChange={(v) => set(!!v)} />;
		case 'number':
			return (
				<Input
					type="number"
					value={typeof value === 'number' ? value : ((prop.default as number) ?? 0)}
					onChange={(e) => set(Number(e.target.value) || 0)}
					placeholder={prop.hint ?? ''}
				/>
			);
		case 'select':
			return (
				<NativeSelect value={String(value ?? prop.default ?? '')} onChange={(e) => set(e.target.value)} style={{ fontSize: '0.74rem' }}>
					{(prop.options ?? []).map((o) => (
						<NativeSelectOption key={o.value} value={o.value}>
							{o.label}
						</NativeSelectOption>
					))}
				</NativeSelect>
			);
		case 'collection':
			return (
				<PropCombobox
					value={String(value ?? '')}
					options={collections.map((c) => ({ value: c.slug, label: `${c.name} (${c.slug})` }))}
					onChange={set}
					placeholder={prop.hint ?? 'Pick a collection'}
				/>
			);
		case 'field':
			return <PropCombobox value={String(value ?? '')} options={fieldOptions} onChange={set} placeholder={prop.hint ?? 'Pick a field'} />;
		case 'color':
			return <ColorPicker value={String(value ?? '')} onChange={set} />;
		case 'code': {
			const raw = value === undefined || value === null ? (prop.default ?? '') : value;
			const display = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
			return (
				<textarea
					value={display}
					onChange={(e) => {
						const t = e.target.value.trim();
						if (t === '') return set(null);
						try {
							set(JSON.parse(t));
						} catch {
							set(t); // keep raw text until it parses
						}
					}}
					placeholder={typeof prop.default === 'string' ? prop.default : (prop.hint ?? '{}')}
					rows={3}
					style={{
						width: '100%',
						boxSizing: 'border-box',
						padding: '0.35rem 0.5rem',
						fontSize: '0.72rem',
						fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
						borderRadius: 6,
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						background: 'var(--mmbix-card, #fff)',
						outline: 'none',
					}}
				/>
			);
		}
		default:
			// text / expression / icon — plain string input.
			return (
				<Input
					value={typeof value === 'string' ? value : String(prop.default ?? '')}
					onChange={(e) => set(e.target.value)}
					placeholder={prop.hint ?? prop.label}
				/>
			);
	}
}

function ConfigFields({
	b,
	collections,
	update,
}: {
	b: PageBlock;
	collections: CollectionSummary[];
	update: (id: string, k: string, v: unknown) => void;
}) {
	const { propsByComponent } = useStudioMeta();
	const defs = propsByComponent[b.type] ?? [];
	// Code-first widgets — the props schema lives in the shared registry.
	if (b.type.startsWith('widget:')) {
		const wdef = widgetDefOf(b.type);
		if (!wdef) return null;
		const entries = Object.entries(wdef.props);
		if (entries.length === 0) return null;
		// Group props by `group` (undefined → default group) so complex widgets
		// (data + layout + behavior) stay scannable in the inspector.
		const groups = new Map<string, typeof entries>();
		for (const [key, prop] of entries) {
			const g = prop.group ?? 'General';
			groups.set(g, [...(groups.get(g) ?? []), [key, prop] as [string, WidgetPropDef]]);
		}
		return (
			<>
				{[...groups.entries()].map(([g, props]) => (
					<div key={g} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
						<div style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9ca3af' }}>
							{g}
						</div>
						{props.map(([key, prop]) => (
							<div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
								<Label>{prop.label}</Label>
								<WidgetPropField b={b} collections={collections} update={update} propKey={key} prop={prop} />
								{prop.hint && <span style={{ fontSize: '0.66rem', color: '#9ca3af' }}>{prop.hint}</span>}
							</div>
						))}
					</div>
				))}
			</>
		);
	}
	if (defs.length === 0) return null;
	return (
		<>
			{defs.map((p) => (
				<div key={p.config_key}>
					<Label>{p.label}</Label>
					<PropField p={p} b={b} collections={collections} update={update} />
				</div>
			))}
		</>
	);
}

/** Dedicated links editor for the `links-card` block — arbitrary label+target rows,
 *  with a quick-pick of the app's collections and pages (Frappe workspace style). */
function LinksCardEditor({ b, update }: { b: PageBlock; update: (id: string, k: string, v: unknown) => void }) {
	const { collections, pages, moduleSlug } = useBuilder();
	const c = b.config as Record<string, unknown>;
	const links = Array.isArray(c.links) ? (c.links as Array<{ label?: string; target?: string }>) : [];
	const setLinks = (next: Array<{ label?: string; target?: string }>) => update(b.id, 'links', next);
	const pickOptions = [
		...collections.map((col) => ({ value: `${moduleSlug}/${col.slug}`, label: `${col.name} (collection)` })),
		...pages.map((p) => ({ value: `${moduleSlug}/${p.path.replace(/^\//, '')}`, label: `${p.title || p.path} (page)` })),
	];
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
			{links.map((link, i) => (
				<div
					key={i}
					style={{
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						borderRadius: 8,
						padding: 8,
						display: 'flex',
						flexDirection: 'column',
						gap: 6,
						background: 'var(--mmbix-card, #ffffff)',
					}}
				>
					<div style={{ display: 'flex', gap: 6 }}>
						<Input
							value={link.label ?? ''}
							placeholder="Link label"
							onChange={(e) => setLinks(links.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))}
							style={{ height: 28, fontSize: '0.78rem' }}
						/>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() => setLinks(links.filter((_, j) => j !== i))}
							style={{ color: '#dc2626', flexShrink: 0 }}
							title="Remove link"
						>
							<Trash2 size={13} />
						</Button>
					</div>
					<Input
						value={link.target ?? ''}
						placeholder="hrm/salary_slip"
						onChange={(e) => setLinks(links.map((l, j) => (j === i ? { ...l, target: e.target.value } : l)))}
						style={{ height: 28, fontSize: '0.78rem' }}
					/>
					<PropCombobox
						value={link.target ?? ''}
						options={pickOptions}
						onChange={(v) => setLinks(links.map((l, j) => (j === i ? { ...l, target: v } : l)))}
						placeholder="…or pick collection / page"
					/>
				</div>
			))}
			<Button variant="ghost" size="sm" onClick={() => setLinks([...links, { label: '', target: '' }])}>
				<Plus size={12} /> Add link
			</Button>
		</div>
	);
}

function PropsTab({
	b,
	collections,
	update,
}: {
	b: PageBlock;
	collections: CollectionSummary[];
	update: (id: string, k: string, v: unknown) => void;
}) {
	const c = b.config as Record<string, unknown>;
	const hidden = !!c.hidden;
	const expression = (c.condition as { expression?: string } | undefined)?.expression ?? '';
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
			<ConfigFields b={b} collections={collections} update={update} />
			{b.type === 'links-card' && <LinksCardEditor b={b} update={update} />}
			<Separator />
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
				<Label>Tooltip</Label>
				<Input value={(c.tooltip as string) ?? ''} placeholder="Shown on hover" onChange={(e) => update(b.id, 'tooltip', e.target.value)} />
			</div>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<Checkbox checked={hidden} onCheckedChange={(v) => update(b.id, 'hidden', !!v)} />
				<Label>Hidden</Label>
			</div>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
				<Label>Show when (expression)</Label>
				<Input
					value={expression}
					placeholder="e.g. status == 'active'"
					onChange={(e) => update(b.id, 'condition', { expression: e.target.value })}
				/>
			</div>
		</div>
	);
}

function StyleTab({ b, update }: { b: PageBlock; update: (id: string, k: string, v: unknown) => void }) {
	const { stylePresets, stylesByComponent } = useStudioMeta();
	const c = b.config as Record<string, unknown>;
	const s = (c.style as Record<string, string> | undefined) ?? {};
	const setS = (k: string, v: string) => update(b.id, 'style', { ...s, [k]: v });
	const opts = (group: string) => (stylePresets[group] ?? []).map((p) => ({ value: p.value_key, label: p.label }));

	const defs = stylesByComponent[b.type] ?? [];
	const controls: { key: string; label: string; type: ComponentStyle['style_type']; group?: string }[] =
		defs.length > 0
			? defs.map((d) => ({ key: d.style_key, label: d.label, type: d.style_type, group: d.preset_group ?? undefined }))
			: [
					{ key: 'padding', label: 'Padding', type: 'preset', group: 'size' },
					{ key: 'bg', label: 'Background', type: 'color' },
					{ key: 'color', label: 'Text color', type: 'color' },
					{ key: 'radius', label: 'Radius', type: 'preset', group: 'radius' },
					{ key: 'fontSize', label: 'Font size', type: 'input' },
				];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
			{controls.map((ctrl) => {
				if (ctrl.type === 'preset')
					return (
						<div key={ctrl.key}>
							<Label>{ctrl.label}</Label>
							<PropCombobox
								value={s[ctrl.key] ?? ''}
								options={opts(ctrl.group ?? '')}
								onChange={(v) => setS(ctrl.key, v)}
								placeholder="Default"
							/>
						</div>
					);
				if (ctrl.type === 'color')
					return (
						<div key={ctrl.key}>
							<Label>{ctrl.label}</Label>
							<ColorPicker value={s[ctrl.key] ?? ''} onChange={(v) => setS(ctrl.key, v)} />
						</div>
					);
				if (ctrl.type === 'toggle')
					return (
						<div key={ctrl.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
							<Label>{ctrl.label}</Label>
							<Checkbox checked={s[ctrl.key] === 'true'} onCheckedChange={(v) => setS(ctrl.key, String(!!v))} />
						</div>
					);
				if (ctrl.type === 'slider')
					return (
						<div key={ctrl.key}>
							<Label>{ctrl.label}</Label>
							<Slider
								value={[Number(s[ctrl.key] ?? 0)]}
								min={0}
								max={100}
								onValueChange={(v) => setS(ctrl.key, String(Array.isArray(v) ? (v[0] ?? 0) : v))}
							/>
						</div>
					);
				return (
					<div key={ctrl.key}>
						<Label>{ctrl.label}</Label>
						<Input value={s[ctrl.key] ?? ''} placeholder="—" onChange={(e) => setS(ctrl.key, e.target.value)} />
					</div>
				);
			})}
		</div>
	);
}

interface ClickAction {
	action: string;
	params: Record<string, unknown>;
}

function EventsTab({ b, update }: { b: PageBlock; update: (id: string, k: string, v: unknown) => void }) {
	const { eventActions, eventsByComponent } = useStudioMeta();
	const actions = eventActions.map((a) => ({ value: a.action_key, label: a.label }));
	const c = b.config as Record<string, unknown>;
	const events = (c.events as Record<string, ClickAction[]> | undefined) ?? {};
	// Per-component event definitions (e.g. Button exposes onClick) — fall back to onClick only.
	const defs = eventsByComponent[b.type] ?? [];
	const eventNames = defs.length > 0 ? defs.map((d) => d.event_name) : ['onClick'];
	const list = (name: string) => events[name] ?? [];
	const setList = (name: string, next: ClickAction[]) => update(b.id, 'events', { ...events, [name]: next });
	const patch = (name: string, i: number, part: Partial<ClickAction>) =>
		setList(
			name,
			list(name).map((e, j) => (j === i ? { ...e, ...part } : e)),
		);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
			{eventNames.map((name) => (
				<div key={name}>
					<Label>{name}</Label>
					{list(name).map((ev, i) => (
						<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
							<div style={{ flex: 1 }}>
								<PropCombobox
									value={ev.action}
									options={actions}
									onChange={(v) => patch(name, i, { action: v })}
									placeholder="Pick action"
								/>
							</div>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() =>
									setList(
										name,
										list(name).filter((_, j) => j !== i),
									)
								}
								style={{ color: '#dc2626' }}
							>
								<Trash2 size={13} />
							</Button>
						</div>
					))}
					<Button variant="ghost" size="sm" onClick={() => setList(name, [...list(name), { action: actions[0]?.value ?? '', params: {} }])}>
						<Plus size={12} /> Add action
					</Button>
				</div>
			))}
			<p style={{ margin: 0, fontSize: '0.75rem', color: '#9ca3af' }}>Click actions come from the Studio admin (Events tab).</p>
		</div>
	);
}

/** View tab — per-view configuration (collection, fields, page size, sort). */
function ViewTab({ view }: { view: string }) {
	const { viewConfigs, setViewConfig, collections, schemas, fetchSchema } = useBuilder();
	const vc = viewConfigs[view] ?? {};
	const schema = vc.collection ? (schemas[vc.collection] ?? null) : null;

	useEffect(() => {
		if (vc.collection && !schemas[vc.collection]) void fetchSchema(vc.collection);
	}, [vc.collection, schemas, fetchSchema]);

	const fields = (schema?.schema_json.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const visibleMap: Record<string, boolean> = {};
	for (const f of fields) visibleMap[f.name] = true;
	for (const f of vc.fields ?? []) visibleMap[f.name] = f.visible;

	const toggleField = (name: string, vis: boolean) => {
		const next = fields.map((f) => ({ name: f.name, visible: f.name === name ? vis : (visibleMap[f.name] ?? true) }));
		setViewConfig(view, { fields: next });
	};

	// ── Child-collection tabs (form view) ──
	const [tabDlg, setTabDlg] = useState(false);
	const [tabCollection, setTabCollection] = useState('');
	const [tabFilter, setTabFilter] = useState('');
	const [tabColumns, setTabColumns] = useState<string[]>([]);
	const childSchema = tabCollection ? (schemas[tabCollection] ?? null) : null;
	useEffect(() => {
		if (tabCollection && !schemas[tabCollection]) void fetchSchema(tabCollection);
	}, [tabCollection, schemas, fetchSchema]);
	const childFields = (childSchema?.schema_json.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	// Candidate parent links: m2o fields on the child that point back at the form's collection.
	const filterCandidates = childFields.filter((f) => (f.type === 'm2o' || f.type === 'm2a') && f.related_collection === vc.collection);
	const addChildTab = () => {
		const label = collections.find((c) => c.slug === tabCollection)?.name ?? tabCollection;
		const tab = {
			kind: 'collection' as const,
			label,
			collection: tabCollection,
			filterField: tabFilter || undefined,
			columns: tabColumns.length > 0 ? tabColumns : undefined,
		};
		setViewConfig(view, { tabs: [...(vc.tabs ?? []), tab] });
		setTabDlg(false);
		setTabCollection('');
		setTabFilter('');
		setTabColumns([]);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
			{view === 'table' ? (
				/* Layout mode: the Data + Rows sections live in the right pane —
				   the Columns editor stays in the middle canvas. */
				<TableConfigEditor view="table" showColumns={false} compact />
			) : view === 'card' ? (
				/* Card layout mode: Data + Card + Fields sections all live here —
				   the middle canvas stays a pure live preview. */
				<CardConfigEditor view="card" compact />
			) : view === 'kanban' ? (
				/* Kanban layout mode: Data + Board + Cards sections all live here —
				   the middle canvas stays a pure live preview. */
				<KanbanConfigEditor view="kanban" compact />
			) : view === 'pivot' ? (
				/* Pivot layout mode: collection + dims + measures with a live preview. */
				<PivotViewConfigEditor view="pivot" compact />
			) : (
				<>
					<div>
						<Label>Collection</Label>
						<PropCombobox
							value={vc.collection ?? ''}
							options={collections.map((c) => ({ value: c.slug, label: `${c.name} (${c.slug})` }))}
							onChange={(v) => setViewConfig(view, { collection: v })}
							placeholder="Pick a collection"
						/>
					</div>
					{vc.collection && (
						<>
							{view === 'table' ? (
								<TableConfigEditor view={view} />
							) : (
								<>
									<div>
										<Label>Page size</Label>
										<Input
											type="number"
											value={vc.pageSize ?? 25}
											onChange={(e) => setViewConfig(view, { pageSize: Number(e.target.value) || 25 })}
										/>
									</div>
									<div>
										<Label>Default sort</Label>
										<Input
											value={vc.defaultSort ?? ''}
											placeholder="e.g. -created_at"
											onChange={(e) => setViewConfig(view, { defaultSort: e.target.value })}
										/>
									</div>
									<Separator />
									{view !== 'form' && (
										<>
											<Label>Fields</Label>
											{fields.length === 0 ? (
												<p style={{ margin: 0, fontSize: '0.78rem', color: '#9ca3af' }}>
													{schema ? 'No fields.' : 'Pick a collection to load its fields.'}
												</p>
											) : (
												<div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
													{fields.map((f) => (
														<div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
															<Checkbox checked={visibleMap[f.name] ?? true} onCheckedChange={(v) => toggleField(f.name, !!v)} />
															<span style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
																{f.label || f.name}
															</span>
														</div>
													))}
												</div>
											)}
										</>
									)}
									{view === 'kanban' && (
										<div>
											<Label>Group by</Label>
											<PropCombobox
												value={vc.groupBy ?? ''}
												options={fields.map((f) => ({ value: f.name, label: f.label || f.name }))}
												onChange={(v) => setViewConfig(view, { groupBy: v })}
												placeholder="Group column"
											/>
										</div>
									)}
									{view === 'calendar' && (
										<div>
											<Label>Date field</Label>
											<PropCombobox
												value={vc.dateField ?? ''}
												options={fields.map((f) => ({ value: f.name, label: f.label || f.name }))}
												onChange={(v) => setViewConfig(view, { dateField: v })}
												placeholder="Date column"
											/>
										</div>
									)}
								</>
							)}
							{view === 'form' && (
								<>
									<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
										<Label style={{ margin: 0 }}>Stepper (wizard)</Label>
										<Switch checked={vc.stepper === true} onCheckedChange={(v) => setViewConfig(view, { stepper: v })} />
									</div>
									<p style={{ margin: '0 0 0.5rem', fontSize: '0.72rem', color: '#9ca3af' }}>
										Render the form tabs one step at a time (multi-step form).
									</p>
									<Separator />
									<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
										<Label style={{ margin: 0 }}>Child tabs</Label>
										<Button variant="outline" size="xs" onClick={() => setTabDlg(true)}>
											<Plus size={12} /> Add
										</Button>
									</div>
									{(vc.tabs ?? []).length === 0 && (
										<p style={{ margin: 0, fontSize: '0.75rem', color: '#9ca3af' }}>
											Show records of a related collection in their own tab — e.g. lines under a header form.
										</p>
									)}
									{(vc.tabs ?? []).map((t, i) => (
										<div key={`${t.collection}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
											<div style={{ flex: 1, minWidth: 0, fontSize: '0.8rem' }}>
												<strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
													{t.label}
												</strong>
												<span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>
													{t.collection}
													{t.filterField ? ` · via ${t.filterField}` : ''}
												</span>
											</div>
											<Button
												variant="ghost"
												size="icon-xs"
												onClick={() => setViewConfig(view, { tabs: (vc.tabs ?? []).filter((_, j) => j !== i) })}
												style={{ color: '#dc2626' }}
											>
												<Trash2 size={12} />
											</Button>
										</div>
									))}
									<Dialog open={tabDlg} onOpenChange={(open) => setTabDlg(open)}>
										<DialogContent style={{ width: 380 }}>
											<DialogHeader>
												<DialogTitle>Add child tab</DialogTitle>
												<DialogDescription>
													Records of the child collection render in their own tab, filtered by the parent link.
												</DialogDescription>
											</DialogHeader>
											<div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
												<div>
													<Label>Collection</Label>
													<PropCombobox
														value={tabCollection}
														options={collections.map((c) => ({ value: c.slug, label: `${c.name} (${c.slug})` }))}
														onChange={setTabCollection}
														placeholder="Pick a child collection"
													/>
												</div>
												{childSchema && (
													<>
														<div>
															<Label>Parent link (m2o on the child)</Label>
															<PropCombobox
																value={tabFilter}
																options={filterCandidates.map((f) => ({ value: f.name, label: f.label || f.name }))}
																onChange={setTabFilter}
																placeholder={filterCandidates.length > 0 ? 'Pick the parent field' : 'No m2o back to this collection'}
															/>
														</div>
														<div>
															<Label>Columns</Label>
															<div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto' }}>
																{childFields.map((f) => (
																	<div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
																		<Checkbox
																			checked={tabColumns.includes(f.name)}
																			onCheckedChange={(v) =>
																				setTabColumns((prev) => (v ? [...prev, f.name] : prev.filter((n) => n !== f.name)))
																			}
																		/>
																		<span
																			style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
																		>
																			{f.label || f.name}
																		</span>
																	</div>
																))}
															</div>
														</div>
													</>
												)}
											</div>
											<DialogFooter>
												<Button variant="outline" size="sm" onClick={() => setTabDlg(false)}>
													Cancel
												</Button>
												<Button size="sm" disabled={!tabCollection} onClick={addChildTab}>
													<Plus size={12} /> Add tab
												</Button>
											</DialogFooter>
										</DialogContent>
									</Dialog>
								</>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
}

/* ── Page-level properties (right pane of the builder) ── */

export function PageProperties() {
	const {
		title,
		setTitle,
		path,
		setPath,
		blocks,
		selectedBlock,
		updateConfig,
		collections,
		removeBlock,
		error,
		canvasMode,
		selected,
		setSelected,
		dirty,
	} = useBuilder();
	const { capabilities } = useStudioMeta();
	const [blockTab, setBlockTab] = useState<'props' | 'style' | 'events' | 'data'>('props');
	const { toggle } = useRightPane() ?? { toggle: () => {} };
	// Capability-driven: which components accept click events (from the studio metadata DB).
	const canEvents = !!selectedBlock && !!capabilities[selectedBlock.type]?.events;
	const canData = !!selectedBlock && isDataCapable(selectedBlock.type);
	const blockTabs: ('props' | 'style' | 'events' | 'data')[] = [
		'props',
		...(canData ? ['data' as const] : []),
		'style',
		...(canEvents ? ['events' as const] : []),
	];

	// Unsaved-changes guard: warn before closing/refreshing the tab with a dirty draft.
	useEffect(() => {
		if (!dirty) return;
		const handler = (e: BeforeUnloadEvent) => {
			e.preventDefault();
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, [dirty]);

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', padding: '0.75rem', overflowY: 'auto', flex: 1, minHeight: 0 }}>
			{/* Collapse pane — Save now lives in the app bar (header) */}
			<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
				<Button variant="ghost" size="icon-xs" title="Collapse pane" onClick={toggle}>
					<ChevronsRight size={13} />
				</Button>
			</div>
			{error && (
				<Alert variant="destructive" style={{ padding: '0.5rem 0.7rem' }}>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{/* Page identity — shared property section style. */}
			<PropSection title="Page" defaultOpen>
				<PropRow label="Title">
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Page title"
						style={{ height: 28, fontSize: '0.8rem' }}
					/>
				</PropRow>
				<PropRow label="Path" hint="URL of the page in the app — lowercase, hyphens.">
					<Input
						value={path}
						onChange={(e) => setPath(e.target.value.replace(/^\/+/, '').replace(/[^a-z0-9-_/]/g, ''))}
						placeholder="my-page"
						style={{ height: 28, fontSize: '0.8rem' }}
					/>
				</PropRow>
			</PropSection>

			<Separator />

			{/* Block tree — containers nest their children (row/column/tabs/accordion). */}
			{blocks.length > 0 && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 260, overflowY: 'auto' }}>
					<BlockTree blocks={blocks} selected={selected} onSelect={setSelected} onRemove={removeBlock} depth={0} />
				</div>
			)}
			{selectedBlock && isContainerType(selectedBlock.type) && (
				<p style={{ margin: 0, fontSize: '0.72rem', color: '#9ca3af', padding: '0.15rem 0.3rem' }}>
					<Plus size={11} style={{ verticalAlign: '-2px' }} /> New blocks from the palette are added inside this {selectedBlock.type}{' '}
					container.
				</p>
			)}

			<Separator />

			{/* Per-view configuration — collection, fields, page size, sort. Always visible
			    so the view's data source can be bound/designed without selecting a block. */}
			<ViewTab view={canvasMode} />

			<Separator />

			{/* Selected block inspector */}
			{selectedBlock && (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0 }}>
					<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
						<Badge style={{ textTransform: 'capitalize' }}>{selectedBlock.type}</Badge>
						<span style={{ fontSize: '0.72rem', color: '#9ca3af', marginLeft: 'auto' }}>
							{selectedBlock.config.hidden ? <EyeOff size={12} /> : <Eye size={12} />} {selectedBlock.config.hidden ? 'hidden' : 'visible'}
						</span>
					</div>
					<div
						style={{
							display: 'flex',
							gap: 2,
							padding: '0.2rem',
							borderRadius: 8,
							background: 'var(--mmbix-muted, #f3f4f6)',
							flexWrap: 'wrap',
						}}
					>
						{blockTabs.map((t) =>
							t === 'events' && !canEvents ? null : (
								<Button
									key={t}
									variant={blockTab === t ? 'default' : 'ghost'}
									size="sm"
									onClick={() => setBlockTab(t)}
									style={{ textTransform: 'capitalize', fontSize: '0.75rem', padding: '0 0.6rem' }}
								>
									{t}
								</Button>
							),
						)}
					</div>
					{blockTab === 'props' && <PropsTab b={selectedBlock} collections={collections} update={updateConfig} />}
					{blockTab === 'data' && <DataTab b={selectedBlock} update={updateConfig} />}
					{blockTab === 'style' && <StyleTab b={selectedBlock} update={updateConfig} />}
					{blockTab === 'events' && <EventsTab b={selectedBlock} update={updateConfig} />}
				</div>
			)}
		</div>
	);
}

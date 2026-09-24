/**
 * Data Tab — the "DB assistant" for the block inspector.
 *
 * Lets any data-capable block bind to a collection and show REAL data:
 *   - Data blocks (table/list/kpi/chart/entity-form/…) → bind a collection,
 *     pick which fields to show, see the live record count.
 *   - Option blocks (select/combobox) → pick a collection + display field,
 *     then LOAD actual values from the database into the component's options.
 *
 * Runs on the existing metadata pipeline: everything lands in block config
 * (collection / fields / options) which the shared renderer consumes.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList, Spinner } from '@mmbix/design-system';
import { Database, RefreshCw, Zap } from 'lucide-react';
import { listItems, SYSTEM_FIELD_NAMES, type PageBlock } from '../lib/api';
import { itemsQuery } from '../lib/queries';
import { useBuilder } from './PageBuilderContext';
import { PropRow, PropSection } from './formlayout/properties';

/** Blocks that render collection data directly. */
const DATA_BLOCKS = new Set(['list', 'table', 'kpi', 'chart', 'entity-card-grid', 'entity-form', 'kanban', 'calendar']);
/** Blocks whose options can be loaded from a collection field. */
const OPTION_BLOCKS = new Set(['select', 'combobox']);

export function isDataCapable(type: string): boolean {
	return DATA_BLOCKS.has(type) || OPTION_BLOCKS.has(type);
}

export function DataTab({ b, update }: { b: PageBlock; update: (id: string, k: string, v: unknown) => void }) {
	const { token, collections, fetchSchema, schemas } = useBuilder();
	const c = b.config as Record<string, unknown>;
	const isData = DATA_BLOCKS.has(b.type);
	const isOptions = OPTION_BLOCKS.has(b.type);
	const collection = String(c.collection ?? '');

	const schema = collection ? (schemas[collection] ?? null) : null;
	const fields = useMemo(() => (schema ? schema.schema_json.fields.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name)) : []), [schema]);
	const [loading, setLoading] = useState(false);
	const [loadMsg, setLoadMsg] = useState('');

	// Fetch schema when a collection is bound.
	useEffect(() => {
		if (collection && !schemas[collection]) void fetchSchema(collection);
	}, [collection, schemas, fetchSchema]);

	// Live record count — a `count_only` read through the row cache, so switching
	// between blocks bound to the same collection is a cache hit (it used to re-read
	// the count on every inspector mount). `count_only=true` is what makes the engine
	// return `meta.total` at all, and it skips the page SELECT entirely — the count
	// costs one COUNT(*) and nothing else.
	const countQ = useQuery(itemsQuery(token, collection, { countOnly: true, fields: 'id' }));
	const count = collection ? (countQ.data?.total ?? null) : null;
	const countBusy = countQ.isFetching;

	const chosenFields = useMemo(() => {
		const f = c.fields;
		return Array.isArray(f) ? (f as Array<string | { name: string; visible?: boolean }>) : [];
	}, [c.fields]);

	function toggleField(name: string) {
		const next = chosenFields.map((x) => (typeof x === 'string' ? { name: x, visible: true } : x));
		const idx = next.findIndex((x) => x.name === name);
		if (idx >= 0) next[idx] = { name, visible: next[idx].visible === false };
		else next.push({ name, visible: true });
		update(
			b.id,
			'fields',
			next.map((x) => ({ name: x.name, visible: x.visible !== false })),
		);
	}

	const [displayField, setDisplayField] = useState('');
	const [valueField, setValueField] = useState('');

	/** Load up to 20 real rows from the bound collection into select/combobox options. */
	async function loadOptions() {
		if (!collection || !displayField) return;
		setLoading(true);
		setLoadMsg('');
		try {
			// Only the two columns the option pair reads — never the whole row graph.
			const valField = valueField || 'id';
			const res = await listItems(token, collection, { limit: 20, fields: [...new Set(['id', valField, displayField])].join(',') });
			const items = (res.rows ?? []) as Array<Record<string, unknown>>;
			const options = items.map((row) => {
				const v = row[valField];
				const l = row[displayField];
				return { value: String(v ?? ''), label: l === null || l === undefined || l === '' ? String(v ?? '—') : String(l) };
			});
			update(b.id, 'options', options);
			setLoadMsg(`Loaded ${options.length} options from “${collection}”.`);
		} catch (e) {
			setLoadMsg(e instanceof Error ? e.message : 'Failed to load data');
		} finally {
			setLoading(false);
		}
	}

	return (
		<PropSection title="Database" defaultOpen>
			<PropRow label="Collection" hint="Bind this component to a collection.">
				<Combobox
					value={collection}
					items={collections.map((col) => col.slug)}
					onValueChange={(v) => {
						if (v) update(b.id, 'collection', v);
					}}
					onInputValueChange={() => {}}
					itemToStringLabel={(v) => collections.find((col) => col.slug === v)?.name ?? String(v)}
				>
					<ComboboxInput showTrigger placeholder="Pick a collection…" style={{ width: '100%' }} />
					<ComboboxContent align="start" sideOffset={4} style={{ width: 260 }}>
						<ComboboxList>
							{(item: string) => {
								const col = collections.find((x) => x.slug === item);
								if (!col) return null;
								return (
									<ComboboxItem key={col.slug} value={col.slug}>
										{col.name} ({col.slug})
									</ComboboxItem>
								);
							}}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</PropRow>

			{collection && (
				<PropRow label="Records">
					<span
						style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--mmbix-foreground, #374151)' }}
					>
						<Database size={12} style={{ color: 'var(--mmbix-primary, #0f766e)' }} />
						{countBusy ? <Spinner size={12} /> : count === null ? '—' : count} records
						{!countBusy && (
							<button
								type="button"
								onClick={() => void countQ.refetch()}
								title="Refresh count"
								style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', color: '#9ca3af' }}
							>
								<RefreshCw size={11} />
							</button>
						)}
					</span>
				</PropRow>
			)}

			{isData && collection && fields.length > 0 && (
				<>
					<PropRow label="Show fields" hint={`${fields.length} fields in ${collection}`}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 180, overflowY: 'auto' }}>
							{fields.slice(0, 30).map((f) => {
								const ch = chosenFields.some((x) => (typeof x === 'string' ? x === f.name : x.name === f.name && x.visible !== false));
								return (
									<label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', cursor: 'pointer' }}>
										<input type="checkbox" checked={ch} onChange={() => toggleField(f.name)} />
										<span style={{ fontWeight: 500 }}>{f.label ?? f.name}</span>
										<span style={{ color: '#9ca3af', fontSize: '0.66rem', marginLeft: 'auto' }}>{f.type}</span>
									</label>
								);
							})}
						</div>
					</PropRow>
					<Button
						size="sm"
						variant="ghost"
						onClick={() =>
							update(
								b.id,
								'fields',
								fields.map((f) => ({ name: f.name, visible: true })),
							)
						}
						style={{ alignSelf: 'flex-start', fontSize: '0.7rem' }}
					>
						<Zap size={12} /> Show all fields
					</Button>
				</>
			)}

			{isOptions && collection && fields.length > 0 && (
				<>
					<PropRow label="Option label field">
						<Combobox
							value={displayField}
							items={fields.map((f) => f.name)}
							onValueChange={(v) => {
								if (v) setDisplayField(String(v));
							}}
							onInputValueChange={() => {}}
							itemToStringLabel={(v) => fields.find((f) => f.name === v)?.label ?? String(v)}
						>
							<ComboboxInput showTrigger placeholder="Pick a field…" style={{ width: '100%' }} />
							<ComboboxContent align="start" sideOffset={4} style={{ width: 240 }}>
								<ComboboxList>
									{(item: string) => {
										const f = fields.find((x) => x.name === item);
										if (!f) return null;
										return (
											<ComboboxItem key={f.name} value={f.name}>
												{f.label ?? f.name}
											</ComboboxItem>
										);
									}}
								</ComboboxList>
							</ComboboxContent>
						</Combobox>
					</PropRow>
					<PropRow label="Option value field" hint="Default: id">
						<Combobox
							value={valueField}
							items={fields.map((f) => f.name)}
							onValueChange={(v) => {
								if (v) setValueField(String(v));
							}}
							onInputValueChange={() => {}}
							itemToStringLabel={(v) => (v ? (fields.find((f) => f.name === v)?.label ?? v) : 'id (default)')}
						>
							<ComboboxInput showTrigger placeholder="id" style={{ width: '100%' }} />
							<ComboboxContent align="start" sideOffset={4} style={{ width: 240 }}>
								<ComboboxList>
									{(item: string) => {
										const f = fields.find((x) => x.name === item);
										if (!f) return null;
										return (
											<ComboboxItem key={f.name} value={f.name}>
												{f.label ?? f.name}
											</ComboboxItem>
										);
									}}
								</ComboboxList>
							</ComboboxContent>
						</Combobox>
					</PropRow>
					<Button
						size="sm"
						onClick={() => void loadOptions()}
						disabled={!displayField || loading}
						style={{ gap: 6, fontSize: '0.72rem', alignSelf: 'flex-start' }}
					>
						{loading ? <Spinner size={13} /> : <Database size={13} />}
						Load options from data
					</Button>
					{loadMsg && <span style={{ fontSize: '0.68rem', color: '#64748b' }}>{loadMsg}</span>}
				</>
			)}

			{!collection && (
				<p style={{ margin: 0, fontSize: '0.7rem', color: '#9ca3af' }}>Pick a collection to bind real data to this component.</p>
			)}
		</PropSection>
	);
}

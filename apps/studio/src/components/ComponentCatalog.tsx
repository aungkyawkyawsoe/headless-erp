/**
 * Component Catalog — the builder's left-pane block library.
 *
 * DB-driven: reads design_components from the studio metadata DB (labels,
 * groups, icons, demo props) — editable via StudioAdmin without code. Each
 * item is a compact icon+label chip; clicking or dragging adds a demo-seeded
 * block to the canvas, which renders the full component.
 */
import { useMemo, useState } from 'react';
import { Box } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { WIDGET_REGISTRY, widgetDefaults, type WidgetDef } from '@mmbix/ui-views';
import { useBuilder } from './PageBuilderContext';
import { useStudioMeta, dsIcon, type DesignComponent } from '../lib/studioMeta';
import type { PageBlock } from '../lib/api';

type AtomicLevel = 'atoms' | 'molecules' | 'organisms';

/** Manual atomic classification of block types (aligned with the design system). */
const ATOMIC_LEVEL: Record<string, AtomicLevel> = {
	button: 'atoms',
	badge: 'atoms',
	avatar: 'atoms',
	input: 'atoms',
	textarea: 'atoms',
	select: 'atoms',
	combobox: 'atoms',
	checkbox: 'atoms',
	switch: 'atoms',
	toggle: 'atoms',
	'radio-group': 'atoms',
	slider: 'atoms',
	rating: 'atoms',
	datepicker: 'atoms',
	'color-picker': 'atoms',
	'search-box': 'atoms',
	'tags-input': 'atoms',
	progress: 'atoms',
	skeleton: 'atoms',
	tooltip: 'atoms',
	breadcrumb: 'atoms',
	pagination: 'atoms',
	separator: 'atoms',
	spinner: 'atoms',
	kbd: 'atoms',
	'input-otp': 'atoms',
	text: 'molecules',
	heading: 'molecules',
	'section-header': 'molecules',
	divider: 'molecules',
	spacer: 'molecules',
	image: 'molecules',
	alert: 'molecules',
	'links-card': 'molecules',
	'choice-card': 'molecules',
	empty: 'molecules',
	field: 'molecules',
	'input-group': 'molecules',
	'button-group': 'molecules',
	'toggle-group': 'molecules',
	card: 'molecules',
	tabs: 'molecules',
	accordion: 'molecules',
	grid: 'molecules',
	row: 'molecules',
	column: 'molecules',
	'media-panel': 'molecules',
	table: 'organisms',
	list: 'organisms',
	kpi: 'organisms',
	chart: 'organisms',
	report: 'organisms',
	appshell: 'organisms',
	sidebar: 'organisms',
	datatable: 'organisms',
	schema: 'organisms',
	'locale-provider': 'organisms',
	'theme-provider': 'organisms',
	marker: 'molecules',
	'native-select': 'atoms',
	label: 'atoms',
	'info-row': 'molecules',
	'counter-chip': 'molecules',
};

const LEVEL_META: Record<AtomicLevel, { label: string; color: string }> = {
	atoms: { label: 'Atoms', color: '#3b82f6' },
	molecules: { label: 'Molecules', color: '#8b5cf6' },
	organisms: { label: 'Organisms', color: '#10b981' },
};
const LEVEL_ORDER: AtomicLevel[] = ['atoms', 'molecules', 'organisms'];
const FILTER_KEYS = ['all', 'widgets', ...LEVEL_ORDER] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

/** Build a demo PageBlock from a component's demo_json (or defaults). */
function demoBlockOf(comp: DesignComponent): PageBlock | null {
	try {
		const cfg = JSON.parse(comp.demo_json ?? comp.defaults_json ?? '{}') as Record<string, unknown> & {
			_children?: Array<{ type: string; config?: Record<string, unknown>; label?: string }>;
		};
		const { _children, ...rest } = cfg;
		const block: PageBlock = {
			id: `demo:${comp.name}`,
			type: comp.name,
			label: comp.label,
			layout: { order: 0 },
			config: rest,
		};
		if (Array.isArray(_children)) {
			block.children = _children.map((c) => ({
				id: crypto.randomUUID(),
				type: c.type,
				label: c.label ?? c.type,
				layout: { order: 0 },
				config: c.config ?? {},
			}));
		}
		return block;
	} catch {
		return null;
	}
}

/** Catalog item — compact chip (icon + label); adds a demo-seeded block on
 *  click/drag. The canvas renders the full component (demo config), not here. */
function CatalogItem({ comp }: { comp: DesignComponent }) {
	const { addBlock } = useBuilder();
	// Demo config + children (from demo_json) — the ADDED canvas block renders
	// exactly like the storyboard, full-size.
	const demo = useMemo(() => demoBlockOf(comp), [comp]);
	const extra = useMemo(() => {
		if (!demo) return undefined;
		return {
			config: demo.config as Record<string, unknown>,
			...(demo.children ? { children: demo.children } : {}),
		};
	}, [demo]);
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `palette:${comp.name}`,
		data: { paletteType: comp.name, paletteExtra: extra },
	});
	return (
		<button
			ref={setNodeRef}
			type="button"
			{...listeners}
			{...attributes}
			onClick={() => addBlock(comp.name, extra)}
			title={`Add ${comp.label} — drag or click`}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				gap: 6,
				width: '100%',
				padding: '0.3rem 0.5rem',
				borderRadius: 7,
				border: '1px solid var(--mmbix-border, #e5e7eb)',
				background: 'var(--mmbix-card, #fff)',
				cursor: 'grab',
				fontSize: '0.74rem',
				fontWeight: 500,
				color: 'var(--mmbix-foreground, #374151)',
				textAlign: 'left',
				userSelect: 'none',
				opacity: isDragging ? 0.4 : 1,
			}}
		>
			<span style={{ display: 'inline-flex', color: 'var(--mmbix-muted-foreground, #6b7280)', flexShrink: 0 }}>
				{dsIcon(comp.icon, 14)}
			</span>
			<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{comp.label}</span>
		</button>
	);
}

/** The block library — search + atomic filters, code widgets, demo chips. */
export function ComponentCatalog() {
	const { insertWidget } = useBuilder();
	const { components } = useStudioMeta();
	const [query, setQuery] = useState('');
	const [level, setLevel] = useState<FilterKey>('all');

	const groups = useMemo(() => {
		const q = query.trim().toLowerCase();
		const map: Record<AtomicLevel, DesignComponent[]> = { atoms: [], molecules: [], organisms: [] };
		for (const c of components) {
			if (c.is_active !== 1) continue;
			const lvl = ATOMIC_LEVEL[c.name] ?? 'molecules';
			if (level !== 'all' && lvl !== level) continue;
			if (q && !c.label.toLowerCase().includes(q) && !c.name.toLowerCase().includes(q)) continue;
			map[lvl].push(c);
		}
		return map;
	}, [query, level, components]);

	// Code-first widgets — real React components under packages/design-system/
	// src/components/widgets (one file per widget; no database involved).
	const codeWidgets = useMemo(() => {
		const q = query.trim().toLowerCase();
		return WIDGET_REGISTRY.filter((w) => !q || w.label.toLowerCase().includes(q) || w.type.toLowerCase().includes(q));
	}, [query]);

	const insertCodeWidget = (def: WidgetDef) => {
		const tree: PageBlock[] = [
			{
				id: crypto.randomUUID(),
				type: def.type,
				label: def.label,
				layout: { order: 0, colSpan: def.defaultColSpan ?? 12 },
				config: widgetDefaults(def),
			},
		];
		insertWidget(tree, def.label);
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			<div
				style={{
					padding: '0.6rem 0.7rem',
					borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
					display: 'flex',
					flexDirection: 'column',
					gap: 6,
				}}
			>
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search components…"
					style={{
						width: '100%',
						boxSizing: 'border-box',
						padding: '0.28rem 0.55rem',
						fontSize: '0.72rem',
						borderRadius: 7,
						border: '1px solid var(--mmbix-border, #e5e7eb)',
						background: 'var(--mmbix-card, #fff)',
						outline: 'none',
						color: 'var(--mmbix-foreground, #374151)',
					}}
				/>
				<div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
					{FILTER_KEYS.map((l) => (
						<button
							key={l}
							type="button"
							onClick={() => setLevel(l)}
							style={{
								padding: '0.15rem 0.5rem',
								borderRadius: 6,
								border: '1px solid var(--mmbix-border, #e5e7eb)',
								background: level === l ? 'var(--mmbix-primary, #0f766e)' : 'transparent',
								color: level === l ? '#fff' : '#64748b',
								fontSize: '0.66rem',
								fontWeight: 600,
								cursor: 'pointer',
								textTransform: 'capitalize',
							}}
						>
							{l}
						</button>
					))}
				</div>
			</div>

			<div
				style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.5rem 0.6rem', display: 'flex', flexDirection: 'column', gap: 10 }}
			>
				{(level === 'all' || level === 'widgets') && codeWidgets.length > 0 && (
					<div>
						<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
							<span style={{ width: 8, height: 8, borderRadius: 2, background: '#7c3aed' }} />
							<span style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}>
								Widgets
							</span>
							<span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>{codeWidgets.length}</span>
						</div>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5 }}>
							{codeWidgets.map((w) => (
								<button
									key={w.type}
									type="button"
									title="Insert code widget"
									onClick={() => insertCodeWidget(w)}
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 5,
										width: '100%',
										padding: '0.28rem 0.45rem',
										borderRadius: 6,
										border: '1px solid var(--mmbix-border, #e5e7eb)',
										background: 'var(--mmbix-card, #fff)',
										cursor: 'pointer',
										fontSize: '0.7rem',
										fontWeight: 600,
										color: 'var(--mmbix-foreground, #374151)',
										textAlign: 'left',
									}}
								>
									<span style={{ color: '#7c3aed', display: 'inline-flex' }}>
										<Box size={12} />
									</span>
									<span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
										{w.label}
									</span>
								</button>
							))}
						</div>
					</div>
				)}
				{level === 'widgets' && codeWidgets.length === 0 && (
					<p style={{ margin: 0, fontSize: '0.72rem', color: '#9ca3af' }}>
						No widgets yet — write one under packages/design-system/src/components/widgets.
					</p>
				)}
				{level !== 'widgets' &&
					LEVEL_ORDER.map((l) => {
						const defs = groups[l];
						if (defs.length === 0) return null;
						return (
							<div key={l}>
								<div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
									<span style={{ width: 8, height: 8, borderRadius: 2, background: LEVEL_META[l].color }} />
									<span
										style={{ fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b' }}
									>
										{LEVEL_META[l].label}
									</span>
									<span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>{defs.length}</span>
								</div>
								<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 5 }}>
									{defs.map((c) => (
										<CatalogItem key={c.name} comp={c} />
									))}
								</div>
							</div>
						);
					})}
				{query && Object.values(groups).every((g) => g.length === 0) && (
					<p style={{ margin: 0, fontSize: '0.72rem', color: '#9ca3af' }}>No blocks match “{query}”.</p>
				)}
			</div>
		</div>
	);
}

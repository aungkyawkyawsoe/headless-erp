import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as React from 'react';
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragMoveEvent,
	type DragStartEvent,
} from '@dnd-kit/core';
import { Button, Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList, alertDialog } from '@mmbix/design-system';
import { PivotTable } from '@mmbix/design-system/pivot';
import type { ReportDefinition } from '@mmbix/types';
import { starterPivotDef } from '@mmbix/types';
import { Box, CopyPlus, Trash2 } from 'lucide-react';
import { api, SYSTEM_FIELD_NAMES, type PageBlock } from '../lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collectionQuery, itemsQuery } from '../lib/queries';
import { useReportPreview, type ReportPreviewSpec } from '../lib/use-report-preview';
import { FormLayoutCanvas } from './formlayout';
import TableLayoutCanvas from './TableLayoutCanvas';
import CardLayoutCanvas from './CardLayoutCanvas';
import KanbanLayoutCanvas from './KanbanLayoutCanvas';
import { BLOCK_TYPES } from './blockDefs';
import {
	BlockView,
	blockColSpan,
	pickDisplayField,
	CardViewGrid,
	type CardViewConfig,
	type PageBlockLike,
	type DataSource,
} from '@mmbix/ui-views';
import BlockContextMenu from './BlockContextMenu';
import { useBuilder } from './PageBuilderContext';
import { dsIcon, useStudioMeta } from '../lib/studioMeta';
import { findBlock, isContainer } from '../lib/page-blocks';

/* ── Builder data context helpers ───────────────────── */

/** Collection bound to the active view: menu focus wins, then the view config, then the first data block. */
export function useDataCollection(): string {
	const { focusCollection, canvasMode, viewConfigs, blocks } = useBuilder();
	const vc = viewConfigs[canvasMode] ?? {};
	const dataBlock = blocks.find((b) => ['list', 'table', 'kpi'].includes(b.type) && (b.config as Record<string, unknown>)?.collection);
	return focusCollection ?? vc.collection ?? (dataBlock ? String((dataBlock.config as Record<string, unknown>).collection ?? '') : '');
}

/** True when the builder should run the embedded form layout editor (Layout mode, form view, a collection is focused). */
export function useFormLayoutActive(): boolean {
	const { canvasMode } = useBuilder();
	// useDataCollection is a hook — call it unconditionally, never inside the &&
	// (a conditional hook call changes the hook count when canvasMode flips to
	// 'form', which trips React's Rules-of-Hooks error).
	const collection = useDataCollection();
	return canvasMode === 'form' && !!collection;
}

/* ── Layout (structure outline) — shows the page's block tree ──────── */

/** Draggable block-row handle — the grip on the outline row that moves a block in the tree. */
function BlockDragHandle({ blockId, label }: { blockId: string; label: string }) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
		id: `move:${blockId}`,
		data: { moveBlockId: blockId, moveLabel: label },
	});
	return (
		<span
			ref={setNodeRef}
			{...listeners}
			{...attributes}
			title="Drag to move this block"
			style={{
				cursor: 'grab',
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				width: 18,
				height: 18,
				borderRadius: 4,
				color: 'var(--mmbix-muted-foreground, #9ca3af)',
				fontSize: '0.68rem',
				letterSpacing: '-0.08em',
				opacity: isDragging ? 0.4 : 1,
				userSelect: 'none',
			}}
		>
			⋮⋮
		</span>
	);
}

/** Droppable zone — root canvas (containerId=null) or any block (blockId).
 *  Shows a live drop indicator (before / inside / after) while dragging. */
function DroppableZone({
	id,
	blockId,
	isContainer = false,
	dropState,
	children,
	style,
	inline = false,
}: {
	id: string;
	blockId?: string;
	isContainer?: boolean;
	/** Live drag feedback: which block is hovered + the resolved position. */
	dropState?: { overId: string | null; position: 'before' | 'after' | 'inside' | null } | null;
	children: React.ReactNode;
	style?: React.CSSProperties;
	inline?: boolean;
}) {
	const { setNodeRef, isOver } = useDroppable({ id, data: { blockId, isContainer } });
	const active = dropState?.overId === blockId && isOver;
	const indicator: React.CSSProperties = {
		position: 'absolute',
		left: 0,
		right: 0,
		height: 3,
		borderRadius: 3,
		background: 'var(--mmbix-primary, #0f766e)',
		zIndex: 5,
		pointerEvents: 'none',
	};
	return (
		<div
			ref={setNodeRef}
			style={{
				position: 'relative',
				...(inline ? { display: 'contents' } : {}),
				...style,
				...(active && dropState?.position === 'inside'
					? { outline: '2px dashed var(--mmbix-primary, #0f766e)', outlineOffset: 2, borderRadius: 8 }
					: {}),
			}}
		>
			{active && dropState?.position === 'before' && <div style={{ ...indicator, top: -2 }} />}
			{active && dropState?.position === 'after' && <div style={{ ...indicator, bottom: -2 }} />}
			{children}
		</div>
	);
}

/** Compact toolbar button style (multi-select toolbar). */
const toolBtn: React.CSSProperties = {
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	width: 24,
	height: 22,
	borderRadius: 6,
	border: '1px solid var(--mmbix-border, #e5e7eb)',
	background: 'var(--mmbix-card, #fff)',
	color: '#6b7280',
	fontSize: '0.72rem',
	cursor: 'pointer',
	padding: 0,
};

// Live card-grid preview in the builder — renders the collection's designed
// cards (CardViewGrid) so widget/data blocks look exactly like runtime.
// Module scope (NOT inside PageLayoutOutline's render): a component defined
// inside render is a NEW type every render → unmount/remount + a refetch storm.
// The reads go through the shared Query cache, so a schema already open anywhere
// in the Studio is a cache hit and identical blocks dedupe to one request.
function StudioCardGrid({ cfg }: { cfg: { collection?: string; limit?: number } }) {
	const { token } = useBuilder();
	const collection = cfg.collection ?? '';
	const schemaQ = useQuery(collectionQuery(token, collection || null));
	const rowsQ = useQuery(itemsQuery(token, collection, { limit: cfg.limit ?? 12 }));
	const schema = schemaQ.data ?? null;

	if (!cfg.collection || !schema || schemaQ.isError || rowsQ.isError) {
		return <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>Card grid — pick a collection in the inspector.</span>;
	}
	if (rowsQ.isPending) return <span style={{ fontSize: '0.78rem', color: '#9ca3af' }}>Loading cards…</span>;
	const rows = rowsQ.data?.rows ?? [];
	const user = (schema.schema_json?.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const designed = (schema.schema_json as { card_view?: CardViewConfig } | undefined)?.card_view;
	const cv: CardViewConfig = designed ?? {
		titleField: pickDisplayField(schema.schema_json?.fields ?? [], SYSTEM_FIELD_NAMES) ?? undefined,
		fields: user.map((f, i) => ({ name: f.name, visible: i < 4 })),
		columns: 3,
	};
	return <CardViewGrid rows={rows} fields={user} cv={cv} />;
}

// Data blocks (kpi/list/table/chart) fetch at runtime — show a compact placeholder here.
const renderDataBlock = (b: PageBlockLike) => {
	const cfg = b.config as { title?: string; label?: string; collection?: string };
	if (b.type === 'entity-card-grid') return <StudioCardGrid cfg={cfg as { collection?: string; limit?: number }} />;
	// Pivot/report blocks show a LIVE preview (design == runtime).
	if (b.type === 'pivot' || b.type === 'report') return <StudioReportPreview block={b} />;
	return (
		<div
			style={{
				border: '1px dashed var(--mmbix-border, #d1d5db)',
				borderRadius: 8,
				padding: '0.6rem 0.8rem',
				background: 'var(--mmbix-card, #ffffff)',
				fontSize: '0.78rem',
				color: '#9ca3af',
			}}
		>
			<strong style={{ color: 'var(--mmbix-foreground, #374151)' }}>{cfg.title || cfg.label || b.type}</strong>
			{cfg.collection ? <span> — {cfg.collection}</span> : <span> — pick a collection in the inspector</span>}
		</div>
	);
};

/** Live pivot/grouped preview — executes the block's report definition against the real API. */
function StudioReportPreview({ block }: { block: PageBlockLike }) {
	const { token } = useBuilder();
	const cfg = block.config as {
		title?: string;
		collection?: string;
		rowGroup?: string;
		columnGroup?: string;
		aggregate?: { op?: string; field?: string; alias?: string };
		showTotals?: boolean;
	};
	const def = React.useMemo<ReportPreviewSpec | null>(() => {
		if (!cfg.collection || !cfg.rowGroup) return null;
		return {
			collection: cfg.collection,
			rowDimensions: [cfg.rowGroup],
			...(cfg.columnGroup ? { columnDimensions: [cfg.columnGroup] } : {}),
			measures: [{ op: cfg.aggregate?.op ?? 'count', field: cfg.aggregate?.field ?? '*', alias: cfg.aggregate?.alias ?? 'count_all' }],
		};
	}, [cfg.collection, cfg.rowGroup, cfg.columnGroup, cfg.aggregate?.op, cfg.aggregate?.field, cfg.aggregate?.alias]);
	const { result, error } = useReportPreview(token, def);

	if (error) {
		return (
			<div
				style={{
					border: '1px solid var(--mmbix-border, #e5e7eb)',
					borderRadius: 8,
					padding: '0.6rem 0.8rem',
					fontSize: '0.78rem',
					color: 'var(--mmbix-destructive, #dc2626)',
				}}
			>
				{error}
			</div>
		);
	}
	if (!cfg.collection || !cfg.rowGroup) {
		return (
			<div
				style={{
					border: '1px dashed var(--mmbix-border, #d1d5db)',
					borderRadius: 8,
					padding: '0.6rem 0.8rem',
					fontSize: '0.78rem',
					color: '#9ca3af',
				}}
			>
				<strong style={{ color: 'var(--mmbix-foreground, #374151)' }}>{cfg.title || 'Pivot'}</strong>
				<span> — pick a collection + row group in the inspector</span>
			</div>
		);
	}
	return (
		<div
			style={{ border: '1px solid var(--mmbix-border, #e5e7eb)', borderRadius: 8, padding: 8, background: 'var(--mmbix-card, #ffffff)' }}
		>
			<PivotTable
				rows={result?.data ?? []}
				columns={result?.columns ?? []}
				rowLabel={cfg.rowGroup}
				showTotals={cfg.showTotals === true}
				showToolbar={false}
				isLoading={result === null}
				labels={{ emptyCell: '—' }}
			/>
		</div>
	);
}

/**
 * Pivot view canvas — live cross-tab preview bound to the pivot view config
 * (design == runtime). The right-pane inspector holds the full editor;
 * this canvas is the same PivotTable the runtime renders.
 */
function PivotLayoutCanvas() {
	const { viewConfigs, focusCollection, schemas, fetchSchema, token } = useBuilder();
	const vc = viewConfigs['pivot'] ?? {};
	// Resolution order: the designer's config → the collection's BAKED pivot_view
	// (schema_json.pivot_view — seeded by the module demos) → a sensible starter
	// default built from the schema, so a focused collection is never blank.
	const designed = vc.pivot as ReportDefinition | undefined;
	// Schema source: the focused collection wins, then the pivot config's own
	// collection (a collection picked in the right pane clears the focus).
	const schemaSource = focusCollection ?? vc.collection ?? '';
	const schema = schemaSource ? (schemas[schemaSource] ?? null) : null;

	React.useEffect(() => {
		if (schemaSource && !schemas[schemaSource]) void fetchSchema(schemaSource);
	}, [schemaSource, schemas, fetchSchema]);

	const baked = schema ? (schema.schema_json as { pivot_view?: ReportDefinition } | undefined)?.pivot_view : undefined;
	// Starter default from USER fields only — system audit columns (deleted_at,
	// updated_at, …) must never become report dimensions (same rule as the runtime).
	const userFields = (schema?.schema_json.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const starter = schema ? starterPivotDef(schemaSource, userFields) : null;
	const pv = designed ?? baked ?? starter;
	const collection = pv?.collection || schemaSource;

	const { result, error } = useReportPreview(
		token,
		pv && pv.rowDimensions.length > 0
			? {
					collection,
					rowDimensions: pv.rowDimensions,
					...(pv.columnDimensions?.length ? { columnDimensions: pv.columnDimensions } : {}),
					measures: pv.measures,
				}
			: null,
	);

	if (!schemaSource) {
		return (
			<div
				style={{
					flex: 1,
					minHeight: 0,
					border: '1px dashed var(--mmbix-border, #d1d5db)',
					borderRadius: 10,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					color: '#9ca3af',
					fontSize: '0.85rem',
					padding: '1rem',
				}}
			>
				Pick a collection + row group in the right pane to see the live cross-tab.
			</div>
		);
	}
	if (!pv) {
		// Collection focused but the schema is still loading — brief wait, then the
		// baked pivot (or a starter default) renders automatically.
		return (
			<div
				style={{
					flex: 1,
					minHeight: 0,
					border: '1px solid var(--mmbix-border, #e5e7eb)',
					borderRadius: 10,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					color: '#9ca3af',
					fontSize: '0.85rem',
					padding: '1rem',
				}}
			>
				Loading schema…
			</div>
		);
	}
	if (error) {
		return (
			<div
				style={{
					flex: 1,
					minHeight: 0,
					border: '1px solid var(--mmbix-border, #e5e7eb)',
					borderRadius: 10,
					padding: '0.8rem 1rem',
					fontSize: '0.8rem',
					color: 'var(--mmbix-destructive, #dc2626)',
				}}
			>
				{error}
			</div>
		);
	}
	return (
		<div
			style={{
				flex: 1,
				minHeight: 0,
				overflowY: 'auto',
				border: '1px solid var(--mmbix-border, #e5e7eb)',
				borderRadius: 10,
				padding: 12,
				background: 'var(--mmbix-card, #ffffff)',
			}}
		>
			<PivotTable
				rows={result?.data ?? []}
				columns={result?.columns ?? []}
				rowLabel={pv.rowDimensions[0]}
				showTotals={pv.layout.showTotals}
				density={pv.layout.density}
				striped={pv.layout.striped}
				showToolbar={false}
				isLoading={result === null}
				labels={{ emptyCell: '—' }}
			/>
		</div>
	);
}

function PageLayoutOutline() {
	const {
		blocks,
		token,
		selected: selectedId,
		setSelected,
		duplicateBlock,
		copyBlock,
		pasteBlock,
		clipboard,
		move,
		removeBlock,
		removeBlocks,
		updateLayout,
		updateConfig,
		addBlockInto,
		addBlockAt,
		moveBlockTo,
		moveBlockToRoot,
	} = useBuilder();
	// Refs mirror the latest state every render — the window keydown handler reads
	// these instead of closure values, so it can never act on stale blocks/selection.
	const blocksRef = useRef(blocks);
	blocksRef.current = blocks;
	const selectedRef = useRef(selectedId);
	selectedRef.current = selectedId;

	// Widget `bind` specs resolve live data on the canvas too (same contract as
	// the frontend runtime) — design == runtime data. Stable identity is
	// required (useBinding re-fetches when the source changes).
	//
	// `count` rides the ONE cache layer with the SAME key the block inspector's
	// live count uses (`itemsQuery({limit:1, fields:'id'})`), so a bound count
	// widget and the inspector's "N records" line cost one read between them.
	// The other kinds stay on the raw transport: `list`/`item` deliberately send
	// NO `?fields=` (the engine's lean default — columns only, no relations, no
	// formulas), a payload `itemsQuery` cannot express without forcing `*`/`*.*`
	// (heavier: formulas / relation expansion).
	const queryClient = useQueryClient();
	const dataSource = useCallback<DataSource>(
		async (spec) => {
			if (!token) return null;
			if (spec.kind === 'list') {
				const q = new URLSearchParams();
				if (spec.limit) q.set('limit', String(spec.limit));
				if (spec.sort) q.set('sort', spec.sort);
				return api<unknown>(token, `/api/entities/${spec.collection}?${q}`);
			}
			if (spec.kind === 'item') {
				return api<unknown>(token, `/api/entities/${spec.collection}/${spec.id}`);
			}
			if (spec.kind === 'count') {
				// Count lives in `meta.total`, which the engine only emits for a
				// `count_only=true` read (and that read skips the page SELECT + per-row
				// enrichment). Reading it through the shared row cache dedupes with the
				// block inspector's count and refetches on a row write.
				const page = await queryClient.fetchQuery(itemsQuery(token, spec.collection, { countOnly: true, fields: 'id' }));
				return page.total ?? 0;
			}
			if (spec.kind === 'aggregate') {
				const q = new URLSearchParams();
				for (const a of spec.aggregate ?? []) q.set(`aggregate[${a.op}]`, a.field);
				if (spec.groupBy) q.append('groupBy[]', spec.groupBy);
				return api<unknown>(token, `/api/entities/${spec.collection}?${q}`);
			}
			return null;
		},
		[token, queryClient],
	);
	// Multi-select — shift-click toggles.
	const [multi, setMulti] = useState<Set<string>>(new Set());
	// Hover highlight — Craft.js-style light outline on the block under the cursor.
	const [hovered, setHovered] = useState<string | null>(null);
	const multiBlocks = useMemo(() => blocks.filter((b) => multi.has(b.id)), [blocks, multi]);
	const selectBlock = useCallback(
		(id: string, shift: boolean) => {
			if (!shift) {
				setMulti(new Set());
				setSelected(id);
				return;
			}
			setMulti((prev) => {
				const next = new Set(prev);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
			setSelected(null);
		},
		[setSelected],
	);
	// ── Drag & drop state (palette → canvas) — Craft.js/Grape.js drop-position model ──
	const [activeDrag, setActiveDrag] = useState<string | null>(null);
	const [dragLabel, setDragLabel] = useState<string>('');
	const [dropState, setDropState] = useState<{ overId: string | null; position: 'before' | 'after' | 'inside' | null }>({
		overId: null,
		position: null,
	});
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
	const onDragStart = useCallback((e: DragStartEvent) => {
		const paletteType = String(e.active.data.current?.paletteType ?? '');
		setActiveDrag(paletteType || String(e.active.data.current?.moveBlockId ?? ''));
		setDragLabel(paletteType || String(e.active.data.current?.moveLabel ?? ''));
	}, []);

	/** Grape.js-style drop position — computed from the dragged rect vs hovered rect. */
	const onDragMove = useCallback((e: DragMoveEvent) => {
		const overId = e.over?.id ? String(e.over.id) : null;
		if (!overId) {
			setDropState({ overId: null, position: null });
			return;
		}
		const rect = e.over?.rect;
		const activeRect = e.active.rect.current.translated;
		const overRect = rect ? { top: rect.top, height: rect.height } : null;
		let position: 'before' | 'after' | 'inside' = 'inside';
		const isContainer = e.over?.data.current?.isContainer === true;
		const hasBlockId = !!e.over?.data.current?.blockId;
		if (overRect && hasBlockId) {
			if (!isContainer) {
				// Leaf — before/after by the vertical center line.
				position = activeRect && activeRect.top + activeRect.height / 2 < overRect.top + overRect.height / 2 ? 'before' : 'after';
			} else if (overRect.height > 24 && activeRect) {
				// Container — top 25% → before, bottom 25% → after, middle → inside.
				const ac = activeRect.top + activeRect.height / 2;
				if (ac < overRect.top + overRect.height * 0.25) position = 'before';
				else if (ac > overRect.top + overRect.height * 0.75) position = 'after';
				else position = 'inside';
			}
		}
		setDropState({ overId, position });
	}, []);

	const onDragEnd = useCallback(
		(e: DragEndEvent) => {
			setActiveDrag(null);
			setDragLabel('');
			setDropState({ overId: null, position: null });
			const paletteType = String(e.active.data.current?.paletteType ?? '');
			const moveBlockId = e.active.data.current?.moveBlockId ? String(e.active.data.current.moveBlockId) : null;
			const overId = e.over?.id ? String(e.over.id) : null;
			const blockId = e.over?.data.current?.blockId ? String(e.over.data.current.blockId) : null;
			const overRect = e.over?.rect ? { top: e.over.rect.top, height: e.over.rect.height } : null;
			const activeRect = e.active.rect.current.translated;
			const isContainer = e.over?.data.current?.isContainer === true;
			let position: 'before' | 'after' | 'inside' = 'inside';
			if (overRect && blockId) {
				if (!isContainer) {
					position = activeRect && activeRect.top + activeRect.height / 2 < overRect.top + overRect.height / 2 ? 'before' : 'after';
				} else if (overRect.height > 24 && activeRect) {
					const ac = activeRect.top + activeRect.height / 2;
					if (ac < overRect.top + overRect.height * 0.25) position = 'before';
					else if (ac > overRect.top + overRect.height * 0.75) position = 'after';
					else position = 'inside';
				}
			}

			// Moving an EXISTING block (drag handle) — reposition it.
			if (moveBlockId) {
				if (!overId || overId === 'drop:root' || !blockId) {
					moveBlockToRoot(moveBlockId);
					return;
				}
				if (blockId === moveBlockId) return; // dropped on itself
				moveBlockTo(moveBlockId, blockId, position);
				return;
			}

			// Adding a NEW block from the palette (demo config/children ride along so the
			// canvas renders exactly like the catalog storyboard, full-size).
			if (!paletteType) return;
			const extra = e.active.data.current?.paletteExtra as { config?: Record<string, unknown>; children?: PageBlock[] } | undefined;
			if (!overId || overId === 'drop:root' || !blockId) {
				addBlockInto(paletteType, null, extra);
				return;
			}
			addBlockAt(paletteType, blockId, position, extra);
		},
		[addBlockInto, addBlockAt, moveBlockTo, moveBlockToRoot],
	);
	// Canvas shortcuts — remappable via the keyboard_shortcuts table (studio.db).
	// Width: press 1–6 (or Shift+1–6 for 2–12). Alignment: L/C/R = left/center/right
	// in the grid, T/B = top/bottom of the cell; pressing the same key again clears it.
	const { shortcuts } = useStudioMeta();
	useEffect(() => {
		// Alias map — match by e.code (physical, layout-independent) AND e.key
		// (what the layout reports, e.g. Burmese digits / '!' for Shift+1), so the
		// shortcuts work on any keyboard layout. Capture phase (true) beats any
		// other listener that might claim the key first.
		const map = new Map<string, (typeof shortcuts)[number]>();
		const addAlias = (k: string, s: (typeof shortcuts)[number]) => {
			map.set(k, s);
		};
		for (const s of shortcuts) {
			if (s.is_active !== 1) continue;
			// Canonical modifier prefix: alt+shift+ / shift+ / '' (Alt before Shift).
			const mod = (s.modifiers.includes('alt') ? 'alt+' : '') + (s.modifiers.includes('shift') ? 'shift+' : '');
			addAlias(mod + s.key, s); // 'Digit2' | 'KeyL' | 'Space' | 'shift+Digit6' | 'alt+shift+Digit2'
			const num = /^Digit([1-6])$/.exec(s.key);
			if (num) {
				addAlias(mod + num[1], s); // '2' | 'shift+2' | 'alt+shift+2'
				addAlias(mod + 'Numpad' + num[1], s); // 'Numpad2' | …
			}
			if (/^Key[A-Z]$/.test(s.key)) addAlias(mod + s.key.slice(3), s); // 'L' | 'shift+L'
			if (s.key === 'Space') addAlias(mod + ' ', s); // ' ' | 'shift+ '
		}
		const act = (id: string, sc: (typeof shortcuts)[number], b: PageBlock | undefined) => {
			// Width actions: Shift+N → 2N (2–12), Alt+Shift+N → N (1–6), fixed values.
			// Accepts modern 'w1-N'/'w2-N' plus legacy 'col-span-N'/'col-span-2xN' keys.
			const wm =
				/^w([12])-([1-6])$/.exec(sc.action_key) || /^col-span-2x([1-6])$/.exec(sc.action_key) || /^col-span-([1-6])$/.exec(sc.action_key);
			if (wm) {
				// w2-N / col-span-2xN → digit × 2; w1-N / col-span-N → digit × 1.
				let digit: number;
				let factor = 1;
				if (sc.action_key.startsWith('w')) {
					factor = Number(wm[1]); // 'w2' → 2, 'w1' → 1
					digit = Number(wm[2]);
				} else {
					digit = Number(wm[1]);
					factor = sc.action_key.startsWith('col-span-2x') ? 2 : 1;
				}
				const next = digit * factor;
				updateLayout(id, { colSpan: next });
				return;
			}
			const span = b ? blockColSpan(b) : 12;
			switch (sc.action_key) {
				case 'align-left':
					updateLayout(id, b?.layout.colStart === 1 ? { colStart: null } : { colStart: 1 });
					break;
				case 'align-center':
					updateLayout(
						id,
						b?.layout.colStart === Math.ceil((12 - span + 1) / 2) ? { colStart: null } : { colStart: Math.ceil((12 - span + 1) / 2) },
					);
					break;
				case 'align-right':
					updateLayout(id, b?.layout.colStart === 12 - span + 1 ? { colStart: null } : { colStart: 12 - span + 1 });
					break;
				case 'align-top':
					updateLayout(id, b?.layout.alignY === 'start' ? { alignY: null } : { alignY: 'start' });
					break;
				case 'align-bottom':
					updateLayout(id, b?.layout.alignY === 'end' ? { alignY: null } : { alignY: 'end' });
					break;
				case 'toggle-hidden':
					// Space = check/uncheck — toggles visibility (BlockView skips hidden blocks).
					updateConfig(id, 'hidden', !b?.config.hidden);
					break;
				default:
					break;
			}
		};
		// Some input sources (e.g. Burmese IME on macOS) consume plain keydowns for
		// composition — keyup still fires, so listen to BOTH and dedupe so a normal
		// keydown+keyup pair only acts once.
		const handledAt = new Map<string, number>();
		const onKey = (e: KeyboardEvent) => {
			// Ctrl/Meta are app-level; Alt+Shift is a canvas modifier (width 1–6).
			if (e.ctrlKey || e.metaKey) return;
			const t = e.target as HTMLElement | null;
			if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
			const selId = selectedRef.current;
			const curBlocks = blocksRef.current;
			if (!selId) return;
			// Canonical modifier prefix (Alt before Shift) — matches the DB modifiers column.
			const mod = (e.altKey ? 'alt+' : '') + (e.shiftKey ? 'shift+' : '');
			const code = e.code ?? '';
			// e.code survives Shift (Shift+1 gives e.key '!'), so it's the primary key.
			const sc = map.get(mod + code) ?? map.get(mod + (e.key ?? '').toUpperCase()) ?? map.get(e.key ?? '');
			if (!sc) return;
			const now = Date.now();
			const last = handledAt.get(code);
			if (e.type === 'keyup' && last !== undefined && now - last < 500) return; // keydown already acted
			if (e.type === 'keydown') handledAt.set(code, now);
			e.preventDefault();
			const found = findBlock(curBlocks, selId);
			act(selId, sc, found ?? undefined);
		};
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('keyup', onKey, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('keyup', onKey, true);
		};
	}, [updateLayout, updateConfig, shortcuts]);
	if (blocks.length === 0) {
		return (
			<BlockContextMenu onPaste={pasteBlock} canPaste={!!clipboard}>
				<div
					style={{
						flex: 1,
						minHeight: 0,
						border: '1px dashed var(--mmbix-border, #d1d5db)',
						borderRadius: 10,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						color: '#9ca3af',
						fontSize: '0.85rem',
						flexDirection: 'column',
						gap: 6,
						textAlign: 'center',
						padding: '1rem',
					}}
				>
					<span>No blocks yet — this page's layout is empty.</span>
					{clipboard && <span style={{ fontSize: '0.72rem' }}>Right-click to paste the copied block.</span>}
				</div>
			</BlockContextMenu>
		);
	}
	// Live WYSIWYG preview — the shared renderer, so the builder shows exactly
	// what the runtime PageView renders. Anchor clicks are inert in the builder.
	return (
		<DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
				{multiBlocks.length > 0 && (
					<div
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: 3,
							padding: '0.15rem',
							borderRadius: 8,
							background: 'var(--mmbix-muted, #f3f4f6)',
							flexWrap: 'wrap',
						}}
					>
						<span style={{ fontSize: '0.66rem', color: '#64748b', padding: '0 0.3rem', fontWeight: 600 }}>
							{multiBlocks.length} selected
						</span>
						<button
							type="button"
							title="Duplicate all"
							onClick={() => multiBlocks.forEach((b) => duplicateBlock(b.id))}
							style={{ ...toolBtn, color: '#2563eb' }}
						>
							<CopyPlus size={13} />
						</button>
						<button
							type="button"
							title="Delete all"
							onClick={() => {
								const ids = [...multi];
								removeBlocks(ids);
								setMulti(new Set());
							}}
							style={{ ...toolBtn, color: '#dc2626' }}
						>
							<Trash2 size={13} />
						</button>
					</div>
				)}
			</div>
			<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.25rem', position: 'relative' }}>
				<DroppableZone id="drop:root" dropState={dropState} style={{ display: 'contents' }}>
					<div
						style={{
							minHeight: '100%',
							display: 'grid',
							gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
							gap: 10,
							alignContent: 'start',
						}}
						onClickCapture={(e) => {
							if ((e.target as HTMLElement).closest('a')) e.preventDefault();
						}}
						onClick={(e) => {
							// Clicking the canvas background (not a block) clears the selection —
							// so the next catalog add lands at the ROOT, not inside a container.
							if (e.target === e.currentTarget) setSelected(null);
						}}
					>
						{blocks.map((b) => (
							<div
								key={b.id}
								style={{
									gridColumn: b.layout.colStart ? `${b.layout.colStart} / span ${blockColSpan(b)}` : `span ${blockColSpan(b)}`,
									minWidth: 0,
									alignSelf: b.layout.alignY === 'start' ? 'start' : b.layout.alignY === 'end' ? 'end' : 'stretch',
									display: 'flex',
									flexDirection: 'column',
								}}
							>
								<BlockContextMenu
									onDuplicate={() => duplicateBlock(b.id)}
									onCopy={() => copyBlock(b.id)}
									onPaste={pasteBlock}
									canPaste={!!clipboard}
									onMoveUp={() => move(-1, b.id)}
									onMoveDown={() => move(1, b.id)}
									onDelete={() => removeBlock(b.id)}
								>
									<DroppableZone id={`drop:${b.id}`} blockId={b.id} isContainer={isContainer(b)} dropState={dropState}>
										<div
											onClick={(e) => selectBlock(b.id, e.shiftKey)}
											onMouseEnter={() => setHovered(b.id)}
											onMouseLeave={() => setHovered((h) => (h === b.id ? null : h))}
											style={{
												flex: 1,
												minWidth: 0,
												position: 'relative',
												outline: multi.has(b.id)
													? '2px dashed var(--mmbix-primary, #0f766e)'
													: selectedId === b.id
														? '2px solid var(--mmbix-ring, #14b8a6)'
														: hovered === b.id
															? '1px solid var(--mmbix-primary, #0f766e)'
															: 'none',
												borderRadius: 8,
												cursor: 'pointer',
											}}
										>
											{/* Width chip — selected block shows its 1–12 grid span (1–6, or Shift+1–6 for 2–12). */}
											{selectedId === b.id && (
												<span
													title="Grid width — Shift+1–6 = 2–12, Alt+Shift+1–6 = 1–6 · Align: L/C/R, top/bottom: T/B · Space: show/hide"
													style={{
														position: 'absolute',
														top: -9,
														left: -9,
														zIndex: 8,
														display: 'inline-flex',
														alignItems: 'center',
														gap: 3,
														padding: '0.1rem 0.35rem',
														borderRadius: 5,
														background: '#111827',
														color: '#fff',
														fontSize: '0.62rem',
														fontWeight: 600,
														letterSpacing: '0.03em',
														boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
													}}
												>
													{blockColSpan(b)}/12
												</span>
											)}
											{/* Drag handle — visible on hover/selection, Craft.js-style move. */}
											{(hovered === b.id || selectedId === b.id || multi.has(b.id)) && (
												<span
													style={{
														position: 'absolute',
														top: -9,
														right: -9,
														zIndex: 8,
														background: 'var(--mmbix-card, #fff)',
														border: '1px solid var(--mmbix-border, #e5e7eb)',
														borderRadius: 5,
														boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
													}}
												>
													<BlockDragHandle blockId={b.id} label={b.label ?? b.type} />
												</span>
											)}
											<BlockView
												block={b}
												renderDataBlock={renderDataBlock}
												dataSource={dataSource}
												notify={(msg) => void alertDialog({ description: msg })}
											/>
										</div>
									</DroppableZone>
								</BlockContextMenu>
							</div>
						))}
					</div>
				</DroppableZone>
			</div>
			<DragOverlay>
				{activeDrag ? (
					<span
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							gap: 5,
							padding: '0.3rem 0.6rem',
							borderRadius: 7,
							background: 'var(--mmbix-primary, #0f766e)',
							color: '#fff',
							fontSize: '0.74rem',
							boxShadow: '0 6px 16px rgba(0,0,0,0.2)',
						}}
					>
						{BLOCK_TYPES.find((d) => d.type === activeDrag)?.icon ?? <Box size={14} />}{' '}
						{dragLabel || (BLOCK_TYPES.find((d) => d.type === activeDrag)?.label ?? activeDrag)}
					</span>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

export function PageCanvas() {
	const { canvasMode, setCanvasMode, template, pickTemplate, title } = useBuilder();
	const { viewModes, templates } = useStudioMeta();
	const formLayoutActive = useFormLayoutActive();

	// DB-driven view modes (icons come from the studio metadata DB).
	const canvasModes = viewModes.map((m) => ({ key: m.key, icon: dsIcon(m.icon, 14), title: m.label }));
	const activeTemplate = templates.find((t) => t.key === template) ?? templates[0];
	if (!activeTemplate) {
		return (
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					height: '100%',
					color: '#9ca3af',
					fontSize: '0.85rem',
				}}
			>
				Studio metadata unavailable.
			</div>
		);
	}
	const viewModesForTemplate = canvasModes.filter((m) => activeTemplate.views.includes(m.key));

	return (
		<div
			style={{
				display: 'flex',
				flexDirection: 'column',
				height: '100%',
				minHeight: 0,
				padding: '0.75rem',
				gap: '0.6rem',
				overflowY: 'auto',
			}}
		>
			{/* Page identity + template picker. */}
			<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
				<h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{title}</h2>
				<div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
					<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Template</span>
					<Combobox
						value={template}
						items={templates.map((t) => t.key)}
						onValueChange={(v) => {
							if (v) pickTemplate(String(v));
						}}
						onInputValueChange={() => {}}
						itemToStringLabel={(v) => templates.find((t) => t.key === String(v))?.label ?? String(v)}
					>
						<ComboboxInput showTrigger placeholder="Search templates…" style={{ width: 240 }} />
						<ComboboxContent align="start" sideOffset={4} style={{ width: 280 }}>
							<ComboboxList>
								{(item: string) => {
									const t = templates.find((tpl) => tpl.key === item);
									if (!t) return null;
									return (
										<ComboboxItem key={t.key} value={t.key}>
											{/* One label per template — the label itself names the views
											    (e.g. "Table & Pivot & Form"). */}
											<span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 8 }}>
												<span>{t.label}</span>
											</span>
										</ComboboxItem>
									);
								}}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
				</div>
			</div>

			{/* Layout mode — view-mode tabs (per the selected template) above the layout editor. */}
			<div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
				{viewModesForTemplate.map((m) => (
					<Button
						key={m.key}
						size="sm"
						variant={canvasMode === m.key ? 'default' : 'ghost'}
						onClick={() => setCanvasMode(m.key)}
						style={{ gap: 6, textTransform: 'capitalize' }}
					>
						{m.icon} {m.title}
					</Button>
				))}
			</div>
			{canvasMode === 'form' ? (
				formLayoutActive ? (
					<FormLayoutCanvas />
				) : (
					<div
						style={{
							flex: 1,
							minHeight: 0,
							border: '1px dashed var(--mmbix-border, #d1d5db)',
							borderRadius: 10,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							color: '#9ca3af',
							fontSize: '0.85rem',
							padding: '1rem',
						}}
					>
						Pick a collection — focus a menu item that points at a collection to edit its form layout.
					</div>
				)
			) : canvasMode === 'table' ? (
				/* Table view — the table editor lives in the canvas (columns/rows/data). */
				<TableLayoutCanvas />
			) : canvasMode === 'card' ? (
				/* Card view — the card editor (title/image/info fields + grid). */
				<CardLayoutCanvas />
			) : canvasMode === 'kanban' ? (
				/* Kanban view — the board editor (group-by, columns, cards). */
				<KanbanLayoutCanvas />
			) : canvasMode === 'pivot' ? (
				/* Pivot view — live cross-tab preview bound to the view config. */
				<PivotLayoutCanvas />
			) : (
				/* Layout view — the page's structure, no designer chrome. */
				<PageLayoutOutline />
			)}
		</div>
	);
}

import { createContext, useContext } from 'react';
import type { CollectionSummary, CustomBlockDef, EntitySchema, PageBlock, PageData } from '../lib/api';
import type { CardViewConfig, KanbanViewConfig, TableViewConfig } from '@mmbix/ui-views';
import type { ReportDefinition } from '@mmbix/types';

/** Per-view configuration — persisted as invisible _view_config blocks in the page's block list.
 *  Each view (table/form/kanban/…) stores its collection, field list, layout hints, etc. */
export interface ViewConfig {
	collection?: string;
	fields?: { name: string; visible: boolean }[];
	pageSize?: number;
	defaultSort?: string;
	/** Table view: the full table editor config (columns, sort, density, rows options).
	 *  Mirrored to the collection's schema_json.list_view on save so the runtime
	 *  collection list renders the exact designed table. */
	table?: TableViewConfig;
	/** Card view: title/image fields + info fields + grid columns.
	 *  Mirrored to the collection's schema_json.card_view on save. */
	card?: CardViewConfig;
	/** Kanban view: group-by field, column order, card fields + progress metric.
	 *  Mirrored to the collection's schema_json.kanban_view on save. */
	kanban?: KanbanViewConfig;
	/** Pivot view: a ReportDefinition (rows × columns × measures).
	 *  Mirrored to the collection's schema_json.pivot_view on save. */
	pivot?: ReportDefinition;
	// Kanban: which field groups the columns.
	groupBy?: string;
	// Calendar: date field to plot events on.
	dateField?: string;
	// Form: extra tabs — currently child-collection record panels (fields tabs
	// live on the schema's form_layout and are merged at render time).
	tabs?: Array<{
		kind: 'collection';
		label: string;
		collection: string;
		/** m2o field on the child collection that points back at this form's collection. */
		filterField?: string;
		/** Child fields to show as table columns. */
		columns?: string[];
	}>;
	// Form: render the tabs as a wizard (one step at a time with Back/Next).
	stepper?: boolean;
}

export interface BuilderCtx {
	token: string;
	moduleSlug: string;
	pages: PageData[];
	collections: CollectionSummary[];
	pageId: string;
	canvasMode: string;
	setCanvasMode: (m: string) => void;
	/** Collection bound by the focused menu item — drives the canvas data context (menu focus wins over saved view configs). */
	focusCollection: string | null;
	setFocusCollection: (c: string | null) => void;
	/** Table view: the column selected on the canvas header — the right pane highlights it. */
	tableColSel: string | null;
	setTableColSel: (c: string | null) => void;
	/** True when the draft differs from the last saved/loaded page (drives the Save button + unsaved-changes guard). */
	dirty: boolean;
	template: string;
	pickTemplate: (key: string) => void;
	/** Focus a menu item (by id) so template changes persist to it. Pass its saved
	 *  template (if any) to avoid re-writing the same value on every click. */
	setActiveMenuId: (id: string | null, template?: string | null) => void;
	selectPage: (id: string) => void;
	title: string;
	setTitle: (v: string) => void;
	path: string;
	setPath: (v: string) => void;
	blocks: PageBlock[];
	selected: string | null;
	setSelected: (id: string | null) => void;
	addBlock: (type: string, extra?: { config?: Record<string, unknown>; children?: PageBlock[] }) => void;
	addBlockInto: (type: string, containerId: string | null, extra?: { config?: Record<string, unknown>; children?: PageBlock[] }) => void;
	/** Insert a block relative to a target — before/after (sibling) or inside (container). */
	addBlockAt: (
		type: string,
		targetId: string,
		position: 'before' | 'after' | 'inside',
		extra?: { config?: Record<string, unknown>; children?: PageBlock[] },
	) => void;
	/** Append externally generated blocks (AI draft / snippets) to the canvas root. */
	importBlocks: (blocks: PageBlock[]) => void;
	/** Replace the entire canvas block tree (version restore / template apply). */
	replaceBlocks: (blocks: PageBlock[], opts?: { selectFirst?: boolean }) => void;
	/** Remove several blocks in one history step (multi-select delete). */
	removeBlocks: (ids: string[]) => void;
	/** Extension API — runtime-registered custom block types (merged into palette). */
	customBlocks: CustomBlockDef[];
	addComponent: (name: string, defaults: Record<string, unknown>) => void;
	addEntityList: (collection: string) => void;
	openTarget: (label: string, target: string, seedBlocks?: PageBlock[]) => void;
	updateConfig: (id: string, k: string, v: unknown) => void;
	/** Patch a block's layout fields (grid colSpan/colStart/alignY, or free-mode x/y/width/height). null clears. */
	updateLayout: (id: string, patch: Record<string, number | string | null>) => void;
	/** Move an existing block relative to a target (drag to reposition). */
	moveBlockTo: (sourceId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
	/** Move an existing block to the end of the page (dropped on empty canvas). */
	moveBlockToRoot: (sourceId: string) => void;
	move: (dir: -1 | 1, id: string) => void;
	removeBlock: (id: string) => void;
	/** Duplicate a block (any depth) right after the original. */
	duplicateBlock: (id: string) => void;
	/** Rename a block (double-click in the Layer panel). */
	renameBlock: (id: string, label: string) => void;
	/** Wrap the given top-level blocks into a new group container (Photoshop-style). */
	groupBlocks: (ids: string[]) => void;
	/** Explode a group container — its children move back to the root. */
	ungroupBlock: (id: string) => void;
	/** Insert a saved widget (block tree) — single block direct, multiple wrapped in a group. */
	insertWidget: (tree: PageBlock[], label: string) => void;
	/** Copy a block to the in-app clipboard (and the system clipboard as JSON). */
	copyBlock: (id: string) => void;
	/** Paste the clipped block — into the selected container when it is one, else at the root. */
	pasteBlock: () => void;
	/** Block currently on the clipboard — enables Paste in the canvas context menu. */
	clipboard: PageBlock | null;
	/** Undo/redo over the page draft (blocks + title + path + view configs). */
	canUndo: boolean;
	canRedo: boolean;
	undo: () => void;
	redo: () => void;
	saving: boolean;
	error: string | null;
	savedVersion: number;
	loadedVersion: number;
	/** Save the page — optional publish override (publish/unpublish in one shot). */
	save: (publishOverride?: boolean) => void;
	selectedBlock: PageBlock | null;
	// View-config system (Odoo-style: each view stores its own collection/field/layout settings)
	viewConfigs: Record<string, ViewConfig>;
	setViewConfig: (view: string, patch: Partial<ViewConfig>) => void;
	schemas: Record<string, EntitySchema>;
	fetchSchema: (collection: string) => Promise<EntitySchema | null>;
}

export const Ctx = createContext<BuilderCtx | null>(null);

export function useBuilder(): BuilderCtx {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error('useBuilder must be used within a PageBuilderProvider');
	return ctx;
}

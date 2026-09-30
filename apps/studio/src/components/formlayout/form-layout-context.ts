import { createContext, useContext } from 'react';
import type { DragEndEvent, DragMoveEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import type { EntitySchema, FieldDefinition } from '../../lib/api';
import type { FormGroup, FormTab, SerializedFormLayout } from './types';

/* The form-layout engine's contract — the shape of the context, the React
 * context object, and the hook that reads it. Kept separate from the provider
 * implementation (`context.tsx`) so the surface and the engine can change for
 * different reasons. `context.tsx` re-exports the hook + type, so importers
 * (which read `./context` or the folder index) are unaffected. */

export interface FormLayoutCtx {
	token: string;
	slug: string;
	schema: EntitySchema | null;
	fields: FieldDefinition[];
	tabs: FormTab[];
	activeTabId: string | null;
	setActiveTabId: (id: string | null) => void;
	/** The group currently focused for inspection (highlight + right-pane properties). */
	activeGroupId: string | null;
	setActiveGroupId: (id: string | null) => void;
	/** The group object for `activeGroupId` (null when none). */
	activeGroup: FormGroup | null;
	/** What the right pane inspects: the form itself, the open tab, the active group, or the selected field. */
	inspectorKind: 'form' | 'tab' | 'group' | 'field';
	setInspectorKind: (k: 'form' | 'tab' | 'group' | 'field') => void;
	selected: string | null;
	setSelected: (id: string | null) => void;
	/** Undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) — snapshot history of tabs + fields. */
	canUndo: boolean;
	canRedo: boolean;
	undo: () => void;
	redo: () => void;
	/** Keyboard-shortcut help overlay. */
	helpOpen: boolean;
	setHelpOpen: (v: boolean) => void;
	/** Active drag-drop insertion target (field name + before/after) for the drop-position preview. */
	dropOver: { name: string; before: boolean } | null;
	dirty: boolean;
	saving: boolean;
	loading: boolean;
	error: string | null;
	activeDrag: { label?: string } | null;
	userFields: FieldDefinition[];
	systemFields: FieldDefinition[];
	selectedField: FieldDefinition | null;
	activeTab: FormTab | null;
	activeFirstGroupId: string;
	/** Form-level: the tab opened by default at runtime (persisted as form_layout.default_tab). */
	defaultTabId: string | null;
	setDefaultTabId: (id: string | null) => void;
	markDirty: () => void;
	/** Patch a group (by id) wherever it lives across tabs — e.g. toggle its column grid. */
	patchGroup: (gid: string, patch: (g: FormGroup) => FormGroup) => void;
	/** Move a group up/down within its parent (tab groups or nested sub-groups) — Arrow keys on the group title. */
	moveGroup: (gid: string, dir: -1 | 1) => void;
	/** Delete a group (with its sub-groups) wherever it lives. */
	removeGroup: (gid: string) => void;
	/** Move a sub-group out of its parent up to the tab's top level. */
	promoteGroup: (gid: string) => void;
	/** Move a group to become a child of another group (nesting). */
	moveGroupUnder: (gid: string, targetGid: string) => void;
	addTab: () => void;
	renameTab: (id: string, label: string) => void;
	removeTab: (id: string) => void;
	/** Add a group to a tab — pass `parentId` to nest it inside that group (sub-group). */
	addGroup: (tabId: string, parentId?: string) => void;
	addNewField: (type: string, groupId: string) => void;
	addFields: (batch: FieldDefinition[]) => void;
	addExistingField: (name: string, groupId: string) => void;
	updateField: (name: string, patch: Partial<FieldDefinition>) => void;
	/** Set a field's grid width inside its group ('full' spans all columns; 'half' is the default). */
	setFieldWidth: (name: string, width: 'half' | 'full') => void;
	/** Set a field's grid span (1..group.columns) — the Studio 1/2/3/4 shortcut. */
	setFieldSpan: (name: string, span: number) => void;
	/** Swap two fields' positions inside the group that contains `name` (WASD reordering). */
	swapFields: (name: string, other: string) => void;
	moveField: (name: string, dir: -1 | 1) => void;
	removeFieldFromLayout: (name: string) => void;
	removeField: (name: string) => void;
	duplicateField: (name: string) => void;
	save: () => Promise<void>;
	refresh: () => Promise<void>;
	copyLayout: () => void;
	pasteLayout: () => void;
	currentLayout: () => SerializedFormLayout;
	exportModel: () => void;
	importModel: (file: File) => void;
	onDragStart: (e: DragStartEvent) => void;
	onDragMove: (e: DragMoveEvent) => void;
	onDragEnd: (e: DragEndEvent) => void;
	onDragOver: (e: DragOverEvent) => void;
}

export const Ctx = createContext<FormLayoutCtx | null>(null);

/** Read the form-layout engine. Returns null when no provider is mounted (components render nothing then). */
export function useFormLayout(): FormLayoutCtx | null {
	return useContext(Ctx);
}

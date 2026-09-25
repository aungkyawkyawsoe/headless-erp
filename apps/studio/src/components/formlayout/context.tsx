import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragMoveEvent,
	type DragOverEvent,
	type DragStartEvent,
} from '@dnd-kit/core';
import { reviewSchemaChange, updateCollectionFields, SYSTEM_FIELD_NAMES, type EntitySchema, type FieldDefinition } from '../../lib/api';
import { confirmDialog } from '@mmbix/design-system';
import { useQueryClient } from '@tanstack/react-query';
import { collectionQuery } from '../../lib/queries';
import type { FormGroup, FormTab, SerializedFormLayout } from './types';
import { humanize } from './palette-data';
import {
	mapGroups,
	flattenGroups,
	serializeLayout,
	tabsFromSerialized,
	tabsFromLayout,
	trimGroupsToFields,
	type StoredFormLayout,
} from './serialize';
import {
	moveGroup as moveGroupOp,
	removeGroup as removeGroupOp,
	promoteGroup as promoteGroupOp,
	moveGroupUnder as moveGroupUnderOp,
	addFieldToGroup,
	setFieldWidth as setFieldWidthOp,
	setFieldSpan as setFieldSpanOp,
	swapFields as swapFieldsOp,
	moveField as moveFieldOp,
	removeFieldFromLayout as removeFieldFromLayoutOp,
	moveFieldToTab,
	insertFieldRelative,
} from './tree-ops';
import { makeFormLayoutKeyHandler } from './keyboard';
import { Ctx, type FormLayoutCtx } from './form-layout-context';
import { useSnapshotHistory } from '../../lib/use-snapshot-history';

/* Group-tree + layout helpers live in ./serialize; the drag-drop tree transforms
 * in ./tree-ops; the keyboard handler in ./keyboard; the context contract + hook
 * (FormLayoutCtx, useFormLayout) in ./form-layout-context — re-exported below so
 * existing importers are unaffected. */
export { useFormLayout } from './form-layout-context';
export type { FormLayoutCtx } from './form-layout-context';

/**
 * FormLayoutProvider — the shared enterprise form layout engine.
 * Owns schema loading, tabs/groups/fields state, all mutations, drag & drop,
 * and saving (PUT collection with merged fields + form_layout).
 * Renders a DndContext so palette, canvas and inspector can drag between panes.
 */
export function FormLayoutProvider({
	token,
	collection,
	onSaved,
	children,
}: {
	token: string;
	collection: string;
	onSaved?: () => void;
	children: ReactNode;
}) {
	const queryClient = useQueryClient();
	const slug = collection;
	const [schema, setSchema] = useState<EntitySchema | null>(null);
	const [fields, setFields] = useState<FieldDefinition[]>([]);
	const [tabs, setTabs] = useState<FormTab[]>([]);
	const [activeTabId, setActiveTabId] = useState<string | null>(null);
	const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
	const [inspectorKind, setInspectorKind] = useState<'form' | 'tab' | 'group' | 'field'>('form');
	const [selected, setSelected] = useState<string | null>(null);
	const [defaultTabId, setDefaultTabId] = useState<string | null>(null);
	const [helpOpen, setHelpOpen] = useState(false);
	const [dropOver, setDropOver] = useState<{ name: string; before: boolean } | null>(null);
	const [dirty, setDirty] = useState(false);
	const [saving, setSaving] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [activeDrag, setActiveDrag] = useState<{ label?: string } | null>(null);
	const [serverBaseline, setServerBaseline] = useState<string | null>(null);

	/* ── Undo/redo — snapshot history. `markDirty()` pushes the PRE-mutation state,
	 *     so every mutation (they all end with markDirty) is reversible. ── */
	type FormSnap = { tabs: FormTab[]; fields: FieldDefinition[]; defaultTabId: string | null };
	const snapRef = useRef<FormSnap>({ tabs: [], fields: [], defaultTabId: null });
	useEffect(() => {
		snapRef.current = { tabs, fields, defaultTabId };
	});
	const { push: pushHistory, undo, redo, canUndo, canRedo } = useSnapshotHistory<FormSnap>(snapRef, 60);
	const undoTabs = useCallback(() => {
		const prev = undo();
		if (!prev) return;
		setTabs(prev.tabs);
		setFields(prev.fields);
		setDefaultTabId(prev.defaultTabId);
		setDirty(true);
	}, [undo]);
	const redoTabs = useCallback(() => {
		const next = redo();
		if (!next) return;
		setTabs(next.tabs);
		setFields(next.fields);
		setDefaultTabId(next.defaultTabId);
		setDirty(true);
	}, [redo]);
	// Global shortcuts — Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y redo, ? help.
	// Canvas editing (same muscle memory as the block canvas): 1–9 grid span (or group
	// columns when a group is focused), A/D move field left/right, W/S move the field
	// to the adjacent group, ←/→ move the selection, Delete removes from the layout,
	// Ctrl+D duplicates the field. Declared after the mutation callbacks so the deps
	// reference stable functions (listener registers once per relevant state change).

	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

	const userFields = useMemo(() => fields.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name)), [fields]);
	const systemFields = useMemo(() => fields.filter((f) => SYSTEM_FIELD_NAMES.has(f.name)), [fields]);

	const refresh = useCallback(async () => {
		if (!slug) return;
		try {
			setError(null);
			// Read through the shared schema cache — a collection already open elsewhere
			// (the table/records views) costs zero requests here.
			const s = await queryClient.fetchQuery(collectionQuery(token, slug));
			setSchema(s);
			setServerBaseline(JSON.stringify(s.schema_json)); // conflict-detection baseline
			const all = s.schema_json?.fields ?? [];
			setFields(all);
			const userNames = all.filter((f) => !SYSTEM_FIELD_NAMES.has(f.name)).map((f) => f.name);
			// Form layout: tabs → groups → fields (groups may nest), falling back to the
			// legacy flat `groups` / a seeded default tab so old collections keep working.
			const layout = (s.schema_json as { form_layout?: StoredFormLayout }).form_layout;
			const { tabs: next, defaultTabId: validDefault } = tabsFromLayout(layout, userNames);
			setTabs(next);
			setDefaultTabId(validDefault);
			setActiveTabId(validDefault ?? next[0]?.id ?? null);
			setActiveGroupId(next.find((t) => t.id === (validDefault ?? next[0]?.id))?.groups[0]?.id ?? null);
			// No field/group is selected yet — the right pane inspects the form itself.
			setInspectorKind('form');
			// No field is selected until the user clicks one (the blue outline is a focus/selection cue).
			setSelected(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to load collection');
		} finally {
			setLoading(false);
		}
	}, [token, slug, queryClient]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const selectedField = useMemo(() => fields.find((f) => f.name === selected) ?? null, [fields, selected]);

	const markDirty = useCallback(() => {
		pushHistory();
		setDirty(true);
	}, [pushHistory]);

	const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;
	const activeFirstGroupId = activeTab?.groups[0]?.id ?? '';
	const activeGroup = useMemo(
		() => tabs.flatMap((t) => flattenGroups(t.groups)).find((g) => g.id === activeGroupId) ?? null,
		[tabs, activeGroupId],
	);

	/** Patch a group (by id) wherever it lives across tabs (including nested sub-groups). */
	const patchGroup = useCallback((gid: string, patch: (g: FormGroup) => FormGroup) => {
		setTabs((prev) => prev.map((t) => ({ ...t, groups: mapGroups(t.groups, (g) => (g.id === gid ? patch(g) : g)) })));
	}, []);

	/** Move a group up/down within its parent — top-level groups reorder in the tab, nested groups in their parent. */
	const moveGroup = useCallback(
		(gid: string, dir: -1 | 1) => {
			setTabs((prev) => moveGroupOp(prev, gid, dir));
			markDirty();
		},
		[markDirty],
	);

	/** Delete a group (and its sub-groups) wherever it lives. */
	const removeGroup = useCallback(
		(gid: string) => {
			setTabs((prev) => removeGroupOp(prev, gid));
			if (activeGroupId === gid) {
				setActiveGroupId(null);
				setInspectorKind('field');
			}
			markDirty();
		},
		[activeGroupId, markDirty],
	);

	/** Move a sub-group out of its parent — re-insert it right after its top-level ancestor. */
	const promoteGroup = useCallback(
		(gid: string) => {
			setTabs((prev) => promoteGroupOp(prev, gid));
			markDirty();
		},
		[markDirty],
	);

	/** Move a group to become a child of another group (nesting) — same tab, no cycles. */
	const moveGroupUnder = useCallback(
		(gid: string, targetGid: string) => {
			setTabs((prev) => moveGroupUnderOp(prev, gid, targetGid));
			markDirty();
		},
		[markDirty],
	);

	const addTab = useCallback(() => {
		const id = `t${Date.now().toString(36)}`;
		setTabs((prev) => [
			...prev,
			{
				id,
				label: `Tab ${prev.length + 1}`,
				groups: [{ id: `g${Date.now().toString(36)}`, title: 'General', columns: 2, fieldNames: [] }],
			},
		]);
		setActiveTabId(id);
		markDirty();
	}, [markDirty]);
	const renameTab = useCallback(
		(id: string, label: string) => {
			setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, label } : t)));
			markDirty();
		},
		[markDirty],
	);
	// Removing a tab keeps the updater pure (no setState inside setTabs) — the
	// active-tab fix-up is a separate setActiveTabId call using the render-time value.
	const removeTab = useCallback(
		(id: string) => {
			const remaining = tabs.filter((t) => t.id !== id);
			setTabs(
				remaining.length > 0
					? remaining
					: [{ id: 't1', label: 'General', groups: [{ id: 'g1', title: 'General', columns: 2, fieldNames: [] }] }],
			);
			if (activeTabId === id) setActiveTabId(remaining[0]?.id ?? 't1');
			markDirty();
		},
		[tabs, activeTabId, markDirty],
	);
	const addGroup = useCallback(
		(tabId: string, parentId?: string) => {
			const id = `g${Date.now().toString(36)}`;
			const group: FormGroup = { id, title: 'Group', columns: 2, fieldNames: [], fieldWidths: {} };
			setTabs((prev) =>
				prev.map((t) => {
					if (t.id !== tabId) return t;
					if (!parentId) return { ...t, groups: [...t.groups, { ...group, title: `Group ${t.groups.length + 1}` }] };
					// Nested sub-group: insert into the matching group's children.
					return {
						...t,
						groups: mapGroups(t.groups, (g) =>
							g.id === parentId ? { ...g, groups: [...(g.groups ?? []), { ...group, title: `Group ${(g.groups?.length ?? 0) + 1}` }] } : g,
						),
					};
				}),
			);
			markDirty();
		},
		[markDirty],
	);

	const addNewField = useCallback(
		(type: string, groupId: string) => {
			const base = `x_${type}_${Date.now().toString(36).slice(-4)}`;
			const field: FieldDefinition = { name: base, type, label: humanize(type), required: false };
			setFields((prev) => [...prev, field]);
			patchGroup(groupId, (g) => ({ ...g, fieldNames: [...g.fieldNames, base] }));
			setSelected(base);
			markDirty();
		},
		[patchGroup, markDirty],
	);

	const addFields = useCallback(
		(batch: FieldDefinition[]) => {
			const names: string[] = [];
			const next = [...fields];
			for (const f of batch) {
				const name = f.name || `x_${f.type}_${Date.now().toString(36).slice(-4)}`;
				names.push(name);
				next.push({ ...f, name, required: f.required ?? false });
			}
			setFields(next);
			patchGroup(activeFirstGroupId, (g) => ({ ...g, fieldNames: [...g.fieldNames, ...names] }));
			setSelected(names[0] ?? null);
			markDirty();
		},
		[fields, patchGroup, activeFirstGroupId, markDirty],
	);

	const addExistingField = useCallback(
		(name: string, groupId: string) => {
			// Move the field into the target group — remove it from wherever it currently lives
			// (palette click, drag onto a group, or drag onto a nested sub-group).
			setTabs((prev) => addFieldToGroup(prev, name, groupId));
			markDirty();
		},
		[markDirty],
	);

	const updateField = useCallback(
		(name: string, patch: Partial<FieldDefinition>) => {
			setFields((prev) => prev.map((f) => (f.name === name ? { ...f, ...patch } : f)));
			markDirty();
		},
		[markDirty],
	);

	const setFieldWidth = useCallback(
		(name: string, width: 'half' | 'full') => {
			setTabs((prev) => setFieldWidthOp(prev, name, width));
			markDirty();
		},
		[markDirty],
	);

	/** Set a field's grid span (1..group.columns) — the Studio 1/2/3/4 shortcut.
	 *  The span is always stored explicitly (even 1) and clears any legacy 'full' width,
	 *  so EVERY field — including textareas and legacy full-width fields — obeys the key. */
	const setFieldSpan = useCallback(
		(name: string, span: number) => {
			setTabs((prev) => setFieldSpanOp(prev, name, span));
			markDirty();
		},
		[markDirty],
	);

	const swapFields = useCallback(
		(name: string, other: string) => {
			setTabs((prev) => swapFieldsOp(prev, name, other));
			markDirty();
		},
		[markDirty],
	);

	const moveField = useCallback(
		(name: string, dir: -1 | 1) => {
			setTabs((prev) => moveFieldOp(prev, name, dir));
			markDirty();
		},
		[markDirty],
	);

	const removeFieldFromLayout = useCallback(
		(name: string) => {
			setTabs((prev) => removeFieldFromLayoutOp(prev, name));
			markDirty();
		},
		[markDirty],
	);

	const removeField = useCallback(
		(name: string) => {
			setFields((prev) => prev.filter((f) => f.name !== name));
			setTabs((prev) =>
				prev.map((t) => ({ ...t, groups: mapGroups(t.groups, (g) => ({ ...g, fieldNames: g.fieldNames.filter((n) => n !== name) })) })),
			);
			setSelected(null);
			markDirty();
		},
		[markDirty],
	);

	const duplicateField = useCallback(
		(name: string) => {
			const f = fields.find((x) => x.name === name);
			if (!f) return;
			const copy: FieldDefinition = { ...f, name: `${name}_copy`, label: `${f.label ?? name} (copy)` };
			setFields((prev) => [...prev, copy]);
			setTabs((prev) =>
				prev.map((t) => ({
					...t,
					groups: mapGroups(t.groups, (g) => (g.fieldNames.includes(name) ? { ...g, fieldNames: [...g.fieldNames, copy.name] } : g)),
				})),
			);
			setSelected(copy.name); // keyboard flow: the copy becomes the active field.
			markDirty();
		},
		[fields, markDirty],
	);

	/* ── dnd ── */
	const onDragStart = useCallback((e: DragStartEvent) => {
		const d = e.active.data.current as { label?: string } | undefined;
		setActiveDrag(d ? { label: d.label } : null);
		setDropOver(null);
	}, []);
	const onDragMove = useCallback((e: DragMoveEvent) => {
		const over = e.over;
		const data = over?.data.current as { kind?: string; name?: string } | undefined;
		if (data?.kind !== 'field' || !data.name) {
			setDropOver(null);
			return;
		}
		const el = document.querySelector(`[data-field-id="${data.name}"]`) as HTMLElement | null;
		if (!el) {
			setDropOver(null);
			return;
		}
		const r = el.getBoundingClientRect();
		const tr = e.active.rect.current.translated;
		setDropOver({ name: data.name, before: tr ? tr.top < r.top + r.height / 2 : true });
	}, []);
	const onDragEnd = useCallback(
		(e: DragEndEvent) => {
			setActiveDrag(null);
			setDropOver(null);
			const over = e.over;
			if (!over) return;
			const target = over.data.current as { kind?: string; gid?: string; tid?: string; name?: string } | undefined;
			const source = e.active.data.current as { kind?: string; type?: string; name?: string } | undefined;
			if (!target || !source) return;
			if (target.kind === 'group') {
				if (source.kind === 'new-field') {
					if (source.type === 'group') {
						// Layout item dropped on a group → nest a new sub-group under it.
						const tid = tabs.find((t) => flattenGroups(t.groups).some((g) => g.id === target.gid))?.id;
						if (tid) addGroup(tid, target.gid);
					} else if (source.type) addNewField(source.type, target.gid!);
				} else if (source.kind === 'existing' && source.name) addExistingField(source.name, target.gid!);
			} else if (target.kind === 'tab') {
				// Drop an existing field onto a tab → move it to that tab's first group.
				if (source.kind === 'existing' && source.name) {
					const name = source.name;
					setTabs((prev) => moveFieldToTab(prev, target.tid!, name));
					markDirty();
				}
			} else if (target.kind === 'field' && source.kind === 'existing' && source.name && target.name !== source.name) {
				// Drop ONTO a field chip → insert the source at that chip's position (before/after by drop position).
				const before = dropOver && dropOver.name === target.name ? dropOver.before : true;
				const name = source.name;
				setTabs((prev) => insertFieldRelative(prev, target.name!, name, before));
				markDirty();
			}
		},
		[tabs, addGroup, addNewField, addExistingField, dropOver, markDirty],
	);
	const onDragOver = useCallback((_e: DragOverEvent) => {
		/* isOver handles highlight */
	}, []);

	/* ── Save ── */
	const save = useCallback(async () => {
		if (!slug) return;
		if (saving || !dirty) return;
		setSaving(true);
		setError(null);
		try {
			// Optimistic concurrency: if the server's schema changed since we loaded it, confirm the overwrite.
			// `staleTime: 0` forces a fresh read (the point is to detect a concurrent change),
			// while still sharing the cache entry and deduping a concurrent identical read.
			const current = await queryClient.fetchQuery({ ...collectionQuery(token, slug), staleTime: 0 }).catch(() => null);
			if (
				current &&
				serverBaseline &&
				JSON.stringify(current.schema_json) !== serverBaseline &&
				!(await confirmDialog({
					title: 'Overwrite changes?',
					description: 'This collection was modified by someone else since you opened it. Overwrite their changes?',
					confirmLabel: 'Overwrite',
					destructive: true,
				}))
			) {
				return;
			}
			const ordered: string[] = [];
			const walk = (gs: FormGroup[]) => {
				for (const g of gs) {
					for (const n of g.fieldNames) if (!ordered.includes(n)) ordered.push(n);
					if (g.groups?.length) walk(g.groups);
				}
			};
			for (const t of tabs) walk(t.groups);
			for (const f of userFields) if (!ordered.includes(f.name)) ordered.push(f.name);
			const fieldMap = new Map(fields.map((f) => [f.name, f]));
			const merged = [...ordered.map((n) => fieldMap.get(n)).filter(Boolean), ...systemFields] as FieldDefinition[];
			const formLayout: SerializedFormLayout = serializeLayout(tabs, defaultTabId);
			// REVIEW before APPLY: ask the server what this schema change does, and
			// surface any BREAKING change for an explicit confirmation. Best-effort —
			// a diff that cannot be computed must never block a legitimate save.
			try {
				const summary = await reviewSchemaChange(token, slug, merged);
				const breaking = summary?.breakingChanges ?? [];
				if (
					breaking.length > 0 &&
					!(await confirmDialog({
						title: 'Breaking changes',
						description: `This change has ${breaking.length} breaking change(s):\n- ${breaking.join('\n- ')}\n\nApply anyway?`,
						confirmLabel: 'Apply anyway',
						destructive: true,
					}))
				) {
					return;
				}
			} catch {
				/* review is advisory */
			}
			// Server-enforced optimistic concurrency: send the version we just read
			// (`current`), so a write landing between this read and the PUT is refused
			// 409 rather than overwriting it. The confirm above is the advisory layer;
			// `If-Match` is the hard one.
			await updateCollectionFields(token, slug, merged, formLayout, current?._schema_version);
			setDirty(false);
			await refresh();
			onSaved?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Save failed');
		} finally {
			setSaving(false);
		}
	}, [slug, saving, dirty, token, serverBaseline, tabs, userFields, fields, systemFields, defaultTabId, refresh, onSaved, queryClient]);

	/* ── Export / Import (canonical model JSON) ── */
	const currentLayout = useCallback((): SerializedFormLayout => serializeLayout(tabs, defaultTabId), [tabs, defaultTabId]);

	const copyLayout = useCallback(() => {
		const text = JSON.stringify(currentLayout(), null, 2);
		navigator.clipboard?.writeText(text).catch(() => {
			setError('Clipboard unavailable');
		});
	}, [currentLayout]);
	const pasteLayout = useCallback(() => {
		navigator.clipboard
			?.readText()
			.then((text) => {
				try {
					const parsed = JSON.parse(text) as StoredFormLayout;
					const incoming = parsed.tabs;
					if (!incoming || incoming.length === 0) throw new Error('Clipboard does not contain a form layout');
					const known = new Set(fields.map((f) => f.name));
					setTabs(
						tabsFromSerialized(
							incoming.map((t) => ({ ...t, groups: trimGroupsToFields(t.groups ?? [], known) })),
							(ti) => `t${Date.now().toString(36)}${ti}`,
						),
					);
					setActiveTabId(null);
					setError(null);
					markDirty();
				} catch (e) {
					setError(e instanceof Error ? e.message : 'Invalid layout in clipboard');
				}
			})
			.catch(() => {
				setError('Clipboard unavailable');
			});
	}, [fields, markDirty]);

	const exportModel = useCallback(() => {
		const payload = {
			app: { name: schema?.name ?? slug, model: slug },
			model: { technicalName: slug, fields: Object.fromEntries(userFields.map((f) => [f.name, f])) },
			layout: currentLayout(),
			exportedAt: new Date().toISOString(),
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${slug}.studio.json`;
		a.click();
		URL.revokeObjectURL(url);
	}, [schema, slug, userFields, currentLayout]);
	const importModel = useCallback(
		(file: File) => {
			file.text().then((text) => {
				try {
					const parsed = JSON.parse(text) as {
						model?: { fields?: Record<string, FieldDefinition> };
						layout?: StoredFormLayout;
					};
					const incoming = parsed.model?.fields ? Object.values(parsed.model.fields) : [];
					if (incoming.length === 0 && !parsed.layout) throw new Error('No fields in file');
					const next = [...fields];
					for (const f of incoming) {
						if (!next.some((x) => x.name === f.name)) next.push({ ...f, required: f.required ?? false });
					}
					setFields(next);
					if (parsed.layout?.tabs && parsed.layout.tabs.length > 0) {
						const known = new Set(next.map((f) => f.name));
						setTabs(
							tabsFromSerialized(
								parsed.layout.tabs.map((t) => ({ ...t, groups: trimGroupsToFields(t.groups ?? [], known) })),
								(ti) => `t${Date.now().toString(36)}${ti}`,
							),
						);
						setActiveTabId(null);
					} else {
						patchGroup(activeFirstGroupId, (g) => ({
							...g,
							fieldNames: [...g.fieldNames, ...incoming.filter((f) => !g.fieldNames.includes(f.name)).map((f) => f.name)],
						}));
					}
					markDirty();
				} catch (e) {
					setError(e instanceof Error ? e.message : 'Invalid model file');
				}
			});
		},
		[fields, patchGroup, activeFirstGroupId, markDirty],
	);

	// Global shortcuts — Ctrl/Cmd+S save, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y redo, ? help.
	// Canvas editing (same muscle memory as the block canvas): 1–9 grid span (or group
	// columns when a group is focused), A/D move field left/right, W/S move the field
	// to the adjacent group, ←/→ move the selection, Delete removes from the layout,
	// Ctrl+D duplicates the field.
	useEffect(() => {
		// Capture phase + keyup fallback: some input sources (e.g. Burmese IME on
		// macOS) consume plain keydowns for composition — keyup still fires. Register
		// in the CAPTURE phase so no other listener (menu wrappers, etc.) can claim
		// the key first, and dedupe so a normal keydown+keyup pair acts only once.
		const onKey = makeFormLayoutKeyHandler({
			save,
			undo: undoTabs,
			redo: redoTabs,
			setHelpOpen,
			selected,
			fields,
			tabs,
			activeGroupId,
			setFieldSpan,
			patchGroup,
			removeFieldFromLayout,
		});
		window.addEventListener('keydown', onKey, true);
		window.addEventListener('keyup', onKey, true);
		return () => {
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('keyup', onKey, true);
		};
	}, [undoTabs, redoTabs, save, selected, fields, tabs, activeGroupId, activeTabId, setFieldSpan, patchGroup, removeFieldFromLayout]);

	const value = useMemo<FormLayoutCtx>(
		() => ({
			token,
			slug,
			schema,
			fields,
			tabs,
			activeTabId,
			setActiveTabId,
			activeGroupId,
			setActiveGroupId,
			activeGroup,
			inspectorKind,
			setInspectorKind,
			selected,
			setSelected,
			canUndo,
			canRedo,
			undo: undoTabs,
			redo: redoTabs,
			helpOpen,
			setHelpOpen,
			dropOver,
			dirty,
			saving,
			loading,
			error,
			activeDrag,
			userFields,
			systemFields,
			selectedField,
			activeTab,
			activeFirstGroupId,
			defaultTabId,
			setDefaultTabId,
			markDirty,
			addTab,
			renameTab,
			removeTab,
			addGroup,
			patchGroup,
			moveGroup,
			removeGroup,
			promoteGroup,
			moveGroupUnder,
			addNewField,
			addFields,
			addExistingField,
			updateField,
			setFieldWidth,
			setFieldSpan,
			swapFields,
			moveField,
			removeFieldFromLayout,
			removeField,
			duplicateField,
			save,
			refresh,
			copyLayout,
			pasteLayout,
			currentLayout,
			exportModel,
			importModel,
			onDragStart,
			onDragMove,
			onDragEnd,
			onDragOver,
		}),
		[
			token,
			slug,
			schema,
			fields,
			tabs,
			activeTabId,
			activeGroupId,
			activeGroup,
			inspectorKind,
			selected,
			canUndo,
			canRedo,
			undoTabs,
			redoTabs,
			helpOpen,
			dropOver,
			dirty,
			saving,
			loading,
			error,
			activeDrag,
			userFields,
			systemFields,
			selectedField,
			activeTab,
			activeFirstGroupId,
			defaultTabId,
			markDirty,
			addTab,
			renameTab,
			removeTab,
			addGroup,
			patchGroup,
			moveGroup,
			removeGroup,
			promoteGroup,
			moveGroupUnder,
			addNewField,
			addFields,
			addExistingField,
			updateField,
			setFieldWidth,
			setFieldSpan,
			swapFields,
			moveField,
			removeFieldFromLayout,
			removeField,
			duplicateField,
			save,
			refresh,
			copyLayout,
			pasteLayout,
			currentLayout,
			exportModel,
			importModel,
			onDragStart,
			onDragMove,
			onDragEnd,
			onDragOver,
		],
	);

	return (
		<Ctx.Provider value={value}>
			<DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragOver={onDragOver} onDragEnd={onDragEnd}>
				{children}
				<DragOverlay>
					{activeDrag && (
						<div
							style={{
								padding: '0.45rem 0.7rem',
								borderRadius: 7,
								background: 'var(--mmbix-accent, #f0fdfa)',
								border: '1px solid var(--mmbix-primary, #0f766e)',
								fontSize: '0.82rem',
								fontWeight: 600,
							}}
						>
							+ {activeDrag.label ?? 'item'}
						</div>
					)}
				</DragOverlay>
			</DndContext>
		</Ctx.Provider>
	);
}

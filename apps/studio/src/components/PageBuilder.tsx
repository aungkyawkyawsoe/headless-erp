import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	getPage,
	listCustomBlocks,
	savePage,
	updatePage,
	updateMenu,
	patchCollectionViews,
	SYSTEM_FIELD_NAMES,
	type CustomBlockDef,
	type EntitySchema,
	type PageBlock,
	type PageData,
} from '../lib/api';
import { collectionQuery, collectionsQuery } from '../lib/queries';
import { confirmDialog } from '@mmbix/design-system';
import MenuPreview from './MenuPreview';
import type { Node as MenuNode } from './MenuBuilder';
import { useSnapshotHistory } from '../lib/use-snapshot-history';
import { blankBlock, isViewConfig } from './blockDefs';
import { DEFAULT_CARD_FIELDS, PAGE_SCHEMA_VERSION, type CardViewConfig } from '@mmbix/ui-views';
import { BuilderCtx, useBuilder, Ctx, type ViewConfig } from './PageBuilderContext';
import { useStudioMeta } from '../lib/studioMeta';
import {
	insertBlock,
	insertIntoRec,
	insertRelativeRec,
	removeBlockRec,
	updateBlockRec,
	orderBlocks,
	findBlock,
	isSelfOrDescendant,
	insertAfterRec,
	moveBlockRec,
} from '../lib/page-blocks';

export { PageProperties } from './PageInspector';

/** Deep clone (history snapshots + clipboard payloads must be detached copies). */
function clone<T>(v: T): T {
	return structuredClone(v);
}

/** Draft snapshot for undo/redo — the persisted page payload minus page identity. */
interface DraftSnapshot {
	blocks: PageBlock[];
	title: string;
	path: string;
	viewConfigs: Record<string, ViewConfig>;
}

/** A designed view config mirrored to the collection's schema_json on save, so the
 *  admin collection list (a separate route) renders the exact designed view. */
interface ViewMirror {
	configKey: 'table' | 'card' | 'kanban' | 'pivot';
	schemaKey: 'list_view' | 'card_view' | 'kanban_view' | 'pivot_view';
	/** Only mirror when the config owns the focused collection (the table view is
	 *  menu-focus-bound; a manual collection override clears focusCollection). */
	requireFocus?: boolean;
}

const VIEW_MIRRORS: ViewMirror[] = [
	{ configKey: 'table', schemaKey: 'list_view', requireFocus: true },
	{ configKey: 'card', schemaKey: 'card_view' },
	{ configKey: 'kanban', schemaKey: 'kanban_view' },
	{ configKey: 'pivot', schemaKey: 'pivot_view' },
];

/* ── Provider ────────────────────────────────────────── */

export function PageBuilderProvider({
	token,
	pages,
	moduleSlug,
	onSaved,
	onPageOpen,
	initialPageId,
	initialTemplate,
	onTemplateChange,
	initialMode,
	onModeChange,
	initialCollection,
	children,
}: {
	token: string;
	pages: PageData[];
	moduleSlug: string;
	onSaved: () => void;
	onPageOpen?: (id: string | null) => void;
	initialPageId?: string | null;
	initialTemplate?: string | null;
	onTemplateChange?: (t: string) => void;
	initialMode?: string | null;
	onModeChange?: (m: string) => void;
	/** Collection from the URL (?collection=) — seeds the focused data context on reload. */
	initialCollection?: string | null;
	children: React.ReactNode;
}) {
	const queryClient = useQueryClient();
	// The collection registry is the same app-wide cached read every screen shares.
	const collectionsQ = useQuery(collectionsQuery(token));
	const collections = useMemo(() => collectionsQ.data ?? [], [collectionsQ.data]);
	const [pageId, setPageId] = useState('new');
	// Active view mode — URL-backed (?view=) so a reload keeps the same view.
	const VIEW_KEYS = new Set(['table', 'form', 'kanban', 'card', 'list', 'calendar', 'layout', 'pivot']);
	const [canvasMode, setCanvasModeState] = useState(initialMode && VIEW_KEYS.has(initialMode) ? initialMode : 'table');
	const setCanvasMode = useCallback(
		(m: string) => {
			setCanvasModeState(m);
			onModeChange?.(m);
		},
		[onModeChange],
	);
	// Collection bound by the focused menu item (menu-driven data context).
	// Seeded from the URL (?collection=) so a reload lands on the right collection —
	// no extra menu click needed when the deep link already names one.
	const [focusCollection, setFocusCollection] = useState<string | null>(initialCollection ?? null);
	// Table view: the column selected on the canvas header (right pane highlights it).
	const [tableColSel, setTableColSel] = useState<string | null>(null);
	// Page template (URL-backed) — declares which designer views this page exposes.
	// Default falls back to studio_config.default_template, then 'table-form'.
	const { templates, config } = useStudioMeta();
	const defaultTemplate = typeof config.default_template === 'string' ? config.default_template : 'table-form';
	const [template, setTemplate] = useState(initialTemplate ?? defaultTemplate);
	const [title, setTitle] = useState('Untitled page');
	const [path, setPath] = useState('untitled');
	const [blocks, setBlocks] = useState<PageBlock[]>([]);
	const [selected, setSelected] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	// Synchronous re-entry guard — the `saving` state can't gate two ⌘S presses that
	// land before a re-render (both would POST for pageId === 'new' → duplicate pages).
	const savingRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [savedVersion, setSavedVersion] = useState(0);
	const [loadedVersion, setLoadedVersion] = useState(0);
	const [viewConfigs, setViewConfigs] = useState<Record<string, ViewConfig>>({});
	const [schemas, setSchemas] = useState<Record<string, EntitySchema>>({});
	// Optimistic-concurrency baseline (server updated_at at load time).
	const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string | null>(null);

	/* ── Undo/redo — snapshot history over the draft (blocks + title + path + view configs).
	 *     Mutations push the PRE-mutation draft; the refs keep snapshots honest inside closures. ── */
	const draftRef = useRef<DraftSnapshot>({ blocks: [], title: '', path: '', viewConfigs: {} });
	useEffect(() => {
		draftRef.current = { blocks, title, path, viewConfigs };
	});
	const {
		push: pushHistory,
		undo: popUndo,
		redo: popRedo,
		reset: resetHistory,
		canUndo,
		canRedo,
	} = useSnapshotHistory<DraftSnapshot>(draftRef, 60);
	const undo = useCallback(() => {
		const prev = popUndo();
		if (!prev) return;
		setBlocks(prev.blocks);
		setTitle(prev.title);
		setPath(prev.path);
		setViewConfigs(prev.viewConfigs);
	}, [popUndo]);
	const redo = useCallback(() => {
		const next = popRedo();
		if (!next) return;
		setBlocks(next.blocks);
		setTitle(next.title);
		setPath(next.path);
		setViewConfigs(next.viewConfigs);
	}, [popRedo]);
	// Clipboard — copy/duplicate place a detached block here; Paste inserts it.
	const [clipboard, setClipboard] = useState<PageBlock | null>(null);

	// Custom blocks (extension API) — merged into the palette so registered block
	// types appear alongside the built-in registry without any code change.
	const [customBlocks, setCustomBlocks] = useState<CustomBlockDef[]>([]);
	useEffect(() => {
		listCustomBlocks(token)
			.then(setCustomBlocks)
			.catch(() => setCustomBlocks([]));
	}, [token]);

	const fetchSchema = useCallback(
		async (collection: string): Promise<EntitySchema | null> => {
			if (!token || !collection) return null;
			if (schemas[collection]) return schemas[collection];
			try {
				// Read through the shared schema cache — a collection already open elsewhere
				// costs zero requests, and this populates the same entry every screen uses.
				const s = await queryClient.fetchQuery(collectionQuery(token, collection));
				setSchemas((prev) => ({ ...prev, [collection]: s }));
				return s;
			} catch {
				return null;
			}
		},
		[token, schemas, queryClient],
	);

	// Per-menu templates: the menu item currently focused by the builder (id + ref so
	// synchronous reads work inside pickTemplate), and the last template persisted per
	// menu id so re-clicks never write the same value back (each write bumps the app's
	// config version — avoid the noise).
	const activeMenuIdRef = useRef<string | null>(null);
	const menuTemplateSaved = useRef<Record<string, string>>({});
	const setActiveMenuId = useCallback((id: string | null, template?: string | null) => {
		activeMenuIdRef.current = id;
		if (id && template) menuTemplateSaved.current[id] = template;
	}, []);

	const pickTemplate = useCallback(
		(key: string) => {
			setTemplate(key);
			onTemplateChange?.(key);
			// Mode clamp: when the new template drops the active view, fall back to its first view.
			// Removed views' configs stay persisted (invisible _view_config blocks) — switching back restores them.
			const t = templates.find((tpl) => tpl.key === key);
			if (t && !t.views.includes(canvasMode)) setCanvasMode(t.views[0] ?? canvasMode);
			// Persist the template choice to the focused menu item (per-menu templates),
			// so each menu remembers its own views instead of sharing one global template.
			const menuId = activeMenuIdRef.current;
			if (menuId && menuTemplateSaved.current[menuId] !== key) {
				menuTemplateSaved.current[menuId] = key;
				updateMenu(token, menuId, { template: key }).catch(() => {
					/* non-fatal: template stays session-only until the next save */
				});
			}
		},
		[onTemplateChange, templates, canvasMode, setCanvasMode, token],
	);

	const selectPage = useCallback(
		(id: string) => {
			setPageId(id);
			setSelected(null);
			setError(null);
			resetHistory();
			if (id === 'new') {
				setTitle('Untitled page');
				setPath('untitled');
				setBlocks([]);
				setViewConfigs({});
				setLoadedUpdatedAt(null);
				setLoadedVersion((v) => v + 1);
				onPageOpen?.(null);
				return;
			}
			onPageOpen?.(id);
			getPage(token, id)
				.then((p) => {
					setTitle(p.title);
					setPath(p.path);
					setLoadedUpdatedAt(p.updatedAt);
					// Split _meta/_view_config blocks out of the block list — they are page metadata and per-view settings, not layout blocks.
					const vcs: Record<string, ViewConfig> = {};
					const real: PageBlock[] = [];
					let metaTemplate: string | null = null;
					for (const b of p.blocks) {
						if (b.type === '_meta') {
							metaTemplate = (b.config as { template?: string }).template ?? null;
							continue;
						}
						if (isViewConfig(b)) {
							const v = (b.config as { view?: string }).view;
							if (v) vcs[v] = b.config as unknown as ViewConfig;
						} else real.push(b);
					}
					setBlocks(real);
					setViewConfigs(vcs);
					// Remember the page's designer template (e.g. workspace pages use 'layout').
					if (metaTemplate && templates.some((t) => t.key === metaTemplate)) setTemplate(metaTemplate);
					setLoadedVersion((v) => v + 1);
				})
				.catch((e) => setError(e instanceof Error ? e.message : 'Failed to load page'));
		},
		[token, onPageOpen, templates, resetHistory],
	);

	// Open the page referenced by the URL (?page=) when the section loads.
	useEffect(() => {
		if (initialPageId && initialPageId !== 'new') selectPage(initialPageId);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const selectedBlock = useMemo(() => blocks.find((b) => b.id === selected) ?? null, [blocks, selected]);

	// Dirty tracking: the persisted page payload (blocks + title + path + view configs + template)
	// differs from the last saved/loaded snapshot → drives the Save button and the unsaved-changes guard.
	// Template is part of the payload (persisted in the _meta block) — a template change must dirty the page.
	const draftKey = JSON.stringify({ blocks, title, path, viewConfigs, template });
	const [lastSaved, setLastSaved] = useState('');
	useEffect(() => {
		setLastSaved(draftKey);
	}, [savedVersion, loadedVersion]); // eslint-disable-line react-hooks/exhaustive-deps
	const dirty = draftKey !== lastSaved;

	/** Build a block with optional demo config + children (from the catalog storyboard). */
	const buildBlock = useCallback((type: string, extra?: { config?: Record<string, unknown>; children?: PageBlock[] }) => {
		const b = blankBlock(type);
		if (extra?.config) b.config = { ...b.config, ...extra.config };
		if (extra?.children) b.children = extra.children;
		return b;
	}, []);

	const addBlock = useCallback(
		(type: string, extra?: { config?: Record<string, unknown>; children?: PageBlock[] }) => {
			const b = buildBlock(type, extra);
			pushHistory();
			setBlocks((prev) => insertBlock(prev, b, selected));
			setSelected(b.id);
		},
		[buildBlock, pushHistory, selected],
	);

	/** Insert a block into a specific container (drag-drop target). */
	const addBlockInto = useCallback(
		(type: string, containerId: string | null, extra?: { config?: Record<string, unknown>; children?: PageBlock[] }) => {
			const b = buildBlock(type, extra);
			pushHistory();
			setBlocks((prev) => insertIntoRec(prev, containerId, b));
			setSelected(b.id);
		},
		[buildBlock, pushHistory],
	);

	/** Insert a block relative to a target block — before/after (sibling) or inside (container). */
	const addBlockAt = useCallback(
		(
			type: string,
			targetId: string,
			position: 'before' | 'after' | 'inside',
			extra?: { config?: Record<string, unknown>; children?: PageBlock[] },
		) => {
			const b = buildBlock(type, extra);
			pushHistory();
			setBlocks((prev) => insertRelativeRec(prev, targetId, position, b));
			setSelected(b.id);
		},
		[buildBlock, pushHistory],
	);

	/** Append a generated block tree (AI draft) to the canvas root. */
	const importBlocks = useCallback(
		(generated: PageBlock[]) => {
			if (!Array.isArray(generated) || generated.length === 0) return;
			pushHistory();
			setBlocks((prev) => [...prev, ...generated]);
			setSelected(generated[0].id);
		},
		[pushHistory],
	);

	/** Replace the whole block tree (version restore / template apply). */
	const replaceBlocks = useCallback(
		(generated: PageBlock[], opts?: { selectFirst?: boolean }) => {
			if (!Array.isArray(generated)) return;
			pushHistory();
			setBlocks(generated);
			setSelected(opts?.selectFirst === false ? null : (generated[0]?.id ?? null));
		},
		[pushHistory],
	);

	const addComponent = useCallback(
		(name: string, defaults: Record<string, unknown>) => {
			const b: PageBlock = { id: crypto.randomUUID(), type: name, label: name, layout: { order: blocks.length }, config: { ...defaults } };
			pushHistory();
			setBlocks((prev) => insertBlock(prev, b, selected));
			setSelected(b.id);
		},
		[blocks, pushHistory, selected],
	);

	const addEntityList = useCallback(
		(collection: string) => {
			const b: PageBlock = {
				id: crypto.randomUUID(),
				type: 'list',
				label: 'Entity List',
				layout: { order: blocks.length },
				config: { title: collection, collection, limit: 10 },
			};
			pushHistory();
			setBlocks((prev) => insertBlock(prev, b, selected));
			setSelected(b.id);
		},
		[blocks, pushHistory, selected],
	);

	const clean = useCallback((target: string) => {
		return target.replace(/^\//, '').replace(/[^a-z0-9-_/]/g, '');
	}, []);

	// Open a link target: reuse the page if its path already exists, else start a fresh one.
	const openTarget = useCallback(
		(label: string, target: string, seedBlocks?: PageBlock[]) => {
			const match = pages.find((p) => p.path === clean(target));
			if (match) {
				selectPage(match.id);
				return;
			}
			resetHistory();
			setPageId('new');
			setTitle(label);
			setPath(clean(target));
			setBlocks(seedBlocks ?? []);
			setSelected(null);
			setLoadedUpdatedAt(null);
			onPageOpen?.(null);
			// Record the fresh draft as its own baseline — otherwise switching menus
			// with zero edits would raise the unsaved-changes guard forever.
			setLoadedVersion((v) => v + 1);
		},
		[pages, selectPage, resetHistory, onPageOpen, clean],
	);

	const updateConfig = useCallback(
		(id: string, key: string, value: unknown) => {
			pushHistory();
			setBlocks((prev) => updateBlockRec(prev, id, (b) => ({ ...b, config: { ...b.config, [key]: value } })));
		},
		[pushHistory],
	);

	/** Patch layout fields — grid colSpan/colStart/alignY + free-mode positioning (x/y/w/h). null clears. */
	const updateLayout = useCallback(
		(id: string, patch: Record<string, number | string | null>) => {
			pushHistory();
			setBlocks((prev) => updateBlockRec(prev, id, (b) => ({ ...b, layout: { ...b.layout, ...patch } })));
		},
		[pushHistory],
	);

	const move = useCallback(
		(dir: -1 | 1, id: string) => {
			pushHistory();
			setBlocks((prev) => moveBlockRec(prev, id, dir));
		},
		[pushHistory],
	);

	/** Move an existing block relative to a target (drag to reposition — Craft.js-style). */
	const moveBlockTo = useCallback(
		(sourceId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
			if (sourceId === targetId) return;
			// Cycle guard — dropping a container onto itself or one of its own descendants
			// would delete the subtree (the target lives inside the removed source).
			if (isSelfOrDescendant(blocks, sourceId, targetId)) return;
			pushHistory();
			setBlocks((prev) => {
				const src = findBlock(prev, sourceId);
				if (!src) return prev;
				const without = removeBlockRec(prev, sourceId);
				return insertRelativeRec(without, targetId, position, src);
			});
			setSelected(sourceId);
		},
		[blocks, pushHistory],
	);

	/** Move an existing block to the end of the page (root) — dropped on empty canvas. */
	const moveBlockToRoot = useCallback(
		(sourceId: string) => {
			pushHistory();
			setBlocks((prev) => {
				const src = findBlock(prev, sourceId);
				if (!src) return prev;
				const without = removeBlockRec(prev, sourceId);
				return [...without, src];
			});
			setSelected(sourceId);
		},
		[pushHistory],
	);

	const removeBlock = useCallback(
		(id: string) => {
			pushHistory();
			setBlocks((prev) => removeBlockRec(prev, id));
		},
		[pushHistory],
	);

	/** Remove several blocks in one history step (multi-select delete). */
	const removeBlocks = useCallback(
		(ids: string[]) => {
			if (ids.length === 0) return;
			pushHistory();
			setBlocks((prev) => {
				const set = new Set(ids);
				const prune = (list: PageBlock[]): PageBlock[] =>
					list.filter((b) => !set.has(b.id)).map((b) => (b.children?.length ? { ...b, children: prune(b.children) } : b));
				return prune(prev);
			});
			setSelected(null);
		},
		[pushHistory],
	);

	const duplicateBlock = useCallback(
		(id: string) => {
			const src = findBlock(blocks, id);
			if (!src) return;
			pushHistory();
			const copy: PageBlock = { ...clone(src), id: crypto.randomUUID() };
			setBlocks((prev) => insertAfterRec(prev, id, copy));
			setSelected(copy.id);
		},
		[blocks, pushHistory],
	);

	/** Rename a block (Layer panel double-click). */
	const renameBlock = useCallback(
		(id: string, label: string) => {
			const name = label.trim();
			if (!name) return;
			pushHistory();
			setBlocks((prev) => updateBlockRec(prev, id, (b) => ({ ...b, label: name })));
		},
		[pushHistory],
	);

	/** Wrap the given TOP-LEVEL blocks into a group container (Photoshop-style). */
	const groupBlocks = useCallback(
		(ids: string[]) => {
			const picked = blocks.filter((b) => ids.includes(b.id));
			if (picked.length < 2) return;
			pushHistory();
			setBlocks((prev) => {
				const set = new Set(ids);
				const rest = prev.filter((b) => !set.has(b.id));
				const group: PageBlock = {
					id: crypto.randomUUID(),
					type: 'column',
					label: 'Group',
					layout: { order: rest.length },
					config: { gap: 8 },
					children: picked.map((b, i) => ({ ...clone(b), layout: { ...b.layout, order: i } })),
				};
				return [...rest, group];
			});
			setSelected(null);
		},
		[blocks, pushHistory],
	);

	/** Explode a group container — children move back to the root. */
	const ungroupBlock = useCallback(
		(id: string) => {
			pushHistory();
			setBlocks((prev) => {
				const target = prev.find((b) => b.id === id);
				if (!target || !target.children?.length) return prev;
				return prev.flatMap((b) => (b.id === id ? target.children!.map((c, i) => ({ ...c, layout: { ...c.layout, order: i } })) : [b]));
			});
			setSelected(null);
		},
		[pushHistory],
	);

	/** Insert a saved widget — its block tree cloned with fresh ids. A single root
	 *  block inserts directly; multiple roots are wrapped in a group container.
	 *  Lands at the root, or INSIDE the selected container when one is selected. */
	const insertWidget = useCallback(
		(tree: PageBlock[], label: string) => {
			if (!Array.isArray(tree) || tree.length === 0) return;
			pushHistory();
			const reId = (b: PageBlock): PageBlock => ({ ...b, id: crypto.randomUUID(), children: b.children?.map(reId) });
			setBlocks((prev) => {
				const cloned = tree.map((b) => reId(b));
				if (cloned.length === 1) return insertBlock(prev, cloned[0], selected);
				const group: PageBlock = {
					id: crypto.randomUUID(),
					type: 'column',
					label: label || 'Widget',
					layout: { order: 0 },
					config: { gap: 8 },
					children: cloned.map((b, i) => ({ ...b, layout: { ...b.layout, order: i } })),
				};
				return insertBlock(prev, group, selected);
			});
			setSelected(null);
		},
		[pushHistory, selected],
	);

	const copyBlock = useCallback(
		(id: string) => {
			const src = findBlock(blocks, id);
			if (!src) return;
			const payload = clone(src);
			setClipboard(payload);
			// Also push JSON to the system clipboard so a copy survives the session.
			try {
				void navigator.clipboard?.writeText(JSON.stringify(payload)).catch(() => {});
			} catch {
				/* clipboard unavailable */
			}
		},
		[blocks],
	);

	const pasteBlock = useCallback(() => {
		if (!clipboard) return;
		pushHistory();
		const b: PageBlock = { ...clone(clipboard), id: crypto.randomUUID() };
		setBlocks((prev) => insertBlock(prev, b, selected));
		setSelected(b.id);
	}, [clipboard, pushHistory, selected]);

	const setViewConfig = useCallback((view: string, patch: Partial<ViewConfig>) => {
		// A manual collection override in the inspector wins over the menu-driven focus collection.
		if ('collection' in patch) setFocusCollection(null);
		setViewConfigs((prev) => ({ ...prev, [view]: { ...prev[view], ...patch } }));
	}, []);

	// Every designer view's collection follows the menu-focused collection. The
	// imperative seed in BuilderMenu only runs on menu clicks, but focus can also
	// arrive from the URL (?collection=) or a mode/template switch — reconcile here
	// so card (and table/form) always know their collection.
	useEffect(() => {
		if (!focusCollection) return;
		setViewConfigs((prev) => {
			let changed = false;
			const next: Record<string, ViewConfig> = {};
			for (const key of ['table', 'form', 'card', 'pivot']) {
				const cur = prev[key] ?? {};
				if (cur.collection !== focusCollection) {
					next[key] = { ...cur, collection: focusCollection };
					changed = true;
				} else next[key] = cur;
			}
			return changed ? { ...prev, ...next } : prev;
		});
	}, [focusCollection]);

	const save = useCallback(async () => {
		// Re-entry guard is a REF (set synchronously) — two ⌘S presses before a re-render
		// must not both POST (pageId === 'new' would create duplicate pages with the same path).
		if (savingRef.current) return;
		savingRef.current = true;
		setSaving(true);
		setError(null);
		try {
			// Optimistic concurrency: if the server's copy changed since we loaded it, confirm the overwrite.
			if (pageId !== 'new') {
				const server = await getPage(token, pageId).catch(() => null);
				if (
					server &&
					loadedUpdatedAt &&
					server.updatedAt !== loadedUpdatedAt &&
					!(await confirmDialog({
						title: 'Overwrite changes?',
						description: 'This page was modified by someone else since you opened it. Overwrite their changes?',
						confirmLabel: 'Overwrite',
						destructive: true,
					}))
				) {
					return;
				}
			}
			// Page metadata (schema versioning + template) and per-view configs serialize as invisible blocks at the start.
			const metaBlock: PageBlock = {
				id: '_meta',
				type: '_meta',
				layout: { order: -2 },
				config: { schema_version: PAGE_SCHEMA_VERSION, template },
			};
			const viewBlocks: PageBlock[] = Object.entries(viewConfigs).map(([view, cfg]) => ({
				id: `_vc_${view}`,
				type: '_view_config',
				layout: { order: -1 },
				config: { view, ...cfg } as unknown as Record<string, unknown>,
			}));
			const payload = [metaBlock, ...viewBlocks, ...orderBlocks(blocks, 0)];
			if (pageId === 'new') {
				const cleanPath = path.trim() || 'untitled';
				// Idempotency: if a page with the same path already exists, update it instead of duplicating.
				const existing = pages.find((p) => p.path === cleanPath);
				if (existing) {
					const updated = await updatePage(token, existing.id, {
						title: title.trim() || 'Untitled page',
						blocks: payload,
						// Pages are always live — the builder no longer has publish/unpublish.
						is_published: true,
					});
					setPageId(existing.id);
					setLoadedUpdatedAt(updated.updatedAt);
					onPageOpen?.(existing.id);
				} else {
					const created = await savePage(token, {
						path: cleanPath,
						title: title.trim() || 'Untitled page',
						module_slug: moduleSlug,
						blocks: payload,
						is_published: true,
					});
					setPageId(created.id);
					setLoadedUpdatedAt(created.updatedAt);
					onPageOpen?.(created.id);
				}
			} else {
				const updated = await updatePage(token, pageId, {
					title: title.trim() || 'Untitled page',
					blocks: payload,
					is_published: true,
				});
				setLoadedUpdatedAt(updated.updatedAt);
			}
			setSavedVersion((v) => v + 1);
			// Mirror the designer's view configs onto the focused collections' schema_json
			// (list/card/kanban/pivot_view) so the admin collection list — a separate route
			// from this page — renders the exact designed view. Each write is non-fatal.
			for (const { configKey, schemaKey, requireFocus } of VIEW_MIRRORS) {
				const vc = viewConfigs[configKey] ?? {};
				// The table view only mirrors when it owns the focused collection — a manual
				// collection override in the inspector clears focusCollection on purpose.
				if (requireFocus && !(vc.collection && focusCollection === vc.collection)) continue;
				let config = vc[configKey];
				if (!vc.collection || !config) continue;
				// Guarantee a curated field list for the card — a card saved without `fields`
				// would dump every schema field on the runtime card. Seed from the schema
				// when the designer never curated one.
				if (configKey === 'card') {
					const card = { ...(config as CardViewConfig) };
					if (card.fields === undefined) {
						const schema = schemas[vc.collection] ?? null;
						const userFields = (schema?.schema_json.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
						card.fields = userFields.slice(0, DEFAULT_CARD_FIELDS).map((f) => ({ name: f.name, visible: true }));
					}
					config = card as typeof config;
				}
				try {
					await patchCollectionViews(token, vc.collection, { [schemaKey]: config } as Parameters<typeof patchCollectionViews>[2]);
				} catch {
					/* non-fatal: page still saved */
				}
			}
			onSaved();
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Save failed');
		} finally {
			savingRef.current = false;
			setSaving(false);
		}
	}, [
		pageId,
		token,
		loadedUpdatedAt,
		pages,
		path,
		title,
		moduleSlug,
		blocks,
		viewConfigs,
		template,
		focusCollection,
		schemas,
		onSaved,
		onPageOpen,
	]);

	// Global shortcuts — Save, undo/redo, duplicate, copy/paste, delete.
	// Declared after save() so the deps can reference the stable callbacks.
	// The nested form-layout provider registers its window listener first (child
	// effects run before parents) and preventDefaults ⌘S + ⌘Z/⌘Y — skip anything
	// it already handled so undo/redo/save target the form, not the page.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey;
			// Save — allowed even while an input is focused (this SPA owns Ctrl/Cmd+S).
			if (mod && (e.key === 's' || e.key === 'S')) {
				if (e.defaultPrevented) return;
				e.preventDefault();
				void save();
				return;
			}
			const t = e.target as HTMLElement | null;
			if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
			if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
				if (e.defaultPrevented) return;
				e.preventDefault();
				if (e.key === 'y' || e.key === 'Y' || e.shiftKey) redo();
				else undo();
				return;
			}
			if (mod && e.key === 'd') {
				if (e.defaultPrevented) return; // layer panel already handled it
				e.preventDefault();
				if (selected) duplicateBlock(selected);
				return;
			}
			if (mod && e.key === 'c') {
				e.preventDefault();
				if (selected) copyBlock(selected);
				return;
			}
			if (mod && e.key === 'v') {
				e.preventDefault();
				pasteBlock();
				return;
			}
			if ((e.key === 'Delete' || e.key === 'Backspace') && !mod && !e.altKey) {
				// The form-layout canvas / field chips handle Delete themselves — don't double-delete.
				if (e.defaultPrevented) return;
				// In the embedded form view, Delete belongs to the form — never the page.
				if (document.querySelector('[data-form-layout]')) return;
				if (selected) {
					e.preventDefault();
					removeBlock(selected);
				}
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [save, undo, redo, duplicateBlock, copyBlock, pasteBlock, removeBlock, selected]);

	const value = useMemo<BuilderCtx>(
		() => ({
			token,
			moduleSlug,
			pages,
			collections,
			pageId,
			canvasMode,
			setCanvasMode,
			focusCollection,
			setFocusCollection,
			tableColSel,
			setTableColSel,
			template,
			pickTemplate,
			setActiveMenuId,
			selectPage,
			title,
			setTitle,
			path,
			setPath,
			blocks,
			selected,
			setSelected,
			addBlock,
			addBlockInto,
			addBlockAt,
			importBlocks,
			replaceBlocks,
			customBlocks,
			removeBlocks,
			addComponent,
			addEntityList,
			openTarget,
			updateConfig,
			updateLayout,
			move,
			moveBlockTo,
			moveBlockToRoot,
			removeBlock,
			duplicateBlock,
			renameBlock,
			groupBlocks,
			ungroupBlock,
			insertWidget,
			copyBlock,
			pasteBlock,
			clipboard,
			canUndo,
			canRedo,
			undo,
			redo,
			saving,
			error,
			savedVersion,
			loadedVersion,
			save,
			selectedBlock,
			viewConfigs,
			setViewConfig,
			schemas,
			fetchSchema,
			dirty,
		}),
		[
			token,
			moduleSlug,
			pages,
			collections,
			pageId,
			canvasMode,
			setCanvasMode,
			focusCollection,
			setFocusCollection,
			tableColSel,
			setTableColSel,
			template,
			pickTemplate,
			setActiveMenuId,
			selectPage,
			title,
			setTitle,
			path,
			setPath,
			blocks,
			selected,
			setSelected,
			addBlock,
			addBlockInto,
			addBlockAt,
			importBlocks,
			replaceBlocks,
			customBlocks,
			removeBlocks,
			addComponent,
			addEntityList,
			openTarget,
			updateConfig,
			updateLayout,
			move,
			moveBlockTo,
			moveBlockToRoot,
			removeBlock,
			duplicateBlock,
			renameBlock,
			groupBlocks,
			ungroupBlock,
			insertWidget,
			copyBlock,
			pasteBlock,
			clipboard,
			canUndo,
			canRedo,
			undo,
			redo,
			saving,
			error,
			savedVersion,
			loadedVersion,
			save,
			selectedBlock,
			viewConfigs,
			setViewConfig,
			schemas,
			fetchSchema,
			dirty,
		],
	);

	return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Builder left column — the app's navigation menu. Link items open their target in the builder. */
export function BuilderMenu({ tree }: { tree: MenuNode[] }) {
	const {
		openTarget,
		collections,
		setFocusCollection,
		setViewConfig,
		dirty,
		pageId,
		pages,
		pickTemplate,
		setCanvasMode,
		setActiveMenuId,
		template,
	} = useBuilder();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// Template chosen per menu item in this session — source of truth over the
	// (possibly stale) tree on re-click, so the last choice sticks until reload.
	const [menuTemplates, setMenuTemplates] = useState<Record<string, string | null>>({});
	const focusedMenuIdRef = useRef<string | null>(null);
	useEffect(() => {
		const id = focusedMenuIdRef.current;
		if (id) setMenuTemplates((prev) => (prev[id] === template ? prev : { ...prev, [id]: template }));
	}, [template]);
	// First descendant (depth-first) that points at a collection — lets a folder click
	// bind its collection in ONE click instead of folder-then-leaf.
	const firstCollectionChild = (n: MenuNode): MenuNode | null => {
		for (const c of n.children ?? []) {
			const slug = (c.target ?? '').replace(/^\//, '').split('/').filter(Boolean).pop() ?? '';
			if (c.type === 'link' && slug && collections.some((x) => x.slug === slug)) return c;
			const deeper = firstCollectionChild(c);
			if (deeper) return deeper;
		}
		return null;
	};
	// Default workspace blocks for a group: a section header + one empty links-card.
	// Children are already in the nav drawer — the admin fills the card with their
	// own links (collections, pages, reports — Frappe workspace style).
	const workspaceSeed = (node: MenuNode): PageBlock[] => [
		{ id: crypto.randomUUID(), type: 'section-header', label: 'Section Header', layout: { order: 0 }, config: { text: node.label } },
		{ id: crypto.randomUUID(), type: 'links-card', label: 'Links', layout: { order: 1 }, config: { title: 'Links', links: [] } },
	];
	return (
		<MenuPreview
			tree={tree}
			selectedId={selectedId}
			onSelect={async (id) => {
				setSelectedId(id);
				const walk = (list: MenuNode[]): MenuNode | null => {
					for (const n of list) {
						if (n.id === id) return n;
						const c = walk(n.children);
						if (c) return c;
					}
					return null;
				};
				const node = walk(tree);
				if (!node) return;
				// Workspace group (has its own target) → open its work-card page in the
				// middle column so the admin can design what the frontend shows.
				if (node.type === 'group' && node.target && node.target !== '#') {
					setFocusCollection(null);
					const wsTarget = node.target;
					const alreadyOpen = pages.find((p) => p.path === wsTarget.replace(/^\//, ''))?.id === pageId;
					if (alreadyOpen) return;
					if (
						dirty &&
						!(await confirmDialog({
							title: 'Discard changes?',
							description: 'You have unsaved changes on this page. Discard them and open the selected item?',
							confirmLabel: 'Discard',
							destructive: true,
						}))
					)
						return;
					// Workspaces are block pages — the menu template doesn't apply; drop the focus.
					setActiveMenuId(null);
					openTarget(node.label, wsTarget, workspaceSeed(node));
					// Switch the canvas to the Page Blocks editor.
					pickTemplate('layout');
					setCanvasMode('layout');
					return;
				}
				// Group folders have no target of their own — bind their first collection child instead.
				const targetNode = node.type === 'group' && !node.target ? firstCollectionChild(node) : node;
				if (!targetNode?.target) return;
				// Per-menu template: focus the menu item so canvas template changes persist
				// to it, and remember which template it currently uses (menu > stale tree).
				const applied = targetNode.type === 'link' ? (menuTemplates[targetNode.id] ?? targetNode.template ?? null) : null;
				const focusMenu = (id: string | null, tpl: string | null) => {
					focusedMenuIdRef.current = id;
					setActiveMenuId(id, tpl ?? undefined);
				};
				const cleanTarget = targetNode.target.replace(/^\//, '').replace(/[^a-z0-9-_/]/g, '');
				const open = pages.find((p) => p.path === cleanTarget);
				const isAlreadyOpen = !!open && open.id === pageId;
				// Entity-list targets (/module/collection) bind a collection and switch the canvas to its table view.
				// Run even when the page is already open so re-clicking fixes stale view-config bindings.
				const slug = cleanTarget.split('/').filter(Boolean).pop();
				if (slug && collections.some((c) => c.slug === slug)) {
					// Seed per-view collections from the menu target first (corrects stale view configs),
					// then set the focus collection LAST so it wins the data-context resolution.
					setViewConfig('table', { collection: slug });
					setViewConfig('form', { collection: slug });
					setViewConfig('card', { collection: slug });
					setViewConfig('pivot', { collection: slug });
					setFocusCollection(slug);
				} else {
					setFocusCollection(null);
				}
				// Re-clicking the already-open item keeps the draft (no reload) — but still
				// focus the menu so subsequent template changes persist to it.
				if (isAlreadyOpen) {
					focusMenu(targetNode.type === 'link' ? targetNode.id : null, applied);
					return;
				}
				// Unsaved-changes guard: switching to another menu item discards the draft — confirm first.
				if (
					dirty &&
					!(await confirmDialog({
						title: 'Discard changes?',
						description: 'You have unsaved changes on this page. Discard them and open the selected item?',
						confirmLabel: 'Discard',
						destructive: true,
					}))
				)
					return;
				focusMenu(targetNode.type === 'link' ? targetNode.id : null, applied);
				openTarget(targetNode.label, targetNode.target);
				// Apply the menu item's own template — its views define what the canvas shows.
				if (applied && applied !== template) pickTemplate(applied);
			}}
		/>
	);
}

export { PageCanvas, useDataCollection, useFormLayoutActive } from './PageCanvas';

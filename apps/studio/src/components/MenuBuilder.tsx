import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	pointerWithin,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
	Alert,
	AlertDescription,
	Button,
	Dialog,
	DialogContent,
	Input,
	Label,
	NativeSelect,
	NativeSelectOption,
} from '@mmbix/design-system';
import { ChevronRight, ChevronDown, Plus, Trash2, GripVertical, FolderOpen, Link2, ArrowUp, ArrowDown, Undo2, Redo2 } from 'lucide-react';
import { createMenu, deleteMenu, updateMenu, type MenuNode } from '../lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { menusQuery } from '../lib/queries';
import { qk } from '../lib/query-keys';
import MenuIcon from './MenuIcon';

/* ── Local tree model with parent links for moves ─── */

export interface Node {
	id: string;
	label: string;
	label_my?: string | null;
	type: string;
	target?: string | null;
	icon?: string | null;
	/** Role names allowed to see this item (null/empty = everyone). */
	roles?: string[] | null;
	/** Per-menu designer template (e.g. 'table-card-form') — NULL = not set. */
	template?: string | null;
	parentId: string | null;
	children: Node[];
}

function toTree(nodes: MenuNode[], parentId: string | null): Node[] {
	return nodes.map((n) => ({
		id: n.id,
		label: n.label,
		label_my: n.label_my,
		type: n.type,
		target: n.target,
		icon: n.icon,
		roles: n.roles,
		template: n.template,
		parentId,
		children: toTree(n.children ?? [], n.id),
	}));
}

/** `Node[]` (with parent links) → the API shape `menusQuery` caches. Used to write
 *  the tree we just persisted straight back into the shared cache — no refetch. */
function fromTree(nodes: Node[]): MenuNode[] {
	return nodes.map((n) => ({
		id: n.id,
		label: n.label,
		label_my: n.label_my ?? null,
		type: n.type,
		target: n.target ?? null,
		icon: n.icon ?? null,
		roles: n.roles ?? null,
		template: n.template ?? null,
		children: fromTree(n.children),
	}));
}

/**
 * Icon per collection slug — an OPTIONAL override map. A headless factory ships
 * it EMPTY: every collection falls back to a generic folder glyph, and any lucide
 * name works because MenuIcon falls back to the CDN glyph for names not in the
 * local APP_ICONS map. Add entries here (or a project-local copy) to give
 * specific slugs their own icon.
 */
const COLLECTION_ICONS: Record<string, string> = {};

/**
 * Build a default menu tree from a module's attached collections — used when the
 * module has no designed menus yet, so the menu editor/preview aren't empty.
 * Items are synthetic (id prefixed `collection:`) until the user saves one.
 */
export function defaultMenuTree(collections: Array<{ slug: string; name: string }>, moduleSlug: string): Node[] {
	return collections.map((c) => ({
		id: `collection:${c.slug}`,
		label: c.name,
		label_my: null,
		type: 'link',
		target: `/${moduleSlug}/${c.slug}`,
		icon: COLLECTION_ICONS[c.slug] ?? 'folder-open',
		roles: null,
		template: null,
		parentId: null,
		children: [],
	}));
}

/** Flatten tree → id → { parentId, order } used to persist moves (order is per level). */
function flatten(
	nodes: Node[],
	out = new Map<string, { parentId: string | null; order: number }>(),
): Map<string, { parentId: string | null; order: number }> {
	nodes.forEach((n, i) => {
		out.set(n.id, { parentId: n.parentId, order: i });
		flatten(n.children, out);
	});
	return out;
}

/* ── Shared add/edit form ─────────────────────────── */

function MenuForm({
	initial,
	submitLabel,
	onSubmit,
	onCancel,
}: {
	initial: { label: string; type: string; target: string };
	submitLabel: string;
	onSubmit: (v: { label: string; type: string; target?: string }) => void;
	onCancel: () => void;
}) {
	const [label, setLabel] = useState(initial.label);
	const [type, setType] = useState<'link' | 'group'>(initial.type === 'group' ? 'group' : 'link');
	const [target, setTarget] = useState(initial.target);

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (!label.trim()) return;
				onSubmit({ label: label.trim(), type, target: type === 'link' ? target.trim() || undefined : target.trim() || undefined });
			}}
			style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 260 }}
		>
			<div>
				<Label>Label</Label>
				<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Menu label" autoFocus required />
			</div>
			<div>
				<Label>Type</Label>
				<NativeSelect value={type} onChange={(e) => setType(e.target.value as 'link' | 'group')} style={{ width: '100%' }}>
					<NativeSelectOption value="group">Group (folder)</NativeSelectOption>
					<NativeSelectOption value="link">Link (menu item)</NativeSelectOption>
				</NativeSelect>
			</div>
			{type === 'link' && (
				<div>
					<Label>Target</Label>
					<Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="/sales/orders" />
				</div>
			)}
			{type === 'group' && (
				<div>
					<Label>Workspace page (optional)</Label>
					<Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="payroll — opens a work card instead of a folder" />
					<p style={{ margin: '0.2rem 0 0', fontSize: '0.68rem', color: '#9ca3af' }}>
						With a path set, this group becomes a Frappe-style workspace: clicking it opens the page you design in the builder.
					</p>
				</div>
			)}
			<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 2 }}>
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" size="sm">
					{submitLabel}
				</Button>
			</div>
		</form>
	);
}

/* ── Sortable menu card ───────────────────────────── */

function MenuCard({
	node,
	depth,
	selectedId,
	selected,
	onSelect,
	onAddChild,
	onDelete,
	onMove,
}: {
	node: Node;
	depth: number;
	selectedId: string | null;
	selected: boolean;
	onSelect: (node: Node) => void;
	onAddChild: (node: Node) => void;
	onDelete: (node: Node) => void;
	onMove: (id: string, dir: -1 | 1) => void;
}) {
	const [open, setOpen] = useState(true);
	const [hover, setHover] = useState(false);
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id: node.id,
		data: { type: 'menu', node },
	});
	const isGroup = node.type === 'group';

	return (
		<div
			ref={setNodeRef}
			style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1, position: 'relative' }}
		>
			<div
				onClick={() => onSelect(node)}
				onMouseEnter={() => setHover(true)}
				onMouseLeave={() => setHover(false)}
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 6,
					padding: '0.45rem 0.55rem',
					borderRadius: 8,
					cursor: isDragging ? 'grabbing' : 'pointer',
					border: `1px solid ${selected ? 'var(--mmbix-primary, #0f766e)' : isDragging ? 'var(--mmbix-primary, #0f766e)' : 'var(--mmbix-border, #e5e7eb)'}`,
					background: selected ? 'var(--mmbix-muted, #f0fdfa)' : isDragging ? 'var(--mmbix-muted, #f0fdfa)' : 'var(--mmbix-card, #ffffff)',
					boxShadow: selected ? '0 0 0 1px rgba(15, 118, 110, 0.15)' : isDragging ? '0 6px 16px rgba(0,0,0,0.12)' : 'none',
				}}
			>
				{isGroup ? (
					<button
						type="button"
						onClick={() => setOpen(!open)}
						style={{ display: 'flex', border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: '#6b7280' }}
					>
						{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					</button>
				) : (
					<span style={{ width: 13 }} />
				)}
				<span
					{...attributes}
					{...listeners}
					title="Drag to reorder"
					style={{ display: 'inline-flex', cursor: 'grab', color: '#9ca3af', touchAction: 'none' }}
				>
					<GripVertical size={13} />
				</span>
				<MenuIcon
					name={node.icon}
					type={node.type}
					size={14}
					style={{ color: isGroup ? '#f59e0b' : 'var(--mmbix-muted-foreground, #6b7280)', flexShrink: 0 }}
				/>
				<span
					style={{
						flex: 1,
						minWidth: 0,
						fontSize: '0.82rem',
						fontWeight: isGroup ? 600 : 400,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
					}}
				>
					{node.label}
				</span>
				{node.target && (
					<span
						style={{
							fontSize: '0.68rem',
							color: '#9ca3af',
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							maxWidth: 90,
						}}
					>
						{node.target}
					</span>
				)}
				<span
					style={{
						display: 'inline-flex',
						gap: 1,
						flexShrink: 0,
						opacity: hover && !isDragging ? 1 : 0,
						transition: 'opacity 0.15s',
						pointerEvents: hover && !isDragging ? 'auto' : 'none',
					}}
				>
					<Button variant="ghost" size="icon-xs" title="Move up" onClick={() => onMove(node.id, -1)}>
						<ArrowUp size={11} />
					</Button>
					<Button variant="ghost" size="icon-xs" title="Move down" onClick={() => onMove(node.id, 1)}>
						<ArrowDown size={11} />
					</Button>
					{isGroup && (
						<Button variant="ghost" size="icon-xs" title="Add child" onClick={() => onAddChild(node)}>
							<Plus size={11} />
						</Button>
					)}
					<Button variant="ghost" size="icon-xs" title="Delete" style={{ color: '#dc2626' }} onClick={() => onDelete(node)}>
						<Trash2 size={11} />
					</Button>
				</span>
			</div>
			{isGroup && open && node.children.length > 0 && (
				<div style={{ paddingLeft: 14, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
					<MenuCardList
						nodes={node.children}
						depth={depth + 1}
						selectedId={selectedId}
						onSelect={onSelect}
						onAddChild={onAddChild}
						onDelete={onDelete}
						onMove={onMove}
					/>
				</div>
			)}
		</div>
	);
}

function MenuCardList({
	nodes,
	depth,
	selectedId,
	onSelect,
	onAddChild,
	onDelete,
	onMove,
}: {
	nodes: Node[];
	depth: number;
	selectedId: string | null;
	onSelect: (node: Node) => void;
	onAddChild: (node: Node) => void;
	onDelete: (node: Node) => void;
	onMove: (id: string, dir: -1 | 1) => void;
}) {
	return (
		<SortableContext items={nodes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
			{nodes.map((n) => (
				<MenuCard
					key={n.id}
					node={n}
					depth={depth}
					selectedId={selectedId}
					selected={selectedId === n.id}
					onSelect={onSelect}
					onAddChild={onAddChild}
					onDelete={onDelete}
					onMove={onMove}
				/>
			))}
		</SortableContext>
	);
}

/* ── Editor popover host ──────────────────────────── */

export default function MenuBuilder({
	token,
	slug,
	collections,
	selectedId,
	onSelect,
	onTreeChange,
	reloadKey,
}: {
	token: string;
	slug: string;
	collections?: Array<{ slug: string; name: string }>;
	selectedId?: string | null;
	onSelect?: (node: Node) => void;
	onTreeChange?: (nodes: Node[]) => void;
	reloadKey?: number;
}) {
	const queryClient = useQueryClient();
	// The tree as it currently exists on the SERVER — the diff baseline for persist.
	// Keeping it in a ref means a reorder never needs a network read to compute the
	// (parent_id, sort_order) deltas (it used to re-fetch the whole tree twice per drag).
	const serverTreeRef = useRef<Node[]>([]);
	const [tree, setTree] = useState<Node[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [editor, setEditor] = useState<{ mode: 'add-root' | 'add-child' | 'edit' | 'delete'; node?: Node } | null>(null);
	const [dragId, setDragId] = useState<string | null>(null);
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

	/* ── Undo/redo — snapshot the tree before each reorder so drag/arrow moves are reversible.
	 *     The restored order is persisted (PUT parent_id/sort_order) like any other move. ── */
	const treeRef = useRef<Node[]>([]);
	useEffect(() => {
		treeRef.current = tree;
	}, [tree]);
	const pastRef = useRef<Node[][]>([]);
	const futureRef = useRef<Node[][]>([]);
	const [, setHistVersion] = useState(0);
	const snapshot = () => JSON.parse(JSON.stringify(treeRef.current)) as Node[];
	function pushHistory() {
		pastRef.current.push(snapshot());
		if (pastRef.current.length > 40) pastRef.current.shift();
		futureRef.current = [];
		setHistVersion((v) => v + 1);
	}
	const canUndo = pastRef.current.length > 0;
	const canRedo = futureRef.current.length > 0;
	function undo() {
		const prev = pastRef.current.pop();
		if (!prev) return;
		futureRef.current.push(snapshot());
		setTree(prev);
		onTreeChange?.(prev);
		void persist(prev);
		setHistVersion((v) => v + 1);
	}
	function redo() {
		const next = futureRef.current.pop();
		if (!next) return;
		pastRef.current.push(snapshot());
		setTree(next);
		onTreeChange?.(next);
		void persist(next);
		setHistVersion((v) => v + 1);
	}
	// ⌘Z/⌘Y — this pane is inside the page-builder provider, whose window listener
	// runs after this one (child effects first) and respects defaultPrevented.
	// The listener registers ONCE — undo/redo are read through refs so the handler
	// always sees the latest functions without re-registering on every render.
	const undoRef = useRef(undo);
	const redoRef = useRef(redo);
	useEffect(() => {
		undoRef.current = undo;
		redoRef.current = redo;
	});
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
			const mod = e.ctrlKey || e.metaKey;
			if (mod && (e.key === 'z' || e.key === 'Z')) {
				e.preventDefault();
				if (e.shiftKey) redoRef.current();
				else undoRef.current();
			} else if (mod && (e.key === 'y' || e.key === 'Y')) {
				e.preventDefault();
				redoRef.current();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	const refresh = useCallback(
		async (force = false) => {
			try {
				setError(null);
				// Read through the shared `qk.menus(slug)` cache — the App workbench already
				// observes the SAME key, so the first load costs one request total, not two.
				// `force` is for paths where the server just changed under us (a create /
				// edit / delete, or the inspector's save) and the cache may be stale.
				const base = menusQuery(token, slug);
				const raw = await queryClient.fetchQuery(force ? { ...base, staleTime: 0 } : base);
				const t = toTree(raw, null);
				serverTreeRef.current = t; // the new diff baseline
				// No menus designed yet → derive a default tree from the module's collections
				// so the editor isn't empty (matches the left preview's fallback).
				const tree = t.length > 0 ? t : defaultMenuTree(collections ?? [], slug);
				setTree(tree);
				onTreeChange?.(tree);
			} catch (e) {
				setError(e instanceof Error ? e.message : 'Failed to load menus');
			} finally {
				setLoading(false);
			}
		},
		[token, slug, collections, onTreeChange, queryClient],
	);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// The inspector saved a menu directly (its own request) and bumped `reloadKey` —
	// re-read server truth, since the shared cache no longer reflects it.
	const reloadKeyRef = useRef(reloadKey);
	useEffect(() => {
		if (reloadKeyRef.current === reloadKey) return;
		reloadKeyRef.current = reloadKey;
		void refresh(true);
	}, [reloadKey, refresh]);

	const nodes = useMemo(() => {
		const map = new Map<string, Node>();
		const walk = (list: Node[]) => {
			for (const n of list) {
				map.set(n.id, n);
				walk(n.children);
			}
		};
		walk(tree);
		return map;
	}, [tree]);

	/** Persist every (parent_id, sort_order) that changed vs the server tree. */
	async function persist(t: Node[]) {
		const current = flatten(t);
		// Diff against the last known server tree — no network read (it used to fetch the
		// whole menu tree here, and again in refresh, on EVERY drag / arrow / undo).
		const prev = flatten(serverTreeRef.current);
		const changed: Array<{ id: string; parentId: string | null; order: number }> = [];
		for (const [id, v] of current) {
			const old = prev.get(id);
			if (!old || old.parentId !== v.parentId || old.order !== v.order) changed.push({ id, parentId: v.parentId, order: v.order });
		}
		if (changed.length === 0) return;
		await Promise.all(changed.map((c) => updateMenu(token, c.id, { parent_id: c.parentId, sort_order: c.order })));
		// The server now matches the draft — write it back to the shared cache (free)
		// instead of refetching the tree we just wrote. Other readers stay in sync.
		serverTreeRef.current = t;
		queryClient.setQueryData(qk.menus(slug), fromTree(t));
	}

	function moveNode(id: string, newParentId: string | null, newIndex: number) {
		const node = nodes.get(id);
		if (!node) return;
		// Prevent dropping a folder into its own subtree
		if (newParentId) {
			let anc: Node | undefined = nodes.get(newParentId);
			while (anc) {
				if (anc.id === id) return;
				anc = anc.parentId ? nodes.get(anc.parentId) : undefined;
			}
		}
		pushHistory();
		// Remove from current parent
		const remove = (list: Node[]): Node[] => list.filter((n) => n.id !== id).map((n) => ({ ...n, children: remove(n.children) }));
		const stripped = remove(tree);
		// Insert into new parent at index
		const insert = (list: Node[], pid: string | null, idx: number): Node[] => {
			if (pid === null) {
				const next = [...list];
				next.splice(Math.min(idx, next.length), 0, { ...node, parentId: null, children: node.children });
				return next;
			}
			return list.map((n) =>
				n.id === pid
					? {
							...n,
							children: (() => {
								const c = [...n.children];
								c.splice(Math.min(idx, c.length), 0, { ...node, parentId: pid, children: node.children });
								return c;
							})(),
						}
					: { ...n, children: insert(n.children, pid, idx) },
			);
		};
		const nextTree = insert(stripped, newParentId, newIndex);
		setTree(nextTree);
		onTreeChange?.(nextTree);
		void persist(nextTree);
	}

	function onDragEnd(e: DragEndEvent) {
		const { active, over } = e;
		setDragId(null);
		if (!over || active.id === over.id) return;
		const a = nodes.get(String(active.id));
		const b = nodes.get(String(over.id));
		if (!a || !b) return;
		if (b.type === 'group') {
			moveNode(a.id, b.id, b.children.length); // drop onto a folder → nest at its end
		} else {
			const parentId = b.parentId;
			const siblings = parentId ? (nodes.get(parentId)?.children ?? []) : tree;
			const at = siblings.findIndex((n) => n.id === b.id);
			moveNode(a.id, parentId, at >= 0 ? at : siblings.length);
		}
	}

	async function onMove(id: string, dir: -1 | 1) {
		const node = nodes.get(id);
		if (!node) return;
		const siblings = node.parentId ? (nodes.get(node.parentId)?.children ?? []) : tree;
		const idx = siblings.findIndex((n) => n.id === id);
		const t = idx + dir;
		if (idx < 0 || t < 0 || t >= siblings.length) return;
		moveNode(id, node.parentId, t);
	}

	async function onEditSubmit(v: { label: string; type: string; target?: string }) {
		if (!editor?.node) return;
		await updateMenu(token, editor.node.id, v);
		setEditor(null);
		await refresh(true); // fields changed — the cached copy is stale
	}
	async function onAddSubmit(v: { label: string; type: string; target?: string }) {
		const parentId = editor?.mode === 'add-child' && editor.node ? editor.node.id : null;
		await createMenu(token, slug, { parent_id: parentId, label: v.label, type: v.type, target: v.target });
		setEditor(null);
		await refresh(true); // a new row exists — re-read to get its id + position
	}
	async function onDeleteConfirm() {
		if (!editor?.node) return;
		await deleteMenu(token, editor.node.id);
		setEditor(null);
		await refresh(true); // a row is gone — re-read
	}

	const draggingNode = dragId ? nodes.get(dragId) : undefined;
	const DragIcon = draggingNode ? (draggingNode.type === 'group' ? FolderOpen : Link2) : Link2;

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
				<span style={{ fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
					Drag cards to reorder; drop on a folder to nest.
				</span>
				<div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
					<Button size="icon-xs" variant="outline" onClick={undo} disabled={!canUndo} title="Undo move (⌘Z)">
						<Undo2 size={12} />
					</Button>
					<Button size="icon-xs" variant="outline" onClick={redo} disabled={!canRedo} title="Redo move (⌘Y)">
						<Redo2 size={12} />
					</Button>
					<Button size="xs" onClick={() => setEditor({ mode: 'add-root' })}>
						<Plus size={12} /> Add
					</Button>
				</div>
			</div>

			{error && (
				<Alert variant="destructive" style={{ marginBottom: 8 }}>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}
			{loading ? (
				<p style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading menus…</p>
			) : tree.length === 0 ? (
				<p style={{ fontSize: '0.78rem', color: '#9ca3af', textAlign: 'center', padding: '1rem' }}>No menu items yet — press Add.</p>
			) : (
				<DndContext
					sensors={sensors}
					collisionDetection={pointerWithin}
					onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
					onDragEnd={onDragEnd}
				>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
						<MenuCardList
							nodes={tree}
							depth={0}
							selectedId={selectedId ?? null}
							onSelect={(n) => onSelect?.(n)}
							onAddChild={(n) => setEditor({ mode: 'add-child', node: n })}
							onDelete={(n) => setEditor({ mode: 'delete', node: n })}
							onMove={onMove}
						/>
					</div>
					<DragOverlay>
						{draggingNode && (
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 8,
									padding: '0.45rem 0.7rem',
									borderRadius: 8,
									background: 'var(--mmbix-accent, #f0fdfa)',
									border: '1px solid var(--mmbix-primary, #0f766e)',
									fontSize: '0.82rem',
									fontWeight: 600,
									boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
								}}
							>
								<DragIcon size={14} /> {draggingNode.label}
							</div>
						)}
					</DragOverlay>
				</DndContext>
			)}

			{/* Shared editor dialog */}
			<Dialog
				open={editor !== null && editor.mode !== 'delete'}
				onOpenChange={(o) => {
					if (!o) setEditor(null);
				}}
			>
				<DialogContent>
					{editor?.mode === 'edit' && editor.node && (
						<MenuForm
							initial={{ label: editor.node.label, type: editor.node.type, target: editor.node.target ?? '' }}
							submitLabel="Save"
							onSubmit={onEditSubmit}
							onCancel={() => setEditor(null)}
						/>
					)}
					{(editor?.mode === 'add-root' || editor?.mode === 'add-child') && (
						<MenuForm
							initial={{ label: '', type: 'link', target: '' }}
							submitLabel="Add"
							onSubmit={onAddSubmit}
							onCancel={() => setEditor(null)}
						/>
					)}
				</DialogContent>
			</Dialog>

			{/* Delete confirm dialog */}
			<Dialog
				open={editor?.mode === 'delete'}
				onOpenChange={(o) => {
					if (!o) setEditor(null);
				}}
			>
				<DialogContent>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
						<p style={{ margin: 0, fontSize: '0.9rem' }}>
							Delete <strong>“{editor?.node?.label}”</strong>?{editor?.node?.type === 'group' ? ' Children are removed too.' : ''}
						</p>
						<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
							<Button variant="ghost" size="sm" onClick={() => setEditor(null)}>
								Cancel
							</Button>
							<Button variant="destructive" size="sm" onClick={onDeleteConfirm}>
								Delete
							</Button>
						</div>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

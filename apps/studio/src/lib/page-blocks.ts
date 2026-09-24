import { isContainerType } from '@mmbix/ui-views';
import type { PageBlock } from './api';

/**
 * Pure block-tree operations for the page builder. Blocks live in a tree:
 * containers (row/column/tabs/accordion) hold children. Every function maps a
 * `PageBlock[]` to a new `PageBlock[]` (immutable) — pure and unit-testable.
 */

/** True when a block can hold children. */
export function isContainer(b: PageBlock | null | undefined): boolean {
	return !!b && isContainerType(b.type);
}

/** Insert a new block — into the selected container when it is one, else at the root. */
export function insertBlock(list: PageBlock[], b: PageBlock, selected: string | null): PageBlock[] {
	if (!selected) return [...list, b];
	let inserted = false;
	const next = list.map((item) => {
		if (item.id === selected && isContainer(item)) {
			inserted = true;
			return { ...item, children: [...(item.children ?? []), b] };
		}
		if (item.children?.length) {
			const nested = insertBlock(item.children, b, selected);
			if (nested !== item.children) {
				inserted = true;
				return { ...item, children: nested };
			}
		}
		return item;
	});
	return inserted ? next : [...list, b];
}

/** Insert `b` into the container with `containerId` at any depth; root when null. */
export function insertIntoRec(list: PageBlock[], containerId: string | null, b: PageBlock): PageBlock[] {
	if (!containerId) return [...list, b];
	let inserted = false;
	const next = list.map((item) => {
		if (item.id === containerId && isContainer(item)) {
			inserted = true;
			return { ...item, children: [...(item.children ?? []), b] };
		}
		if (item.children?.length) {
			const nested = insertIntoRec(item.children, containerId, b);
			if (nested !== item.children) {
				inserted = true;
				return { ...item, children: nested };
			}
		}
		return item;
	});
	return inserted ? next : [...list, b];
}

/** Insert `b` relative to a target — before/after as sibling, or inside a container. */
export function insertRelativeRec(list: PageBlock[], targetId: string, position: 'before' | 'after' | 'inside', b: PageBlock): PageBlock[] {
	if (position === 'inside') return insertIntoRec(list, targetId, b);
	const idx = list.findIndex((x) => x.id === targetId);
	if (idx >= 0) {
		const next = [...list];
		next.splice(idx + (position === 'after' ? 1 : 0), 0, b);
		return next;
	}
	return list.map((item) =>
		item.children?.length ? { ...item, children: insertRelativeRec(item.children, targetId, position, b) } : item,
	);
}

/** Recursively remove a block by id (from any depth). */
export function removeBlockRec(list: PageBlock[], id: string): PageBlock[] {
	return list.filter((b) => b.id !== id).map((b) => (b.children?.length ? { ...b, children: removeBlockRec(b.children, id) } : b));
}

/** Recursively map a block subtree; `patch` applies at the matching id. */
export function updateBlockRec(list: PageBlock[], id: string, patch: (b: PageBlock) => PageBlock): PageBlock[] {
	return list.map((b) => {
		if (b.id === id) return patch(b);
		return b.children?.length ? { ...b, children: updateBlockRec(b.children, id, patch) } : b;
	});
}

/** Assign stable `layout.order` values to every node, depth-first (persisted payload). */
export function orderBlocks(list: PageBlock[], start: number): PageBlock[] {
	let i = start;
	return list.map((b) => {
		const ordered: PageBlock = { ...b, layout: { ...b.layout, order: i++ } };
		if (ordered.children?.length) ordered.children = orderBlocks(ordered.children, 0);
		return ordered;
	});
}

/** Find a block by id at any depth. */
export function findBlock(list: PageBlock[], id: string): PageBlock | null {
	for (const b of list) {
		if (b.id === id) return b;
		const c = b.children?.length ? findBlock(b.children, id) : null;
		if (c) return c;
	}
	return null;
}

/** True when `id` is `parentId` itself or nested under it — used to guard container drag-moves
 *  from dropping a block onto its own subtree (which would delete the subtree). */
export function isSelfOrDescendant(list: PageBlock[], parentId: string, id: string): boolean {
	if (parentId === id) return true;
	const parent = findBlock(list, parentId);
	if (!parent?.children) return false;
	return parent.children.some((c) => isSelfOrDescendant([c], c.id, id));
}

/** Insert `b` immediately after the block with `id` in the same parent (duplicate target). */
export function insertAfterRec(list: PageBlock[], id: string, b: PageBlock): PageBlock[] {
	return list.flatMap((item) => {
		if (item.id === id) return [item, b];
		if (item.children?.length) {
			const children = insertAfterRec(item.children, id, b);
			return children === item.children ? [item] : [{ ...item, children }];
		}
		return [item];
	});
}

/** Move a block up/down within its parent — works at any depth. */
export function moveBlockRec(list: PageBlock[], id: string, dir: -1 | 1): PageBlock[] {
	const idx = list.findIndex((b) => b.id === id);
	if (idx >= 0) {
		const target = idx + dir;
		if (target < 0 || target >= list.length) return list;
		const next = [...list];
		[next[idx], next[target]] = [next[target], next[idx]];
		return next;
	}
	return list.map((b) => (b.children?.length ? { ...b, children: moveBlockRec(b.children, id, dir) } : b));
}

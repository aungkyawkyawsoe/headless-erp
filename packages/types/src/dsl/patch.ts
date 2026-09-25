/**
 * Structural patch ops — token-efficient, streaming-safe edits to a block tree.
 *
 * Instead of re-sending a whole page to change one node, a caller (or an LLM)
 * emits deltas. Applying them is a PURE function `(tree, ops) → tree`, O(ops)
 * in the number of operations (each op is one traversal), never O(tree). Ops
 * carry stable ids so a replay is idempotent: an `ADD` whose node already
 * exists is a no-op, and every op is deterministic (no `Date.now`/`Math.random`).
 */

/** A node in the page block tree (a metadata block, never code). */
export interface BlockNode {
	id: string;
	type: string;
	label?: string;
	layout?: { order?: number; colSpan?: number };
	config?: Record<string, unknown>;
	children?: BlockNode[];
}

export type PatchOp =
	| { id: string; op: 'ADD'; parent: string | null; index?: number; node: BlockNode }
	| { id: string; op: 'MOVE'; node: string; parent: string | null; index: number }
	| { id: string; op: 'REMOVE'; node: string }
	| { id: string; op: 'UPDATE'; node: string; config: Record<string, unknown> }
	| { id: string; op: 'BIND'; node: string; collection: string; field?: string }
	| { id: string; op: 'SPLIT'; node: string; into: 2 | 3; axis: 'row' | 'column' };

function cloneNode(n: BlockNode): BlockNode {
	return {
		...n,
		layout: n.layout ? { ...n.layout } : undefined,
		config: n.config ? { ...n.config } : undefined,
		children: n.children ? n.children.map(cloneNode) : undefined,
	};
}

function findNode(nodes: readonly BlockNode[], id: string): BlockNode | null {
	for (const n of nodes) {
		if (n.id === id) return n;
		if (n.children) {
			const found = findNode(n.children, id);
			if (found) return found;
		}
	}
	return null;
}

function insertAt(nodes: BlockNode[], parent: string | null, index: number | undefined, node: BlockNode): BlockNode[] {
	if (parent === null) {
		const out = nodes.slice();
		const i = index === undefined || index < 0 || index > out.length ? out.length : index;
		out.splice(i, 0, node);
		return out;
	}
	return nodes.map((n) => {
		if (n.id === parent) {
			const children = (n.children ?? []).slice();
			const i = index === undefined || index < 0 || index > children.length ? children.length : index;
			children.splice(i, 0, node);
			return { ...n, children };
		}
		return n.children ? { ...n, children: insertAt(n.children, parent, index, node) } : n;
	});
}

function removeNode(nodes: BlockNode[], id: string): { tree: BlockNode[]; removed: BlockNode | null } {
	let removed: BlockNode | null = null;
	const walk = (list: BlockNode[]): BlockNode[] => {
		const out: BlockNode[] = [];
		for (const n of list) {
			if (n.id === id && !removed) {
				removed = n;
				continue;
			}
			out.push(n.children ? { ...n, children: walk(n.children) } : n);
		}
		return out;
	};
	return { tree: walk(nodes), removed };
}

function updateNode(nodes: BlockNode[], id: string, fn: (n: BlockNode) => BlockNode): BlockNode[] {
	return nodes.map((n) => {
		if (n.id === id) return fn(n);
		return n.children ? { ...n, children: updateNode(n.children, id, fn) } : n;
	});
}

function applyOne(nodes: BlockNode[], op: PatchOp): BlockNode[] {
	switch (op.op) {
		case 'ADD': {
			// Idempotent: an ADD whose node id already exists is a replay no-op.
			if (findNode(nodes, op.node.id)) return nodes;
			return insertAt(nodes, op.parent, op.index, cloneNode(op.node));
		}
		case 'MOVE': {
			if (!findNode(nodes, op.node)) return nodes;
			const { tree, removed } = removeNode(nodes, op.node);
			if (!removed) return nodes;
			const moved = { ...removed };
			delete moved.children;
			return insertAt(tree, op.parent, op.index, moved);
		}
		case 'REMOVE':
			return removeNode(nodes, op.node).tree;
		case 'UPDATE':
			return updateNode(nodes, op.node, (n) => ({ ...n, config: { ...(n.config ?? {}), ...op.config } }));
		case 'BIND':
			return updateNode(nodes, op.node, (n) => ({
				...n,
				config: { ...(n.config ?? {}), collection: op.collection, ...(op.field ? { field: op.field } : {}) },
			}));
		case 'SPLIT':
			return updateNode(nodes, op.node, (n) => {
				const kids = n.children ?? [];
				const groups: BlockNode[][] = Array.from({ length: op.into }, () => []);
				kids.forEach((k, i) => groups[i % op.into].push(k));
				// Deterministic wrapper ids: replaying the op yields identical ids.
				const wrappers: BlockNode[] = groups.map((g, i) => ({
					id: `${n.id}__split${i}`,
					type: op.axis === 'row' ? 'column' : 'row',
					layout: { ...(n.layout ?? {}), order: i },
					children: g,
				}));
				return { ...n, children: wrappers };
			});
	}
}

/** Apply a batch of ops to a block tree. Pure; the input tree is not mutated. */
export function applyOps(nodes: readonly BlockNode[], ops: readonly PatchOp[]): BlockNode[] {
	let tree = nodes.map(cloneNode);
	for (const op of ops) tree = applyOne(tree, op);
	return tree;
}

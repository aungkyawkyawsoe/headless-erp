import { describe, expect, it } from 'vitest';
import type { PageBlock } from './api';
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
	isContainer,
} from './page-blocks';

function block(id: string, type = 'text', children?: PageBlock[]): PageBlock {
	return { id, type, label: type, layout: { order: 0 }, config: {}, ...(children ? { children } : {}) };
}

/** row(g1) → [text(a), column(c1) → [text(b)]] */
function sample(): PageBlock[] {
	return [block('g1', 'row', [block('a'), block('c1', 'column', [block('b')])])];
}

describe('isContainer', () => {
	it('recognizes container types', () => {
		expect(isContainer(block('x', 'row'))).toBe(true);
		expect(isContainer(block('x', 'column'))).toBe(true);
		expect(isContainer(block('x', 'text'))).toBe(false);
		expect(isContainer(null)).toBe(false);
	});
});

describe('insertBlock', () => {
	it('appends to root when no selection', () => {
		const next = insertBlock(sample(), block('n'), null);
		expect(next.map((b) => b.id)).toEqual(['g1', 'n']);
	});
	it('inserts into the selected container at any depth', () => {
		const next = insertBlock(sample(), block('n'), 'c1');
		const c1 = findBlock(next, 'c1')!;
		expect(c1.children!.map((c) => c.id)).toEqual(['b', 'n']);
	});
});

describe('insertIntoRec', () => {
	it('inserts into a named container at any depth', () => {
		const next = insertIntoRec(sample(), 'c1', block('n'));
		const c1 = findBlock(next, 'c1')!;
		expect(c1.children!.map((c) => c.id)).toEqual(['b', 'n']);
	});
	it('appends to root when containerId is null', () => {
		const next = insertIntoRec(sample(), null, block('n'));
		expect(next.map((b) => b.id)).toEqual(['g1', 'n']);
	});
});

describe('insertRelativeRec', () => {
	it('inserts before/after a sibling', () => {
		const before = insertRelativeRec(sample(), 'a', 'before', block('n'));
		expect(findBlock(before, 'g1')!.children!.map((c) => c.id)).toEqual(['n', 'a', 'c1']);
		const after = insertRelativeRec(sample(), 'a', 'after', block('n'));
		expect(findBlock(after, 'g1')!.children!.map((c) => c.id)).toEqual(['a', 'n', 'c1']);
	});
	it('inserts inside a container', () => {
		const inside = insertRelativeRec(sample(), 'c1', 'inside', block('n'));
		expect(findBlock(inside, 'c1')!.children!.map((c) => c.id)).toEqual(['b', 'n']);
	});
});

describe('removeBlockRec', () => {
	it('removes a block at any depth', () => {
		const next = removeBlockRec(sample(), 'b');
		expect(findBlock(next, 'b')).toBeNull();
		expect(findBlock(next, 'a')).not.toBeNull();
	});
});

describe('updateBlockRec', () => {
	it('patches a block at any depth', () => {
		const next = updateBlockRec(sample(), 'b', (b) => ({ ...b, label: 'renamed' }));
		expect(findBlock(next, 'b')!.label).toBe('renamed');
	});
});

describe('orderBlocks', () => {
	it('assigns depth-first order values', () => {
		const next = orderBlocks(sample(), 0);
		const g1 = next[0];
		expect(g1.layout.order).toBe(0);
		expect(g1.children![0].layout.order).toBe(0);
		expect(g1.children![1].layout.order).toBe(1);
		expect(g1.children![1].children![0].layout.order).toBe(0);
	});
});

describe('findBlock / isSelfOrDescendant', () => {
	it('finds a block at any depth', () => {
		expect(findBlock(sample(), 'b')!.id).toBe('b');
		expect(findBlock(sample(), 'missing')).toBeNull();
	});
	it('detects self/descendant for cycle guards', () => {
		expect(isSelfOrDescendant(sample(), 'g1', 'g1')).toBe(true);
		expect(isSelfOrDescendant(sample(), 'g1', 'b')).toBe(true);
		expect(isSelfOrDescendant(sample(), 'b', 'g1')).toBe(false);
	});
});

describe('insertAfterRec / moveBlockRec', () => {
	it('duplicates a block right after the original', () => {
		const next = insertAfterRec(sample(), 'a', block('a2'));
		expect(findBlock(next, 'g1')!.children!.map((c) => c.id)).toEqual(['a', 'a2', 'c1']);
	});
	it('moves a block up/down within its parent', () => {
		const up = moveBlockRec(sample(), 'c1', -1);
		expect(findBlock(up, 'g1')!.children!.map((c) => c.id)).toEqual(['c1', 'a']);
		const down = moveBlockRec(sample(), 'a', 1);
		expect(findBlock(down, 'g1')!.children!.map((c) => c.id)).toEqual(['c1', 'a']);
	});
});

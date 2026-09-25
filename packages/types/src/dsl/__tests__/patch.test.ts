import { describe, expect, it } from 'vitest';
import { applyOps, type BlockNode, type PatchOp } from '../patch';

const leaf = (id: string, type = 'text'): BlockNode => ({ id, type, config: { label: id } });

describe('applyOps', () => {
	it('ADD inserts at root and under a parent', () => {
		const root: BlockNode[] = [{ id: 'row', type: 'row', children: [] }];
		const ops: PatchOp[] = [
			{ id: 'o1', op: 'ADD', parent: null, node: leaf('h1', 'header') },
			{ id: 'o2', op: 'ADD', parent: 'row', index: 0, node: leaf('c1', 'column') },
		];
		const out = applyOps(root, ops);
		expect(out.map((n) => n.id)).toEqual(['row', 'h1']);
		expect(out[0].children?.map((n) => n.id)).toEqual(['c1']);
	});

	it('is idempotent by id — replaying an ADD is a no-op', () => {
		const root: BlockNode[] = [];
		const ops: PatchOp[] = [{ id: 'o1', op: 'ADD', parent: null, node: leaf('x') }];
		expect(applyOps(applyOps(root, ops), ops)).toEqual(applyOps(root, ops));
	});

	it('MOVE re-parents a node without duplicating it', () => {
		const root: BlockNode[] = [
			{ id: 'a', type: 'column', children: [leaf('n')] },
			{ id: 'b', type: 'column', children: [] },
		];
		const out = applyOps(root, [{ id: 'o1', op: 'MOVE', node: 'n', parent: 'b', index: 0 }]);
		expect(out[0].children).toEqual([]);
		expect(out[1].children?.map((x) => x.id)).toEqual(['n']);
	});

	it('REMOVE deletes the subtree', () => {
		const root: BlockNode[] = [{ id: 'a', type: 'column', children: [leaf('n')] }];
		expect(applyOps(root, [{ id: 'o1', op: 'REMOVE', node: 'a' }])).toEqual([]);
	});

	it('UPDATE merges config and BIND sets the collection binding', () => {
		const root: BlockNode[] = [leaf('t', 'table')];
		const updated = applyOps(root, [{ id: 'o1', op: 'UPDATE', node: 't', config: { title: 'Orders' } }]);
		expect(updated[0].config).toEqual({ label: 't', title: 'Orders' });
		const bound = applyOps(updated, [{ id: 'o2', op: 'BIND', node: 't', collection: 'orders', field: 'id' }]);
		expect(bound[0].config).toEqual({ label: 't', title: 'Orders', collection: 'orders', field: 'id' });
	});

	it('SPLIT wraps children into deterministic column wrappers', () => {
		const root: BlockNode[] = [{ id: 'row', type: 'row', children: [leaf('a'), leaf('b'), leaf('c'), leaf('d')] }];
		const out = applyOps(root, [{ id: 'o1', op: 'SPLIT', node: 'row', into: 2, axis: 'row' }]);
		expect(out[0].children?.map((n) => n.id)).toEqual(['row__split0', 'row__split1']);
		expect(out[0].children?.[0].children?.map((n) => n.id)).toEqual(['a', 'c']);
		expect(out[0].children?.[1].children?.map((n) => n.id)).toEqual(['b', 'd']);
	});

	it('does not mutate the input tree', () => {
		const root: BlockNode[] = [{ id: 'row', type: 'row', children: [leaf('a')] }];
		const before = JSON.parse(JSON.stringify(root));
		applyOps(root, [{ id: 'o1', op: 'REMOVE', node: 'a' }]);
		expect(root).toEqual(before);
	});
});

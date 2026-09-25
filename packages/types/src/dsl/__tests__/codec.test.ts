import { describe, expect, it } from 'vitest';
import { decodeColumns, encodeColumns, unionColumns } from '../codec';
import { META_WIRE_VERSION, decodeMeta, encodeMeta, type MetaSnapshot } from '../meta-codec';

describe('columnar codec', () => {
	it('round-trips rows losslessly', () => {
		const rows = [
			{ name: 'amount', type: 'currency', required: true, uniq: false },
			{ name: 'note', type: 'longtext', required: false, uniq: null },
		];
		expect(decodeColumns(encodeColumns(rows))).toEqual(rows);
	});

	it('names each column exactly once and sends rows positionally', () => {
		const wire = encodeColumns([
			{ a: 1, b: 2 },
			{ a: 3, b: 4 },
		]);
		expect(wire.columns).toEqual(['a', 'b']);
		expect(wire.rows).toEqual([
			[1, 2],
			[3, 4],
		]);
		// The column name appears once in the wire, not once per row.
		expect(JSON.stringify(wire).split('"a"').length - 1).toBe(1);
	});

	it('unions ragged rows so no column is silently dropped', () => {
		const rows = [{ a: 1 }, { a: 2, b: 3 }];
		expect(unionColumns(rows)).toEqual(['a', 'b']);
		expect(decodeColumns(encodeColumns(rows))).toEqual([
			{ a: 1, b: null },
			{ a: 2, b: 3 },
		]);
	});

	it('is deterministic — same input yields the same column order', () => {
		const rows = [
			{ b: 1, a: 2 },
			{ b: 3, a: 4 },
		];
		expect(encodeColumns(rows).columns).toEqual(encodeColumns(rows).columns);
		expect(encodeColumns(rows).columns).toEqual(['b', 'a']);
	});
});

describe('meta codec (specialization)', () => {
	const snapshot: MetaSnapshot = {
		components: [
			{ id: 'c1', name: 'hero', capabilities_json: '[]' },
			{ id: 'c2', name: 'table', capabilities_json: '{}' },
		],
		shortcuts: [{ id: 's1', label: 'Save' }],
	};

	it('round-trips a snapshot', () => {
		expect(decodeMeta(encodeMeta(snapshot))).toEqual(snapshot);
	});

	it('stamps the wire version', () => {
		expect(encodeMeta(snapshot).v).toBe(META_WIRE_VERSION);
	});

	it('passes a pre-codec plain object map through untouched', () => {
		expect(decodeMeta(snapshot)).toEqual(snapshot);
	});

	it('passes a non-object payload through as an empty map', () => {
		expect(decodeMeta(null)).toEqual({});
		expect(decodeMeta('nope')).toEqual({});
	});
});

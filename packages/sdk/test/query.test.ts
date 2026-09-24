import { describe, expect, it } from 'vitest';
import { aggregateAlias, serializeFilter, serializeQuery, stringifyFilterValue } from '../src/query';
import type { Filter } from '../src/query';

interface Row {
	id: string;
	employee_tg_id: string;
	type: 'check-in' | 'check-out';
	timestamp: string;
	status: string;
	qty_on_hand: number;
}

describe('serializeFilter', () => {
	it('serializes flat conditions as filter[field][_op]=value', () => {
		const params = serializeFilter<Row>({ employee_tg_id: { _eq: '42' }, type: { _eq: 'check-in' } });
		expect(params.toString()).toContain('filter%5Bemployee_tg_id%5D%5B_eq%5D=42');
		expect(params.toString()).toContain('filter%5Btype%5D%5B_eq%5D=check-in');
	});

	it('serializes range/contains/in operators', () => {
		const params = serializeFilter<Row>({
			timestamp: { _gte: '2026-08-01T00:00:00.000Z', _lte: '2026-08-31T00:00:00.000Z' },
			status: { _in: ['a', 'b', 'c'] },
			type: { _contains: 'in' },
		});
		const qs = params.toString();
		expect(qs).toContain('filter%5Btimestamp%5D%5B_gte%5D=2026-08-01T00%3A00%3A00.000Z');
		expect(qs).toContain('filter%5Btimestamp%5D%5B_lte%5D=2026-08-31T00%3A00%3A00.000Z');
		expect(qs).toContain('filter%5Bstatus%5D%5B_in%5D=a%2Cb%2Cc');
		expect(qs).toContain('filter%5Btype%5D%5B_contains%5D=in');
	});

	it('serializes OR groups with the _or[i] prefix', () => {
		const filter: Filter<Row> = {
			status: { _eq: 'approved' },
			_or: [{ type: { _eq: 'check-in' } }, { type: { _eq: 'check-out' } }],
		};
		const qs = serializeFilter<Row>(filter).toString();
		expect(qs).toContain('filter%5B_or%5D%5B0%5D%5Btype%5D%5B_eq%5D=check-in');
		expect(qs).toContain('filter%5B_or%5D%5B1%5D%5Btype%5D%5B_eq%5D=check-out');
	});

	it('serializes nested relation filters as filter[rel][field][_op]', () => {
		const params = serializeFilter({ issues_type: { category: { _eq: 'cat-1' } } } as Filter<Record<string, unknown>>);
		expect(params.get('filter[issues_type][category][_eq]')).toBe('cat-1');
	});

	it('serializes a nested relation filter inside an OR group', () => {
		const filter = {
			_or: [{ fleet: { plate_no: { _contains: 'RF' } } }, { technician: { _eq: 'Ko Aung' } }],
		} as Filter<Record<string, unknown>>;
		const params = serializeFilter(filter);
		expect(params.get('filter[_or][0][fleet][plate_no][_contains]')).toBe('RF');
		expect(params.get('filter[_or][1][technician][_eq]')).toBe('Ko Aung');
	});

	it('serializes an operator condition alongside a nested relation filter', () => {
		const filter = {
			doc_status: { _eq: 'draft' },
			issues_type: { category: { _eq: 'cat-1' } },
		} as Filter<Record<string, unknown>>;
		const params = serializeFilter(filter);
		expect(params.get('filter[doc_status][_eq]')).toBe('draft');
		expect(params.get('filter[issues_type][category][_eq]')).toBe('cat-1');
	});

	it('skips undefined conditions', () => {
		const params = serializeFilter<Row>({ employee_tg_id: { _eq: undefined as never, _gte: 'x' } });
		expect(params.toString()).not.toContain('_eq%5D=');
		expect(params.toString()).toContain('_gte%5D=x');
	});

	it('stringifies null/boolean operators', () => {
		expect(stringifyFilterValue('_null', true)).toBe('true');
		expect(stringifyFilterValue('_in', [1, 2])).toBe('1,2');
		expect(stringifyFilterValue('_gte', new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
	});
});

describe('serializeQuery', () => {
	it('projects fields, sorts, cursor, limit and count flags', () => {
		const params = serializeQuery<Row>({
			fields: ['type', 'timestamp', 'status'],
			sort: ['-timestamp'],
			limit: 24,
			cursor: 'abc123',
			search: 'hello',
			countOnly: true,
		});
		const qs = params.toString();
		expect(qs).toContain('fields=type%2Ctimestamp%2Cstatus');
		expect(qs).toContain('sort=-timestamp');
		expect(qs).toContain('limit=24');
		expect(qs).toContain('cursor=abc123');
		expect(qs).toContain('search=hello');
		expect(qs).toContain('count_only=true');
	});

	it('joins filter + pagination into one query string', () => {
		const qs = serializeQuery<Row>({
			filter: { employee_tg_id: { _eq: '7' } },
			limit: 10,
			sort: '-timestamp',
		}).toString();
		expect(qs).toContain('filter%5Bemployee_tg_id%5D%5B_eq%5D=7');
		expect(qs).toContain('limit=10');
	});

	it('serializes groupBy as repeated groupBy[] buckets', () => {
		const qs = serializeQuery<Row>({ groupBy: ['status', 'month(timestamp)'] }).toString();
		expect(qs).toContain('groupBy%5B%5D=status');
		expect(qs).toContain('groupBy%5B%5D=month%28timestamp%29');
	});

	it('serializes aggregates as aggregate[op]=field (repeats preserved)', () => {
		const qs = serializeQuery<Row>({
			groupBy: ['status'],
			aggregate: [
				{ op: 'count', field: 'id' },
				{ op: 'sum', field: 'qty_on_hand' },
			],
		}).toString();
		expect(qs).toContain('aggregate%5Bcount%5D=id');
		expect(qs).toContain('aggregate%5Bsum%5D=qty_on_hand');
	});

	it('keeps two measures that share an operator (append, not set)', () => {
		const qs = serializeQuery<Row>({
			aggregate: [
				{ op: 'sum', field: 'a' },
				{ op: 'sum', field: 'b' },
			],
		}).toString();
		expect(qs).toContain('aggregate%5Bsum%5D=a');
		expect(qs).toContain('aggregate%5Bsum%5D=b');
	});

	it('aggregateAlias mirrors the server’s `${op}_${field}` response key', () => {
		expect(aggregateAlias('sum', 'qty_on_hand')).toBe('sum_qty_on_hand');
		expect(aggregateAlias('count', 'id')).toBe('count_id');
	});
});

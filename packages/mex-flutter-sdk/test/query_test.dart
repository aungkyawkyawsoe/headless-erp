/// Query serialization — the 1:1 Dart port of `test/query.test.ts`.
///
/// Pins the WIRE format byte-for-byte: the same percent-encoded query string
/// the TS SDK produces (`URLSearchParams.toString()` semantics), including
/// repeated `groupBy[]` / `aggregate[op]` keys that a plain Map would destroy.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

void main() {
	group('serializeFilter', () {
		test('serializes flat conditions as filter[field][_op]=value', () {
			final params = serializeFilter({
				'person_id': {'_eq': '42'},
				'type': {'_eq': 'check-in'},
			});
			expect(params.toString(), contains('filter%5Bperson_id%5D%5B_eq%5D=42'));
			expect(params.toString(), contains('filter%5Btype%5D%5B_eq%5D=check-in'));
		});

		test('serializes range/contains/in operators', () {
			final params = serializeFilter({
				'timestamp': {
					'_gte': '2026-08-01T00:00:00.000Z',
					'_lte': '2026-08-31T00:00:00.000Z',
				},
				'status': {
					'_in': ['a', 'b', 'c'],
				},
				'type': {'_contains': 'in'},
			});
			final qs = params.toString();
			expect(qs, contains('filter%5Btimestamp%5D%5B_gte%5D=2026-08-01T00%3A00%3A00.000Z'));
			expect(qs, contains('filter%5Btimestamp%5D%5B_lte%5D=2026-08-31T00%3A00%3A00.000Z'));
			expect(qs, contains('filter%5Bstatus%5D%5B_in%5D=a%2Cb%2Cc'));
			expect(qs, contains('filter%5Btype%5D%5B_contains%5D=in'));
		});

		test('serializes OR groups with the _or[i] prefix', () {
			final filter = <String, Object?>{
				'status': {'_eq': 'approved'},
				'_or': [
					{
						'type': {'_eq': 'check-in'},
					},
					{
						'type': {'_eq': 'check-out'},
					},
				],
			};
			final qs = serializeFilter(filter).toString();
			expect(qs, contains('filter%5B_or%5D%5B0%5D%5Btype%5D%5B_eq%5D=check-in'));
			expect(qs, contains('filter%5B_or%5D%5B1%5D%5Btype%5D%5B_eq%5D=check-out'));
		});

		test('serializes nested relation filters as filter[rel][field][_op]', () {
			final params = serializeFilter({
				'issues_type': {
					'category': {'_eq': 'cat-1'},
				},
			});
			expect(params.get('filter[issues_type][category][_eq]'), 'cat-1');
		});

		test('serializes a nested relation filter inside an OR group', () {
			final filter = <String, Object?>{
				'_or': [
					{
						'fleet': {
							'plate_no': {'_contains': 'RF'},
						},
					},
					{
						'technician': {'_eq': 'Ko Aung'},
					},
				],
			};
			final params = serializeFilter(filter);
			expect(params.get('filter[_or][0][fleet][plate_no][_contains]'), 'RF');
			expect(params.get('filter[_or][1][technician][_eq]'), 'Ko Aung');
		});

		test('serializes an operator condition alongside a nested relation filter', () {
			final filter = <String, Object?>{
				'doc_status': {'_eq': 'draft'},
				'issues_type': {
					'category': {'_eq': 'cat-1'},
				},
			};
			final params = serializeFilter(filter);
			expect(params.get('filter[doc_status][_eq]'), 'draft');
			expect(params.get('filter[issues_type][category][_eq]'), 'cat-1');
		});

		test('an omitted condition is simply absent (Dart has no undefined)', () {
			// The TS suite pinned that `undefined` values are skipped. Dart has no
			// `undefined` — callers omit the key (or spread conditionally) instead,
			// and the wire result is identical.
			final params = serializeFilter({
				'person_id': {'_gte': 'x'},
			});
			expect(params.toString(), isNot(contains('_eq%5D=')));
			expect(params.toString(), contains('_gte%5D=x'));
		});

		test('a literal null operator value serializes as "null" (JSON null)', () {
			// `_eq: null` is a REAL wire value (match the JSON null), exactly as
			// `String(null) === 'null'` in TS.
			final params = serializeFilter({
				'deleted_at': {'_eq': null},
			});
			expect(params.get('filter[deleted_at][_eq]'), 'null');
		});

		test('stringifies null/boolean operators', () {
			expect(stringifyFilterValue('_null', true), 'true');
			expect(stringifyFilterValue('_in', [1, 2]), '1,2');
			expect(stringifyFilterValue('_gte', DateTime.utc(2026, 1, 1)), '2026-01-01T00:00:00.000Z');
		});
	});

	group('serializeQuery', () {
		test('projects fields, sorts, cursor, limit and count flags', () {
			final params = serializeQuery(ListQuery(
				fields: ['type', 'timestamp', 'status'],
				sort: ['-timestamp'],
				limit: 24,
				cursor: 'abc123',
				search: 'hello',
				countOnly: true,
			));
			final qs = params.toString();
			expect(qs, contains('fields=type%2Ctimestamp%2Cstatus'));
			expect(qs, contains('sort=-timestamp'));
			expect(qs, contains('limit=24'));
			expect(qs, contains('cursor=abc123'));
			expect(qs, contains('search=hello'));
			expect(qs, contains('count_only=true'));
		});

		test('joins filter + pagination into one query string', () {
			final qs = serializeQuery(ListQuery(
				filter: {
					'person_id': {'_eq': '7'},
				},
				limit: 10,
				sort: '-timestamp',
			)).toString();
			expect(qs, contains('filter%5Bperson_id%5D%5B_eq%5D=7'));
			expect(qs, contains('limit=10'));
		});

		test('serializes groupBy as repeated groupBy[] buckets', () {
			final qs = serializeQuery(ListQuery(
				groupBy: ['status', 'month(timestamp)'],
			)).toString();
			expect(qs, contains('groupBy%5B%5D=status'));
			expect(qs, contains('groupBy%5B%5D=month%28timestamp%29'));
		});

		test('serializes aggregates as aggregate[op]=field (repeats preserved)', () {
			final qs = serializeQuery(ListQuery(
				groupBy: ['status'],
				aggregate: [
					const AggregateMeasure(AggregateOp.count, 'id'),
					const AggregateMeasure(AggregateOp.sum, 'qty_on_hand'),
				],
			)).toString();
			expect(qs, contains('aggregate%5Bcount%5D=id'));
			expect(qs, contains('aggregate%5Bsum%5D=qty_on_hand'));
		});

		test('keeps two measures that share an operator (append, not set)', () {
			final qs = serializeQuery(ListQuery(
				aggregate: [
					const AggregateMeasure(AggregateOp.sum, 'a'),
					const AggregateMeasure(AggregateOp.sum, 'b'),
				],
			)).toString();
			expect(qs, contains('aggregate%5Bsum%5D=a'));
			expect(qs, contains('aggregate%5Bsum%5D=b'));
		});

		test("aggregateAlias mirrors the server's \${op}_\${field} response key", () {
			expect(aggregateAlias(AggregateOp.sum, 'qty_on_hand'), 'sum_qty_on_hand');
			expect(aggregateAlias(AggregateOp.count, 'id'), 'count_id');
		});
	});
}

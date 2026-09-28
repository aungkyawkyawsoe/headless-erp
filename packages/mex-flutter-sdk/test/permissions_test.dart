/// Permissions + queryMany — the 1:1 Dart port of `test/permissions.test.ts`.
///
/// Pins the client half of "ask only what you may see" (the server always
/// ENFORCES the same rules): the whitelist semantics of `restrictFields`, the
/// 60s cache + in-flight coalescing of `/auth/me?collection=`, and the
/// keyed one-round-trip `POST /api/query` batch contract.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import 'support.dart';

void main() {
	group('restrictFields', () {
		test('null (no restrictions) → projection unchanged', () {
			expect(restrictFields(['a', 'b'], null), equals(['a', 'b']));
			expect(restrictFields(null, null), isNull);
		});

		test('[] (deny all) → only id survives', () {
			expect(restrictFields(['a', 'b'], const []), equals(['id']));
			expect(restrictFields(null, const []), equals(['id']));
		});

		test('no requested projection → whitelist caps the request', () {
			expect(restrictFields(null, ['name', 'email']), equals(['name', 'email']));
		});

		test('"*" (everything) → whitelist caps it', () {
			expect(restrictFields(['*'], ['name', 'email']), equals(['name', 'email']));
		});

		test('named fields → intersected with the whitelist (hidden fields dropped)', () {
			expect(restrictFields(['id', 'salary', 'name'], ['id', 'name']), equals(['id', 'name']));
			expect(restrictFields(['secret'], ['id', 'name']), isEmpty);
		});
	});

	group('fieldsToArray', () {
		test('normalizes string, comma-list, array and null projections', () {
			expect(fieldsToArray('a,b,c'), equals(['a', 'b', 'c']));
			expect(fieldsToArray('*'), equals(['*']));
			expect(fieldsToArray(['a', 'b']), equals(['a', 'b']));
			expect(fieldsToArray(null), isNull);
		});
	});

	group('client.fieldRestrictions', () {
		test('fetches /auth/me?collection= and returns the whitelist (cached 60s)', () async {
			var meCalls = 0;
			final fake = FakeTransport();
			fake.fallback = (request) async {
				if (request.url.toString().contains('/auth/me')) {
					meCalls++;
					return envelope({'field_restrictions': ['id', 'name']});
				}
				return envelope(const {});
			};
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: MemoryTokenStorage(),
			));
			client.tokenStorage.set('tok');

			expect(await client.fieldRestrictions('orders'), equals(['id', 'name']));
			expect(await client.fieldRestrictions('orders'), equals(['id', 'name'])); // cache hit — no 2nd call
			expect(meCalls, 1);
		});

		test('concurrent callers share ONE in-flight /auth/me (no duplicate fetches)', () async {
			var meCalls = 0;
			final fake = FakeTransport();
			fake.fallback = (request) async {
				if (request.url.toString().contains('/auth/me')) meCalls++;
				return envelope({'field_restrictions': ['id', 'name']});
			};
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: MemoryTokenStorage(),
			));
			client.tokenStorage.set('tok');

			final results = await Future.wait([
				client.fieldRestrictions('orders'),
				client.fieldRestrictions('orders'),
			]);
			expect(results[0], equals(['id', 'name']));
			expect(results[1], equals(['id', 'name']));
			expect(meCalls, 1);
		});

		test('null when unrestricted (admin or no restrictions)', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'field_restrictions': null});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			expect(await client.fieldRestrictions('orders'), isNull);
		});

		test('pruneFields applies the whitelist to a projection', () async {
			final fake = FakeTransport();
			fake.fallback = (request) async {
				if (request.url.toString().contains('/auth/me')) {
					return envelope({'field_restrictions': ['id', 'type']});
				}
				return envelope(const {});
			};
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			expect(
				await client.pruneFields('orders', ['id', 'timestamp', 'type']),
				equals(['id', 'type']),
			);
		});
	});

	group('client.queryMany', () {
		test('POSTs keyed specs to /api/query and unwraps the keyed results', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({
				'results': [
					{
						'key': 'a',
						'ok': true,
						'data': [
							{'id': '1'},
						],
					},
					{'key': 'b', 'ok': false, 'error': 'denied'},
				],
			});
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: MemoryTokenStorage(),
			));
			client.tokenStorage.set('tok');

			final result = await client.queryMany([
				QuerySpec(key: 'a', collection: 'orders', query: QueryParams.of({'limit': '5'})),
				const QuerySpec(key: 'b', collection: 'secret'),
			]);

			expect(fake.last.url.toString(), '/api/query');
			expect(fake.last.method, 'POST');
			expect(
				jsonBodyOf(fake.last),
				equals({
					'queries': [
						{'key': 'a', 'collection': 'orders', 'params': {'limit': '5'}},
						// Page-size policy: a spec without a limit gets the SDK default (25).
						{'key': 'b', 'collection': 'secret', 'params': {'limit': '25'}},
					],
				}),
			);
			final results = (result['results'] as List).cast<Map<String, dynamic>>();
			expect(results, hasLength(2));
			expect(results[0]['key'], 'a');
			expect(results[0]['ok'], isTrue);
			expect(results[1]['key'], 'b');
			expect(results[1]['ok'], isFalse);
		});
	});
}

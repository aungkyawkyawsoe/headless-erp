/// Client request pipeline + items + page-size policy + offline wiring +
/// change envelope + auth helpers — the 1:1 Dart port of `test/client.test.ts`.
///
/// Telegram paths in the TS suite become `/auth/login` (the standalone app's
/// only sign-in path), and `vi.stubGlobal('fetch')` becomes an injected
/// [FakeTransport]; every wire-level assertion is preserved unchanged.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';
import 'package:mex_flutter_sdk/src/log.dart';

import 'support.dart';

void main() {
	group('request pipeline', () {
		test('unwraps the success envelope', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope([{'id': '1'}]);
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			expect(await client.request('/entities/x'), equals([{'id': '1'}]));
		});

		test('attaches the bearer token from storage (except login paths)', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'ok': true});
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: MemoryTokenStorage(),
			));
			client.tokenStorage.set('jwt-abc');
			await client.request('/entities/orders');
			expect(authOf(fake.calls[0]), 'Bearer jwt-abc');

			// Login paths must NOT carry a stale token.
			await client.request('/auth/login', method: 'POST', body: {'email': 'a@b.c', 'password': 'x'});
			expect(authOf(fake.calls[1]), isNull);
		});

		test('skips an expired token entirely (no doomed request) and clears it', () async {
			var sawAuthHeader = false;
			final fake = FakeTransport();
			fake.fallback = (request) async {
				sawAuthHeader = authOf(request) != null;
				return envelope({'ok': true});
			};
			final storage = MemoryTokenStorage();
			final payload = jsonEncode({
				'jti': 'x',
				'user_id': 'u',
				'exp': DateTime.now().millisecondsSinceEpoch - 3600000,
			});
			storage.set(base64.encode(utf8.encode('$payload.sig')));
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.request('/entities/x');
			expect(sawAuthHeader, isFalse);
			expect(storage.get(), isNull);
		});

		test('401 → refreshSession once → retries with the fresh token', () async {
			final calls = <String>[];
			final fake = FakeTransport();
			fake.fallback = (request) async {
				final auth = authOf(request) ?? '';
				calls.add(auth);
				return auth == 'Bearer fresh' ? envelope({'ok': true}) : errorEnvelope(401, 'Invalid or expired token');
			};
			final storage = MemoryTokenStorage()..set('stale');
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: storage,
				refreshSession: () async => 'fresh',
			));
			expect(await client.request('/entities/x'), equals({'ok': true}));
			expect(calls, equals(['Bearer stale', 'Bearer fresh']));
			expect(storage.get(), 'fresh');
		});

		test('surfaces the 401 when refreshSession returns null', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => errorEnvelope(401, 'Invalid or expired token');
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				refreshSession: () async => null,
			));
			await expectLater(
				client.request('/entities/x'),
				throwsA(isA<ErpHttpException>()
					.having((e) => e.status, 'status', 401)
					.having((e) => e.apiCode, 'apiCode', 'API_ERROR')),
			);
		});

		test('throws typed ErpHttpException with the REAL top-level backend code', () async {
			// The backend envelope: { success: false, error: string, code: string } —
			// `code` is a TOP-LEVEL sibling of `error`, not nested inside it.
			final fake = FakeTransport();
			fake.fallback = (_) async => ErpResponse(
				status: 409,
				headers: const {'Content-Type': 'application/json'},
				body: jsonEncode({
					'success': false,
					'error': 'Version conflict — row changed',
					'code': 'CONFLICT',
				}),
			);
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await expectLater(
				client.request('/entities/x/1', method: 'PUT'),
				throwsA(isA<ErpHttpException>()
					.having((e) => e.status, 'status', 409)
					.having((e) => e.code, 'code', 'CONFLICT')),
			);
		});

		test('keeps the nested error-object fallback for legacy envelopes', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async =>
				errorEnvelope(409, {'message': 'Version conflict', 'code': 'VERSION_CONFLICT'});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await expectLater(
				client.request('/entities/x/1', method: 'PUT'),
				throwsA(isA<ErpHttpException>()
					.having((e) => e.status, 'status', 409)
					.having((e) => e.code, 'code', 'VERSION_CONFLICT')),
			);
		});

		test('throws ErpNetworkException when the transport fails (offline)', () async {
			final fake = FakeTransport();
			fake.fallback = (_) => Future.error(Exception('Failed to fetch'));
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await expectLater(client.request('/entities/x'), throwsA(isA<ErpNetworkException>()));
		});

		test('retries transient failures (429) with backoff, then succeeds', () async {
			var calls = 0;
			final fake = FakeTransport();
			fake.fallback = (_) async {
				calls++;
				return calls == 1 ? errorEnvelope(429, 'Rate limit exceeded') : envelope({'ok': true});
			};
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				retry: const RetryPolicy(attempts: 2, delayMs: 1),
			));
			expect(await client.request('/entities/x'), equals({'ok': true}));
			expect(calls, 2);
		});

		test('sends Idempotency-Key and If-Match headers', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'id': '1'});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.request(
				'/entities/orders',
				method: 'POST',
				body: {'id': 'abc'},
				idempotencyKey: 'idem-1',
				ifMatch: '2026-08-26T00:00:00.000Z',
			);
			expect(idempotencyKeyOf(fake.calls[0]), 'idem-1');
			expect(headerOf(fake.calls[0], 'If-Match'), '2026-08-26T00:00:00.000Z');
		});

		test('auto-generates an Idempotency-Key for mutating requests without one', () async {
			final keys = <String?>[];
			final fake = FakeTransport();
			fake.fallback = (request) async {
				keys.add(idempotencyKeyOf(request));
				return envelope({'ok': true});
			};
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.request('/entities/orders/1', method: 'PUT', body: {'note': 'x'});
			expect(keys[0], matches(uuidPattern)); // looks like a UUID
		});

		test('reuses the SAME Idempotency-Key across transient retries', () async {
			final keys = <String>[];
			var calls = 0;
			final fake = FakeTransport();
			fake.fallback = (request) async {
				calls++;
				keys.add(idempotencyKeyOf(request) ?? '');
				return calls == 1 ? errorEnvelope(502, 'Bad gateway') : envelope({'ok': true});
			};
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				retry: const RetryPolicy(attempts: 2, delayMs: 1),
			));
			expect(
				await client.request('/entities/orders/1', method: 'PUT', body: {'note': 'x'}),
				equals({'ok': true}),
			);
			expect(keys, hasLength(2));
			expect(keys[0], matches(uuidPattern));
			expect(keys[1], keys[0]); // the retry reuses the SAME key
		});

		test('does NOT send Idempotency-Key for GETs or login POSTs', () async {
			final keys = <String?>[];
			final fake = FakeTransport();
			fake.fallback = (request) async {
				keys.add(idempotencyKeyOf(request));
				return envelope({'ok': true});
			};
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.request('/entities/orders');
			await client.request('/auth/login', method: 'POST', body: {'email': 'a@b.c', 'password': 'x'});
			expect(keys, equals([null, null]));
		});

		test('honors an explicit idempotencyKey as-is (not replaced)', () async {
			final keys = <String?>[];
			final fake = FakeTransport();
			fake.fallback = (request) async {
				keys.add(idempotencyKeyOf(request));
				return envelope({'ok': true});
			};
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.request(
				'/entities/orders',
				method: 'POST',
				body: {'id': 'abc'},
				idempotencyKey: 'explicit-key-1',
			);
			expect(keys[0], 'explicit-key-1');
		});
	});

	group('items API', () {
		test('lists with typed query → correct URL + meta passthrough', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => listEnvelope([{'id': '1'}], {'limit': 10, 'has_more': false});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			final result = await client.items('orders').list(ListQuery(
				filter: {
					'customer_id': {'_eq': '42'},
				},
				fields: ['type', 'timestamp'],
				limit: 10,
			));
			expect(fake.last.url.toString(), contains('/api/entities/orders?'));
			expect(fake.last.url.toString(), contains('filter%5Bcustomer_id%5D%5B_eq%5D=42'));
			expect(fake.last.url.toString(), contains('fields=type%2Ctimestamp'));
			expect(result.data, equals([{'id': '1'}]));
			expect(result.meta['limit'], 10);
		});

		test('count() hits count_only and returns the total', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => countEnvelope(7);
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			expect(
				await client.items('tasks').count(filter: {
					'status': {'_eq': 'pending'},
				}),
				7,
			);
			expect(fake.last.url.toString(), contains('count_only=true'));
		});

		test('create() attaches a client UUID for replay-safe writes', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'id': 'abc-123', 'type': 'check-in'});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.items('orders').create({'type': 'check-in'});
			final parsed = jsonBodyOf(fake.calls[0])! as Map<String, dynamic>;
			expect(parsed['id'], matches(uuidPattern));
		});

		test('update() forwards ifMatch for optimistic concurrency', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'id': '1'});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.items('orders').update('1', {'note': 'x'}, const UpdateOptions(ifMatch: 'ts-1'));
			expect(headerOf(fake.calls[0], 'If-Match'), 'ts-1');
		});
	});

	group('page-size policy (enterprise grade)', () {
		test('list() sends an explicit default limit of 25 when none is given', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => listEnvelope(const [], {'limit': 25, 'has_more': false});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.items('orders').list();
			expect(fake.last.url.toString(), contains('limit=25'));
		});

		test('list() clamps page sizes above the server ceiling to maxPageSize', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => listEnvelope(const [], {'limit': maxPageSize, 'has_more': false});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.items('products').list(ListQuery(limit: maxPageSize + 200));
			expect(fake.last.url.toString(), contains('limit=$maxPageSize'));
		});

		test('queryMany specs get the same page-size policy (default 25, max maxPageSize)', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'results': const []});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			await client.queryMany([
				const QuerySpec(key: 'a', collection: 'orders'),
				QuerySpec(
					key: 'b',
					collection: 'products',
					query: QueryParams.of({'limit': '${maxPageSize + 500}'}),
				),
			]);
			final parsed = jsonBodyOf(fake.calls[0])! as Map<String, dynamic>;
			final queries = (parsed['queries'] as List).cast<Map<String, dynamic>>();
			expect((queries[0]['params'] as Map)['limit'], '25');
			expect((queries[1]['params'] as Map)['limit'], '$maxPageSize');
		});

		test('queryMany truncates batches to the server cap (12) and warns once', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'results': const []});
			final warnings = <String>[];
			sdkLogSink = warnings.add;
			addTearDown(() => sdkLogSink = null);
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			final specs = List.generate(
				20,
				(i) => QuerySpec(key: 'k$i', collection: 'orders'),
			);
			await client.queryMany(specs);
			final parsed = jsonBodyOf(fake.calls[0])! as Map<String, dynamic>;
			expect(parsed['queries'] as List, hasLength(12));
			expect(warnings, hasLength(1));
		});
	});

	test('loadLimits() discovers the backend contract and clamps against it', () async {
		final fake = FakeTransport();
		fake.fallback = (request) async {
			if (request.url.toString().contains('/api/meta')) {
				return envelope({
					'platform': 'mmbix-headless',
					'pagination': {'default_page_size': 50, 'max_page_size': 200},
				});
			}
			final limit = int.tryParse(request.url.queryParameters['limit'] ?? '') ?? 0;
			return listEnvelope(const [], {'limit': limit, 'has_more': false});
		};
		final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
		// Built-in mirror of the server's defaults.
		expect(client.limits.defaultPageSize, 25);
		expect(client.limits.maxPageSize, maxPageSize);

		await client.loadLimits();
		expect(client.limits.defaultPageSize, 50); // adopted from the server
		expect(client.limits.maxPageSize, 200);

		await client.items('orders').list(); // no limit → policy default
		expect(fake.last.url.toString(), contains('limit=50'));
		await client.items('orders').list(ListQuery(limit: 500)); // above policy max → clamped
		expect(fake.last.url.toString(), contains('limit=200'));
	});

	group('offline queue wiring', () {
		test('network-failed writes enqueue for replay; reads and login never do', () async {
			final fake = FakeTransport();
			fake.fallback = (_) => Future.error(Exception('Failed to fetch'));
			final storage = MemoryQueueStorage();
			final queue = OfflineQueue.create(OfflineQueueOptions(storage: storage));
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				offlineQueue: queue,
			));

			// Write → enqueued.
			await expectLater(
				client.request('/entities/requests', method: 'POST', body: {'status': 'pending'}),
				throwsA(isA<ErpNetworkException>()),
			);
			expect(queue.pending(), hasLength(1));

			// Read → never queued.
			await expectLater(client.request('/entities/requests'), throwsA(isA<ErpNetworkException>()));
			expect(queue.pending(), hasLength(1));

			// Login → never queued.
			await expectLater(
				client.request('/auth/login', method: 'POST', body: {'email': 'a@b.c', 'password': 'x'}),
				throwsA(isA<ErpNetworkException>()),
			);
			expect(queue.pending(), hasLength(1));
		});

		test('noQueue: true opts a read-encoded POST out of the replay queue', () async {
			final fake = FakeTransport();
			fake.fallback = (_) => Future.error(Exception('Failed to fetch'));
			final storage = MemoryQueueStorage();
			final queue = OfflineQueue.create(OfflineQueueOptions(storage: storage));
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				offlineQueue: queue,
			));

			await expectLater(
				client.request(
					'/reports/execute',
					method: 'POST',
					body: {'collection': 'store_purchases'},
					noQueue: true,
				),
				throwsA(isA<ErpNetworkException>()),
			);
			expect(queue.pending(), isEmpty);
		});

		test('onWrite fires only for successful non-login writes; onSettled reports reachability', () async {
			final writes = <(String, String)>[];
			final settled = <(String, String, bool)>[];
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'id': '1'});
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				onWrite: (path, method) => writes.add((path, method)),
				onSettled: (path, method, ok) => settled.add((path, method, ok)),
			));

			await client.request('/entities/orders', method: 'POST', body: {'type': 'check-in'});
			await client.request('/entities/orders'); // read
			expect(writes, equals([('/entities/orders', 'POST')]));
			expect(settled, hasLength(2));
			expect(settled.every((entry) => entry.$3), isTrue);
		});
	});

	group('change envelope (meta.changed)', () {
		test('delivers the touched collections + rows to onChange', () async {
			final seen = <ChangeEnvelope>[];
			final fake = FakeTransport();
			fake.fallback = (_) async => envelopeWithMeta({'id': 'inv-1'}, {
				'changed': {
					'collections': ['orders', 'stock'],
					'rows': {
						'orders': ['inv-1'],
					},
				},
			});
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				onChange: (change, path, method) => seen.add(change),
			));

			await client.request('/entities/orders', method: 'POST', body: {'id': 'inv-1'});

			expect(seen, hasLength(1));
			expect(seen[0].collections, equals(['orders', 'stock']));
			expect(seen[0].rows, equals({'orders': ['inv-1']}));
		});

		test('does not fire when a response carries no envelope', () async {
			final seen = <ChangeEnvelope>[];
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'id': '1'});
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				onChange: (change, path, method) => seen.add(change),
			));

			await client.request('/entities/orders', method: 'POST', body: const {});

			expect(seen, isEmpty);
		});

		test('parseChangeEnvelope tolerates junk and filters non-string entries', () {
			expect(parseChangeEnvelope(null), isNull);
			expect(parseChangeEnvelope({'changed': 'nope'}), isNull);
			expect(parseChangeEnvelope({'changed': {'collections': const []}}), isNull);
			final parsed = parseChangeEnvelope({
				'changed': {
					'collections': ['a', 5],
					'rows': {
						'a': ['1', 2],
						'b': 'x',
					},
				},
			});
			expect(parsed, isNotNull);
			expect(parsed!.collections, equals(['a']));
			expect(parsed.rows, equals({'a': ['1']}));
		});
	});

	group('auth helpers', () {
		test('client.auth.token returns the stored unexpired token', () {
			final storage = MemoryTokenStorage()..set('valid');
			final client = HeadlessErpClient(HeadlessErpOptions(tokenStorage: storage));
			expect(client.auth.token, 'valid');
		});

		test('client.auth.logout clears storage', () {
			final storage = MemoryTokenStorage()..set('valid');
			final client = HeadlessErpClient(HeadlessErpOptions(tokenStorage: storage));
			client.auth.logout();
			expect(storage.get(), isNull);
			expect(isTokenExpired('x'), isFalse); // sanity: helper exported
		});

		test('auth.login stores the token and returns the session user', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({
				'status': 'approved',
				'token': 'jwt-1',
				'user': {'id': '1', 'email': 'a@b.c', 'full_name': 'A'},
			});
			final storage = MemoryTokenStorage();
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			final result = await client.auth.login(email: 'a@b.c', password: 'secret');
			expect(result['id'], '1');
			expect(storage.get(), 'jwt-1');
		});

		test('auth.login surfaces a 401 and stores no token', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => errorEnvelope(401, 'Invalid email or password');
			final storage = MemoryTokenStorage();
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await expectLater(
				client.auth.login(email: 'a@b.c', password: 'wrong'),
				throwsA(isA<ErpHttpException>().having((e) => e.status, 'status', 401)),
			);
			expect(storage.get(), isNull);
		});
	});

	/// A token the client considers expired (exp 1h ago).
	String expiredToken() => makeToken(DateTime.now().millisecondsSinceEpoch - 3600000);

	group('refresh tokens & logout', () {
		test('rotates an expired token up front (no doomed request) and sends the fresh bearer', () async {
			final fake = FakeTransport();
			fake.fallback = (request) async => request.url.path == '/api/auth/refresh'
				? envelope({'token': 'fresh', 'refresh_token': 'refresh-2', 'user': {'id': 'u'}})
				: envelope({'ok': true});
			final storage = MemoryTokenStorage();
			storage.set(expiredToken());
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.request('/entities/x');
			expect(fake.calls.map((c) => c.url.path), equals(['/api/auth/refresh', '/api/entities/x']));
			// The rotation authenticates by the token itself — no bearer, no key.
			expect(authOf(fake.calls[0]), isNull);
			expect(idempotencyKeyOf(fake.calls[0]), isNull);
			expect(authOf(fake.calls[1]), 'Bearer fresh');
			expect(storage.get(), 'fresh');
			expect(storage.getRefresh(), 'refresh-2');
		});

		test('rotates ONCE when concurrent requests race the same expired token', () async {
			var refreshCalls = 0;
			final entityAuth = <String?>[];
			final fake = FakeTransport();
			fake.fallback = (request) async {
				if (request.url.path == '/api/auth/refresh') {
					refreshCalls++;
					await Future<void>.delayed(Duration.zero); // widen the overlap window
					return envelope({'token': 'fresh', 'refresh_token': 'refresh-2'});
				}
				entityAuth.add(authOf(request));
				return envelope({'ok': true});
			};
			final storage = MemoryTokenStorage();
			storage.set(expiredToken());
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await Future.wait([client.request('/entities/a'), client.request('/entities/b')]);
			// A second rotation would present an already-rotated token — theft to
			// the server, which revokes the whole chain. Single-flight is a
			// correctness requirement, not an optimization.
			expect(refreshCalls, 1);
			expect(entityAuth, equals(['Bearer fresh', 'Bearer fresh']));
		});

		test('a refused rotation (401) ends the session and the request surfaces the 401', () async {
			final fake = FakeTransport();
			fake.fallback = (request) async => request.url.path == '/api/auth/refresh'
				? errorEnvelope(401, 'Invalid refresh token')
				: errorEnvelope(401, 'Invalid or expired token');
			final storage = MemoryTokenStorage();
			storage.set(expiredToken());
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await expectLater(
				client.request('/entities/x'),
				throwsA(isA<ErpHttpException>().having((e) => e.status, 'status', 401)),
			);
			expect(fake.calls.map((c) => c.url.path), equals(['/api/auth/refresh', '/api/entities/x']));
			expect(storage.get(), isNull);
			expect(storage.getRefresh(), isNull);
		});

		test('401 → rotates the refresh token once → retries with the fresh bearer', () async {
			final calls = <String>[];
			final fake = FakeTransport();
			fake.fallback = (request) async {
				if (request.url.path == '/api/auth/refresh') {
					calls.add('refresh:${authOf(request) ?? 'anon'}');
					return envelope({'token': 'fresh', 'refresh_token': 'refresh-2'});
				}
				final auth = authOf(request) ?? 'anon';
				calls.add(auth);
				return auth == 'Bearer fresh' ? envelope({'ok': true}) : errorEnvelope(401, 'Invalid or expired token');
			};
			final storage = MemoryTokenStorage();
			storage.set('stale'); // unparseable → sent as-is until the server rejects it
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await expectLater(client.request('/entities/x'), completion(equals({'ok': true})));
			expect(calls, equals(['Bearer stale', 'refresh:anon', 'Bearer fresh']));
			expect(storage.get(), 'fresh');
			expect(storage.getRefresh(), 'refresh-2');
		});

		test('prefers the refresh token over the refreshSession hook', () async {
			var hookCalls = 0;
			final fake = FakeTransport();
			fake.fallback = (request) async => request.url.path == '/api/auth/refresh'
				? envelope({'token': 'fresh', 'refresh_token': 'refresh-2'})
				: envelope({'ok': true});
			final storage = MemoryTokenStorage();
			storage.set(expiredToken());
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				tokenStorage: storage,
				refreshSession: () async {
					hookCalls++;
					return 'hooked';
				},
			));
			await client.request('/entities/x');
			expect(hookCalls, 0);
		});

		test('auth.refresh() rotates the chain and stores the successor', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'token': 'fresh', 'refresh_token': 'refresh-2'});
			final storage = MemoryTokenStorage();
			storage.set('old');
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			expect(await client.auth.refresh(), isTrue);
			expect(storage.get(), 'fresh');
			expect(storage.getRefresh(), 'refresh-2');
		});

		test('auth.refresh() resolves false without a stored token — no network call', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'ok': true});
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			expect(await client.auth.refresh(), isFalse);
			expect(fake.calls, isEmpty);
		});

		test('auth.refresh() ends the session on a 401 refusal', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => errorEnvelope(401, 'Invalid refresh token');
			final storage = MemoryTokenStorage();
			storage.set('old');
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			expect(await client.auth.refresh(), isFalse);
			expect(storage.get(), isNull);
			expect(storage.getRefresh(), isNull);
		});

		test('a network failure during rotation keeps the session (a later try may succeed)', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => throw StateError('network down');
			final storage = MemoryTokenStorage();
			storage.set('old');
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			expect(await client.auth.refresh(), isFalse);
			expect(storage.get(), 'old');
			expect(storage.getRefresh(), 'refresh-1');
		});

		test('logout() clears locally FIRST, then revokes the chain server-side', () async {
			final storage = MemoryTokenStorage();
			final fake = FakeTransport();
			var sawClearedStorage = false;
			fake.fallback = (_) async {
				sawClearedStorage = storage.get() == null && storage.getRefresh() == null;
				return envelope({'revoked': 1});
			};
			storage.set('tok');
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.auth.logout();
			expect(sawClearedStorage, isTrue); // local state is gone when the revoke leaves
			expect(jsonBodyOf(fake.last), equals({'refresh_token': 'refresh-1', 'all': false}));
			expect(authOf(fake.last), isNull); // revoked by the token, not the bearer
		});

		test('logout({ all: true }) asks for every chain of the user to be revoked', () async {
			final storage = MemoryTokenStorage();
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'revoked': 3});
			storage.set('tok');
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.auth.logout(all: true);
			expect(jsonBodyOf(fake.last), equals({'refresh_token': 'refresh-1', 'all': true}));
		});

		test('logout() resolves even when the revoke call fails', () async {
			final storage = MemoryTokenStorage();
			final fake = FakeTransport();
			fake.fallback = (_) async => throw StateError('network down');
			storage.set('tok');
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.auth.logout(); // must not throw
			expect(storage.get(), isNull);
			expect(storage.getRefresh(), isNull);
		});

		test('logout() without a stored refresh token never calls the server', () async {
			final storage = MemoryTokenStorage();
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'ok': true});
			storage.set('tok');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.auth.logout();
			expect(fake.calls, isEmpty);
			expect(storage.get(), isNull);
		});

		test('auth.login forwards device_id and stores the issued chain', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({
				'token': 'jwt-1',
				'refresh_token': 'refresh-1',
				'user': {'id': '1', 'email': 'a@b.c', 'full_name': 'A'},
			});
			final storage = MemoryTokenStorage();
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.auth.login(email: 'a@b.c', password: 'pw', deviceId: 'device-7');
			expect(jsonBodyOf(fake.last), equals({'email': 'a@b.c', 'password': 'pw', 'device_id': 'device-7'}));
			expect(storage.get(), 'jwt-1');
			expect(storage.getRefresh(), 'refresh-1');
		});

		test('a sign-in replaces the prior chain — or clears it when the server issued none', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'token': 'jwt-2', 'user': {'id': '2', 'email': 'b@c.d', 'full_name': 'B'}});
			final storage = MemoryTokenStorage();
			storage.set('jwt-1');
			storage.setRefresh('refresh-from-account-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.auth.login(email: 'b@c.d', password: 'pw');
			expect(storage.get(), 'jwt-2');
			expect(storage.getRefresh(), isNull); // never carry a previous session's chain
		});

		test('an auth-path request never rotates, clears or grafts the session', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => envelope({'revoked': 0});
			final storage = MemoryTokenStorage();
			storage.set(expiredToken());
			storage.setRefresh('refresh-1');
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler, tokenStorage: storage));
			await client.request('/auth/logout', method: 'POST', body: {'refresh_token': 'refresh-1'});
			expect(fake.calls, hasLength(1)); // no rotation recursion
			expect(authOf(fake.last), isNull);
			expect(idempotencyKeyOf(fake.last), isNull);
			expect(storage.get(), isNotNull); // the refresh token must survive for logout()/refresh()
			expect(storage.getRefresh(), 'refresh-1');
		});
	});
}

/// Riverpod session + write providers — who is signed in, per-collection
/// field restrictions, mutation state, and the offline pending/flush bridge.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';
import 'package:mex_flutter_sdk/riverpod.dart';

import 'support.dart';

void main() {
	HeadlessErpClient clientWith(
		FakeTransport transport, {
		TokenStorage? storage,
		OfflineQueue? queue,
	}) =>
		HeadlessErpClient(HeadlessErpOptions(
			baseUrl: 'https://api.test',
			transport: transport.handler,
			tokenStorage: storage,
			offlineQueue: queue,
		));

	ProviderContainer containerWith(HeadlessErpClient client) => ProviderContainer.test(
		overrides: [erpClientProvider.overrideWithValue(client)],
		// Riverpod 3 auto-retries failed providers with backoff. Tests must see
		// the FIRST verdict — a masked retry would swallow the error under test.
		retry: (retryCount, error) => null,
	);

	OfflineQueue memoryQueue(FakeTransport transport) => OfflineQueue.create(
		OfflineQueueOptions(storage: MemoryQueueStorage(), transport: transport.handler),
	);

	group('erpSessionProvider', () {
		test('no stored token → signed out, without a request', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));

			expect(await container.read(erpSessionProvider.future), isNull);
			expect(transport.calls, isEmpty);
		});

		test('a stored token resolves the identity through /auth/me', () async {
			final transport = FakeTransport();
			final storage = MemoryTokenStorage()..set(makeToken(9999999999999));
			final container = containerWith(clientWith(transport, storage: storage));

			transport.onceOk(envelope({'id': 'u1', 'email': 'ada@example.com'}));
			final user = await container.read(erpSessionProvider.future);

			expect(user?['id'], 'u1');
			expect(transport.last.url.path, '/auth/me');
		});

		test('a 401 verdict ends the local session and reports signed out', () async {
			final transport = FakeTransport();
			final storage = MemoryTokenStorage()..set(makeToken(9999999999999));
			final container = containerWith(clientWith(transport, storage: storage));

			transport.onceOk(errorEnvelope(401, {'message': 'expired'}));

			expect(await container.read(erpSessionProvider.future), isNull);
			expect(storage.get(), isNull, reason: 'the dead chain is dropped locally');
		});

		test('a network failure is an ERROR — an offline resume is not signed out', () async {
			final transport = FakeTransport();
			final storage = MemoryTokenStorage()..set(makeToken(9999999999999));
			final container = containerWith(clientWith(transport, storage: storage));

			transport.onceThrow(StateError('offline'));

			await expectLater(
				container.read(erpSessionProvider.future),
				throwsA(isA<ErpNetworkException>()),
			);
			expect(storage.get(), isNotNull, reason: 'the session survives an unreachable server');
		});

		test('login swaps the session and bumps the data version', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport, storage: MemoryTokenStorage()));

			// Build first (signed out), then sign in.
			expect(await container.read(erpSessionProvider.future), isNull);

			transport.onceOk(envelope({
				'token': makeToken(9999999999999),
				'refresh_token': 'r1',
				'user': {'id': 'u1'},
			}));
			final user = await container.read(erpSessionProvider.notifier).login(
				email: 'ada@example.com',
				password: 'secret',
			);

			expect(user['id'], 'u1');
			expect(container.read(erpSessionProvider).value?['id'], 'u1');
			expect(
				container.read(erpDataVersionProvider),
				1,
				reason: 'the previous account\'s cached rows must be dropped',
			);
		});

		test('logout clears the session, revokes the chain best-effort, and bumps', () async {
			final transport = FakeTransport();
			final storage = MemoryTokenStorage()..set(makeToken(9999999999999));
			storage.setRefresh('r1');
			final container = containerWith(clientWith(transport, storage: storage));

			transport.onceOk(envelope({'id': 'u1'}));
			expect(await container.read(erpSessionProvider.future), isNotNull);

			transport.onceOk(envelope(null));
			await container.read(erpSessionProvider.notifier).logout();

			expect(container.read(erpSessionProvider).value, isNull);
			expect(container.read(erpDataVersionProvider), 1);
			expect(storage.get(), isNull);
			expect(transport.last.url.path, '/auth/logout');
		});
	});

	group('erpFieldRestrictionsProvider', () {
		test('reads the caller\'s whitelist for a collection', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			transport.onceOk(envelope({
				'field_restrictions': ['code', 'total'],
			}));
			container.listen(erpFieldRestrictionsProvider('orders'), (previous, next) {});

			final restrictions = await container.read(erpFieldRestrictionsProvider('orders').future);

			expect(restrictions, ['code', 'total']);
			expect(transport.last.url.path, '/auth/me');
			expect(transport.last.url.queryParameters['collection'], 'orders');
		});
	});

	group('erpMutationsProvider', () {
		test('create resolves the row and exposes the outcome as AsyncData', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			container.listen(erpMutationsProvider('orders'), (previous, next) {});

			transport.onceOk(envelope({'id': 'o1', 'code': 'PO-1'}));
			final row = await container.read(erpMutationsProvider('orders').notifier).create({'code': 'PO-1'});

			expect(row['id'], 'o1');
			expect(container.read(erpMutationsProvider('orders'))?.value?['code'], 'PO-1');
			expect(transport.last.method, 'POST');
			expect(transport.last.url.path, '/entities/orders');
		});

		test('a refused write surfaces as AsyncError and still rethrows', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			container.listen(erpMutationsProvider('orders'), (previous, next) {});

			transport.onceOk(errorEnvelope(422, {'message': 'invalid'}));

			await expectLater(
				container.read(erpMutationsProvider('orders').notifier).update('o1', {'code': ''}),
				throwsA(isA<ErpException>()),
			);
			expect(container.read(erpMutationsProvider('orders'))?.hasError, isTrue);
		});
	});

	group('offline bridge', () {
		test('pending count follows the queue; flush drains it and bumps the version', () async {
			final transport = FakeTransport();
			final queue = memoryQueue(transport);
			final container = ProviderContainer.test(
				overrides: [
					erpClientProvider.overrideWithValue(clientWith(transport, queue: queue)),
					erpOfflineQueueProvider.overrideWithValue(queue),
				],
				retry: (retryCount, error) => null,
			);

			expect(container.read(erpPendingMutationsProvider), 0);
			queue.enqueue('POST', '/entities/orders', {'id': 'o1'});
			await pumpEventQueue();
			expect(container.read(erpPendingMutationsProvider), 1);

			transport.onceOk(envelope({'id': 'o1'}));
			final replayed = await container.read(erpPendingMutationsProvider.notifier).flush();

			expect(replayed, 1);
			expect(container.read(erpPendingMutationsProvider), 0);
			expect(
				container.read(erpDataVersionProvider),
				1,
				reason: 'replays bypass the pipeline — only a version bump refetches the reads',
			);
			expect(transport.last.method, 'POST');
			expect(transport.last.url.path, '/api/entities/orders');
		});

		test('a queued write throws the network error AND stays pending', () async {
			final transport = FakeTransport();
			final queue = memoryQueue(transport);
			final client = clientWith(transport, queue: queue);
			final container = ProviderContainer.test(
				overrides: [
					erpClientProvider.overrideWithValue(client),
					erpOfflineQueueProvider.overrideWithValue(queue),
				],
				retry: (retryCount, error) => null,
			);

			transport.onceThrow(StateError('offline'));
			await expectLater(
				client.items('orders').create({'code': 'PO-1'}),
				throwsA(isA<ErpNetworkException>()),
			);
			await pumpEventQueue();

			expect(container.read(erpPendingMutationsProvider), 1);
		});

		test('no queue wired → zero pending and a no-op flush', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));

			expect(container.read(erpPendingMutationsProvider), 0);
			expect(await container.read(erpPendingMutationsProvider.notifier).flush(), 0);
			expect(transport.calls, isEmpty);
		});
	});
}

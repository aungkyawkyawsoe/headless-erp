/// Offline mutation queue — the 1:1 Dart port of `test/offline.test.ts`.
///
/// Pins the replay contract: in-order flush with per-item auth, idempotency
/// keys carried through, 409 as success (EXCEPT an ifMatch conflict = real
/// rejection, dropped), permanent 4xx dropped, 5xx/network kept — and the
/// per-ACCOUNT fingerprint guard (a re-minted token is not a new user).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';
import 'package:mex_flutter_sdk/src/log.dart';

import 'support.dart';

void main() {
	group('OfflineQueue', () {
		test('enqueues mutations in order and reports them', () {
			final queue = OfflineQueue.create();
			queue.enqueue('POST', '/entities/orders', {'id': 'a1', 'type': 'check-in'});
			queue.enqueue('DELETE', '/entities/orders/a1');
			expect(queue.pending(), hasLength(2));
			expect(queue.pending()[0].path, '/entities/orders');
			expect(queue.pending()[0].id, matches(uuidPattern)); // own queue id (UUID)
			// Entity id preserved in the body — replay-safe.
			expect((queue.pending()[0].body! as Map)['id'], 'a1');
		});

		test('flushes in order with auth headers and drops successful items', () async {
			final seen = <({String method, String url, String? auth})>[];
			final transport = FakeTransport();
			transport.fallback = (request) async {
				seen.add((
					method: request.method,
					url: request.url.toString(),
					auth: authOf(request),
				));
				return const ErpResponse(status: 200);
			};
			final queue = OfflineQueue.create(OfflineQueueOptions(
				getToken: () => 'tok-1',
				transport: transport.handler,
			));
			queue.enqueue('POST', '/entities/orders', {'id': 'a1'});
			queue.enqueue('PUT', '/entities/orders/a1', {'note': 'x'}, 'ts-1');

			expect(await queue.flush(), 2);
			expect(queue.pending(), isEmpty);
			expect(seen[0].url, '/api/entities/orders');
			expect(seen[0].auth, 'Bearer tok-1');
			expect(seen[1].auth, 'Bearer tok-1');
		});

		test('replays with the captured Idempotency-Key; unkeyed items send no header', () async {
			final seen = <({String method, String? key})>[];
			final transport = FakeTransport();
			transport.fallback = (request) async {
				seen.add((method: request.method, key: idempotencyKeyOf(request)));
				return const ErpResponse(status: 200);
			};
			final queue = OfflineQueue.create(OfflineQueueOptions(transport: transport.handler));
			queue.enqueue('POST', '/entities/orders', {'id': 'a1'}, null, 'idem-1');
			queue.enqueue('PUT', '/entities/orders/a1', {'note': 'x'});

			expect(await queue.flush(), 2);
			expect(queue.pending(), isEmpty);
			expect(seen[0].key, 'idem-1'); // keyed item carries the header
			expect(seen[1].key, isNull); // unkeyed item sends no header
		});

		test('treats a 409 replay as success (idempotent create already landed)', () async {
			final transport = FakeTransport();
			transport.fallback = (_) async => const ErpResponse(status: 409);
			final queue = OfflineQueue.create(OfflineQueueOptions(transport: transport.handler));
			queue.enqueue('POST', '/entities/x', {'id': 'dup'});
			expect(await queue.flush(), 1);
			expect(queue.pending(), isEmpty);
		});

		test('drops a queued PUT with ifMatch on 409 (record changed while offline — permanent conflict)', () async {
			final failed = <({QueuedMutation item, Object? err})>[];
			final transport = FakeTransport();
			transport.fallback = (_) async => const ErpResponse(status: 409);
			final queue = OfflineQueue.create(OfflineQueueOptions(
				transport: transport.handler,
				onFailed: (item, err) => failed.add((item: item, err: err)),
			));
			queue.enqueue('PUT', '/entities/x/a', {'note': 'x'}, 'ts-1');
			expect(await queue.flush(), 0); // NOT counted as replayed
			expect(queue.pending(), isEmpty); // dropped, not kept
			expect(failed, hasLength(1));
			expect((failed[0].err! as ErpException).message, contains('If-Match mismatch'));
			expect(failed[0].item.ifMatch, 'ts-1');
		});

		test('still replays a queued DELETE with ifMatch on a non-409 success', () async {
			final transport = FakeTransport();
			transport.fallback = (_) async => const ErpResponse(status: 200);
			final queue = OfflineQueue.create(OfflineQueueOptions(transport: transport.handler));
			queue.enqueue('DELETE', '/entities/x/a', null, 'ts-1');
			expect(await queue.flush(), 1);
			expect(queue.pending(), isEmpty);
		});

		test('keeps items that fail and reports them', () async {
			var calls = 0;
			final failed = <Object?>[];
			final transport = FakeTransport();
			transport.fallback = (_) async {
				calls++;
				if (calls == 1) throw Exception('Failed to fetch');
				return const ErpResponse(status: 500);
			};
			final queue = OfflineQueue.create(OfflineQueueOptions(
				transport: transport.handler,
				onFailed: (item, err) => failed.add((item, err)),
			));
			queue.enqueue('POST', '/entities/x', {'id': 'b1'});
			queue.enqueue('POST', '/entities/y', {'id': 'b2'});

			expect(await queue.flush(), 0);
			expect(queue.pending(), hasLength(2));
			expect(failed, hasLength(2));
		});

		test('notifies subscribers on enqueue/clear, and unsubscribes cleanly', () {
			final queue = OfflineQueue.create();
			final events = <String>[];
			final unsubscribe = queue.subscribe(() => events.add('change'));
			queue.enqueue('POST', '/entities/x', {'id': 'c1'});
			queue.clear();
			expect(events, ['change', 'change']);
			unsubscribe();
			queue.enqueue('POST', '/entities/x', {'id': 'c2'});
			expect(events, hasLength(2)); // no further notifications
		});

		test('persists across instances with a shared storage', () {
			final storage = MemoryQueueStorage();
			OfflineQueue.create(OfflineQueueOptions(storage: storage))
				.enqueue('DELETE', '/entities/x/a');
			final second = OfflineQueue.create(OfflineQueueOptions(storage: storage));
			expect(second.pending(), hasLength(1));
		});
	});

	group('OfflineQueue identity scoping', () {
		test('replays a RE-MINTED token for the same account (a refresh is not a new user)', () async {
			final transport = FakeTransport();
			transport.fallback = (_) async => const ErpResponse(status: 200);
			final warnings = <String>[];
			sdkLogSink = warnings.add;
			addTearDown(() => sdkLogSink = null);

			var token = tokenFor('u-1', 'jti-1');
			final queue = OfflineQueue.create(OfflineQueueOptions(
				getToken: () => token,
				transport: transport.handler,
			));
			queue.enqueue('POST', '/entities/orders', {'id': 'a1'});

			token = tokenFor('u-1', 'jti-2'); // same human, fresh session
			expect(await queue.flush(), 1);
			expect(queue.pending(), isEmpty);
			expect(warnings, isEmpty);
		});

		test("never replays another account's queue — and keeps its items for its owner", () async {
			final transport = FakeTransport();
			transport.fallback = (_) async => const ErpResponse(status: 200);
			final warnings = <String>[];
			sdkLogSink = warnings.add;
			addTearDown(() => sdkLogSink = null);

			var token = tokenFor('u-1', 'jti-1');
			final queue = OfflineQueue.create(OfflineQueueOptions(
				getToken: () => token,
				transport: transport.handler,
			));
			queue.enqueue('POST', '/entities/orders', {'id': 'a1'});

			token = tokenFor('u-2', 'jti-9'); // a different human on the same device
			expect(await queue.flush(), 0);
			expect(transport.calls, isEmpty);
			expect(queue.pending(), hasLength(1)); // no data loss — the owner may return
			expect(warnings, hasLength(1));
		});

		test('silently adopts the current identity when there is nothing queued', () async {
			final transport = FakeTransport();
			transport.fallback = (_) async => const ErpResponse(status: 200);
			final warnings = <String>[];
			sdkLogSink = warnings.add;
			addTearDown(() => sdkLogSink = null);

			final storage = MemoryQueueStorage();
			storage.setFingerprint(fingerprint('someone-else'));
			final queue = OfflineQueue.create(OfflineQueueOptions(
				storage: storage,
				getToken: () => tokenFor('u-1', 'jti-1'),
			));

			expect(await queue.flush(), 0);
			expect(warnings, isEmpty); // no writes existed to warn about

			// The tag moved on, so the NEXT write is this account's without a warning.
			queue.enqueue('POST', '/entities/orders', {'id': 'a1'});
			expect(queue.pending(), hasLength(1));
			expect(warnings, isEmpty);
		});

		test("discards a previous account's writes when a new one queues its own", () {
			final warnings = <String>[];
			sdkLogSink = warnings.add;
			addTearDown(() => sdkLogSink = null);
			final storage = MemoryQueueStorage();

			final first = OfflineQueue.create(OfflineQueueOptions(
				storage: storage,
				getToken: () => tokenFor('u-1', 'jti-1'),
			));
			first.enqueue('POST', '/entities/orders', {'id': 'a1'});

			final second = OfflineQueue.create(OfflineQueueOptions(
				storage: storage,
				getToken: () => tokenFor('u-2', 'jti-2'),
			));
			second.enqueue('POST', '/entities/orders', {'id': 'b1'});

			expect(second.pending().map((item) => (item.body! as Map)['id']).toList(), ['b1']);
			expect(warnings, hasLength(1));
		});
	});
}

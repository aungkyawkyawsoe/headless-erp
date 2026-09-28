/// Offline reads — the 1:1 Dart port of `test/offline-reads.test.ts`.
///
/// A read body is kept on the device ONLY when the server blessed that
/// response with `X-Offline-Max-Age` (the collection's
/// `policies.offline_reads`), and only for that window. Everything else stays
/// network-only; another account's device copy is refused and discarded; a 304
/// slides the window; logout purges every device copy.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import 'support.dart';

const String token = 'jwt-offline-test';
const String urlPath = '/entities/orders';
const String key = '/api$urlPath';

MemoryTokenStorage withToken() => MemoryTokenStorage()..set(token);

void main() {
	group('offline reads (SDK)', () {
		test('serves a blessed read from the device when the network is gone', () async {
			final rows = [{'id': '1'}];
			final fake = FakeTransport();
			fake.onceOk(ok(rows, etag: 'W/"v1"', offlineMaxAge: 3600));
			fake.onceThrow(Exception('Failed to fetch'));

			final client = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: fake.handler,
				conditionalGet: ConditionalResponseCache(storage: MemoryResponseCacheStorage()),
			));
			expect(await client.request(urlPath), equals(rows));
			// Second call never reaches the server (transport rejects) yet returns the rows.
			expect(await client.request(urlPath), equals(rows));
			expect(fake.calls, hasLength(2));
		});

		test('does NOT serve a read the server never blessed', () async {
			final fake = FakeTransport();
			fake.onceOk(ok([{'id': '1'}], etag: 'W/"v1"'));
			fake.onceThrow(Exception('Failed to fetch'));

			final client = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: fake.handler,
				conditionalGet: ConditionalResponseCache(storage: MemoryResponseCacheStorage()),
			));
			expect(await client.request(urlPath), equals([{'id': '1'}]));
			await expectLater(client.request(urlPath), throwsA(isA<ErpNetworkException>()));
		});

		test('survives a reload when the storage is shared (device persistence)', () async {
			final rows = [{'id': '1'}];
			final storage = MemoryResponseCacheStorage();
			final fake = FakeTransport();
			fake.onceOk(ok(rows, etag: 'W/"v1"', offlineMaxAge: 3600));

			// Session 1 — one online read.
			final first = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: fake.handler,
				conditionalGet: ConditionalResponseCache(storage: storage),
			));
			expect(await first.request(urlPath), equals(rows));

			// Session 2 — a brand-new client (as after an app restart) with no network.
			final offlineFake = FakeTransport();
			offlineFake.fallback = (_) => Future.error(Exception('Failed to fetch'));
			final second = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: offlineFake.handler,
				conditionalGet: ConditionalResponseCache(storage: storage),
			));
			expect(await second.request(urlPath), equals(rows));
		});

		test('refuses a device copy that belongs to another account', () async {
			final storage = MemoryResponseCacheStorage();
			storage.set([
				PersistedResponse(
					key,
					CachedResponse(
						etag: 'W/"v1"',
						data: [
							{'id': 'secret'},
						],
						storedAt: DateTime.now().millisecondsSinceEpoch,
						maxAgeS: 3600,
					),
				),
			]);
			storage.setFingerprint('someone-else');
			final fake = FakeTransport();
			fake.onceThrow(Exception('Failed to fetch'));

			final client = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: fake.handler,
				conditionalGet: ConditionalResponseCache(storage: storage),
			));
			await expectLater(client.request(urlPath), throwsA(isA<ErpNetworkException>()));
			// The other account's copy is discarded, not left for the next hydrate.
			expect(storage.get(), isEmpty);
			expect(storage.getFingerprint(), isNull);
		});

		test('drops an entry whose offline window has expired', () async {
			final storage = MemoryResponseCacheStorage();
			storage.set([
				PersistedResponse(
					key,
					CachedResponse(
						etag: 'W/"v1"',
						data: [
							{'id': '1'},
						],
						storedAt: DateTime.now().millisecondsSinceEpoch - 10000,
						maxAgeS: 1,
					),
				),
			]);
			storage.setFingerprint(fingerprint(token));
			final fake = FakeTransport();
			fake.onceThrow(Exception('Failed to fetch'));

			final client = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: fake.handler,
				conditionalGet: ConditionalResponseCache(storage: storage),
			));
			await expectLater(client.request(urlPath), throwsA(isA<ErpNetworkException>()));
		});

		test('purges every device copy on logout', () async {
			final storage = MemoryResponseCacheStorage();
			final fake = FakeTransport();
			fake.onceOk(ok([{'id': '1'}], etag: 'W/"v1"', offlineMaxAge: 3600));

			final client = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: fake.handler,
				conditionalGet: ConditionalResponseCache(storage: storage),
			));
			await client.request(urlPath);
			expect(storage.get(), hasLength(1));

			client.auth.logout();
			expect(storage.get(), isEmpty);
			expect(storage.getFingerprint(), isNull);
		});

		test('keeps the offline window sliding across a 304 revalidation', () async {
			final storage = MemoryResponseCacheStorage();
			var fakeNow = DateTime.now().millisecondsSinceEpoch;
			final cache = ConditionalResponseCache(
				storage: storage,
				now: () => fakeNow,
			);
			final fake = FakeTransport();
			fake.onceOk(ok([{'id': '1'}], etag: 'W/"v1"', offlineMaxAge: 3600));
			fake.onceOk(notModified(offlineMaxAge: '3600'));
			fake.onceThrow(Exception('Failed to fetch'));

			final client = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: fake.handler,
				conditionalGet: cache,
			));
			await client.request(urlPath);
			final storedAt = storage.get()[0].entry.storedAt!;

			// A 304 at a later time must refresh the window, not let it lapse.
			fakeNow = storedAt + 60000;
			expect(await client.request(urlPath), equals([{'id': '1'}]));
			expect(storage.get()[0].entry.storedAt, storedAt + 60000);

			// And the refreshed copy is still servable offline.
			expect(await client.request(urlPath), equals([{'id': '1'}]));
		});

		test('never persists a write response', () async {
			final storage = MemoryResponseCacheStorage();
			final fake = FakeTransport();
			fake.onceOk(ok({'id': '1'}, etag: 'W/"v1"', offlineMaxAge: 3600));

			final client = HeadlessErpClient(HeadlessErpOptions(
				tokenStorage: withToken(),
				transport: fake.handler,
				conditionalGet: ConditionalResponseCache(storage: storage),
			));
			await client.request(urlPath, method: 'POST', body: {'title': 'a'});
			expect(storage.get(), isEmpty);
		});
	});
}

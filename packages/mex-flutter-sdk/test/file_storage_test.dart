/// File-backed storage tests — the pure-Dart stand-ins for the TS
/// `localStorage*` adapters: `FileResponseCacheStorage` (offline reads) and
/// `FileQueueStorage` (offline writes). Covers restart survival, the account
/// fingerprint guard, expiry on hydrate, and corrupt/empty-file tolerance.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

void main() {
	late Directory dir;

	setUp(() {
		dir = Directory.systemTemp.createTempSync('erp-sdk-file-');
	});

	tearDown(() {
		if (dir.existsSync()) dir.deleteSync(recursive: true);
	});

	CachedResponse blessed(String data, {int? storedAt, num maxAgeS = 3600}) => CachedResponse(
		etag: 'etag-$data',
		data: data,
		storedAt: storedAt ?? DateTime.now().millisecondsSinceEpoch,
		maxAgeS: maxAgeS,
	);

	group('FileResponseCacheStorage', () {
		test('persists blessed entries and rehydrates them in a new instance (restart survival)', () {
			final file = File('${dir.path}/read-cache.json');
			final cache1 = ConditionalResponseCache(storage: FileResponseCacheStorage(file));
			cache1.hydrate('fp-1');
			cache1.set('https://api/orders', blessed('orders'));

			expect(file.existsSync(), isTrue);
			expect((jsonDecode(file.readAsStringSync()) as Map)['v'], 1);

			// A fresh process — new cache, new storage object, same file.
			final cache2 = ConditionalResponseCache(storage: FileResponseCacheStorage(file));
			cache2.hydrate('fp-1');
			final hit = cache2.get('https://api/orders');
			expect(hit, isNotNull);
			expect(hit!.data, 'orders');
			expect(hit.etag, 'etag-orders');
		});

		test('rejects another account\'s persisted copy (fingerprint guard)', () {
			final file = File('${dir.path}/read-cache.json');
			final cacheA = ConditionalResponseCache(storage: FileResponseCacheStorage(file));
			cacheA.hydrate('acct-A');
			cacheA.set('k', blessed('secret'));

			final cacheB = ConditionalResponseCache(storage: FileResponseCacheStorage(file));
			cacheB.hydrate('acct-B');
			expect(cacheB.get('k'), isNull);

			// The rejected copy is erased from the device, not just ignored.
			final raw = jsonDecode(file.readAsStringSync()) as Map;
			expect(raw['entries'] as List, isEmpty);
			expect(raw['fp'], isNull);
		});

		test('drops entries whose offline window passed while the app was closed', () {
			final file = File('${dir.path}/read-cache.json');
			var fakeNow = 1000000000000;
			final cache1 = ConditionalResponseCache(storage: FileResponseCacheStorage(file), now: () => fakeNow);
			cache1.hydrate('fp');
			cache1.set('k', blessed('v', storedAt: fakeNow, maxAgeS: 60));

			// Reopened an hour later — the 60s window is long gone.
			final cache2 = ConditionalResponseCache(storage: FileResponseCacheStorage(file), now: () => fakeNow + 3600000);
			cache2.hydrate('fp');
			expect(cache2.get('k'), isNull);
		});

		test('tolerates missing, corrupt and empty files (and repairs on write)', () {
			final file = File('${dir.path}/read-cache.json');
			final storage = FileResponseCacheStorage(file);

			expect(storage.get(), isEmpty); // missing
			file.writeAsStringSync('not-json {{{');
			expect(storage.get(), isEmpty); // corrupt
			file.writeAsStringSync('');
			expect(storage.get(), isEmpty); // empty

			storage.setFingerprint('fp-x');
			expect(storage.getFingerprint(), 'fp-x'); // write repaired the file
		});

		test('set() preserves the stored fingerprint and setFingerprint() preserves entries', () {
			final file = File('${dir.path}/read-cache.json');
			final storage = FileResponseCacheStorage(file);
			storage.setFingerprint('fp-1');
			storage.set([PersistedResponse('k', blessed('v'))]);
			expect(storage.getFingerprint(), 'fp-1');
			expect(storage.get().single.key, 'k');
		});
	});

	group('FileQueueStorage', () {
		QueuedMutation mutation(String id) => QueuedMutation(
			id: id,
			method: 'POST',
			path: '/entities/records',
			body: {'title': id},
			idempotencyKey: 'key-$id',
			createdAt: 1,
		);

		test('persists queued mutations across instances (restart survival)', () {
			final file = File('${dir.path}/queue.json');
			FileQueueStorage(file).set([mutation('a'), mutation('b')]);
			FileQueueStorage(file).setFingerprint('fp-1');

			final reopened = FileQueueStorage(file);
			expect(reopened.get().map((m) => m.id), ['a', 'b']);
			expect(reopened.get().first.body, {'title': 'a'});
			expect(reopened.getFingerprint(), 'fp-1');
		});

		test('reads a legacy bare-array file, then adopts the versioned envelope', () {
			final file = File('${dir.path}/queue.json');
			file.writeAsStringSync(jsonEncode([mutation('a').toJson()]));

			final storage = FileQueueStorage(file);
			expect(storage.get().map((m) => m.id), ['a']);

			storage.set(storage.get());
			final raw = jsonDecode(file.readAsStringSync()) as Map;
			expect(raw['v'], 2);
			expect(raw['fp'], isNull);
		});

		test('a write to an unwritable path never throws (persistence is best-effort)', () {
			final blocker = File('${dir.path}/blocker')..writeAsStringSync('x');
			final storage = FileQueueStorage(File('${blocker.path}/queue.json'));

			expect(() => storage.set([mutation('a')]), returnsNormally);
			expect(storage.get(), isEmpty); // nothing persisted, nothing crashed
		});
	});
}

/// Conditional GETs (ETag / 304) — the 1:1 Dart port of
/// `test/conditional-get.test.ts`.
///
/// Pins: the stored tag is replayed as `If-None-Match`; an unchanged 304 is
/// served from memory (no body crosses the wire); a changed tag replaces the
/// stored body; untagged responses are never revalidated; query variants stay
/// apart; writes never participate; the store is LRU-capped.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import 'support.dart';

void main() {
	group('conditional GET (SDK)', () {
		test('replays the stored tag and serves an unchanged 304 from memory', () async {
			final rows = [{'id': '1'}];
			final fake = FakeTransport();
			fake.onceOk(ok(rows, etag: 'W/"v1"'));
			fake.onceOk(notModified());

			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));
			// First read has nothing to revalidate against.
			expect(await client.request('/entities/orders'), equals(rows));
			expect(sentIfNoneMatch(fake.calls[0]), isNull);

			// Second read sends the tag; the bodiless 304 still yields the rows,
			// because the client kept the body the tag described.
			expect(await client.request('/entities/orders'), equals(rows));
			expect(sentIfNoneMatch(fake.calls[1]), 'W/"v1"');
		});

		test('replaces the stored body when the tag changes', () async {
			final fake = FakeTransport();
			fake.onceOk(ok([{'id': '1'}], etag: 'W/"v1"'));
			fake.onceOk(ok([{'id': '1'}, {'id': '2'}], etag: 'W/"v2"'));
			fake.onceOk(notModified());
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));

			await client.request('/entities/orders');
			expect(await client.request('/entities/orders'), equals([{'id': '1'}, {'id': '2'}]));
			// The newer tag is now the one replayed, and it still resolves from memory.
			expect(await client.request('/entities/orders'), equals([{'id': '1'}, {'id': '2'}]));
			expect(sentIfNoneMatch(fake.calls[2]), 'W/"v2"');
		});

		test('does not revalidate a response the server did not tag', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => ok([{'id': '1'}]);
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));

			await client.request('/entities/orders');
			await client.request('/entities/orders');
			expect(sentIfNoneMatch(fake.calls[1]), isNull);
		});

		test('keeps query variants apart', () async {
			final fake = FakeTransport();
			fake.onceOk(ok([{'id': '1'}], etag: 'W/"page1"'));
			fake.onceOk(ok([{'id': '2'}], etag: 'W/"page2"'));
			fake.onceOk(notModified());
			fake.onceOk(notModified());
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));

			await client.request('/entities/orders', query: QueryParams.of({'limit': '1'}));
			await client.request('/entities/orders', query: QueryParams.of({'limit': '1', 'cursor': 'c'}));
			expect(
				await client.request('/entities/orders', query: QueryParams.of({'limit': '1'})),
				equals([{'id': '1'}]),
			);
			expect(
				await client.request('/entities/orders', query: QueryParams.of({'limit': '1', 'cursor': 'c'})),
				equals([{'id': '2'}]),
			);
			expect(sentIfNoneMatch(fake.calls[2]), 'W/"page1"');
			expect(sentIfNoneMatch(fake.calls[3]), 'W/"page2"');
		});

		test('never revalidates when disabled', () async {
			final fake = FakeTransport();
			fake.fallback = (_) async => ok([{'id': '1'}], etag: 'W/"v1"');
			final client = HeadlessErpClient(HeadlessErpOptions(
				transport: fake.handler,
				conditionalGet: false,
			));

			await client.request('/entities/orders');
			await client.request('/entities/orders');
			expect(sentIfNoneMatch(fake.calls[1]), isNull);
		});

		test('does not revalidate writes', () async {
			final fake = FakeTransport();
			fake.onceOk(ok({'id': '1'}, etag: 'W/"v1"'));
			fake.onceOk(ok({'id': '1'}, etag: 'W/"v1"'));
			final client = HeadlessErpClient(HeadlessErpOptions(transport: fake.handler));

			await client.request('/entities/orders', method: 'POST', body: {'title': 'a'});
			await client.request('/entities/orders', method: 'POST', body: {'title': 'b'});
			expect(sentIfNoneMatch(fake.calls[1]), isNull);
		});
	});

	group('ConditionalResponseCache', () {
		test('evicts the least recently used entry past its cap', () {
			final cache = ConditionalResponseCache(maxEntries: 2);
			cache.set('a', const CachedResponse(etag: '1', data: []));
			cache.set('b', const CachedResponse(etag: '2', data: []));
			// Touch `a` so `b` becomes the least recently used.
			expect(cache.get('a')!.etag, '1');
			cache.set('c', const CachedResponse(etag: '3', data: []));

			expect(cache.size, 2);
			expect(cache.get('a')!.etag, '1');
			expect(cache.get('b'), isNull);
			expect(cache.get('c')!.etag, '3');
		});

		test('clears on demand', () {
			final cache = ConditionalResponseCache();
			cache.set('a', const CachedResponse(etag: '1', data: []));
			cache.clear();
			expect(cache.size, 0);
		});
	});
}

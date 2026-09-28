/// Riverpod read providers — the bridge's data half: canonical family keys,
/// envelope-driven invalidation, version bumps, and the cursor-walking
/// infinite list.
///
/// These pin the bridge's central claim: refreshing is driven by the SDK's
/// OWN invalidation signals, so a read refetches exactly when a write touched
/// what it shows — never periodically, never wholesale.
///
/// Flow note: an invalidation may rebuild EAGERLY (the provider holds a
/// listener), so the refetch's fake response is queued BEFORE the signal is
/// fired — the FakeTransport queue stays FIFO either way.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show ProviderException;
import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';
import 'package:mex_flutter_sdk/riverpod.dart';

import 'support.dart';

void main() {
	HeadlessErpClient clientWith(FakeTransport transport) => HeadlessErpClient(
		HeadlessErpOptions(baseUrl: 'https://api.test', transport: transport.handler),
	);

	ProviderContainer containerWith(HeadlessErpClient client) => ProviderContainer.test(
		overrides: [erpClientProvider.overrideWithValue(client)],
		// Riverpod 3 auto-retries failed providers with backoff. Tests must see
		// the FIRST verdict — a masked retry would double the transport calls.
		retry: (retryCount, error) => null,
	);

	/// A write response carrying the change envelope (`meta.changed`).
	ErpResponse writeWithChange(List<String> collections) => envelopeWithMeta(
		{'id': 'o1'},
		{
			'changed': {'collections': collections},
		},
	);

	group('erpClientProvider', () {
		test('throws a self-naming error until overridden', () {
			final container = ProviderContainer.test();
			expect(
				() => container.read(erpClientProvider),
				throwsA(
					isA<ProviderException>().having(
						(ProviderException err) => err.exception,
						'cause',
						isA<UnimplementedError>(),
					),
				),
			);
		});
	});

	group('erpChangesProvider', () {
		test('streams every envelope the client dispatches', () async {
			final transport = FakeTransport();
			final client = clientWith(transport);
			final container = containerWith(client);
			final seen = <List<String>>[];
			container.listen(erpChangesProvider, (previous, next) {
				final change = next.value;
				if (change != null) seen.add(change.collections);
			});

			transport.onceOk(writeWithChange(['orders']));
			await client.request('/entities/orders', method: 'POST', body: const {});
			await pumpEventQueue();

			expect(seen, [
				['orders'],
			]);
			expect(container.read(erpChangesProvider).value?.collections, ['orders']);
		});
	});

	group('family keys', () {
		test('erpItemsKey canonicalizes through the wire serialization', () {
			final key = ErpItemsKey('orders', ListQuery(filter: {'status': {'_eq': 'open'}}));
			final twin = ErpItemsKey('orders', ListQuery(filter: {'status': {'_eq': 'open'}}));

			expect(key, twin);
			expect(key.hashCode, twin.hashCode);
			expect(key, isNot(ErpItemsKey('orders', ListQuery(filter: {'status': {'_eq': 'done'}}))));
			expect(key, isNot(ErpItemsKey('invoices', ListQuery(filter: {'status': {'_eq': 'open'}}))));
		});

		test('invalidateOn is part of the identity (order-insensitive)', () {
			expect(ErpItemsKey('orders', null, {'customers'}), ErpItemsKey('orders', null, {'customers'}));
			expect(ErpItemsKey('orders', null, {'a', 'b'}), ErpItemsKey('orders', null, {'b', 'a'}));
			expect(ErpItemsKey('orders', null, {'customers'}), isNot(ErpItemsKey('orders')));
		});

		test('erpItemKey unifies a fields list with its CSV string', () {
			expect(
				ErpItemKey('orders', 'o1', fields: ['id', 'code']),
				ErpItemKey('orders', 'o1', fields: 'id, code'),
			);
			expect(ErpItemKey('orders', 'o1', fields: ['id']), isNot(ErpItemKey('orders', 'o1')));
		});

		test('erpCountKey canonicalizes the filter', () {
			expect(
				ErpCountKey('orders', filter: {'status': {'_eq': 'open'}}),
				ErpCountKey('orders', filter: {'status': {'_eq': 'open'}}),
			);
			expect(
				ErpCountKey('orders', filter: {'status': {'_eq': 'open'}}),
				isNot(ErpCountKey('orders', filter: {'status': {'_eq': 'done'}})),
			);
		});

		test('erpViewKey: spec ORDER is part of the request identity', () {
			final key = ErpViewKey([ErpViewSpec('open', 'orders'), ErpViewSpec('paid', 'invoices')]);

			expect(key, ErpViewKey([ErpViewSpec('open', 'orders'), ErpViewSpec('paid', 'invoices')]));
			expect(key, isNot(ErpViewKey([ErpViewSpec('paid', 'invoices'), ErpViewSpec('open', 'orders')])));
			expect(
				ErpViewKey([ErpViewSpec('open', 'orders')]),
				isNot(ErpViewKey([ErpViewSpec('open', 'invoices')])),
			);
		});
	});

	group('erpItemsProvider', () {
		test('two equal keys share ONE fetch', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			transport.onceOk(listEnvelope([
				{'id': 'o1'},
			], {'has_more': false}));

			final first = ErpItemsKey('orders', ListQuery(filter: {'status': {'_eq': 'open'}}));
			final second = ErpItemsKey('orders', ListQuery(filter: {'status': {'_eq': 'open'}}));
			container.listen(erpItemsProvider(first), (previous, next) {});
			container.listen(erpItemsProvider(second), (previous, next) {});

			final page = await container.read(erpItemsProvider(first).future);
			expect(page.data.map((row) => row['id']), ['o1']);
			expect(await container.read(erpItemsProvider(second).future), same(page));
			expect(transport.calls.length, 1);
		});

		test('a change envelope refetches exactly the collection it names', () async {
			final transport = FakeTransport();
			final client = clientWith(transport);
			final container = containerWith(client);
			final key = ErpItemsKey('orders');
			// Queue BEFORE the build-triggering listen: the first transport call
			// happens during the build, not lazily on read.
			transport.onceOk(listEnvelope([{'id': 'o1'}], {'has_more': false}));
			container.listen(erpItemsProvider(key), (previous, next) {});

			await container.read(erpItemsProvider(key).future);
			expect(transport.calls.single.url.path, '/entities/orders');

			// A write touching an UNRELATED collection must not move the read.
			transport.onceOk(writeWithChange(['invoices']));
			await client.request('/entities/invoices', method: 'POST', body: const {});
			await pumpEventQueue();
			await container.read(erpItemsProvider(key).future);
			expect(transport.calls.length, 2, reason: 'an unrelated envelope must not invalidate');

			// A write touching THIS collection invalidates — the refetch
			// response is queued BEFORE the write so an eager rebuild finds it.
			transport.onceOk(writeWithChange(['orders', 'order_lines']));
			transport.onceOk(listEnvelope([{'id': 'o1'}, {'id': 'o2'}], {'has_more': false}));
			await client.request('/entities/orders', method: 'POST', body: const {});
			await pumpEventQueue();

			final page = await container.read(erpItemsProvider(key).future);
			expect(page.data.map((row) => row['id']), ['o1', 'o2']);
			expect(transport.calls.length, 4); // GET, POST, POST, GET
		});

		test('a data-version bump refetches every wired read', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			final key = ErpItemsKey('orders');
			transport.onceOk(listEnvelope([{'id': 'o1'}], {'has_more': false}));
			container.listen(erpItemsProvider(key), (previous, next) {});

			await container.read(erpItemsProvider(key).future);

			transport.onceOk(listEnvelope([{'id': 'o9'}], {'has_more': false}));
			container.read(erpDataVersionProvider.notifier).bump();

			final page = await container.read(erpItemsProvider(key).future);
			expect(page.data.single['id'], 'o9');
			expect(transport.calls.length, 2);
		});
	});

	group('erpItemProvider / erpCountProvider', () {
		test('erpItemProvider reads one row with a canonical fields projection', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			final key = ErpItemKey('orders', 'o1', fields: ['id', 'code']);
			transport.onceOk(envelope({'id': 'o1', 'code': 'PO-1'}));
			container.listen(erpItemProvider(key), (previous, next) {});

			final row = await container.read(erpItemProvider(key).future);

			expect(row['code'], 'PO-1');
			expect(transport.last.url.path, '/entities/orders/o1');
			expect(transport.last.url.queryParameters['fields'], 'id,code');
		});

		test('erpCountProvider reads the total (count_only, no page rows)', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			final key = ErpCountKey('orders', filter: {'status': {'_eq': 'open'}});
			transport.onceOk(countEnvelope(42));
			container.listen(erpCountProvider(key), (previous, next) {});

			expect(await container.read(erpCountProvider(key).future), 42);
			expect(transport.last.url.queryParameters['count_only'], 'true');
			expect(transport.last.url.queryParameters['filter[status][_eq]'], 'open');
		});
	});

	group('erpViewProvider', () {
		test('POSTs the keyed specs and returns the keyed payload', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			final key = ErpViewKey([
				ErpViewSpec('open', 'orders', ListQuery(filter: {'status': {'_eq': 'open'}})),
				ErpViewSpec('recent', 'invoices'),
			]);
			transport.onceOk(envelope({
				'open': {
					'ok': true,
					'data': [
						{'id': 'o1'},
					],
				},
				'recent': {'ok': false, 'error': 'boom'},
			}));
			container.listen(erpViewProvider(key), (previous, next) {});

			final payload = await container.read(erpViewProvider(key).future);

			expect(transport.last.url.path, '/query');
			expect(transport.last.method, 'POST');
			final body = jsonBodyOf(transport.last) as Map<String, dynamic>;
			final specs = (body['queries'] as List).cast<Map<String, dynamic>>();
			expect(specs.map((spec) => spec['key']), ['open', 'recent']);
			expect((specs.first['params'] as Map)['filter[status][_eq]'], 'open');
			// Per-key failure isolation: the failing source reports INSIDE the
			// payload instead of killing the view.
			expect((payload['recent'] as Map)['ok'], false);
			expect((payload['open'] as Map)['data'], isNotEmpty);
		});

		test('a write to ANY spec collection refetches the view', () async {
			final transport = FakeTransport();
			final client = clientWith(transport);
			final container = containerWith(client);
			final key = ErpViewKey([ErpViewSpec('open', 'orders'), ErpViewSpec('recent', 'invoices')]);
			transport.onceOk(envelope({'open': {'ok': true}}));
			container.listen(erpViewProvider(key), (previous, next) {});

			await container.read(erpViewProvider(key).future);

			transport.onceOk(writeWithChange(['invoices']));
			transport.onceOk(envelope({
				'open': {
					'ok': true,
					'data': [
						{'id': 'o1'},
					],
				},
			}));
			await client.request('/entities/invoices', method: 'POST', body: const {});
			await pumpEventQueue();

			final payload = await container.read(erpViewProvider(key).future);
			expect((payload['open'] as Map)['data'], isNotEmpty);
			expect(transport.calls.length, 3); // POST /query, POST write, POST /query
		});
	});

	group('erpInfiniteItemsProvider', () {
		test('builds the first page, then walks next_cursor to the end', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			final key = ErpItemsKey('orders', const ListQuery(limit: 2));
			transport.onceOk(listEnvelope([
				{'id': 'o1'},
				{'id': 'o2'},
			], {
				'has_more': true,
				'next_cursor': 'c2',
			}));
			container.listen(erpInfiniteItemsProvider(key), (previous, next) {});

			final first = await container.read(erpInfiniteItemsProvider(key).future);
			expect(first.items.map((row) => row['id']), ['o1', 'o2']);
			expect(first.hasMore, isTrue);

			transport.onceOk(listEnvelope([{'id': 'o3'}], {'has_more': false}));
			await container.read(erpInfiniteItemsProvider(key).notifier).loadMore();

			final after = container.read(erpInfiniteItemsProvider(key)).value!;
			expect(after.items.map((row) => row['id']), ['o1', 'o2', 'o3']);
			expect(after.hasMore, isFalse);
			expect(transport.calls.first.url.queryParameters['limit'], '2');
			expect(transport.calls.last.url.queryParameters['cursor'], 'c2');

			// At the end — loadMore is a no-op.
			await container.read(erpInfiniteItemsProvider(key).notifier).loadMore();
			expect(transport.calls.length, 2);
		});

		test('a change envelope resets the list to a fresh first page', () async {
			final transport = FakeTransport();
			final client = clientWith(transport);
			final container = containerWith(client);
			final key = ErpItemsKey('orders');
			transport.onceOk(listEnvelope([{'id': 'o1'}], {'has_more': true, 'next_cursor': 'c2'}));
			container.listen(erpInfiniteItemsProvider(key), (previous, next) {});

			await container.read(erpInfiniteItemsProvider(key).future);
			transport.onceOk(listEnvelope([{'id': 'o2'}], {'has_more': false}));
			await container.read(erpInfiniteItemsProvider(key).notifier).loadMore();

			transport.onceOk(writeWithChange(['orders']));
			transport.onceOk(listEnvelope([{'id': 'o9'}], {'has_more': false}));
			await client.request('/entities/orders', method: 'POST', body: const {});
			await pumpEventQueue();

			final reset = await container.read(erpInfiniteItemsProvider(key).future);
			expect(reset.items.map((row) => row['id']), ['o9']);
			expect(reset.hasMore, isFalse);
			expect(transport.calls.length, 4); // GET, GET, POST, GET
		});

		test('a failed page keeps the loaded rows and rethrows', () async {
			final transport = FakeTransport();
			final container = containerWith(clientWith(transport));
			final key = ErpItemsKey('orders');
			transport.onceOk(listEnvelope([{'id': 'o1'}], {'has_more': true, 'next_cursor': 'c2'}));
			container.listen(erpInfiniteItemsProvider(key), (previous, next) {});

			await container.read(erpInfiniteItemsProvider(key).future);

			transport.onceThrow(StateError('offline'));
			await expectLater(
				container.read(erpInfiniteItemsProvider(key).notifier).loadMore(),
				throwsA(isA<ErpNetworkException>()),
			);

			final after = container.read(erpInfiniteItemsProvider(key)).value!;
			expect(after.items.map((row) => row['id']), ['o1']);
			expect(after.hasMore, isTrue);
			expect(after.loadingMore, isFalse);
		});
	});
}

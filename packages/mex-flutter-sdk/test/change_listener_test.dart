/// Change-envelope fan-out — [HeadlessErpClient.addChangeListener], the
/// Dart-only additive seam next to the single `onChange` option.
///
/// Pins the three guarantees the Riverpod bridge relies on:
///   1. every subscriber receives each envelope, unsubscribe included;
///   2. one throwing subscriber can neither fail the request nor starve
///      the others (fault isolation — the whole point of a fan-out seam);
///   3. auth paths (login/refresh/logout) never fan out — an auth response
///      carrying a `meta.changed` block is ignored, exactly like `onChange`.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import 'support.dart';

void main() {
	group('client.addChangeListener', () {
		HeadlessErpClient clientWith(FakeTransport transport, {TokenStorage? storage}) =>
			HeadlessErpClient(HeadlessErpOptions(
				baseUrl: 'https://api.test',
				transport: transport.handler,
				tokenStorage: storage,
			));

		ErpResponse writeWithChange(List<String> collections) => envelopeWithMeta(
			{'id': 'o1'},
			{
				'changed': {'collections': collections},
			},
		);

		test('delivers each envelope to every subscriber; unsubscribe stops delivery', () async {
			final transport = FakeTransport();
			final client = clientWith(transport);
			final first = <List<String>>[];
			final second = <List<String>>[];
			final offFirst = client.addChangeListener((change, path, method) => first.add(change.collections));
			final offSecond = client.addChangeListener((change, path, method) => second.add(change.collections));

			transport.onceOk(writeWithChange(['orders', 'order_lines']));
			await client.request('/entities/orders', method: 'POST', body: {'code': 'PO-1'});
			offFirst();

			transport.onceOk(writeWithChange(['orders']));
			await client.request('/entities/orders', method: 'POST', body: {'code': 'PO-2'});
			offSecond();

			expect(first, [
				['orders', 'order_lines'],
			]);
			expect(second, [
				['orders', 'order_lines'],
				['orders'],
			]);
			// The path/method label the listener receives names the write.
			expect(transport.calls.map((c) => c.method), ['POST', 'POST']);
		});

		test('the change rows map rides through untouched', () async {
			final transport = FakeTransport();
			final client = clientWith(transport);
			ChangeEnvelope? seen;
			client.addChangeListener((change, path, method) => seen = change);

			transport.onceOk(envelopeWithMeta({'id': 'o1'}, {
				'changed': {
					'collections': ['orders'],
					'rows': {'orders': ['o1', 'o2']},
				},
			}));
			await client.request('/entities/orders', method: 'POST', body: const {});

			expect(seen?.collections, ['orders']);
			expect(seen?.rows['orders'], ['o1', 'o2']);
		});

		test('a throwing listener neither fails the request nor starves the others', () async {
			final transport = FakeTransport();
			final client = clientWith(transport);
			client.addChangeListener((change, path, method) => throw StateError('boom'));
			final seen = <String>[];
			client.addChangeListener((change, path, method) => seen.addAll(change.collections));

			transport.onceOk(writeWithChange(['orders']));
			final row = await client.request<Map<String, dynamic>>(
				'/entities/orders',
				method: 'POST',
				body: const {},
			);

			expect(row['id'], 'o1');
			expect(seen, ['orders']);
		});

		test('a response without a change envelope notifies nobody', () async {
			final transport = FakeTransport();
			final client = clientWith(transport);
			var calls = 0;
			client.addChangeListener((change, path, method) => calls++);

			transport.onceOk(envelope({'id': 'o1'}));
			await client.request('/entities/orders', method: 'POST', body: const {});

			expect(calls, 0);
		});

		test('auth responses never fan out, even when they carry an envelope', () async {
			final transport = FakeTransport();
			final storage = MemoryTokenStorage();
			final client = clientWith(transport, storage: storage);
			final seen = <List<String>>[];
			client.addChangeListener((change, path, method) => seen.add(change.collections));

			transport.onceOk(envelopeWithMeta(
				{'token': makeToken(9999999999999), 'user': {'id': 'u1'}},
				{
					'changed': {'collections': ['users']},
				},
			));
			await client.auth.login(email: 'ada@example.com', password: 'secret');

			expect(seen, isEmpty);
			expect(storage.get(), isNotNull);
		});
	});
}

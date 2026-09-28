/// ConnectivityQueueFlusher tests — trigger semantics with an injected
/// online-changes stream and probe (the plugin mapping itself is a one-liner
/// over `connectivity_plus`; `isOnline` covers its parsing rule).
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

void main() {
	TestWidgetsFlutterBinding.ensureInitialized();

	group('ConnectivityQueueFlusher', () {
		test('isOnline reads the plugin semantics (none means offline)', () {
			expect(ConnectivityQueueFlusher.isOnline([ConnectivityResult.wifi]), isTrue);
			expect(ConnectivityQueueFlusher.isOnline([ConnectivityResult.mobile]), isTrue);
			expect(ConnectivityQueueFlusher.isOnline([ConnectivityResult.mobile, ConnectivityResult.vpn]), isTrue);
			expect(ConnectivityQueueFlusher.isOnline([ConnectivityResult.none]), isFalse);
		});

		test('flushes once at attach when already online (leftover queue)', () async {
			var flushes = 0;
			final changes = StreamController<bool>();
			final handle = ConnectivityQueueFlusher.attach(
				flush: () async => flushes++,
				onlineChanges: changes.stream,
				checkOnline: () async => true,
			);

			await pumpEventQueue();
			expect(flushes, 1);
			await changes.close();
			handle.detach();
		});

		test('does not flush at attach when offline', () async {
			var flushes = 0;
			final changes = StreamController<bool>();
			final handle = ConnectivityQueueFlusher.attach(
				flush: () async => flushes++,
				onlineChanges: changes.stream,
				checkOnline: () async => false,
			);

			await pumpEventQueue();
			expect(flushes, 0);
			await changes.close();
			handle.detach();
		});

		test('flushes on transitions to online, not on offline events', () async {
			var flushes = 0;
			final changes = StreamController<bool>();
			final handle = ConnectivityQueueFlusher.attach(
				flush: () async => flushes++,
				onlineChanges: changes.stream,
				checkOnline: () async => false,
			);

			changes.add(false);
			await pumpEventQueue();
			expect(flushes, 0);

			changes.add(true);
			await pumpEventQueue();
			expect(flushes, 1);

			changes.add(false);
			await pumpEventQueue();
			changes.add(true);
			await pumpEventQueue();
			expect(flushes, 2);

			await changes.close();
			handle.detach();
		});

		test('skips overlapping flushes while one is in flight', () async {
			final gate = Completer<void>();
			var flushes = 0;
			final changes = StreamController<bool>();
			final handle = ConnectivityQueueFlusher.attach(
				flush: () async {
					flushes++;
					await gate.future;
				},
				onlineChanges: changes.stream,
				checkOnline: () async => false,
			);

			changes.add(true);
			changes.add(true);
			await pumpEventQueue();
			expect(flushes, 1);

			gate.complete();
			await pumpEventQueue();
			changes.add(true);
			await pumpEventQueue();
			expect(flushes, 2); // the gate reopened — a new trigger runs again

			await changes.close();
			handle.detach();
		});

		test('surfaces flush errors via onError', () async {
			final errors = <Object>[];
			final changes = StreamController<bool>();
			final handle = ConnectivityQueueFlusher.attach(
				flush: () async => throw StateError('flush failed'),
				onlineChanges: changes.stream,
				checkOnline: () async => false,
				onError: errors.add,
			);

			changes.add(true);
			await pumpEventQueue();
			expect(errors.single, isA<StateError>());

			await changes.close();
			handle.detach();
		});

		test('detach() stops flushing (and is idempotent)', () async {
			var flushes = 0;
			final changes = StreamController<bool>();
			final handle = ConnectivityQueueFlusher.attach(
				flush: () async => flushes++,
				onlineChanges: changes.stream,
				checkOnline: () async => false,
			);

			handle.detach();
			handle.detach(); // safe to call twice
			changes.add(true);
			await pumpEventQueue();
			expect(flushes, 0);

			await changes.close();
		});
	});
}

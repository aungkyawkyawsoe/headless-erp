/// SessionLifecycle tests — the resume-revalidation trigger logic, plus one
/// binding-driven test proving the observer is actually attached to the app
/// lifecycle (the framework dispatch itself is Flutter's contract).
library;

import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

void main() {
	TestWidgetsFlutterBinding.ensureInitialized();

	group('SessionLifecycle', () {
		test('revalidates on resume and ignores every other state', () async {
			var calls = 0;
			final handle = SessionLifecycle.attach(revalidate: () async => calls++);

			handle.didChangeAppLifecycleState(AppLifecycleState.inactive);
			handle.didChangeAppLifecycleState(AppLifecycleState.hidden);
			handle.didChangeAppLifecycleState(AppLifecycleState.paused);
			await pumpEventQueue();
			expect(calls, 0);

			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			await pumpEventQueue();
			expect(calls, 1);
			handle.detach();
		});

		test('skips overlapping resumes while a revalidation is in flight', () async {
			final gate = Completer<void>();
			var calls = 0;
			final handle = SessionLifecycle.attach(revalidate: () async {
				calls++;
				await gate.future;
			});

			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			await pumpEventQueue();
			expect(calls, 1);

			gate.complete();
			await pumpEventQueue();
			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			await pumpEventQueue();
			expect(calls, 2);
			handle.detach();
		});

		test('surfaces errors via onError and keeps observing', () async {
			final errors = <Object>[];
			var calls = 0;
			final handle = SessionLifecycle.attach(
				revalidate: () async {
					calls++;
					if (calls == 1) throw StateError('revoked');
				},
				onError: errors.add,
			);

			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			await pumpEventQueue();
			expect(errors.single, isA<StateError>());

			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			await pumpEventQueue();
			expect(calls, 2); // the failure did not stop future resumes
			handle.detach();
		});

		test('minInterval throttles resumes that arrive too close together', () async {
			var calls = 0;
			final handle = SessionLifecycle.attach(
				revalidate: () async => calls++,
				minInterval: const Duration(milliseconds: 80),
			);

			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			await pumpEventQueue();
			expect(calls, 1);

			handle.didChangeAppLifecycleState(AppLifecycleState.resumed); // too soon
			await pumpEventQueue();
			expect(calls, 1);

			await Future<void>.delayed(const Duration(milliseconds: 100));
			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			await pumpEventQueue();
			expect(calls, 2);
			handle.detach();
		});

		test('detach() stops observing (and is idempotent)', () async {
			var calls = 0;
			final handle = SessionLifecycle.attach(revalidate: () async => calls++);
			handle.detach();
			handle.detach(); // safe to call twice
			handle.didChangeAppLifecycleState(AppLifecycleState.resumed);
			await pumpEventQueue();
			expect(calls, 0);
		});

		testWidgets('is attached to the app lifecycle binding', (tester) async {
			var calls = 0;
			final handle = SessionLifecycle.attach(revalidate: () async => calls++);

			// Drive a real transition through the binding, the way the engine
			// does — proves `attach()` registered the observer.
			tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
			tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
			await tester.pump();
			expect(calls, 1);
			handle.detach();
		});
	});
}

/// Diagnostic logging seam.
///
/// The TS SDK warns through `console.warn` (slow calls, `queryMany` truncation,
/// offline-queue identity changes). Pure Dart has no console; the default sink
/// routes to `dart:developer` (visible in DevTools), and tests swap in a
/// counting sink to pin "warns exactly once" semantics.
library;

import 'dart:developer' as developer;

/// Override the process-wide warning sink (used by tests). When null, warnings
/// go to `dart:developer`.
void Function(String message)? sdkLogSink;

/// Emit an SDK warning through the active sink.
void sdkWarn(String message) {
	final sink = sdkLogSink;
	if (sink != null) {
		sink(message);
		return;
	}
	developer.log(message, name: 'mmbix-sdk');
}

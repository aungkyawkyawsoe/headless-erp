/// Connectivity-triggered offline-queue flush — when the network comes back,
/// replay the queued writes. Replays are safe by construction (every mutation
/// carries an `Idempotency-Key`, and the queue treats a replayed 409 as
/// success), so flushing eagerly is always correct; flushing while offline
/// would only burn through the queue's keep-on-network-failure path.
///
/// Attach once at startup, alongside `erp.offlineQueue`:
///
/// ```dart
/// final flusher = ConnectivityQueueFlusher.attach(flush: erp.offlineQueue.flush);
/// // ... later: flusher.detach();
/// ```
///
/// The plugin mapping is injectable ([onlineChanges] / [checkOnline]) so the
/// trigger logic is testable without a platform channel; by default it reads
/// `connectivity_plus`, including one initial [checkOnline] probe at attach
/// (a queue left over from the last session must not wait for the next
/// connectivity *event* to replay).
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

class ConnectivityQueueFlusher {
	final Future<void> Function() _flush;
	final void Function(Object error)? _onError;
	StreamSubscription<bool>? _subscription;
	bool _inFlight = false;
	bool _detached = false;

	ConnectivityQueueFlusher._(this._flush, this._onError);

	/// Start flushing when connectivity returns.
	///
	/// [flush] is typically `erp.offlineQueue.flush`. Every observed
	/// transition to online triggers one flush; overlapping triggers while a
	/// flush is still running are skipped (the in-flight flush drains the
	/// queue; the next online transition re-checks).
	static ConnectivityQueueFlusher attach({
		required Future<void> Function() flush,
		Stream<bool>? onlineChanges,
		Future<bool> Function()? checkOnline,
		void Function(Object error)? onError,
	}) {
		final flusher = ConnectivityQueueFlusher._(flush, onError);
		final changes = onlineChanges ?? pluginOnlineChanges();
		flusher._subscription = changes.where((online) => online).listen((_) => flusher._run());
		final check = checkOnline ?? pluginCheckOnline;
		unawaited(
			check()
				.then((online) {
					if (online) flusher._run();
				})
				.catchError((Object error) {
					onError?.call(error);
				}),
		);
		return flusher;
	}

	/// The `connectivity_plus` semantics: the emitted list is never empty, and
	/// `none` appears only when there is no connectivity at all.
	static bool isOnline(List<ConnectivityResult> results) => !results.contains(ConnectivityResult.none);

	/// The default online-transition stream, backed by `connectivity_plus`.
	static Stream<bool> pluginOnlineChanges() => Connectivity().onConnectivityChanged.map(isOnline);

	/// The default connectivity probe, backed by `connectivity_plus`.
	static Future<bool> pluginCheckOnline() async => isOnline(await Connectivity().checkConnectivity());

	/// Stop observing — safe to call more than once.
	void detach() {
		if (_detached) return;
		_detached = true;
		unawaited(_subscription?.cancel());
	}

	Future<void> _run() async {
		if (_detached || _inFlight) return;
		_inFlight = true;
		try {
			await _flush();
		} catch (error) {
			_onError?.call(error);
		} finally {
			_inFlight = false;
		}
	}
}

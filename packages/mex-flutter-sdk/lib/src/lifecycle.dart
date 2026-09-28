/// Resume-time session revalidation — the Flutter half of design §7.2
/// ("App resume တိုင်း → GET /auth/me"). The server re-validates the employee
/// link on every request, so a revocation (offboarded employee, disabled
/// account) is observed the next time the app asks — which is exactly here.
///
/// Opt-in: nothing is observed until [SessionLifecycle.attach] is called.
/// The callback is typically `() => erp.auth.me()`; a 401 through the client
/// also runs the refreshSession/self-heal path, and whatever still fails is
/// surfaced to `onError` — where the app decides (typically `logout()`).
///
/// ```dart
/// final lifecycle = SessionLifecycle.attach(
///   revalidate: erp.auth.me,
///   onError: (e) => erp.auth.logout(),
///   minInterval: const Duration(seconds: 30),
/// );
/// // ... later, in dispose():
/// lifecycle.detach();
/// ```
library;

import 'package:flutter/widgets.dart';

class SessionLifecycle with WidgetsBindingObserver {
	final WidgetsBinding _binding;
	final Future<void> Function() _revalidate;
	final void Function(Object error)? _onError;
	final Duration? _minInterval;
	bool _inFlight = false;
	bool _detached = false;
	int _lastRunMs = 0;

	SessionLifecycle._(this._binding, this._revalidate, this._onError, this._minInterval);

	/// Start observing the app lifecycle. Returns the handle — call [detach]
	/// when the app (or its client) is torn down, or to permanently stop.
	///
	/// [minInterval] optionally throttles revalidation: resumes closer
	/// together than the interval are skipped (the server is not polled by
	/// notification-shade flickers).
	static SessionLifecycle attach({
		required Future<void> Function() revalidate,
		void Function(Object error)? onError,
		Duration? minInterval,
		WidgetsBinding? binding,
	}) {
		final lifecycle = SessionLifecycle._(
			binding ?? WidgetsBinding.instance,
			revalidate,
			onError,
			minInterval,
		);
		lifecycle._binding.addObserver(lifecycle);
		return lifecycle;
	}

	/// Revalidate whenever the app returns to the foreground.
	@override
	void didChangeAppLifecycleState(AppLifecycleState state) {
		if (state == AppLifecycleState.resumed) _run();
	}

	Future<void> _run() async {
		if (_detached || _inFlight) return;
		if (_minInterval != null) {
			final now = DateTime.now().millisecondsSinceEpoch;
			if (now - _lastRunMs < _minInterval.inMilliseconds) return;
			_lastRunMs = now;
		}
		_inFlight = true;
		try {
			await _revalidate();
		} catch (error) {
			_onError?.call(error);
		} finally {
			_inFlight = false;
		}
	}

	/// Stop observing — safe to call more than once.
	void detach() {
		if (_detached) return;
		_detached = true;
		_binding.removeObserver(this);
	}
}

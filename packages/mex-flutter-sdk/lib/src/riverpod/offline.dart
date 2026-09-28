/// Offline queue providers — the app's queue instance and the live pending
/// count that drives sync badges.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../offline.dart';
import 'client.dart';

/// The app's [OfflineQueue] — override with the SAME instance that was passed
/// to `HeadlessErpOptions.offlineQueue`: the client does not expose its queue,
/// and the bridge must never build a second queue over the same storage.
/// Defaults to null (no queue wired → everything offline reports 0 / no-ops).
final erpOfflineQueueProvider = Provider<OfflineQueue?>((ref) => null);

/// Pending mutations — the sync-badge count. Kept live by the queue's own
/// change notifications (enqueue/clear/flush); apps only need to override
/// [erpOfflineQueueProvider] to turn it on.
final erpPendingMutationsProvider = NotifierProvider<ErpPendingMutations, int>(ErpPendingMutations.new);

/// See [erpPendingMutationsProvider].
class ErpPendingMutations extends Notifier<int> {
	@override
	int build() {
		final queue = ref.watch(erpOfflineQueueProvider);
		if (queue == null) return 0;
		final unsubscribe = queue.subscribe(() {
			state = queue.pending().length;
		});
		ref.onDispose(unsubscribe);
		return queue.pending().length;
	}

	/// Replay the queue now (idempotent by construction — see the core:
	/// replayed creates carry their client UUID, replays reuse their
	/// idempotency keys). Returns the replayed count.
	///
	/// Replays BYPASS the client pipeline, so no change envelope is ever
	/// dispatched for them — a non-zero replay therefore bumps
	/// [erpDataVersionProvider] to refetch every bridged read.
	Future<int> flush() async {
		final queue = ref.read(erpOfflineQueueProvider);
		if (queue == null) return 0;
		final replayed = await queue.flush();
		if (ref.mounted) state = queue.pending().length;
		if (replayed > 0) ref.read(erpDataVersionProvider.notifier).bump();
		return replayed;
	}
}

/// Write providers — one notifier per collection performing create/update/
/// remove, with the last outcome exposed as [AsyncValue].
///
/// Refreshing is NOT this notifier's job: every successful write's response
/// carries a change envelope and the READ providers refresh from it. A
/// network-level failure surfaces unchanged (`ErpNetworkException`) — when an
/// offline queue is wired, the write is ALREADY enqueued before the throw;
/// watch `erpPendingMutationsProvider` for the "will sync" badge and
/// `erpPendingMutationsProvider.flush()` to replay.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../items.dart';
import 'client.dart';

/// Last write outcome for one collection: null = idle, loading while in
/// flight, data = the server-returned row, error = the failure (rethrown to
/// the caller too).
final erpMutationsProvider =
	NotifierProvider.autoDispose.family<ErpMutations, AsyncValue<Map<String, dynamic>>?, String>(
	ErpMutations.new,
);

/// See [erpMutationsProvider]. Auto-dispose: a write outcome belongs to the
/// screen that made it, so leaving the screen forgets it.
class ErpMutations extends Notifier<AsyncValue<Map<String, dynamic>>?> {
	ErpMutations(this.collection);

	final String collection;

	@override
	AsyncValue<Map<String, dynamic>>? build() => null;

	/// Create — client-generated UUID + auto idempotency key (see the core
	/// `ItemsApi`); pass [CreateOptions.id] only to adopt a server-known id.
	Future<Map<String, dynamic>> create(Map<String, Object?> body, [CreateOptions? options]) =>
		_run(() => ref.read(erpClientProvider).items(collection).create(body, options));

	/// Update — pass `UpdateOptions.ifMatch` (the row's `updated_at`) to make
	/// a stale overwrite a 409 instead of a silent clobber.
	Future<Map<String, dynamic>> update(String id, Map<String, Object?> body, [UpdateOptions? options]) =>
		_run(() => ref.read(erpClientProvider).items(collection).update(id, body, options));

	/// Soft delete.
	Future<Map<String, dynamic>> remove(String id, [RemoveOptions? options]) =>
		_run(() => ref.read(erpClientProvider).items(collection).remove(id, options));

	Future<Map<String, dynamic>> _run(Future<Map<String, dynamic>> Function() op) async {
		state = const AsyncLoading();
		try {
			final row = await op();
			if (ref.mounted) state = AsyncData(row);
			return row;
		} catch (err, stack) {
			if (ref.mounted) state = AsyncError(err, stack);
			Error.throwWithStackTrace(err, stack);
		}
	}
}

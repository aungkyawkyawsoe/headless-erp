/// The bridge's spine — the client provider, the change-envelope stream, and
/// the data-version invalidation lever every read provider is wired through.
///
/// [erpClientProvider] deliberately THROWS until overridden: the app owns
/// client construction (storage init is async, transports get injected), and
/// an un-overridden read should name its own fix instead of silently building
/// a client that talks to the wrong place.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../client.dart';

/// The app's [HeadlessErpClient] — override at the root:
///
/// ```dart
/// ProviderScope(
///   overrides: [erpClientProvider.overrideWithValue(erp)],
///   child: const App(),
/// )
/// ```
final erpClientProvider = Provider<HeadlessErpClient>(
	(ref) => throw UnimplementedError(
		'erpClientProvider must be overridden with the app\'s HeadlessErpClient: '
		'ProviderScope(overrides: [erpClientProvider.overrideWithValue(erp)])',
	),
);

/// Every change envelope the client observes, as a stream.
///
/// Fed by `client.addChangeListener` — additive to the app's own `onChange`
/// option, so both coexist. Kept alive for the container's lifetime (never
/// auto-dispose): subscribers attach and detach as screens mount, and no
/// envelope may be dropped in the gap between two of them.
final erpChangesProvider = StreamProvider<ChangeEnvelope>((ref) {
	final client = ref.watch(erpClientProvider);
	final controller = StreamController<ChangeEnvelope>.broadcast();
	final remove = client.addChangeListener((change, path, method) => controller.add(change));
	ref.onDispose(() {
		remove();
		controller.close();
	});
	return controller.stream;
});

/// Bumped whenever cached reads may be stale without any envelope naming
/// them — the offline-queue flush (replays bypass the client pipeline, so no
/// `meta.changed` ever arrives) and account switches (login/logout): the
/// next session must never render the previous one's rows.
///
/// Also the blunt instrument for "invalidate everything": `ref.invalidate`
/// would NOT reach watchers (the rebuilt value is unchanged, so nothing
/// notifies) — the bump changes the value on purpose.
final erpDataVersionProvider = NotifierProvider<ErpDataVersion, int>(ErpDataVersion.new);

/// See [erpDataVersionProvider].
class ErpDataVersion extends Notifier<int> {
	@override
	int build() => 0;

	/// Invalidate every provider wired through [watchErpData].
	void bump() => state++;
}

/// Wire [ref] into the bridge's invalidation sources and return the client —
/// the single line every read provider starts with:
///
///   - watches [erpDataVersionProvider] (a bump re-runs the provider), and
///   - listens to [erpChangesProvider], invalidating self the moment an
///     envelope names any slug in [collections].
///
/// Invalidation is collection-EXACT: pass the collection the read addresses,
/// plus anything it embeds via dot-path `fields` (the envelope names what a
/// write TOUCHED, not what reads FROM it — see `ErpItemsKey.invalidateOn`).
HeadlessErpClient watchErpData(Ref ref, Set<String> collections) {
	ref.watch(erpDataVersionProvider);
	final client = ref.watch(erpClientProvider);
	ref.listen(erpChangesProvider, (previous, next) {
		// Error transitions carry no envelope (and retain the previous value
		// for display) — never invalidate off one.
		if (next.hasError) return;
		final change = next.value;
		if (change != null && change.collections.any(collections.contains)) {
			ref.invalidateSelf();
		}
	});
	return client;
}

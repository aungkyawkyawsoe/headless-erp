/// Riverpod adapters for the MEX Flutter SDK — an OPTIONAL second entrypoint
/// of `mex_flutter_sdk`, so the main import stays adapter-free:
///
/// ```dart
/// import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';
/// import 'package:mex_flutter_sdk/riverpod.dart';
/// ```
///
/// The bridge turns the SDK's own invalidation signals into precise provider
/// refreshes — no TTL guessing, no coarse refetch-everything:
///   - `meta.changed` change envelopes (via `client.addChangeListener`) drop
///     exactly the collections a write touched — including cascade and hook
///     writes the app never issued;
///   - [erpDataVersionProvider] bumps on queue flush and account switches
///     (login/logout), where no envelope exists but every cached read may be
///     stale — or about to leak into the next account's screens.
///
/// Opt-in by import: nothing here runs until a provider is read. Wiring is
/// two overrides at the root — the client and (when offline) the queue:
///
/// ```dart
/// ProviderScope(
///   overrides: [
///     erpClientProvider.overrideWithValue(erp),
///     erpOfflineQueueProvider.overrideWithValue(queue),
///   ],
///   child: const App(),
/// )
/// ```
///
/// See `docs/backend-api/sdk-dart.md` §Riverpod adapters.
library;

export 'src/riverpod/client.dart';
export 'src/riverpod/data.dart';
export 'src/riverpod/keys.dart';
export 'src/riverpod/mutations.dart';
export 'src/riverpod/offline.dart';
export 'src/riverpod/session.dart';

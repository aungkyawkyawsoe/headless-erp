/// MEX Flutter SDK — the single-package client for the Headless ERP entity
/// engine: the 1:1 Dart port of `@mmbix/sdk` (TypeScript) with the Flutter
/// platform wiring merged in.
///
/// One import:
///
/// ```dart
/// import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';
/// ```
///
/// Optional Riverpod integration ships as a SECOND entrypoint of the same
/// package (so the main import stays adapter-free):
///
/// ```dart
/// import 'package:mex_flutter_sdk/riverpod.dart';
/// ```
///
/// Core guarantees (ported from the TS SDK, pinned by parity tests):
///   - typed query DSL with factory helpers (a misspelled filter operator is
///     unrepresentable — the server silently drops unknown operators)
///   - expired-token awareness (no doomed request + 401 + retry on expiry)
///   - auto `Idempotency-Key` on every mutation; transient-failure retry
///   - single-flight refresh-token rotation + local-first `logout({all})`
///   - ETag/304 revalidation (conditional GETs), deniable offline reads
///     (`X-Offline-Max-Age` — deny-by-default device persistence)
///   - offline write queue with per-account fingerprinting
///   - `meta.changed` change envelopes for precise cache invalidation
///   - media uploads via `erp.files` (direct, and the delegated
///     presign/redeem path)
///
/// Flutter platform wiring (the only Flutter imports in the package — all
/// opt-in):
///   - [FlutterSecureTokenStorage] — Keychain/Keystore-backed [TokenStorage]
///     (sync mirror over the async secure storage; `init()` at startup)
///   - [SessionLifecycle] — resume-time revalidation (`GET /auth/me`), so a
///     server-side revocation (offboarded employee) surfaces on the spot
///   - [ConnectivityQueueFlusher] — replays the offline write queue when the
///     network returns (idempotent replays; safe to trigger eagerly)
///   - [openFileQueueStorage] / [openFileResponseCacheStorage] — the
///     app-support-directory defaults for the core's device stores, so the
///     queue and the deny-by-default offline reads survive restarts
library;

export 'src/auth.dart';
export 'src/client.dart';
export 'src/conditional_cache.dart';
export 'src/errors.dart';
export 'src/files.dart';
export 'src/items.dart';
export 'src/jwt.dart';
export 'src/meta.dart';
export 'src/offline.dart';
export 'src/permissions.dart';
export 'src/query.dart';
export 'src/requester.dart';
export 'src/transport.dart';

// Flutter platform adapters — the only libraries that import Flutter plugins.
export 'src/connectivity.dart';
export 'src/lifecycle.dart';
export 'src/secure_token_storage.dart';
export 'src/stores.dart';

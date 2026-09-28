# mex_flutter_sdk

MEX Flutter SDK — the **single-package** client for the Headless ERP entity
engine: a 1:1 Dart port of `@mmbix/sdk` with the Flutter platform wiring merged
in. Typed query DSL (a misspelled filter operator is a compile error), sessions
with single-flight refresh-token rotation, replay-safe writes, an offline write
queue, ETag/304 revalidation, deny-by-default offline reads, and media uploads —
plus secure token storage, resume revalidation, connectivity-triggered queue
flush, and app-support-dir stores.

> 📚 Full reference in the docs tree: [`docs/backend-api/sdk-dart.md`](../../docs/backend-api/sdk-dart.md)
> (query DSL → sessions → writes → offline → media → errors → `--target dart` typegen).

> **Status:** released to the private registry through
> [`.github/workflows/publish-flutter-sdk.yml`](../../.github/workflows/publish-flutter-sdk.yml)
> (dispatch with `dry_run=true` to validate). The committed `publish_to: 'none'`
> keeps a stray local `dart pub publish` off pub.dev.

## Install

```yaml
# release — from the private registry
dependencies:
  mex_flutter_sdk:
    hosted: https://pub.example.com # wherever PUB_REGISTRY_URL points
    version: ^0.1.0
```

Co-developing inside this repo? Depend on it by path instead
(`path: ../headless-erp/packages/mex-flutter-sdk`).

Requires Dart `>= 3.4.0`, Flutter `>= 3.24.0`.

## Quickstart

```dart
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import 'generated/schema.dart'; // mmbix-typegen --target dart

final storage = FlutterSecureTokenStorage();
await storage.init(); // hydrate the Keychain/Keystore mirror before the client

final queue = OfflineQueue.create(OfflineQueueOptions(
	storage: await openFileQueueStorage(),
	baseUrl: 'https://api.example.com',
	getToken: storage.get,
));

final erp = HeadlessErpClient(HeadlessErpOptions(
	baseUrl: 'https://api.example.com',
	tokenStorage: storage,
	offlineQueue: queue,
));

await erp.auth.login(email: 'ada@example.com', password: '…', deviceId: 'device-1');

final page = await erp.items('work_orders').list(ListQuery(
	filter: F.eq(WorkOrdersFields.status, 'draft'),
	fields: ['id', 'code', 'status', 'created_at'],
	sort: '-created_at',
	limit: 24,
));
final row = WorkOrders.fromJson(page.data.first);
```

## What you get

- **Typed query DSL** — `F.eq` / `F.in_` / `F.or([...])` + `ListQuery`
  (filters, projections, sort, cursor, search, aggregates, groupBy); relation
  filters nest (`{'department': {'category': F.eq('id', x)}}`).
- **Sessions** — `erp.auth.login/refresh/logout({all})` with local-first
  logout, single-flight rotation, expired-token up-front rotation;
  `FlutterSecureTokenStorage` (Keychain/Keystore) + `SessionLifecycle.attach`
  for resume revalidation (`GET /auth/me`).
- **Replay-safe writes** — client UUID + `Idempotency-Key`, `If-Match`
  optimistic concurrency, `X-Write-Ack` guard acknowledgements, and
  `meta.changed` change envelopes (`onChange`) for precise cache invalidation.
- **Offline** — a fingerprinted write queue (`OfflineQueue` +
  `ConnectivityQueueFlusher`) whose replays are idempotent, and device-persisted
  reads only when the server blessed them with `X-Offline-Max-Age`.
- **Media** — `erp.files.upload` (direct), `presign()` + `uploadWithToken()`
  (delegated, self-authenticating single-use token).
- **Riverpod adapters** — an opt-in second entrypoint
  (`package:mex_flutter_sdk/riverpod.dart`): `erpItemsProvider` /
  `erpItemProvider` / `erpCountProvider` / `erpViewProvider` /
  `erpInfiniteItemsProvider` / `erpSessionProvider` / `erpMutationsProvider` /
  `erpFieldRestrictionsProvider` + the offline pending/flush bridge, refreshed
  by change envelopes (`erpDataVersionProvider`).
- **Typed errors** — `ErpHttpException` (`status`, `code`, `apiCode`,
  `requestId`), `ErpNetworkException`; the canonical code catalog mirrors
  `@mmbix/utils` and is pinned by CI on both sides.
- **Typegen** — `mmbix-typegen --target dart` emits ONE `schema.dart`: row
  models (`fromJson` / PATCH-style `toJson`, no build_runner),
  `<Collection>Fields` constants, `ApiErrorCodes`
  ([CLI reference](../../docs/cli/typegen.md)).

## Riverpod

```dart
import 'package:mex_flutter_sdk/riverpod.dart';

ProviderScope(
	overrides: [
		erpClientProvider.overrideWithValue(erp),
		// the SAME queue instance that was passed to HeadlessErpOptions
		erpOfflineQueueProvider.overrideWithValue(queue),
	],
	child: const App(),
);

// in a screen
final page = ref.watch(erpItemsProvider(ErpItemsKey('work_orders', ListQuery(limit: 24))));
```

A write's `meta.changed` envelope invalidates collection-exactly; queue flushes
and login/logout bump `erpDataVersionProvider` (replays bypass the client
pipeline; a new session must never render the old one's rows). Full reference:
[sdk-dart.md § Riverpod adapters](../../docs/backend-api/sdk-dart.md#12-riverpod-adapters).

## Scripts

```bash
pnpm --filter @mmbix/mex-flutter-sdk test   # flutter pub get && flutter test
pnpm --filter @mmbix/mex-flutter-sdk lint   # flutter pub get && flutter analyze
```

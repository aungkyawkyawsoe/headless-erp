# Changelog

## 0.1.0

Initial release — the **single-package** MEX Flutter SDK for the Headless ERP
entity engine: a 1:1 Dart port of `@mmbix/sdk` with the Flutter platform wiring
merged in.

- **Typed query DSL** — `F.eq` / `F.in_` / `F.or([...])` and `ListQuery`
  (filters, projections, sort, cursor, search, aggregates, groupBy); relation
  filters nest (`{'department': {'category': F.eq('id', x)}}`); a misspelled
  operator is a compile error.
- **Sessions** — `erp.auth.login / refresh / logout({all})` with local-first
  logout, single-flight refresh-token rotation, and expired-token up-front
  rotation; `FlutterSecureTokenStorage` (Keychain / Keystore) and
  `SessionLifecycle.attach` resume revalidation.
- **Replay-safe writes** — client UUID + `Idempotency-Key`, `If-Match`
  optimistic concurrency, `X-Write-Ack` guard acknowledgements, and `meta.changed`
  change envelopes for precise cache invalidation.
- **Change envelopes** — `erp.onChange` and `erp.addChangeListener` name every
  collection a write touched (its own row + cascade parents + hook writes).
- **Offline** — a fingerprinted write queue (`OfflineQueue` +
  `ConnectivityQueueFlusher`) whose replays are idempotent, and device-persisted
  reads only when the server blessed them with `X-Offline-Max-Age`.
- **Conditional reads** — `ETag` / `304` revalidation with a memory-only body
  store.
- **Media** — `erp.files.upload` (direct), `presign()` + `uploadWithToken()`
  (delegated, self-authenticating single-use token).
- **Riverpod adapters** — an opt-in second entrypoint
  (`package:mex_flutter_sdk/riverpod.dart`): `erpItemsProvider`,
  `erpItemProvider`, `erpCountProvider`, `erpViewProvider`,
  `erpInfiniteItemsProvider`, `erpSessionProvider`, `erpMutationsProvider`,
  `erpFieldRestrictionsProvider`, plus the offline pending/flush bridge —
  invalidated by change envelopes via `erpDataVersionProvider`.
- **Batch reads** — `erp.queryMany` (≤ 12 specs per batch, server cap
  enforced client-side).
- **Typegen** — `mmbix-typegen --target dart` emits ONE `schema.dart`: row
  models (`fromJson` / PATCH-style `toJson`, no build_runner),
  `<Collection>Fields` constants, and `ApiErrorCodes`.
- **Typed errors** — `ErpHttpException` (`status`, `code`, `apiCode`,
  `requestId`) and `ErpNetworkException`; the canonical code catalog mirrors
  `@mmbix/utils` and is pinned by CI on both sides.

> Published to the **private registry only**. The repository ships
> `publish_to: 'none'`, so a stray local `dart pub publish` can never reach
> pub.dev — releases go through `.github/workflows/publish-flutter-sdk.yml`.

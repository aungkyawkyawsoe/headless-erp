# Dart/Flutter SDK — `mex_flutter_sdk`

The typed Flutter client for the headless entity engine — a **1:1 Dart port of
`@mmbix/sdk`** with the Flutter platform wiring merged into ONE package. Same
guarantees, same wire: typed query DSL (misspelled operators are unrepresentable),
expired-token awareness, single-flight refresh-token rotation, replay-safe writes,
ETag/304 revalidation, deny-by-default offline reads, an offline write queue, and
`meta.changed` change envelopes — plus Keychain/Keystore token storage, resume
revalidation, connectivity-triggered queue flush, and app-support-dir stores.

| Package                       | Role                                                                   | Source                                                       |
| ----------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------ |
| `mex_flutter_sdk`             | Typed REST client + query DSL + offline queue/reads + Flutter adapters | [`packages/mex-flutter-sdk`](../../packages/mex-flutter-sdk) |
| `mmbix-typegen --target dart` | Generates row models + field constants + error codes for your app      | [CLI reference](../cli/typegen.md)                           |

Runtime: **Dart VM** (`dart:io` sockets) — iOS, Android, desktop, macOS. Not a
web target. The TS sibling for browser/Worker/Node lives in [sdk.md](sdk.md).

> **Status:** released to the private registry through
> [`.github/workflows/publish-flutter-sdk.yml`](../../.github/workflows/publish-flutter-sdk.yml)
> (dispatch with `dry_run=true` to validate first). The committed `pubspec.yaml`
> keeps `publish_to: 'none'`, so a stray local `dart pub publish` can never
> reach pub.dev — see §13.

---

## 1. Install

```yaml
# your app's pubspec.yaml — release from the private registry
dependencies:
  mex_flutter_sdk:
    hosted: https://pub.example.com # wherever PUB_REGISTRY_URL points
    version: ^0.1.0
```

Co-developing inside this repo? Depend on it by path instead:

```yaml
dependencies:
  mex_flutter_sdk:
    path: ../headless-erp/packages/mex-flutter-sdk
```

Requires Dart `>= 3.4.0` and Flutter `>= 3.24.0`.

## 2. Quickstart

```dart
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import 'generated/schema.dart'; // mmbix-typegen --target dart

Future<void> main() async {
	// The Keychain/Keystore mirror must be hydrated before the first request.
	final storage = FlutterSecureTokenStorage();
	await storage.init();

	final queue = OfflineQueue.create(OfflineQueueOptions(
		storage: await openFileQueueStorage(), // app-support dir — survives restarts
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
	// page.data — this page's rows; page.meta['next_cursor'] — keyset cursor

	final created = await erp.items('work_orders').create(
		{'code': 'WO-1042', 'status': 'draft'}, // client UUID attached automatically
	);
	final row = WorkOrders.fromJson(created); // generated row model
}
```

## 3. Typed query DSL

The DSL serializes to the engine's native filter contract
(`filter[field][_op]=value`). The server **silently drops an unknown operator**
(HTTP 200, unfiltered data), so the `F.*` factories exist to make a wrong
spelling a compile error. A relation filter is a nested map: keys that are not
`_`-prefixed open a relation hop.

```dart
final page = await erp.items('hr_employees').list(ListQuery(
	filter: F.and([
		F.eq('status', 'active'),
		F.or([F.icontains('name_mm', 'ada'), F.icontains('email', 'ada')]),
		{'department': {'category': F.eq('id', departmentId)}}, // → filter[department][category][_eq]
	]),
	fields: ['id', 'name_mm', 'email'], // dot paths expand relations
	sort: ['-status', 'name_mm'],
	cursor: previousPage.meta['next_cursor'] as String?,
));
```

| Factory                                      | Wire operator                             | Notes                                                  |
| -------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `F.eq` / `F.neq`                             | `_eq` / `_neq`                            |                                                        |
| `F.gt` / `F.gte` / `F.lt` / `F.lte`          | `_gt` / `_gte` / `_lt` / `_lte`           |                                                        |
| `F.between(field, 'a,b')`                    | `_between`                                | comma-joined inclusive pair                            |
| `F.in_` / `F.nin`                            | `_in` / `_nin`                            | renamed — `in` is a Dart keyword; lists join on commas |
| `F.contains` / `F.icontains` / `F.ncontains` | `_contains` / `_icontains` / `_ncontains` |                                                        |
| `F.startswith` / `F.endswith`                | `_startswith` / `_endswith`               | the backend spells them without the extra `_`          |
| `F.empty` / `F.nempty`                       | `_empty` / `_nempty`                      | the value is ignored by the backend                    |
| `F.isNull` / `F.isNotNull`                   | `_null` / `_nnull`                        |                                                        |
| `F.or([...])` / `F.and([...])`               | `filter[_or][i]` / `filter[_and][i]`      | AND-joined to the flat filters                         |

Value serialization matches the TS SDK byte-for-byte: `DateTime` →
`YYYY-MM-DDTHH:mm:ss.sssZ` (UTC), `_in`/`_nin` lists comma-join, boolean
operators serialize truthiness as `true`/`false`, and numbers print JS-style
(no trailing `.0`).

**`ListQuery`:**

| Field       | Type                       | Notes                                                                 |
| ----------- | -------------------------- | --------------------------------------------------------------------- |
| `filter`    | `Map<String, Object?>?`    | built with `F.*`                                                      |
| `fields`    | `String` or `List<String>` | projection; dot paths expand relations (server skips unselected work) |
| `sort`      | `String` or `List<String>` | `-field` = descending                                                 |
| `limit`     | `int?`                     | clamped by the page-size policy (below)                               |
| `cursor`    | `String?`                  | from a previous page's `meta['next_cursor']`                          |
| `search`    | `String?`                  | collection search policy (`contains` / `prefix`)                      |
| `count`     | `bool?`                    | `total` in meta (runs a COUNT with the same WHERE)                    |
| `countOnly` | `bool?`                    | only the total — skips the page SELECT                                |
| `aggregate` | `List<AggregateMeasure>?`  | replaces the row projection                                           |
| `groupBy`   | `List<String>?`            | plain columns or date buckets (`month(created_at)`)                   |

`list()` resolves to `ListResult { List<Map<String, dynamic>> data; Map<String, Object?> meta }`.
`get(id)`, `count({filter, search})`, `create/update/remove` round out the set.

**Aggregates** — the column name is a server contract spelled once:

```dart
final totals = await erp.items('stock_items').list(ListQuery(
	aggregate: [AggregateMeasure(AggregateOp.sum, 'qty_on_hand')],
	groupBy: ['warehouse_id'],
));
// each row carries aggregateAlias(AggregateOp.sum, 'qty_on_hand') == 'sum_qty_on_hand'
```

**Pagination & the page-size policy.** Reads are cursor-based (keyset, no
OFFSET). Default page size **25**, max **500** — the server is the single source
of truth and advertises it on `GET /api/meta`:

```dart
await erp.loadLimits(); // discovers the deployment's policy; safe to call repeatedly
erp.limits;             // active PageSizePolicy(defaultPageSize, maxPageSize)
```

An unspecified `limit` becomes the policy default; anything above the max is
clamped (the server truncates there anyway). Whole-set reads walk the cursor:

```dart
var cursor = null as String?;
final rows = <Map<String, dynamic>>[];
do {
	final page = await erp.items('hr_employees').list(ListQuery(limit: erp.limits.maxPageSize, cursor: cursor));
	rows.addAll(page.data);
	cursor = page.meta['next_cursor'] as String?;
} while (cursor != null);
```

**One view, one round trip** — `erp.queryMany([...])` executes keyed
`{ collection, params }` specs in parallel server-side (`POST /api/query`); the
batch is capped at 12 specs and truncated client-side to match.

## 4. Sessions, refresh tokens & lifecycle

A sign-in returns `{ token, refresh_token, user }`: the 24h JWT plus a rotating
refresh chain — `login({email, password, deviceId?})` binds the chain to the
device (server-side). `AuthApi` stores both slots through the injected
`TokenStorage`.

- **Expired stored token** → rotated up front through the stored refresh token
  (no doomed request + 401 + retry); with none, the dead token is cleared.
- **401 self-heal** → one rotation (single-flight: concurrent 401s share ONE
  `/auth/refresh` POST) then one retry. A refused rotation (401) ends the local
  session; a network/5xx failure keeps it (the token may rotate later).
- `await erp.auth.refresh()` — explicit rotation; resolves `false` instead of
  throwing.
- `await erp.auth.logout({all: false})` — local state (token, refresh token,
  device-persisted reads) is dropped FIRST so logout works offline, then the
  chain is revoked best-effort server-side (`all: true` → every device). Never
  throws.
- **Token-only mode:** a custom `TokenStorage` that omits
  `getRefresh()`/`setRefresh()` gets the legacy `refreshSession` hook as its
  only self-heal.

**`FlutterSecureTokenStorage`** (iOS Keychain / Android Keystore; keys
`headless_erp.token` / `headless_erp.refresh`) mirrors both slots in memory so
the synchronous `TokenStorage` interface sees them; `init()` hydrates once at
startup and must run **before** the client's first request. The password is
never stored. Persistence is best-effort — a failed device write is surfaced via
`onPersistError` but never breaks the running session. Apps that sync in the
background construct it with `FlutterSecureTokenStorage.forBackgroundSync()`
(Keychain `first_unlock`).

**Resume revalidation** — the server re-validates the acting employee on every
request, so a revocation (offboarded employee, disabled account) is observed the
next time the app asks. `SessionLifecycle` asks on every resume:

```dart
final lifecycle = SessionLifecycle.attach(
	revalidate: erp.auth.me,
	onError: (e) => erp.auth.logout(), // whatever still fails after self-heal
	minInterval: const Duration(seconds: 30), // optional resume throttle
);
// later, in dispose(): lifecycle.detach();
```

## 5. Writes are replay-safe

- `create` attaches a client-generated UUID (`uuid()`, CSPRNG) — a retried or
  replayed POST can never duplicate a row (the API is idempotent on the primary
  key). Pass `CreateOptions(idempotencyKey: …)` for whole-batch server dedupe.
- `update` takes `UpdateOptions(ifMatch: created['updated_at'])` — a stale
  overwrite is a 409, not a clobber.
- `ack:` acknowledges a server guard WARNING (e.g. a same-day duplicate
  requisition) via the `X-Write-Ack` header — take the token from the guard's
  own pre-flight read; it can never leak into the record.
- `validate:` runs a generated parser on the response (typegen output).

**Change envelope.** Every write response carries `meta.changed =
{ collections, rows }` — the exact collections it touched (own row + cascade
parents + hook/denorm writes the client cannot see). The client attaches a
precise invalidation hook:

```dart
final erp = HeadlessErpClient(HeadlessErpOptions(
	onChange: (change, path, method) {
		for (final collection in change.collections) {
			// drop cached reads for `collection` (change.rows[id] names changed ids when known)
		}
	},
));
```

| Hook        | Fires                                                                    |
| ----------- | ------------------------------------------------------------------------ |
| `onWrite`   | after any successful non-auth write                                      |
| `onChange`  | when the response carries a `meta.changed` envelope                      |
| `onQueued`  | when a network-failed write was enqueued for offline replay              |
| `onError`   | on any HTTP/envelope error (drives error toasts; dedupe in the listener) |
| `onSettled` | every request outcome — `ok: true` when the API answered at all          |

## 6. Offline — write queue + reads

### Write queue

A write that fails at the **network level** is stashed and replayed on
reconnect. Reads, auth calls, and binary (multipart) bodies never queue;
per-request `noQueue: true` opts read-encoded POSTs (report aggregates) out.

```dart
final queue = OfflineQueue.create(OfflineQueueOptions(
	storage: await openFileQueueStorage(), // FileQueueStorage in the app-support dir
	baseUrl: 'https://api.example.com',
	getToken: storage.get,                 // read PER ITEM — the token may rotate mid-flush
	onReplayed: (item) => …,
	onFailed: (item, error) => …,
));
```

**Flush semantics** (`await queue.flush()` → replayed count):

- 2xx **and** 409 (the write already landed — idempotent replay) count as success.
- A 409 on a queued write that carried `ifMatch` is a real optimistic-concurrency
  rejection → dropped, surfaced via `onFailed`.
- Permanent client errors (other 4xx) are dropped too; 5xx/network errors stay queued.
- **Account scoping:** the queue is fingerprinted by the token's ACCOUNT subject
  (not its bytes — the server re-mints tokens). Another account's queue is never
  replayed; an empty queue silently adopts the current identity.
- `pending()`, `clear()`, `subscribe(listener)` drive sync banners.

**Connectivity flush** — replay the moment the network returns (replays are
idempotent by construction, so triggering eagerly is always safe):

```dart
final flusher = ConnectivityQueueFlusher.attach(flush: queue.flush);
// later: flusher.detach();
```

It probes once at attach (a queue left from the last session must not wait for
the next connectivity event) and flushes on every offline→online transition.

### Offline reads (deny by default)

**Conditional GETs are on by default**: the client replays the last `ETag` for
the exact request URL as `If-None-Match`, so an unchanged read costs a bodiless
`304` instead of re-downloading it. A 304 is servable because the cache keeps
the tag together with the last body. Pass `conditionalGet: false` to disable.

Persisting a body **to the device** is a separate, opt-in grant: a read of a
collection whose `policies.offline_reads.enabled` is true carries
`X-Offline-Max-Age: <s>`; absent ⇒ the client must never persist it. Wire a
persistable cache to let blessed reads survive restarts:

```dart
final erp = HeadlessErpClient(HeadlessErpOptions(
	conditionalGet: ConditionalResponseCache(storage: await openFileResponseCacheStorage()),
	// …
));
```

- Persisted entries are scoped per account (same fingerprint as the queue);
  a copy belonging to another account is discarded, and `logout()` clears both
  the memory and the device copy.
- A network failure with a fresh persisted body serves that body; otherwise the
  call throws `ErpNetworkException` (a queued write still reports via `onQueued`).
- A `304` slides the offline window — a regularly revalidated read never falls
  out of it.

## 7. Files (media)

Uploads into the engine's R2 library — `erp.files`, three paths MECE:

```dart
// Direct upload — the session bearer rides along; a 401 heals like any call.
final asset = await erp.files.upload(File(path), visibility: MediaVisibility.private);
// -> { key, url, filename, size, mime_type }

// Delegated upload — mint a single-use, user-bound token (15 min)…
final presigned = await erp.files.presign();
// -> { token, expires_at, upload_url, max_bytes }
// …then redeem it with NO bearer (background isolate, upload worker):
await erp.files.uploadWithToken(File(path), presigned['token'] as String);
```

- `visibility: private` restricts serving to the uploader/admin; omitted ⇒ the
  server default `public` (a capability URL — a stored value renders as
  `<img src>`, which cannot carry a bearer). See [media.md](media.md).
- The delegated route is self-authenticating: no bearer, no 401 heal, and the
  token is **redacted from every hook/log** (`/media/upload/<token>`) — a leaked
  token would be a 15-minute credential.
- Uploads are exempt from `Idempotency-Key` and the offline queue by shape;
  `presign()` additionally opts out of the queue. The declared MIME comes from
  the filename extension and must be in the server's allowlist — an unmapped
  extension falls back to `application/octet-stream` and gets a clear 415.
- Default upload timeout 120 s (`uploadTimeoutMs`); override per call.

## 8. Errors

Every failure is typed:

| Type                                       | When                                                   | Key fields                                                                        |
| ------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `ErpNetworkException extends ErpException` | never reached the server (offline, DNS, abort)         | `cause`                                                                           |
| `ErpHttpException extends ErpException`    | the server answered non-2xx                            | `status`, `code` (raw), `apiCode` (canonical or `API_ERROR`), `requestId`, `body` |
| `ErpException`                             | base class — also malformed envelopes (`BAD_ENVELOPE`) | `message`, `status`, `code`                                                       |

```dart
try {
	await erp.items('work_orders').update(id, {'status': 'approved'});
} on ErpHttpException catch (e) {
	if (e.status == 409) { /* stale write — reload and retry */ }
	switch (e.apiCode) { case 'RATE_LIMIT_EXCEEDED': /* back off */ }
}
```

- The real envelope is `{ success: false, error, code, request_id? }` — `code`
  is a top-level sibling of `error` and is read first, so backend codes
  (`NOT_FOUND`, `CONFLICT`, `UNAUTHORIZED`, …) survive.
- **The error catalog is a single source.** `errorCodes` (16 — the API's 12 plus
  SDK-only `NETWORK_ERROR` / `SDK_ERROR` / `API_ERROR` / `BAD_ENVELOPE`) mirrors
  `@mmbix/utils`; `apiErrorCodes` (12) is what `GET /api/meta → error_codes`
  advertises. `erp.fetchServerErrorCodes()` reads the deployment's own catalog;
  `apiErrorCodeOf(e)` narrows without string literals.
- The generated `ApiErrorCodes` class (typegen below) gives the same 12 codes as
  compile-time constants, and the whole loop is pinned by CI tests on both sides.

## 9. Field restrictions

The client half of "ask only what you may see" — the server still ENFORCES the
same rules on every response:

```dart
final allowed = await erp.fieldRestrictions('hr_employees'); // null | [] | ['id', …]
await erp.pruneFields('records', ['id', 'salary']);          // -> ['id'] when salary is hidden
```

`null` = unrestricted, `[]` = deny all (only `id` survives), otherwise a
whitelist. Results are cached 60 s per collection and concurrent mounts collapse
into one `/auth/me` read. Pure helpers `fieldsToArray` / `restrictFields` are
exported for custom transports and non-HTTP flows.

## 10. Typegen — `--target dart`

`mmbix-typegen` emits ONE `schema.dart` for the app: plain-Dart row models
(`fromJson` / PATCH-style `toJson`, no build_runner), `<Collection>Fields`
constants for the `F.*` factories, and `ApiErrorCodes` from
`/api/meta → error_codes`.

```bash
node packages/sdk/bin/typegen.js --url http://localhost:8788/api --token dev-token \
	--target dart --out ./lib/generated
```

Wire semantics the models encode: D1 booleans arrive as `0`/`1` (decoded via an
internal `_dbBool`), snake_case wire ↔ camelCase members, `id` is the only
non-null member, virtual fields (o2m/m2m/table + non-stored formulas) are
omitted, and `toJson()` omits nulls but keeps `false`. A committed, CI-verified
example (`packages/mex-flutter-sdk/example/schema.dart`) is byte-drift-gated:
an emitter edit without regeneration fails the TS suite. Full reference:
[mmbix-typegen CLI](../cli/typegen.md).

## 11. Diagnostics & testing seams

- **Transport** — inject `HttpTransportFn` (e.g. a recording fake) via
  `HeadlessErpOptions(transport: …)`; same for `OfflineQueueOptions(transport: …)`
  (without it, `flush()` would use real sockets in tests).
- **Storages** — `MemoryTokenStorage`, `MemoryQueueStorage`,
  `MemoryResponseCacheStorage` for tests; file-backed stores for apps.
- **Clock** — `ConditionalResponseCache(now: …)` governs every timestamp the
  cache sees.
- **Logs** — slow requests (≥ 1.5 s), `queryMany` truncation, and offline-queue
  identity changes warn through `sdkLogSink` (default: `dart:developer`).
- **Riverpod tests** — disable Riverpod 3's auto-retry in every test container
  (`ProviderContainer.test(retry: (retryCount, error) => null, overrides: […])`):
  with retries on, a failed first build is silently re-attempted with backoff —
  masking the real verdict and doubling fake-transport calls.

```bash
pnpm --filter @mmbix/mex-flutter-sdk test   # flutter test (includes the generated-schema wire tests)
pnpm --filter @mmbix/mex-flutter-sdk lint   # flutter analyze
```

## 12. Riverpod adapters

An OPTIONAL second entrypoint — the main import stays adapter-free:

```dart
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';
import 'package:mex_flutter_sdk/riverpod.dart';
```

Wiring is two root overrides: the client, and — when offline is on — the SAME
queue instance that was passed to `HeadlessErpOptions.offlineQueue` (the bridge
must never build a second queue over the same storage):

```dart
ProviderScope(
	overrides: [
		erpClientProvider.overrideWithValue(erp),
		erpOfflineQueueProvider.overrideWithValue(queue),
	],
	child: const App(),
)
```

`erpClientProvider` deliberately THROWS until overridden — the app owns client
construction (async storage init, injected transports), and an un-overridden
read names its own fix (`ProviderException` wrapping the `UnimplementedError`).

**Reads** — all auto-dispose (a screen's worth of cache, dropped when the
screen leaves; `ref.keepAlive()` upgrades one to app-lifetime):

| Provider                   | Key           | Round trip                                            |
| -------------------------- | ------------- | ----------------------------------------------------- |
| `erpItemsProvider`         | `ErpItemsKey` | `GET /entities/<collection>` (rows + meta)            |
| `erpItemProvider`          | `ErpItemKey`  | `GET /entities/<collection>/<id>`                     |
| `erpCountProvider`         | `ErpCountKey` | COUNT only — no page SELECT behind it                 |
| `erpViewProvider`          | `ErpViewKey`  | `POST /api/query` — one-view-one-round-trip (≤ 12)    |
| `erpInfiniteItemsProvider` | `ErpItemsKey` | cursor-walking list: `build()` = page 1, `loadMore()` |

Family keys are value-equality wrappers that canonicalize through the wire
serialization — two equal queries always land on one cache entry, whether or
not the caller rebuilt the objects. `invalidateOn` is the escape hatch for
dot-path embeds: a change envelope names what a write TOUCHED, so a list
embedding `customer.name` refreshes on a `customers` write only when
`customers` is listed there.

**Invalidation is envelope-driven, not periodic.** Every read is wired through
`watchErpData`: it watches `erpDataVersionProvider` and listens to
`erpChangesProvider` (fed by `client.addChangeListener` — additive to the
app's own `onChange`, and it carries every `meta.changed` envelope, including
cascade and hook writes the app never issued). An envelope invalidates ONLY
providers whose collections it names; `erpDataVersionProvider.bump()` is the
blunt lever for the two moments no envelope exists — queue flush (replays
bypass the client pipeline) and account switches (login/logout must never leak
rows into the next session).

- `erpSessionProvider` — the signed-in user (or null). `build()`: no stored
  token → null; stored token → `auth.me()` (self-healing via refresh rotation);
  a 401 verdict → local session ended and null. Any other failure stays an
  `AsyncError` — an offline resume must not masquerade as signed-out. Re-run on
  app resume via `ref.invalidate(erpSessionProvider)`; `login()` / `logout()`
  bump the data version.
- `erpMutationsProvider(collection)` — create/update/remove with the last
  outcome as `AsyncValue` (null = idle) and the error rethrown to the caller.
  Refreshing reads is the envelope's job, not the notifier's.
- `erpFieldRestrictionsProvider(collection)` — the caller's whitelist
  (`null | [] | [...]`), refreshed on version bumps.
- `erpPendingMutationsProvider` — the live sync-badge count, kept by the
  queue's own change notifications; `flush()` replays now and bumps the data
  version when anything replayed.

## 13. Publishing — private registry

Releases run through
[`.github/workflows/publish-flutter-sdk.yml`](../../.github/workflows/publish-flutter-sdk.yml)
(workflow_dispatch). The `dry_run` input defaults to **true** — validate, then
dispatch again with `dry_run=false` to upload.

| Knob               | Where               | Meaning                                                |
| ------------------ | ------------------- | ------------------------------------------------------ |
| `PUB_REGISTRY_URL` | repository variable | the private registry host (must start with http/https) |
| `PUB_TOKEN`        | repository secret   | the credential for that host                           |

The job gates on `flutter pub get` / `analyze` / `test`, re-points
`publish_to` at `PUB_REGISTRY_URL` (throwaway CI checkout — never committed),
authorizes the credential (`dart pub token add <url> --env-var PUB_TOKEN`),
then runs `dart pub publish --dry-run`, or `dart pub publish --force` when
`dry_run=false`.

Poka-Yoke: the committed pubspec keeps `publish_to: 'none'`, so a stray local
`dart pub publish` can never reach pub.dev; the workflow never sets
`PUB_HOSTED_URL`, so dependency resolution keeps using pub.dev. LICENSE and
CHANGELOG.md are part of the published surface — the dry-run gate must report
**0 warnings** before flipping `dry_run` to false.

## See also

- [Client SDK](sdk.md) — the TypeScript sibling (`@mmbix/sdk` + `@mmbix/sdk-react`)
- [mmbix-typegen CLI](../cli/typegen.md) — the generator reference
- [Entities API](entities.md) — the REST surface both SDKs wrap (filters, cursor, `POST /api/query`)
- [Authentication](authentication.md) — tokens, refresh chains, RBAC
- [Media](media.md) — upload contract, serving, allowlists
- [Flutter SDK design spec](../superpowers/specs/2026-09-28-flutter-sdk-design.md) — scope decisions + roadmap

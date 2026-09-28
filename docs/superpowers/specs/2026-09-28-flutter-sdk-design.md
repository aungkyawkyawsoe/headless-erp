# Flutter SDK — Design (Headless ERP)

> **Date:** 2026-09-28 (rev 3 — Standalone app; ဆုံးဖြတ်ချက်များ ပိတ်ပြီး) · **Status:** DESIGN PROPOSAL — implementation မစရသေး · **Scope:** Flutter/Dart client SDK + server-side auth upgrade
>
> **အခြေခံ:** `packages/sdk` (TypeScript SDK)၊ `docs/backend-api/*` contract များ နှင့် `apps/api` auth flow ကို audit လုပ်ပြီး ရေးထားသော အကြံပြုချက် document ဖြစ်သည်။
>
> **Rev 4 — implementation (2026-09-28): package တစ်ခုတည်း။** User decision: "single package for flutter usage for more easy"။ §1 နိဂုံး (၃) နှင့် §4.1 ရဲ့ "package ၂ ခု" ဖွဲ့စည်းပုံကို supersede — `sdk-dart` + `sdk-dart-flutter` ကို **`packages/mex-flutter-sdk`** (pub name **`mex_flutter_sdk`**) တစ်ခုတည်းအဖြစ် ပေါင်းစည်း၊ single import `package:mex_flutter_sdk/mex_flutter_sdk.dart`။ Core lib များ Flutter-free ဆက်ထား၊ adapter ဖိုင် ၄ ဖိုင်သာ plugin များသုံးသည်။

> **Rev 5 — P3 ပြီး (2026-09-28)။** `mmbix-typegen --target dart` ကို implement ပြီး (§9): plain-Dart row models + `F.*` field constants + `ApiErrorCodes` (`/api/meta → error_codes`) ကို ONE `schema.dart` အဖြစ် emit။ §10 contract loop ပိတ်ပြီး — TS drift gate (`packages/sdk/test/generate-dart.test.ts`, byte-exact golden) + Dart golden test (`packages/mex-flutter-sdk/test/generated_schema_test.dart`)။ Committed example `packages/mex-flutter-sdk/example/schema.dart` (CI-verified, hash-only header — byte-stable)။ `_devices` မပါ — optional/deferred အဖြစ် ဆက်။ ကျန်: P4 (publish + `sdk-dart.md` + Riverpod)။

> **Rev 6 — P4 docs အပိုင်း ပြီး (2026-09-29)။** `docs/backend-api/sdk-dart.md` ထွက်ပြီး — verified Flutter SDK reference (query DSL, sessions + lifecycle, replay-safe writes + change envelope, offline queue/reads, media, errors + SSOT catalog, field restrictions, `--target dart`, diagnostics/test seams)။ Package README (`packages/mex-flutter-sdk/README.md`) + cross-links (`docs/README.md`, `docs/backend-api/README.md`, `sdk.md` sibling pointer)။ Drive-by ပြင်: sdk.md ရဲ့ stale `MAX_PAGE_SIZE 100` ကို **500** (SSOT `packages/utils/src/constants.ts` အတိုင်း)။ ကျန် P4: publish (pub.dev / private registry) + Riverpod adapters။

> **Rev 7 — P4 ပြီးဆုံး (2026-09-29)။** Riverpod adapters — optional second entrypoint `package:mex_flutter_sdk/riverpod.dart`: read providers ၅ (`erpItemsProvider` / `erpItemProvider` / `erpCountProvider` / `erpViewProvider` / `erpInfiniteItemsProvider`) + session / mutations / field-restrictions / offline bridge။ Invalidation က change envelope ကနေ (`client.addChangeListener` → `watchErpData`) — flush/login/logout တွေမှာ envelope မရှိလို့ `erpDataVersionProvider.bump()`။ Tests ၂၉ pass; Riverpod 3 auto-retry ကို test container တိုင်းမှာ `retry: (c, e) => null` နဲ့ ပိတ်ထားသည် (masked retry က first verdict ကို ဖျောက်ပိတ်ပြီး transport calls ကို နှစ်ဆဖြစ်စေသည်)။ Publishing — private registry: `.github/workflows/publish-flutter-sdk.yml` (workflow_dispatch, `dry_run` default true; gate → `sed` publish_to → `dart pub token add --env-var PUB_TOKEN` → dry-run / `--force`) + `LICENSE` + `CHANGELOG.md`; committed `publish_to: 'none'` က pub.dev ဆီ stray publish ကို Poka-Yoke ပိတ်ထားပြီး `PUB_HOSTED_URL` မသုံး (dependency resolution pub.dev ကပဲ)။ Local dry-run ရလဒ် — **0 warnings**။ ဤနှင့်အတူ **P0–P4 အားလုံး ပြီးဆုံး**။

---

## 1. အနှစ်ချုပ် (TL;DR)

**ပန်းတိုင်:** Flutter app တစ်ခုမှာ `HeadlessErpClient` instance တစ်ခု init လုပ်ရုံနဲ့ (endpoint URL + configurations pass လုပ်) — auth, typed CRUD, batch read, offline sync အားလုံးကို Directus SDK လို အလွယ်တကူ သုံးနိုင်တဲ့ Flutter package နှစ်ခု။

**အဓိက နိဂုံး ၅ ချက်:**

1. **အသစ် design မလုပ်ပါ — `@mmbix/sdk` ကို Dart သို့ port လုပ်ပါ။** TS SDK မှာ zero-waste guarantee ၉ ချက် (typed query, expired-token awareness, 401 self-heal, idempotent write, ETag 304, offline queue...) အားလုံး ဖြေရှင်းပြီးသား။ ဒီ decisions တွေကို ပြန်တွေးစရာ မလိုတော့ — ကူးယူပါ။
2. **App code က REST ကို လုံးဝ မမြင်ရပါ။** ဒါပေမယ့် wire ပေါ်မှာ သွားတာက REST (HTTP/JSON) ပဲ။ Directus လည်း ဒီအတိုင်း — "SDK လို လွယ်တာ" က **DX** ဖြစ်တယ်၊ transport မဟုတ်ဘူး။ tRPC က Dart အတွက် မရ (TS-to-TS သာ)၊ GraphQL က server-side surface အသစ် — Flutter gain မရှိ။
3. **Package ၂ ခု ခွဲပါ။** `sdk-dart` (pure Dart core — Flutter dependency လုံးဝမပါ) + `sdk-dart-flutter` (secure storage, lifecycle, connectivity adapter)။ TS ရဲ့ `@mmbix/sdk` / `@mmbix/sdk-react` split အတိုင်း။
4. **Server-side gap တစ်ခု ရှိတယ် — `refresh token` + `logout` endpoint မရှိ။** လက်ရှိ 24h JWT က per-request re-validation (`_healActingEmployee`) လုပ်တဲ့အတွက် လုံခြုံရေး အားကောင်းပြီးသား။ ဒါပေမယ့် (က) ၂၄ နာရီထက် session ရှည်ဖို့၊ (ခ) unlinked account တွေအတွက် server-side revoke ရှိဖို့ refresh token လိုအပ် (P1)။ Standalone app ဖြစ်လို့ 24h ကျော် "stay signed in" အတွက် refresh token က တစ်ခုတည်းသော လမ်း — အရေးပါမှု ပိုမြင့်။
5. **Offline persistence က deny-by-default။** Read body တွေကို `X-Offline-Max-Age` header ပါမှသာ device မှာ သိမ်းခွင့်ရှိတယ် — ဒီ server policy ကို Dart SDK က တိကျစွာ လိုက်နာရမယ်။

---

## 2. ပန်းတိုင် နှင့် Non-Goals

### ပန်းတိုင် (Goal)

- Flutter app တစ်ခုမှာ `HeadlessErpClient` instance တစ်ခု init လုပ်ရုံနဲ့ app တစ်ခုလုံးရဲ့ data pipeline (auth → offline → error → connectivity → cache) ကို client တစ်ခုတည်းကနေ ဖြတ်သွားနိုင်တာ။
- Compile-time မှာ typed: collection/field အမည်များ၊ filter operators များ၊ models များ — typegen ကနေ generate။
- Wire contract ကို `@mmbix/sdk` နဲ့ **တစ်ထပ်တည်း** (parity) ဖြစ်နေတာ — ported tests နဲ့ သက်သေပြနိုင်တာ။
- Offline-first: network မရှိချိန် write များ queue လုပ်ပြီး ပြန်ရောက်ချိန် replay — duplicate လုံးဝ မဖြစ် (`Idempotency-Key`)။

### Non-Goals (ရှင်းရှင်းလင်းလင်း ပြင်ပ)

| ပြင်ပ (Out of scope)                    | အကြောင်းရင်း                                                                       |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| GraphQL / gRPC layer အသစ်               | Server မှာ မရှိ၊ Flutter gain မရှိ။ REST wire တစ်ခုတည်း (Directus model အတိုင်း)   |
| tRPC port (Dart)                        | tRPC က TypeScript-to-TypeScript သာ — Dart မှာ တရားဝင် client မရှိ                  |
| UI widgets (table/form builder စသဖြင့်) | SDK က data layer သာ။ UI က app အလိုက် (လိုအပ်မှ Flutter package မှာ adapter)        |
| Real-time subscription (`realtime()`)   | Server-side events channel မရှိသေး (TS SDK ရဲ့ roadmap အတိုင်း) — လောလောဆယ် မဆောက် |
| Password ကို device မှာ သိမ်း           | လုံးဝ တားမြစ် — refresh token ဒါမှမဟုတ် re-login သာ                                |
| API key (`mmk_`) ကို app binary ထဲ ထည့် | App မှာ extract လုပ်လို့ရ — key က server/kiosk အတွက်သာ                             |

---

## 3. လက်ရှိ အခြေအနေ (What already exists — audit ရလဒ်)

SDK ရေးရာမှာ **ပြန်သုံးလို့ရတဲ့အရာ / ဖြည့်ရမယ့်အရာ** တွေကို ရှင်းရှင်းသိထားဖို့ လိုတယ်။

### 3.1 Server side (ရှိပြီးသား — အားကောင်းပြီးသား)

| Ability                | အနေအထား                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login (email/password) | `POST /api/auth/login` → 24h JWT။ Production မှာ **5/min** rate limit                                                                                   |
| Session check          | `GET /api/auth/me` → role, `field_restrictions`, `granted_collections`, `apps` — **resume တိုင်း ပြန်ခေါ်ရမယ်**                                         |
| Per-request revocation | `verifyToken` → `_healActingEmployee` — employee link ကို **request တိုင်း** re-check။ Offboard လုပ်လိုက်တာနဲ့ session ချက်ချင်း ကုန်                   |
| Authz freshness        | Role/permission ပြောင်းလဲမှု **~1s** အတွင်း effect (version-keyed cache stamp) — TTL စောင့်စရာ မလို                                                     |
| Conditional reads      | GET တိုင်း weak `ETag`; `If-None-Match` နဲ့ → `304` bodiless (server-side cache invalidation အလကား)                                                     |
| Write change envelope  | Write response ရဲ့ `meta.changed = { collections, rows }` — cascade/hook ရေးလိုက်တဲ့ collections အထိ ပါ                                                 |
| Offline reads policy   | `X-Offline-Max-Age` header — collection policy ပါမှသာ client persist ခွင့်ရှိ (deny-by-default)                                                         |
| Batch read             | `POST /api/query` — view တစ်ခုရဲ့ read အားလုံး **round trip တစ်ခါ** (batch cap 12)၊ per-key error isolation                                             |
| Pagination             | Cursor-based (O(log n))။ Default page 25, max 100 — `/api/meta` မှာ advertise                                                                           |
| Idempotency            | Client UUID + `Idempotency-Key` header — replay-safe write                                                                                              |
| Optimistic concurrency | `If-Match: <updated_at>` → ဟောင်းနေရင် 409                                                                                                              |
| Media upload           | `POST /api/media/upload` (multipart) + presign single-use token flow (15 min TTL)                                                                       |
| Capabilities discovery | `GET /api/meta` → `pagination {default_page_size, max_page_size}` + `error_codes` catalog (SSOT)                                                        |
| Machine keys           | `mmk_` prefix API keys — SHA-256 hash သာ သိမ်း (`_api_keys`)၊ scope (read/write/admin) + `expires_at` — **refresh token design အတွက် precedent ကောင်း** |

### 3.2 Client side (TS SDK — ကူးယူရမယ့် architecture)

| TS SDK file                             | ဘာကို pin လုပ်ထားလဲ (Dart မှာ ကူးရမယ့် semantics)                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `packages/sdk/src/query.ts`             | Filter/ListQuery wire serialization (`filter[field][_op]`, `_or[i]`, relation paths, `groupBy[]`) |
| `packages/sdk/src/items.ts`             | Fluent CRUD + `MutateOptions` (id, idempotencyKey, ifMatch, ack, validate)                        |
| `packages/sdk/src/auth.ts`              | `TokenStorage` interface, `isTokenExpired` (30s skew), `tokenSubjectOf` (account fingerprint)     |
| `packages/sdk/src/client.ts`            | Request pipeline: bearer attach, 401 → refresh once → retry once, retry backoff, hooks            |
| `packages/sdk/src/offline.ts`           | Write queue: 2xx/409 = success၊ 4xx = drop၊ 5xx/network = keep။ Account-scoped fingerprint        |
| `packages/sdk/src/conditional-cache.ts` | ETag store + 304 handling (memory-only)                                                           |
| `packages/sdk/src/errors.ts`            | `HttpError` (raw `code`, canonical `apiCode`, `requestId`) — canonical catalog မှ တည်ဆောက်        |
| `packages/sdk/test/*` (87 tests)        | **Parity ကို သက်သေပြတဲ့ suite** — Dart မှာ 1:1 port လုပ်ရမယ်                                      |

### 3.3 Gap များ (ဖြည့်ရမယ့်အရာ)

1. **Refresh token + logout endpoint မရှိ** (§7.3 တွင် design) — 24h အထက် session နှင့် explicit revoke အတွက်။
2. **Dart typegen target မရှိ** — `mmbix-typegen` က TS/Zod သာ emit လုပ်။
3. **Dart SDK လုံးဝ မရှိ** — ဒီ document ရဲ့ အဓိက deliverable။

---

## 4. Architecture — Package ဖွဲ့စည်းပုံ

### 4.1 Package ၂ ခု (TS split အတိုင်း) — ⚠️ rev 4 တွင် supersede: package တစ်ခုတည်း (ထိပ်ရှိ rev 4 မှတ်စုကြည့်)

```
packages/sdk-dart/                     # pure Dart core — Flutter dependency မပါ
  lib/
    headless_erp.dart                  # barrel export
    src/
      client.dart                      # HeadlessErpClient + HeadlessErpOptions
      query.dart                       # ListQuery / Filter / QuerySerializer
      items.dart                       # items<T>(collection).list/get/create/update/remove
      auth.dart                        # TokenStorage interface + login/logout (+ refresh, P1)
      jwt.dart                         # ⚠️ custom JWT decoder (အောက်တွင် ရှင်းလင်း)
      errors.dart                      # ErpHttpException + canonical code enum
      conditional_cache.dart           # ETag store (conditional-cache.ts port)
      offline.dart                     # write queue (offline.ts port)
      meta.dart                        # loadLimits(), error_codes discovery
  test/                                # TS test suite ရဲ့ 1:1 port

packages/sdk-dart-flutter/             # thin Flutter adapter
  lib/src/
    secure_token_storage.dart          # flutter_secure_storage-backed TokenStorage
    lifecycle.dart                     # app resume → auth.revalidate() (opt-in auto)
    connectivity.dart                  # connectivity_plus → queue flush
    biometric.dart                     # local_auth gate (optional)
```

**ဘာကြောင့် ၂ ခု ခွဲ?** — Core က Flutter မပါဘဲ Dart run နိုင်တဲ့နေရာတိုင်း (CLI, server-side Dart, isolate) အလုပ်လုပ်တယ်။ Flutter-only deps (`flutter_secure_storage`, `connectivity_plus`, `local_auth`) တွေက core ကို မညစ်ပတ်စေဘူး။ TS ရဲ့ `@mmbix/sdk` vs `@mmbix/sdk-react` split အတိအကျ။

### 4.2 TS → Dart mapping

| `@mmbix/sdk`               | Dart equivalent                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createClient(options)`    | `HeadlessErpClient(baseUrl: …, …)` (named params + `HeadlessErpOptions`)                                        |
| `serializeQuery/Filter`    | `QuerySerializer` + mistake-proof operator factories (§5)                                                       |
| `items<T>()` fluent CRUD   | `erp.items<T>('orders')` typed repository                                                                       |
| `TokenStorage` interface   | တူတူ — ဒါပေမယ့် **custom JWT decoder** လိုအပ် (§6.2)                                                            |
| `conditional-cache.ts`     | တူတူ — in-memory default; disk ကို policy ပါမှသာ                                                                |
| `offline.ts` queue         | တူတူ — `QueueStorage` injectable (file / drift / secure)                                                        |
| `errors.ts` `HttpError`    | `ErpHttpException` — raw `code` + canonical `apiCode` + `requestId`                                             |
| `.with(authenticate(...))` | **Dart မှာ type-level composition မရ** → sub-APIs (`erp.auth`, `erp.items`, `erp.files`) + constructor features |
| `@mmbix/sdk-react` hooks   | Flutter package မှာ optional Riverpod/Provider adapter                                                          |

### 4.3 Repo ထဲ ထားမလား၊ repo အသစ် ခွဲမလား?

**အကြံပြုချက်: ဒီ repo ထဲမှာပဲ `packages/sdk-dart/` အနေနဲ့ ထား။** အကြောင်းရင်း — contract tests တွေ CI မှာ API နဲ့အတူ run နိုင်တယ် (parity ကို CI က စောင့်ရှောက်)။ Turbo pipeline ထဲ slot ဝင်ဖို့ thin `package.json` wrapper လောက်ပဲ လိုမယ် (`"test": "dart test"`)။ Publish လုပ်တဲ့အခါ pub.dev သို့မဟုတ် private registry ကို သီးသန့် ထုတ်လို့ရ။ _(rev 4: implementation က `packages/mex-flutter-sdk` တစ်ခုတည်း — ဤအကြံပြုချက်ကို supersede။)_

---

## 5. API Surface — App Developer မြင်ရမယ့် ပုံ

### 5.1 Instance init

```dart
final erp = HeadlessErpClient(
  baseUrl: 'https://api.mycompany.com',          // `/api` prefix ကို auto ထည့်
  storage: FlutterSecureTokenStorage(),           // TokenStorage interface
  refreshSession: () async => erp.auth.refresh(), // 401 self-heal hook (§7.3)
  retry: const RetryPolicy(attempts: 2),
  timeout: const Duration(seconds: 15),
  offlineQueue: OfflineQueueOptions(dir: appDocsDir),   // P2 — v1 must-have
  conditionalGet: true,                            // ETag store (in-memory default)
  on: ErpHooks(
    onChange: (change) => localDb.invalidate(change.collections),
    onQueued: (item) => banner.pending(item.path),
    onError: (e) => toast(e.message),
    onSettled: (ok) => connectivity.set(ok),
  ),
);
```

### 5.2 Auth

```dart
final s  = await erp.auth.login(email: e, password: p);  // Standalone — password login သာ
final me = await erp.auth.me();                       // role, restrictions, granted_collections, apps
await erp.auth.refresh();                             // P1 — refresh token (§7.3)
await erp.auth.logout();
```

> Standalone app ဖြစ်လို့ login က email/password သာ။ 24h ကျော် "stay signed in" အတွက် `refresh()` (P1) — §7.3။

### 5.3 Typed CRUD + batch + escape hatch

```dart
// list — cursor pagination
final page = await erp.items<Order>('orders').list(ListQuery(
  filter: F.and([F.eq('status', 'open'), F.gte('created_at', since)]),
  fields: ['id', 'title', 'total'],
  sort: '-created_at',
  limit: 24,
));
final next = await erp.items<Order>('orders').list(ListQuery(cursor: page.meta.nextCursor));

// write — replay-safe + optimistic concurrency
final row = await erp.items<Order>('orders').create(
  {'title': 'x'}, id: uuidV4(), idempotencyKey: 'k1',
);
final upd = await erp.items<Order>('orders').update(id, {'total': 1200}, ifMatch: row.updatedAt);

// one view = one round trip (POST /api/query)
final batch = await erp.queryMany({
  'cards': const Spec('orders', ListQuery(limit: 24)),
  'hero':  const Spec('hr_employees', ListQuery(fields: ['name_mm'])),
});

// business endpoints အားလုံးအတွက် escape hatch
final summary = await erp.request<Map<String, dynamic>>('/attendance/summary', query: {'month': '2026-09'});

// media (camera → R2)
await erp.files.upload(photoFile, visibility: Visibility.private);
```

### 5.4 Composition ကိစ္စ (Directus `.with()` ကို Dart မှာ ဘယ်လိုဖြေမလဲ)

TS SDK ရဲ့ `.with(authenticate(...))` ဟာ type-level composition — Dart မှာ higher-kinded types မရှိလို့ တိကျ တူအောင် လုပ်လို့မရ။ **Dart-idiomatic ဖြေရှင်းချက်:** sub-APIs (`erp.auth`, `erp.items`, `erp.files`) အမြဲ ရှိမယ် + features တွေကို constructor options ကနေ ထည့်။ ဒါက ရိုးသားတဲ့ adaptation — TS ရဲ့ chain ကို အတု မဆောက်ဘူး။

---

## 6. Query DSL — Footgun တွေကို မဖြစ်နိုင်အောင် ဆောက်

### 6.1 အရေးကြီးဆုံး insight

`packages/sdk/src/query.ts` ထဲက အရေးကြီးဆုံး သတိပေးချက်: **filter operator ကို စာလုံးမှားရေးလိုက်ရင် server က တိတ်ဆိတ်စွာ drop လုပ်တယ် (HTTP 200, filter မပါတဲ့ data အပြည့်အစုံ)** — ဒါ silently-wrong-results bug class။ TS မှာ type system က ကာကွယ်တယ်။ Dart မှာ map literals က မကာကွယ်ဘူး — ဒါကြောင့် SDK က **factory helpers** နဲ့ wrong operators ကို **represent လုပ်လို့မရအောင်** ဆောက်ရမယ်:

```dart
F.eq('status', 'open')           // → filter[status][_eq]=open
F.in_('id', [a, b])              // → filter[id][_in]=a,b
F.or([F.eq(...), F.and([...])])  // → filter[_or][0][...] groups
```

### 6.2 Dart-specific wire gotchas (တစ်ခုချင်း သတိထားရမယ်)

| Gotcha                                                                     | စည်းမျဉ်း                                                                                                                                                                                     |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repeated query keys** (`groupBy[]`, `aggregate[sum]` + `aggregate[avg]`) | `Uri(queryParameters: {'groupBy[]': ['a','b']})` နဲ့ ဆောက် — `Map<String,String>` က repetition ကို ဖျက်ပစ်တယ်                                                                                 |
| **JWT format က ပုံမှန် မဟုတ်**                                             | Server token က `base64(payload).sig` (single part)။ `jwt_decoder` စတဲ့ package တွေက 3-part JWT ကို မှန်းပြီး **fail ဖြစ်မယ်** — `decodeTokenPayload`/`tokenExpiryMs` ကို တိုက်ရိုက် port လုပ် |
| **Boolean က 0/1 လာတယ်** (D1)                                               | Generated models မှာ `num → bool` parse၊ `bool` ကို တိုက်ရိုက် မမှီး                                                                                                                          |
| **`num` vs `int`/`double`**                                                | JSON `1` vs `1.0` — `num` ကနေ parse၊ cast မလုပ်                                                                                                                                               |
| **`_startswith`(`_starts_with` မဟုတ်)**                                    | Misspelled op = silently dropped → 200 unfiltered. Factory helpers က op ကို const ထဲ ချုပ်ထားမယ်                                                                                              |

---

## 7. Secure Auth Flow

### 7.1 Flutter side — လိုက်နာရမယ့် စည်းမျဉ်း ၁၀ ချက်

1. **`flutter_secure_storage` သာ** — iOS Keychain / Android Keystore (EncryptedSharedPreferences)။ `SharedPreferences` လုံးဝ မသုံး။ Background sync လိုအပ်ရင် iOS accessibility `afterFirstUnlock`။
2. **Password ကို device မှာ လုံးဝ မသိမ်း။** "Remember me" ဆိုတာ refresh token ရဲ့ တာဝန် — credential သိမ်းတာ မဟုတ်။
3. **Expiry-aware**: `exp` ကို decode လုပ်၊ expired token ကို absent လို သဘောထား၊ ဆုံးခါနီး (30s skew) မှာ up-front re-auth — `401 + retry` အလကား မခံ။
4. **Resume တိုင်း revalidate** — `erp.auth.me()`။ Server design က ဒါကို တောင်းတယ် (offboard ဆို per-request refuse)။ Flutter layer က `didChangeAppLifecycleState` နဲ့ auto (opt-in)။
5. **401 taxonomy — ၃ မျိုး ခွဲခြား:**
   - `UNAUTHORIZED` (invalid/expired) → `refreshSession()` တစ်ခါ → retry တစ်ခါ → မရရင် logout
   - `"no longer linked to an active employee"` → **refresh လုံးဝ မလုပ်၊ retry လုံးဝ မလုပ်** → logout + "HR ကို ဆက်သွယ်ပါ" message (loop ဖြစ်မယ်)
6. **Login ကို auto-retry လုံးဝ မလုပ်** — production 5/min။ 429 + `Retry-After` ကို UI ဆီ surface လုပ်။
7. **Fail-closed transport** — `http://` baseUrl ကို debug-only flag မပါဘဲ refuse (poka-yoke)။ SDK ပိုင် log/interceptor တိုင်းမှာ `Authorization` ကို redact။ `requestId` ကို error ပေါ် expose — support ticket → server log ဆက်နိုင်ဖို့။
8. **Certificate pinning** — trade-off ရှိတယ်: Cloudflare cert က rotate ဖြစ်၊ backup pin + remote kill switch မရှိရင် app ကိုယ်တိုင် brick ဖြစ်နိုင်။ **v1 မှာ standard TLS; threat model မှာ hostile network + jailbroken device ပါမှ ပြန်စဉ်း။**
9. **Biometric gate (optional)** — `local_auth` က stored token ကို **ဖတ်ခြင်း** ကို gate လုပ်၊ server call ကို မဟုတ်။ Server auth ကို မပျော့စေဘဲ "unlock" UX ရ။
10. **Offline queue က per-account** — `tokenSubjectOf` fingerprint port လုပ်: user A queue က user B အောက်မှာ replay လုံးဝ မဖြစ်။ Logout မှာ response cache ရှင်း၊ queue ကို ဆက်ထား (ပိုင်ရှင် ပြန်လာနိုင်)။

### 7.2 Session lifecycle — လက်ရှိ flow (server change မလိုဘဲ အလုပ်လုပ်)

```
App open
  └─ secure storage မှာ token ရှိ?
       ├─ မရှိ → Login screen
       └─ ရှိ → exp စစ် → မကုန်သေး → GET /auth/me (resume revalidate)
                                   ├─ 200 → app စ (role/restrictions/apps ရပြီး)
                                   └─ 401 → logout → Login screen
App resume တိုင်း → GET /auth/me ပြန် (revocation ဒီမှာ ဖမ်း)
Mid-flight 401 → refreshSession() တစ်ခါ → retry တစ်ခါ → မရရင် logout
```

### 7.3 Server side — လိုအပ်တဲ့ upgrade (P1)

**လက်ရှိ အားကောင်းတာ — မပြင်ပါနဲ့:** JWT က capability cache မဟုတ်၊ **session pointer** လို ပြုမူတယ် — request တိုင်း user status + employee link ကို re-check၊ disable လုပ်တာနဲ့ live session ချက်ချင်း ကုန်၊ authz version stamp က ~1s အတွင်း ပျံ့။ ဒါကြောင့် **short-lived access token မလိုအပ်** — 24h JWT ကို server က request တိုင်း ပြန် validate နေပြီးသား။

**Gap:** `POST /api/auth/refresh` + `POST /api/auth/logout` မရှိ။

- 24h ကျော် "stay signed in" မဖြစ်နိုင် (password ပြန်ထည့်ရ)
- _unlinked_ account (bootstrap admin, external provider user — employee link မရှိတဲ့သူ) ရဲ့ ခိုးခံရတဲ့ token က 24h အပြည့် အသက်ရှင်၊ kill switch မရှိ
- Standalone app ဖြစ်လို့ 24h ကျော် session အတွက် အခြားလမ်း မရှိ — refresh token ကသာ

**Design — `_api_keys` precedent အတိုင်း (SHA-256 hash သာ at rest၊ `sha256Hex` ရှိပြီးသား):**

```
_refresh_tokens (migration အသစ်)
  id, user_id, token_hash (SHA-256 only), device_id,
  created_at, expires_at, rotated_from, revoked_at
```

- `POST /api/auth/refresh` → JWT အသစ် + **rotated** refresh token။ Rotated-from token ကို ပြန်တွေ့ရင် (reuse) = theft signal → token family တစ်ခုလုံး revoke + `securityAudit` event (audit pattern ရှိပြီးသား)။
- `POST /api/auth/logout` → တင်လာတဲ့ refresh token ကို revoke (`all: true` ဆို device အားလုံး sign out)။
- Refresh အချိန်တိုင်း `_healActingEmployee` ချက် ပြန် run — **offboard ဆို bearer ရော refresh chain ရော ကုန်**။
- Token က 256-bit random၊ rate-limit tier (~10/min/user)၊ log မှာ လုံးဝ မထုတ်။
- Optional (နောက်ပိုင်း): `_devices` registry — admin က device list မြင်၊ per-device revoke၊ push notification target။ Play Integrity / App Attest က threat model တောင်းမှသာ။

**မလုပ်သင့်တာ:** password ကို device မှာ သိမ်းပြီး "auto re-login" လုပ်တဲ့ဟာ anti-pattern — လုံးဝ ရှောင်။

---

## 8. Offline-first & Caching

### 8.1 Write queue (port `offline.ts`)

- Network ကြောင့် ကျရှုံးတဲ့ write များ queue ထဲ သိမ်း၊ ပြန်ရောက်ချိန် replay။
- Replay semantics: **2xx + 409 = success** (idempotent replay — write ရောက်ပြီးသား)၊ permanent 4xx = drop + surface၊ 5xx/network = ဆက်ထား။
- Mutating request တိုင်း auto `Idempotency-Key` — blind retry/replay က duplicate write လုံးဝ မဖြစ်စေ။
- `ifMatch` ပါတဲ့ queued write ရဲ့ 409 က conflict အစစ် → drop + `onFailed` (replayed လို့ မရေတွက်)။
- Storage injectable: default file-based (`path_provider`)၊ app မှာ drift/sqflite ရှိပြီးသားဆို အဲဒါ inject။

### 8.2 Read persistence — deny-by-default (PII contract)

- Read body ကို disk မှာ သိမ်းခွင့် **collection policy က `X-Offline-Max-Age` header ပေးမှသာ**။ မပါ → memory-only။
- 304 ရရင် window ကို slide (TTL ရှည်)။ Expired entries ကို init မှာ drop။
- Logout မှာ persisted cache တစ်ခုလုံး ရှင်း (device ပေါ်မှာ PII မကျန်)။

### 8.3 Cache invalidation — `meta.changed` envelope

- Write response ရဲ့ `meta.changed.collections` က cascade parent + hook/denorm write အထိ **အတိအကျ** ပြတယ်။
- `onChange` hook ကနေ local DB/provider invalidation ကို ဒီကနေ feed — optimistic မှန်းဆမှု မလိုအပ်ဘူး။
- ETag + envelope နှစ်ခုပေါင်းရင် polling မလိုဘဲ cache coherence ရ။

### 8.4 Cursor walk helpers

- `listAll()` / `listAllPages()` — page size ကို ဖောင်းမထားဘူး (default 25, max 100)။ လိုအပ်ရင် cursor လိုက်လျှောက်။
- `loadLimits()` — `/api/meta` မှ policy ကို runtime မှာ discover။ Hardcode မထား။

---

## 9. Typed Models — `mmbix-typegen` ကို Dart target ထည့်

> **Rev 5 — DONE (2026-09-28):** `packages/sdk/src/typegen/generate-dart.ts` + CLI `--target dart` (bin rebuild ပါ)။ Input က §ပါအတိုင်း — live `/api/collections` သို့မဟုတ် `--schema` snapshot။ Emit: row models (`fromJson`/`toJson`, virtual fields မပါ; booleans `_dbBool` ဖြတ်; numbers `num?`) + `<Collection>Fields` constants + `ApiErrorCodes`။ Live mode က `/api/meta → error_codes` ကို fail-soft ဖတ် (မရရင် bundled `@mmbix/types` catalog)။ Determinism: slug အလိုက် sort; header မှာ `source-hash` သာ (path မပါ — committed golden က invocation ပုံစံဘယ်လိုဖြစ်ဖြစ် byte-stable)။ Collision/slug/field-name/injection guard များ generation-time မှာ refuse။ `_devices`-linked ဘာမှ ဤနေရာမှာ မလိုအပ်။

လက်ရှိ `mmbix-typegen` က live schema (`GET /api/collections` / snapshot) ကနေ TS types + Zod emit လုပ်တယ်။ ဒီ CLI ကို `--target dart` ထည့်ရမယ်:

- **Models**: collection တစ်ခုချင်း plain Dart class (`fromJson`/`toJson`) — **build_runner dependency မပါ** (lean ထား)။
- **Field constants**: filter factories အတွက် field အမည် constants (`OrderFields.status`) — misspelled field ကို compile-time ဖမ်း။
- **Error code enum**: `/api/meta` → `error_codes` catalog ကနေ generate — CI contract test က ညီမညီ စစ် (SSOT loop ပိတ်)။

Trade-off: codegen (schema ပြောင်းတိုင်း command တစ်ချက် run၊ safety ရ) vs hand-written DTO (tooling နည်း)။ ERP ရဲ့ collection ဒါဇင်ချီအတွက် **codegen က အနိုင်**။

---

## 10. Testing — Parity ကို Test နဲ့ သက်သေပြ

> **Rev 5 — contract loop ပိတ်ပြီး (2026-09-28):** error-code SSOT ကို အလွှာ ၂ ခုနဲ့ pin — (၁) **TS suite** (`packages/sdk/test/generate-dart.test.ts`) က `packages/mex-flutter-sdk/lib/src/errors.dart` ကို parse ပြီး `ERROR_CODES`/`API_ERROR_CODES` (`@mmbix/types`) နဲ့ compare — CI မှာ run သော ဒီ suite က Dart catalog မွေ့ကို PR တစ်ခုထဲ ဖမ်း; (၂) **Dart suite** (`generated_schema_test.dart`) က `ApiErrorCodes.all == apiErrorCodes`။ Golden drift gate: committed `example/schema.dart` ကို in-memory regeneration output နဲ့ byte-compare (emitter ပြင်ပြီး golden မ regenerate ရင် TS suite က ချက်ချင်း fail)။ Dart suite ယခု 172 tests, `flutter analyze` clean။

- **TS suite (87 tests) ကို 1:1 port**: query serialization golden tests၊ 401-heal-once၊ ETag/304၊ page clamping၊ queue replay (409 = replayed / 4xx = dropped)၊ offline-reads gating၊ token expiry decode။
- **Live smoke**: `live-smoke.test.ts` pattern အတိုင်း `wrangler dev` + `dev-token` နဲ့ တိုက်ရိုက် run။
- **Contract test**: Dart error-code enum == `/api/meta` `error_codes` — CI မှာ စစ်။
- **စည်းမျဉ်း:** Dart test က TS test နဲ့ ကွဲရင် Dart test က မှားတယ် (သက်သေမပြမချင်း)။

---

## 11. Roadmap — Phase များ

| Phase  | Scope                                                                                                                                                       | Server change                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **P0** | Pure Dart core: client, auth (password login), items CRUD, query DSL, errors, `loadLimits` + ported tests                                                   | မလိုပါ                                               |
| **P1** | Flutter adapter (secure storage, resume revalidation), `refreshSession` wiring + logout revocation, ETag cache, media upload, `request()` escape hatch      | `_refresh_tokens` + `/auth/refresh` + `/auth/logout` |
| **P2** | Offline write queue (v1 must-have) + `onChange` hooks + replay semantics; drift/sqflite storage option                                                      | မလိုပါ                                               |
| **P3** | Dart typegen target (`--target dart`) + CI contract tests — ✅ Done (rev 5) (+ `_devices` optional — deferred)                                              | `_devices` (optional)                                |
| **P4** | Publish — private registry via `publish-flutter-sdk.yml` ✅ Done (rev 7), `docs/backend-api/sdk-dart.md` ✅ Done (rev 6), Riverpod adapters ✅ Done (rev 7) | မလိုပါ                                               |

---

## 12. Anti-patterns — ရှင်းရှင်းလင်းလင်း ငြင်းပယ်ရမယ့်အရာ

1. **Password ကို device မှာ သိမ်း** "auto-login" အတွက် — refresh token သုံး၊ ဒါမှမဟုတ် re-login လက်ခံ။
2. **`mmk_` API key ကို app binary ထဲ ထည့်** — extract လုပ်လို့ရ။ Key က server/kiosk အတွက်; kiosk ဖြစ်ရင်လည်း scoped `read` + expiry + rotate။
3. **`X-Offline-Max-Age` မပါဘဲ body disk သိမ်း** — PII contract ချိုးဖောက်။
4. **Business rules ကို client မှာ ပြန်ရေးခြင်း** — server က authority (`field_restrictions`, row filters, validations က `/auth/me`၊ `/api/meta` ကနေ လာ)။
5. **Flutter အတွက် GraphQL/tRPC layer ဆောက်ခြင်း** — မှားတဲ့ tool။ "လွယ်တာ" က SDK surface မှာ ရှိတယ်။
6. **Misspelled operator ကို map literal နဲ့ ရေး** — factory helper သာ သုံး (§6)။

---

## 13. ဆုံးဖြတ်ချက် မှတ်တမ်း — ၄ ချက် ဆုံးဖြတ်ပြီး

1. **(ဆုံးဖြတ်ပြီး) Standalone app — login က email/password သာ။** → refresh token ရဲ့ အရေးပါမှု မြင့် (§7.3)။
2. **(ဆုံးဖြတ်ပြီး) 24h ကျော် "stay signed in" လိုအပ် — refresh token + logout ကို P1 ဆီ တွန်းပြီး။** → §7.3 design + §11 roadmap တွင် update ပြီး။
3. **(ဆုံးဖြတ်ပြီး) Offline write က v1 must-have — queue က P2 ရဲ့ အဓိက deliverable။** → offline-first က headline goal; storage အတွက် drift/sqflite inject option ရှိ (§8.1)။
4. **(ဆုံးဖြတ်ပြီး) Personal device သာ (kiosk/shared မရှိ)။** → biometric gate က optional အတိုင်း ကျန်; account-scoped queue semantics က အတိုင်း အသုံးဝင်။

---

## 14. Appendix — Code Evidence (ဆက်လေ့လာရန်)

| ဖိုင်                                          | ဘာကို pin လုပ်ထားလဲ                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `packages/sdk/src/client.ts`                   | Request pipeline၊ hooks (`onChange`/`onQueued`/`onError`/`onSettled`)  |
| `packages/sdk/src/query.ts`                    | Filter wire format + "misspelled operator silently dropped" သတိပေးချက် |
| `packages/sdk/src/items.ts`                    | CRUD + `MutateOptions` (`id`, `idempotencyKey`, `ifMatch`, `ack`)      |
| `packages/sdk/src/auth.ts`                     | `TokenStorage`, `tokenExpiryMs`, `tokenSubjectOf`                      |
| `packages/sdk/src/offline.ts`                  | Replay semantics + account fingerprint scoping                         |
| `packages/sdk/src/conditional-cache.ts`        | ETag store + 304 slide                                                 |
| `packages/sdk/src/errors.ts`                   | `HttpError` + canonical code catalog                                   |
| `packages/sdk/test/*`                          | Port လုပ်ရမယ့် 87 tests                                                |
| `apps/api/src/routes/auth.ts`                  | login / me / requireAuth (mmk_ key + dev-token path)                   |
| `apps/api/src/routes/media.ts`                 | upload / presign (single-use token, 15 min)                            |
| `apps/api/src/lib/services/api-key.service.ts` | SHA-256 hash-only precedent (**refresh token design ရဲ့ စံ**)          |
| `docs/backend-api/authentication.md`           | JWT details + employee link + revocation semantics                     |
| `docs/backend-api/entities.md`                 | ETag / offline reads / query batch contract                            |
| `docs/backend-api/sdk.md`                      | TS SDK ၏ zero-waste guarantee ၉ ချက် — Dart parity checklist           |

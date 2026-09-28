# `mmbix-typegen` — SDK Schema Typegen

Generates ONE file from the live API schema (or a local JSON snapshot):
**TypeScript types + Zod schemas** (`--target ts`, the default) where types are
`z.infer<schema>` so compile-time and runtime validation can never diverge —
or **plain-Dart models** (`--target dart`) for Flutter apps, with field
constants and the canonical API error codes.

Part of `@mmbix/sdk` (not the `headless` CLI). Full client usage:
[Client SDK — `@mmbix/sdk`](../backend-api/sdk.md).

## Usage

```bash
# From the live API (needs an admin/dev token — GET /entities is admin-only)
mmbix-typegen --url http://localhost:8788/api --token dev-token --out ./src/generated

# Or from a local schema snapshot (CI / IaC)
mmbix-typegen --schema ./schema.json --out ./src/generated

# Dart/Flutter output
mmbix-typegen --schema ./schema.json --out ./lib/generated --target dart
```

## Flags

| Flag              | Default             | Description                                                                |
| ----------------- | ------------------- | -------------------------------------------------------------------------- |
| `--url <base>`    | —                   | API base URL, e.g. `http://localhost:8788/api`                             |
| `--token <token>` | —                   | Admin/dev token (required with `--url`)                                    |
| `--schema <path>` | —                   | Local JSON file (array of collections) instead of `--url`                  |
| `--target <lang>` | `ts`                | Output language: `ts` (types + Zod) or `dart` (models + constants + codes) |
| `--out <dir>`     | `./src/generated`   | Output directory (created if missing)                                      |
| `--name <file>`   | `schema.ts`/`.dart` | Output file name (`schema.ts`, or `schema.dart` for `--target dart`)       |
| `-h` / `--help`   | —                   | Print usage                                                                |

> `--schema` JSON shape: an array of collection rows as returned by
> `GET /api/entities` (each with `slug` + `schema_json`), or
> `{ collections: [...] }`.

## What it emits

`src/generated/schema.ts`:

```ts
import { z } from 'zod';

export const HrAttendanceSchema = z.object({ ... });          // per collection
export type Schema = { 'records': z.infer<typeof HrAttendanceSchema>; ... };
export const Schemas = { 'records': HrAttendanceSchema, ... };
```

- **Zero drift** — one source of truth: types are inferred FROM the Zod
  schemas; re-run after any schema change and both sides update together.
- **Typed client** — `createClient<Schema>({ ... })` type-checks every
  `items(...)` call, filter, sort and field projection against the generated
  types (see [Client SDK](../backend-api/sdk.md)).
- **Runtime purification** — `Schemas.records.parse(row)` validates any
  API response at runtime.
- **Computed fields** — stored formulas (`store: true`) are typed by their
  `result_type` (`number` → `z.number()`, `boolean` →
  `z.union([z.boolean(), z.number()])` since D1 stores 0/1, `string`/`json` →
  `z.string()`); virtual formulas are omitted from the row shape like o2m/m2m
  fields (they only appear when expanded).

## Dart mode (`--target dart`)

For Flutter/Dart apps — the same input, emitted as plain Dart (no
`build_runner`). `lib/generated/schema.dart` contains:

- **Row models** — one class per collection (`WorkOrders`, `Contacts`, …)
  with `fromJson`/`toJson`. Wire keys stay `snake_case`; members are
  `camelCase` (`is_billable` → `isBillable`). `id` is the only non-null
  member — every other field is nullable on read (D1 can return NULL even for
  `required: true`). Booleans decode through a `_dbBool` helper (D1 returns
  0/1 integers); numbers stay `num?`.
- **`toJson()` is PATCH-style** — null fields are OMITTED (absent ≠ explicit
  null), so a round-tripped row never silently clears a column.
- **Field constants** — `WorkOrdersFields.status` etc. for the `F.eq(...)`
  filter factories: a misspelled field becomes a compile error.
- **`ApiErrorCodes`** — the canonical error catalog (`GET /api/meta` →
  `error_codes` in live mode, with a warning if it differs from this CLI
  build; the bundled `@mmbix/types` catalog offline).
- Virtual fields (o2m/m2m/table + non-stored formulas) are omitted; stored
  formulas are typed by `result_type`; Dart reserved words are escaped
  (`class` → `class_`); name/slug collisions are refused at generation time.

A committed, CI-verified example lives at
`packages/mex-flutter-sdk/example/schema.dart` — regenerate it with:

```bash
node packages/sdk/bin/typegen.js \
  --schema packages/mex-flutter-sdk/example/schema.source.json \
  --target dart --out packages/mex-flutter-sdk/example
```

The TS suite's drift gate (`packages/sdk/test/generate-dart.test.ts`)
regenerates in memory and byte-compares the committed file, and the Dart test
suite (`generated_schema_test.dart`) exercises the emitted models against D1
wire quirks.

## Regenerate after schema changes

Every collection/field change (Studio schema designer, `POST /api/entities`, or
`headless collection create`) should be followed by a regen:

```bash
npx mmbix-typegen --url http://localhost:8788/api --token dev-token --out ./src/generated
```

> Tip for CI: commit the generated file and add a check that regenerates it and
> fails on drift — the file header says `AUTO-GENERATED — DO NOT EDIT`.

## See also

- [Client SDK — `@mmbix/sdk`](../backend-api/sdk.md)
- [Entities API](../backend-api/entities.md) — the schema the generator reads
- [Schema Snapshot / Diff](../backend-plugins/schema-snapshot.md) — IaC for schemas

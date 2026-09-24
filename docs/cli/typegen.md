# `mmbix-typegen` — SDK Schema Typegen

Generates `schema.ts` — **one file with TypeScript types AND Zod schemas** —
from the live API schema (or a local JSON snapshot). Types are
`z.infer<schema>`, so compile-time and runtime validation can never diverge.

Part of `@mmbix/sdk` (not the `headless` CLI). Full client usage:
[Client SDK — `@mmbix/sdk`](../backend-api/sdk.md).

## Usage

```bash
# From the live API (needs an admin/dev token — GET /entities is admin-only)
mmbix-typegen --url http://localhost:8788/api --token dev-token --out ./src/generated

# Or from a local schema snapshot (CI / IaC)
mmbix-typegen --schema ./schema.json --out ./src/generated
```

## Flags

| Flag              | Default           | Description                                               |
| ----------------- | ----------------- | --------------------------------------------------------- |
| `--url <base>`    | —                 | API base URL, e.g. `http://localhost:8788/api`            |
| `--token <token>` | —                 | Admin/dev token (required with `--url`)                   |
| `--schema <path>` | —                 | Local JSON file (array of collections) instead of `--url` |
| `--out <dir>`     | `./src/generated` | Output directory (created if missing)                     |
| `--name <file>`   | `schema.ts`       | Output file name                                          |
| `-h` / `--help`   | —                 | Print usage                                               |

> `--schema` JSON shape: an array of collection rows as returned by
> `GET /api/entities` (each with `slug` + `schema_json`), or
> `{ collections: [...] }`.

## What it emits

`src/generated/schema.ts`:

```ts
import { z } from 'zod';

export const HrAttendanceSchema = z.object({ ... });          // per collection
export type Schema = { 'hr_attendance': z.infer<typeof HrAttendanceSchema>; ... };
export const Schemas = { 'hr_attendance': HrAttendanceSchema, ... };
```

- **Zero drift** — one source of truth: types are inferred FROM the Zod
  schemas; re-run after any schema change and both sides update together.
- **Typed client** — `createClient<Schema>({ ... })` type-checks every
  `items(...)` call, filter, sort and field projection against the generated
  types (see [Client SDK](../backend-api/sdk.md)).
- **Runtime purification** — `Schemas.hr_attendance.parse(row)` validates any
  API response at runtime.
- **Computed fields** — stored formulas (`store: true`) are typed by their
  `result_type` (`number` → `z.number()`, `boolean` →
  `z.union([z.boolean(), z.number()])` since D1 stores 0/1, `string`/`json` →
  `z.string()`); virtual formulas are omitted from the row shape like o2m/m2m
  fields (they only appear when expanded).

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

# Generic Server-Side Table Filters in the Studio Collection Workbench

**Date:** 2026-09-10
**Status:** Approved design (approach A — Studio-only generic adapter)

## Problem

The collection table in the Studio (`#/idp/collections?collection=…&view=table`) renders a
functional Directus-style toolbar — global `SearchBox`, filter trigger + active count,
filter chips — but the filter popover opens **empty** and “Add Filter” is disabled.

Root causes (verified in code + DOM):

1. `CollectionsWorkbench.tsx` / `AppDetailPage.tsx` build table columns with only
   `{ id, accessorKey, header, enableSorting, defaultVisible, cell }`. The design-system
   `DataTableFilterPopover` only lists `columns.filter((c) => c.filter != null)`, so with
   zero `filter` metadata there is nothing to render.
2. Even when filters existed, `fetchData` hardcodes every filter to `_icontains`
   (`entityParams.filters[f.id] = { operator: '_icontains', value: String(f.value) }`),
   which is wrong for equals, booleans, numbers, dates, between/in, and empty checks.

The design system and backend already provide everything needed:

- Debounced server-side global search (`?search=`)
- Filter popover + typed field/operator/value controls + chips (already wired in DataTable)
- Server-side `fetchData` with cursor reset on filter/search change
- Backend operators `_eq _neq _gt _gte _lt _lte _icontains _ncontains _startswith _endswith
_in _nin _null _nnull _between _empty _nempty`, plus nested m2o paths
  (`filter[department.name][_icontains]=…`) and function filters (`filter[date(col)][_eq]=…`)

## Goal / Non-goals

**Goal:** any collection table gets working, typed, server-side filtering for every physical /
scalar / m2o column, driven purely by the schema field definitions. Apply to both
`CollectionsWorkbench` and `AppDetailPage` (they duplicate the same dead code).

**Non-goals (explicit):**

- No design-system source changes and no design-system rebuild.
- No backend / API-worker changes.
- No filtering through `o2m`, `m2m`, `m2a`, or `table` (virtual array) columns — the generic
  backend list API cannot express those today (`applyNestedQueries` resolves m2o hops only).
  This is a candidate for a separate future backend spec.
- No URL persistence of active filters/search (would require controlled DataTable filter
  props — separate scope).
- No async related-record pickers inside the filter popover (would require a DataTable
  `FilterDef` extension — separate scope).

## Interaction (unchanged UI, newly live)

1. Toolbar `SearchBox` — global server-side `?search=` (unchanged).
2. “Filter” trigger — opens the existing design-system popover:
   - searchable field combobox (fields come from `filter` metadata)
   - operator list filtered by the chosen field’s type
   - typed value control (text/number/date/select/boolean)
3. Apply → `DataTable.setFilters()` → `fetchData` sends real backend operators.
4. Active filters render as removable chips (`showFilterBar` already defaults on).
5. Removing/clearing filters, changing search, sorting, or page size resets the cursor to the
   first page (existing DataTable behavior).

## Field-type → FilterDef mapping (pure, generic)

Central mapper in a new shared module `apps/studio/src/lib/collection-table-filters.ts`.

| Engine field types                                                                                   | `FilterDef.type`                                                                        | Default operator                              |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| `text longtext slug email url phone icon barcode color uuid csv tags time text_editor markdown code` | `text`                                                                                  | `contains`                                    |
| `integer number bigint currency percent rating duration progress`                                    | `number`                                                                                | `equals`                                      |
| `select`                                                                                             | `select`                                                                                | `equals` (options from `field.options`)       |
| `boolean`                                                                                            | `boolean`                                                                               | `equals`                                      |
| `date`                                                                                               | `date`                                                                                  | `equals`                                      |
| `datetime timestamp`                                                                                 | `date`                                                                                  | `equals` (day-granularity, see serialization) |
| `formula`                                                                                            | typed by `result_type` **only when `store: true`**                                      | —                                             |
| `m2o`                                                                                                | typed by the related row's display leaf (below)                                         | leaf default                                  |
| `o2m m2m m2a table`                                                                                  | excluded                                                                                | —                                             |
| `password`, `encrypted` fields                                                                       | excluded                                                                                | —                                             |
| `file image`                                                                                         | excluded from the default filter list (opaque storage URLs; the column remains visible) | —                                             |
| system `id` / `uuid` (`id`, `created_by`-style refs)                                                 | `text`                                                                                  | `equals`                                      |
| system `doc_status` / `display_number`                                                               | `text`                                                                                  | `contains`                                    |
| system `created_at updated_at deleted_at`                                                            | `date`                                                                                  | `equals`                                      |

System user-reference columns (`_owner`, `created_by`, `updated_by`, `deleted_by`) are
hidden-opt-in columns whose value is a raw UUID, not a label. They are excluded from the
filter list (the columns stay hidden/visible exactly as today); `id` remains filterable as a
text equals because it is the row key.

`select` options normalization: strings pass through as `{ label: s, value: s }`; objects use
`{ label: obj.label ?? obj.value, value: obj.value ?? obj.label }` and stringify non-strings.

## m2o relation filters

The engine table cell shows an m2o value as a related-row object labelled via
`display_template` or `M2O_DISPLAY_FIELDS` (`record-label.ts`). An m2o column becomes
filterable through a **single filter attached to the real column itself** whose backend target
is the related row's display leaf:

- Field `department` (m2o → `hrm_departments`, display field `name`)
  → the real `department` column gets filter `{ id: "department", … }`, which serializes as
  `filter[department.name][_icontains]=…`.
- Field `item_name` (m2o → `mro_item_name`, `display_template: "{{name}}"`)
  → the real `item_name` column filters on `item_name.name`.

Resolution (`buildTableColumns` + `buildFilterFieldMap` in `collection-table-filters.ts`):

1. `useM2oSchemas(token, fields, knownSchemas)` finds every unique `m2o` field with a
   `related_collection`, fetches each related collection detail once (module-level promise
   cache keyed by `token:slug`; pages that already hold related schemas pass them through so
   nothing refetches), and returns `Record<relatedSlug, EntitySchema>`.
2. For each m2o field pick the display leaf (`displayLeafField`):
   - **simple** tokens from `field.display_template` (`{{name}}` → `name`) if the related
     schema has that field (dotted template tokens like `{{a.b}}` are skipped in v1 — the
     backend nested filter may still only resolve m2o hops, not array hops);
   - otherwise the first related-schema field matching `M2O_DISPLAY_FIELDS`
     (`name_mm`, `name_en`, `name`, `full_name`, `title`, `code`, …);
   - no resolvable leaf → the relation is not filterable (column stays visible, no filter).
3. The filter def is typed by the **leaf field's** schema type; the popover/chip id stays the
   real column id (`item_name`), and only serialization (`buildFilterFieldMap` → `path`)
   targets the nested backend path `item_name.name`. `is-empty` / `is-not-empty` act on the
   m2o FK (`item_name`) rather than the nested leaf.

> ⚠️ Implementation note — earlier draft used hidden synthetic filter-only columns
> (`defaultVisible: false`) appended for each m2o display leaf. That does **not** work in this
> DataTable: columns appended after the related schema resolves are rendered as real, visible
> table columns (they appear as duplicates of the existing m2o column) because column
> visibility state ignores late-arriving columns. Keep the one-filter-per-real-column design
> above.

## Operator + value serialization

New shared `serializeFilters(filters, fieldInfo)` used by `fetchData`.

Design-system operator → backend operator:

| DS operator                 | Backend operator            | Notes                                |
| --------------------------- | --------------------------- | ------------------------------------ |
| `equals` / `not-equals`     | `_eq` / `_neq`              |                                      |
| `contains` / `not-contains` | `_icontains` / `_ncontains` |                                      |
| `starts-with` / `ends-with` | `_startswith` / `_endswith` |                                      |
| `gt gte lt lte`             | `_gt _gte _lt _lte`         |                                      |
| `between`                   | `_between`                  | value sent as `"{value},{valueTo}"`  |
| `in` / `not-in`             | `_in` / `_nin`              | value sent comma-joined if array     |
| `is-empty` / `is-not-empty` | `_null` / `_nnull`          | empty UI values mean SQL `NULL` here |

Type-aware value handling:

- `boolean` values serialize as `"1"` / `"0"` (physical storage is INTEGER).
- `date` fields keep the `YYYY-MM-DD` value.
- `datetime`/`timestamp` day filters serialize through the already-supported function form so a
  picked day matches the whole stored day regardless of clock time:
  `filter[date(created_at)][_eq]=2026-09-04` (operators `_eq`, `_neq`, comparisons, and
  `_between` all supported by `QueryParser.applyFunctionFilters`).
- Numeric values stay strings — SQLite numeric affinity compares them correctly against
  INTEGER/REAL columns.
- `_null` / `_nnull` ignore the UI value.

## API client change (`apps/studio/src/lib/api.ts`)

Extend the filter value type without breaking existing callers:

```ts
filters?: Record<
  string,
  {
    operator: string;
    value?: string;
    valueTo?: string;
    /** Backend function wrapper, e.g. "date" → filter[date(field)][_op]=value */
    fn?: string;
  }
>;
```

One shared `appendEntityFilters(searchParams, filters)` helper used by both `listItems` and
`exportCsv`. Key shapes emitted:

- `filter[field][_op]` (scalar)
- `filter[a.b][_op]` (nested m2o leaf)
- `filter[fn(field)][_op]` (function/date)

## Call-site changes

Both pages currently build columns identically and both have the same dead fetchData
translation. They switch to the shared helpers:

- `apps/studio/src/pages/CollectionsWorkbench.tsx`
- `apps/studio/src/pages/AppDetailPage.tsx`

No other table consumers are affected; existing direct `EntityListParams` callers (trashed
export, report preview, …) compile unchanged because the new filter fields are optional.

## Testing / validation

- `cd apps/studio && npx tsc --noEmit && npx vite build`
- Manual:
  - `mro_item_model`: filter popover lists fields; `tracking` is a dropdown; text/number/date
    work; `item_name`/`brand` filter by related master text.
  - `hrm_employees`: `active` boolean filter; `doj`/`dob` day filter; `department` /
    `designation` nested text filter.
  - Verify the request URL in DevTools carries the expected `filter[…]` params.
  - Remove/clear chips, combine search + filters + sort + cursor pages.
- Pure mappers are unit-testable; add/extend `*.spec.ts` under `apps/studio/src/lib` only if a
  Vitest setup already exists for Studio (`cell-render.spec.ts` suggests one exists).

## Future (separate specs)

- Backend `EXISTS`-style filters for m2m/o2m/m2a arrays (`filter[shifts.name][_icontains]`) so
  the remaining virtual columns become filterable.
- Async option sources in the DataTable `FilterDef` for Directus-exact relation pickers.
- Controlled DataTable filter/search props + URL persistence via `useViewState`.

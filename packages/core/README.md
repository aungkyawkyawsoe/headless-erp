# @mmbix/core — Entity Engine Core

D1 client, Knex-style QueryBuilder, Repository, SchemaBuilder, and entity engine (linkage, validation, defaults, encryption, expression evaluator). Runs on Cloudflare Workers (workerd) — **no `eval`/`new Function`, no node-only APIs**.

## Modules

| Module                                                 | File                        | Purpose                                                                        |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------ |
| `D1Client`                                             | `src/db/d1-client.ts`       | Executes `{ sql, bindings }` statements; `onQuery` hook; transient-error retry |
| `QueryBuilder`                                         | `src/db/query-builder.ts`   | Fluent SQL builder (Knex-style) → `{ sql, bindings }`                          |
| `Repository<T>`                                        | `src/db/repository.ts`      | Typed CRUD + cursor pagination + constraint-error mapping                      |
| `SchemaBuilder`                                        | `src/db/schema-builder.ts`  | DDL generation (create table, columns, indexes)                                |
| `EntityMigrator`                                       | `src/db/entity-migrator.ts` | Diff-based schema migrations                                                   |
| `FieldValidator` / `LinkageEngine` / `DefaultResolver` | `src/entity/`               | v0.7 field validation, linkage rules, default expressions                      |
| `evaluateExpression`                                   | `src/entity/expression.ts`  | Safe expression evaluator (workerd-safe, no eval)                              |

## QueryBuilder — Key Features (v0.8)

All methods produce parameterized `{ sql, bindings }` statements; identifiers are sanitized; WHERE operators are whitelisted.

### WHERE & groups

```ts
qb.where('status', 'published')
  .orWhere('featured', true)
  .whereIn('id', ['a', 'b', 'c'])          // >50 items → auto json_each (O(1) bindings, D1 100-param safe)
  .whereNotIn('id', ['x'])
  .whereBetween('price', 10, 100)
  .whereNotBetween('price', 0, 5)
  .whereNull('deleted_at')
  .whereNotNull('slug')
  .whereGroup([{ column: 'a', op: '=', value: 1 }, { column: 'b', op: '=', value: 2 }], 'or'); // (a OR b)
  .orCond([...])   // shorthand: parenthesized OR group
  .andCond([...])  // shorthand: parenthesized AND group
```

### Subqueries & EXISTS

```ts
const sub = QueryBuilder.from('authors').select('id').where('active', true);
qb.whereInSubquery('author_id', sub);
qb.whereNotInSubquery('author_id', sub);
qb.whereExists(sub);
qb.whereNotExists(sub); // NOT EXISTS
qb.orWhereExists(sub); // OR EXISTS
```

### CTE (WITH / WITH RECURSIVE)

```ts
const cte = QueryBuilder.from('posts').select('id', 'author_id').where('status', 'published');
QueryBuilder.from('users')
	.with('pub_posts', cte) // WITH pub_posts AS (...)
	.join('pub_posts', 'pub_posts.author_id', 'users.id')
	.select('name')
	.toSelect();

QueryBuilder.from('thread').withRecursive('tree', recursiveCte).select('*'); // tree/hierarchy queries
```

### Inserts & upserts

```ts
qb.returning(true).toInsert({ title: 'Hello' }); // INSERT ... RETURNING *
qb.onConflict(['id']).toInsert({ id: 'x', title: 'A' }); // ON CONFLICT(id) DO NOTHING
qb.onConflict(['id'], 'update').toInsert({ id: 'x', title: 'B' }); // ON CONFLICT(id) DO UPDATE SET title = excluded.title
qb.toInsertMany([{ a: 1 }, { a: 2 }]); // multi-row INSERT (watch D1 100-param limit)
```

### Expression builder (window functions, aggregates, JSON)

```ts
QueryBuilder.from('employees')
	.select('name', 'salary')
	.selectRawWith('json_extract(meta, ?)', ['$.title'], 'meta_title') // parameterized raw select
	.selectFn('SUM', 'amount') // SUM(?)
	.selectFn('COUNT', '*') // COUNT(*)
	.window('w', 'PARTITION BY dept ORDER BY salary DESC') // WINDOW w AS (...)
	.orderBy('salary', 'desc')
	.toSelect();

QueryBuilder.fn('json_extract', 'meta', "'$.title'"); // raw fn string for selectRaw
QueryBuilder.caseWhen("status = 'active'", "'yes'", "'no'"); // CASE WHEN ... THEN ... ELSE ... END
```

### SQL template tag (Kysely-style)

```ts
const sub = QueryBuilder.from('authors').select('id').where('active', true).toSelect();
QueryBuilder.sql`SELECT * FROM posts WHERE author_id IN (${sub}) AND status = ${'published'}`;
// bindings auto-collected; subquery inlined
```

### Debugging

```ts
QueryBuilder.from('posts').where('status', 'draft').explain();
// EXPLAIN QUERY PLAN SELECT * FROM posts WHERE status = ?1
```

## D1Client

```ts
const db = new D1Client(env.DB);

// Observability — fires after every query
db.onQuery = ({ sql, durationMs, rowsAffected, error }) => {
	console.log(`${durationMs}ms`, sql);
};

// Transient-error retry (overloaded / 503) with exponential backoff
db.maxRetries = 3;
db.retryDelayMs = 50;
```

Methods: `all`, `first`, `run`, `runFirst`, `batch` (atomic), `exec` (DDL). All parameterized — no raw interpolation.

## Repository

```ts
const repo = new Repository<User>(db, '_users');

await repo.findMany({ where: { status: 'active' }, limit: 10 });
await repo.findById('uuid-123');
await repo.findOne({ email: 'a@b.c' });
await repo.create({ email: 'a@b.c' });       // auto UUID + timestamps
await repo.createMany([{ ... }, { ... }]);   // multi-row insert
await repo.update('uuid-123', { status: 'inactive' });
await repo.delete('uuid-123');
await repo.count({ status: 'active' });
```

Constraint violations (`UNIQUE` / `NOT NULL` / `CHECK`) are mapped to field-level `ValidationError` (e.g. `"slug" already exists`).

## Constraints (workerd)

- **No `eval` / `new Function`** — expressions use `src/entity/expression.ts`; extend that instead.
- `db.exec()` splits on newlines — keep DDL single-line.
- `SELECT *` does **not** include implicit `rowid` — select `rowid` explicitly when needed.
- D1 FTS5 `MATCH ?1` binding fails — inline the search term as an escaped literal.
- D1 bound params: **100 per query** — use `toInsertMany` chunks (≤33 rows × 3 cols), `json_each` for large IN lists.

## Tests

```bash
pnpm --filter @mmbix/core test   # 144 tests
```

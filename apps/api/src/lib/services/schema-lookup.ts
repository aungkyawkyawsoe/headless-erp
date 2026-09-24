/**
 * Cached schema-row lookups for collaborators that only hold a `D1Client`.
 *
 * The engine's own reads go through `SchemaService.getCollection()` /
 * `getCollections()`, but a long tail of services and plugins each ran their own
 * uncached `SELECT … FROM _entity_schemas WHERE slug = ?` — a fresh D1 round-trip
 * for a row the schema plane had almost always already loaded (and, for
 * `SELECT schema_json`, a re-read of the collection's whole schema blob).
 *
 * These helpers are that ONE cache, exposed without forcing every caller to take
 * a `SchemaService` dependency: they delegate to `SchemaService.getCollectionRows`
 * so the raw-row cache (`schema:<slug>:raw`), the `schemas:all` fallback and the
 * single invalidation seam stay owned by exactly one class.
 */
import type { D1Client } from '@mmbix/core';
import type { EntitySchema } from '@mmbix/types';
import { SchemaService } from '@/lib/services/collection-schema.service';

/** The raw `_entity_schemas` row for `slug`, or `null` when it does not exist. */
export function findCollectionRow(db: D1Client, slug: string): Promise<EntitySchema | null> {
	return new SchemaService(db, () => null).getCollectionRows([slug]).then((rows) => rows.get(slug) ?? null);
}

/** Batched form — one `WHERE slug IN (…)` for every row not already cached. */
export function findCollectionRows(db: D1Client, slugs: string[]): Promise<Map<string, EntitySchema>> {
	return new SchemaService(db, () => null).getCollectionRows(slugs);
}

/**
 * Every collection's raw row, ordered by name — through the shared `schemas:all`
 * cache. For readers whose projection really is the whole row (OpenAPI spec,
 * SDK type generation, search field discovery) this is the same read the rest of
 * the engine already pays for, so it is free after any relation-touching query.
 */
export function findAllCollections(db: D1Client): Promise<EntitySchema[]> {
	return new SchemaService(db, () => null).getCollections();
}

/**
 * Studio metadata wire codec — the specialized columnar encoding for the
 * snapshot served at `/__studio/meta`.
 *
 * Relocated here (from `apps/studio/src/lib/meta-codec.ts`) so the Worker, the
 * Vite dev plugin and the browser share ONE module, and so the generic
 * `encodeColumns`/`decodeColumns` (codec.ts) has exactly one consumer per seam.
 * The wire shape is unchanged — `META_WIRE_VERSION` stays 2.
 *
 * Producers (the dev Vite plugin and the production Studio worker) call
 * `encodeMeta`; the client calls `decodeMeta` before deriving `StudioMeta`.
 *
 * `decodeMeta` is deliberately tolerant: a plain object map (the pre-codec shape,
 * and the `/__studio/prompt` payload) passes straight through, so a stale client
 * or an older server degrades to the old bytes instead of crashing.
 */

import { decodeColumns, encodeColumns, type ColumnarTable } from './codec.ts';

/** Bumped only on a breaking wire change — `decodeMeta` passes anything else through. */
export const META_WIRE_VERSION = 2;

/** One table in columnar form (alias of `ColumnarTable` — keeps the public shape). */
export type WireTable = ColumnarTable;

/** The encoded snapshot: a version tag plus one `WireTable` per table. */
export interface WireMeta {
	v: typeof META_WIRE_VERSION;
	tables: Record<string, WireTable>;
}

type RowMap = Record<string, unknown>;
/** The decoded snapshot — the object map every existing consumer expects. */
export type MetaSnapshot = Record<string, RowMap[]>;

/** Encode an object-map snapshot into the compact columnar wire form. */
export function encodeMeta(snapshot: MetaSnapshot): WireMeta {
	const tables: Record<string, WireTable> = {};
	for (const [key, rows] of Object.entries(snapshot)) tables[key] = encodeColumns(rows);
	return { v: META_WIRE_VERSION, tables };
}

/**
 * Decode the wire form back into the object map every consumer already reads.
 * A non-encoded payload (plain object map) is returned untouched.
 */
export function decodeMeta(wire: unknown): MetaSnapshot {
	if (!wire || typeof wire !== 'object') return {};
	const candidate = wire as Partial<WireMeta>;
	if (candidate.v !== META_WIRE_VERSION || !candidate.tables || typeof candidate.tables !== 'object') {
		return wire as MetaSnapshot;
	}
	const out: MetaSnapshot = {};
	for (const [key, table] of Object.entries(candidate.tables)) out[key] = decodeColumns(table as WireTable);
	return out;
}

/**
 * Metadata wire codec — a lossless, compact encoding for the studio metadata
 * snapshot served at `/__studio/meta`.
 *
 * The snapshot is a dozen tables of uniform-shaped rows (`SELECT *`). Sending
 * them as an array of objects repeats every column NAME once per row — measured
 * on the committed catalog, ~46% of the 38.9 kB `components` payload is key
 * scaffolding (`"capabilities_json":`, `"group_name":`, …), not data. The
 * columnar form names each column exactly once (in `columns`) and sends the rest
 * as positional rows, so the same snapshot travels in roughly half the bytes
 * with no value dropped.
 *
 * Producers (the dev Vite plugin in `studio.db/vitePlugin.ts` and the production
 * Studio worker in `worker/index.ts`) call `encodeMeta`; the client calls
 * `decodeMeta` before deriving `StudioMeta`. Keeping the codec in ONE module —
 * shared by dev, prod and browser — is what stops the three sides drifting.
 *
 * `decodeMeta` is deliberately tolerant: a plain object map (the pre-codec shape,
 * and the `/__studio/prompt` payload) passes straight through, so a stale client
 * or an older server degrades to the old bytes instead of crashing.
 */

/** Bumped only on a breaking wire change — `decodeMeta` passes anything else through. */
export const META_WIRE_VERSION = 2;

/** One table in columnar form: `columns[i]` names the field at `rows[*][i]`. */
export interface WireTable {
	columns: string[];
	rows: unknown[][];
}

/** The encoded snapshot: a version tag plus one `WireTable` per table. */
export interface WireMeta {
	v: typeof META_WIRE_VERSION;
	tables: Record<string, WireTable>;
}

type RowMap = Record<string, unknown>;
/** The decoded snapshot — the object map every existing consumer expects. */
export type MetaSnapshot = Record<string, RowMap[]>;

/**
 * The column list for a table — the union of every row's keys, in first-seen
 * order. Rows from a single `SELECT *` always share one shape, but unioning is
 * cheap and keeps a ragged row (or a future projection) from silently dropping
 * a column.
 */
function columnsOf(rows: RowMap[]): string[] {
	const columns: string[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		for (const key of Object.keys(row)) {
			if (seen.has(key)) continue;
			seen.add(key);
			columns.push(key);
		}
	}
	return columns;
}

/** Encode an object-map snapshot into the compact columnar wire form. */
export function encodeMeta(snapshot: MetaSnapshot): WireMeta {
	const tables: Record<string, WireTable> = {};
	for (const [key, rows] of Object.entries(snapshot)) {
		const columns = columnsOf(rows);
		tables[key] = { columns, rows: rows.map((row) => columns.map((c) => row[c] ?? null)) };
	}
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
	for (const [key, table] of Object.entries(candidate.tables)) {
		const { columns, rows } = table as WireTable;
		if (!Array.isArray(columns) || !Array.isArray(rows)) {
			out[key] = [];
			continue;
		}
		out[key] = rows.map((values) => {
			const row: RowMap = {};
			for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i] ?? null;
			return row;
		});
	}
	return out;
}

/**
 * Generic columnar codec — ONE encoder for every wire seam.
 *
 * The payloads the factory moves between Worker, Studio and SDK are uniform
 * rows of key/value pairs (schema proposals, design DNA, block patches, the
 * studio metadata snapshot). Sending them as an array of objects repeats every
 * key once per row; this codec names each key exactly once in `columns` and
 * sends the rest positionally, cutting the scaﬀolding bytes with no value lost.
 *
 * It is deliberately generic and pure: a row payload declares nothing, the
 * encoder derives the column order from first-seen keys (pinned and
 * deterministic for a given input), and the decoder is tolerant of the
 * un-encoded shape so an older producer/consumer degrades instead of crashing.
 *
 * Precedent: the studio's `meta-codec.ts` proved the shape (columnar, lossless,
 * tolerant). It is now a thin specialization of THIS encoder — there is never a
 * second implementation.
 */

/** One table in columnar form: `columns[i]` names the field at `rows[*][i]`. */
export interface ColumnarTable {
	columns: string[];
	rows: unknown[][];
}

/**
 * The column list for a set of rows — the union of every row's keys, in
 * first-seen order. Rows from a single `SELECT *` share one shape, but unioning
 * is cheap and keeps a ragged row (or a projection) from silently dropping a
 * column.
 */
export function unionColumns(rows: ReadonlyArray<Record<string, unknown>>): string[] {
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

/** Encode uniform rows into positional columnar form. Deterministic for a given input. */
export function encodeColumns(rows: ReadonlyArray<Record<string, unknown>>): ColumnarTable {
	const columns = unionColumns(rows);
	return { columns, rows: rows.map((row) => columns.map((c) => row[c] ?? null)) };
}

/** Decode a columnar table back into object rows. Tolerant of a missing/ragged row. */
export function decodeColumns(table: ColumnarTable): Array<Record<string, unknown>> {
	const { columns, rows } = table;
	if (!Array.isArray(columns) || !Array.isArray(rows)) return [];
	return rows.map((values) => {
		const row: Record<string, unknown> = {};
		for (let i = 0; i < columns.length; i++) row[columns[i]] = values[i] ?? null;
		return row;
	});
}

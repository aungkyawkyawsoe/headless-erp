/**
 * Shared CSV parsing — the SINGLE implementation used by every import path.
 *
 * Replaces three divergent parsers that used to live in routes/entities.ts,
 * lib/services/export.service.ts and routes/export.ts. Handles quoted fields,
 * `""` escapes, CRLF line endings, and quoted newlines.
 */

/** Tokenize CSV text into rows of raw string cells. */
export function parseCsvRows(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (inQuotes) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else inQuotes = false;
			} else field += ch;
		} else if (ch === '"') inQuotes = true;
		else if (ch === ',') {
			row.push(field);
			field = '';
		} else if (ch === '\n') {
			row.push(field);
			field = '';
			rows.push(row);
			row = [];
		} else if (ch !== '\r') field += ch;
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	return rows;
}

export interface CsvToRecordsOptions {
	/** Trim header names (default true). */
	trimHeaders?: boolean;
	/** Trim cell values (default true). */
	trimValues?: boolean;
}

/**
 * Convert CSV text into record objects using the first row as headers.
 * Empty header names and fully-empty rows are skipped.
 */
export function csvToRecords(text: string, opts: CsvToRecordsOptions = {}): Record<string, unknown>[] {
	const { trimHeaders = true, trimValues = true } = opts;
	const rows = parseCsvRows(text);
	if (rows.length < 2) return [];

	const header = rows[0].map((h) => (trimHeaders ? h.trim() : h));
	const out: Record<string, unknown>[] = [];
	for (let i = 1; i < rows.length; i++) {
		const record: Record<string, unknown> = {};
		header.forEach((key, idx) => {
			if (!key) return;
			const raw = rows[i][idx];
			record[key] = raw === undefined ? null : trimValues ? raw.trim() : raw;
		});
		// Skip fully-empty rows (e.g. trailing blank lines in the upload)
		if (Object.values(record).some((v) => v !== null && v !== '')) out.push(record);
	}
	return out;
}

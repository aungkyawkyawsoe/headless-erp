/**
 * R2SqlClient — query R2 Data Catalog (Apache Iceberg) tables from the worker.
 *
 * R2 SQL is Cloudflare's serverless analytics query engine. It is READ-ONLY
 * (no INSERT/UPDATE/DELETE/DDL) and executes over the REST endpoint:
 *
 *   POST https://api.sql.cloudflarestorage.com/api/v1/accounts/{ACCOUNT_ID}/r2-sql/query/{BUCKET_NAME}
 *   Authorization: Bearer <R2_SQL_TOKEN>
 *   { "query": "SELECT ... FROM default.table WHERE ... LIMIT 100" }
 *
 * The token must have R2 SQL (read), R2 Data Catalog, and R2 Storage
 * permissions (created in the Cloudflare dashboard; `R2_SQL_TOKEN` secret).
 *
 * Design notes (zero-waste / cost):
 *  - This class is a thin, dependency-free client. It never caches results
 *    (R2 SQL bills by bytes scanned) — callers pass focused queries with
 *    WHERE (partition) filters + LIMIT so scans stay small.
 *  - Fully unit-testable: `fetchFn` is injectable for tests.
 */

export interface R2SqlQueryResult {
	/** Column names in result-set order. */
	columns: string[];
	/** Rows as objects keyed by column name. */
	rows: Array<Record<string, unknown>>;
	/** R2 SQL metadata returned by the API (file count, bytes read, …). */
	meta?: Record<string, unknown>;
}

export interface R2SqlClientConfig {
	accountId: string;
	bucketName: string;
	token: string;
	/** Injectable fetch (test seam / mocking). Defaults to global fetch. */
	fetchFn?: typeof fetch;
}

const R2_SQL_API = 'https://api.sql.cloudflarestorage.com';

export class R2SqlClient {
	private readonly cfg: R2SqlClientConfig;
	readonly url: string;

	constructor(cfg: R2SqlClientConfig) {
		if (!cfg.accountId || !cfg.bucketName || !cfg.token) {
			throw new Error('R2SqlClient requires accountId, bucketName and token');
		}
		this.cfg = cfg;
		this.url = `${R2_SQL_API}/api/v1/accounts/${cfg.accountId}/r2-sql/query/${cfg.bucketName}`;
	}

	/**
	 * Execute a read-only SQL query against the R2 Data Catalog. Throws on
	 * network errors, non-2xx responses, and query errors returned by the API.
	 */
	async query(sql: string): Promise<R2SqlQueryResult> {
		const fetchFn = this.cfg.fetchFn ?? fetch;
		const res = await fetchFn(this.url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${this.cfg.token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ query: sql }),
		});

		if (!res.ok) {
			let detail = '';
			try {
				const text = await res.text();
				detail = text.length > 500 ? text.slice(0, 500) : text;
			} catch {
				/* ignore body parse failures */
			}
			throw new Error(`R2 SQL query failed (${res.status}): ${detail || res.statusText}`);
		}

		return this.parseResult(await res.json());
	}

	/** List namespaces (databases) available in the catalog. */
	async listNamespaces(): Promise<Array<Record<string, unknown>>> {
		const r = await this.query('SHOW NAMESPACES');
		return r.rows;
	}

	/** Describe a table's column structure. */
	async describeTable(namespaceTable: string): Promise<R2SqlQueryResult> {
		return this.query(`DESCRIBE ${namespaceTable}`);
	}

	private parseResult(payload: unknown): R2SqlQueryResult {
		// R2 SQL REST returns a result envelope. Be tolerant here so a shape
		// change doesn't crash every caller — extract columns/rows if present.
		const obj = (payload ?? {}) as Record<string, unknown>;
		if (typeof obj === 'string') return { columns: [], rows: [] };
		const meta = (typeof obj.meta === 'object' && obj.meta !== null ? obj.meta : undefined) as Record<string, unknown> | undefined;

		// Shape A: { columns: [...], rows: [...] } — rows already objects.
		if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
			return {
				columns: obj.columns as string[],
				rows: obj.rows as Array<Record<string, unknown>>,
				meta,
			};
		}

		// Shape B: { rows: [[...]] } — arrays keyed by a separately-declared
		// header, or { results: [...], columns/headers: [...] }.
		const columns = resolveColumnNames(obj);
		const rawRows = Array.isArray(obj.rows) ? (obj.rows as unknown[]) : Array.isArray(obj.results) ? (obj.results as unknown[]) : [];
		const rows = rawRows.map((r) => normalizeRow(r, columns));
		return { columns, rows, meta };
	}

	/** Sanity check: can we reach the catalog? */
	async ping(): Promise<boolean> {
		try {
			await this.listNamespaces();
			return true;
		} catch {
			return false;
		}
	}
}

function resolveColumnNames(obj: Record<string, unknown>): string[] {
	if (Array.isArray(obj.columns) && obj.columns.every((c) => typeof c === 'string')) return obj.columns as string[];
	// DuckDB-style: { column_names: [...], column_types: [...] } or a header array.
	const names = obj.column_names ?? obj.headers;
	if (Array.isArray(names)) return (names as unknown[]).map(String);
	return [];
}

function normalizeRow(row: unknown, columns: string[]): Record<string, unknown> {
	if (row && typeof row === 'object' && !Array.isArray(row)) {
		return row as Record<string, unknown>;
	}
	if (Array.isArray(row)) {
		const out: Record<string, unknown> = {};
		row.forEach((v, i) => {
			out[columns[i] ?? String(i)] = v;
		});
		return out;
	}
	return {};
}

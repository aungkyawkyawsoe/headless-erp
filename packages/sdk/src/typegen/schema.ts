/**
 * Raw schema shapes — what the API's entity endpoints return.
 *
 * `GET /api/collections` (admin) lists collections; `GET /api/collections/:slug`
 * returns the full row with `schema_json` parsed to an object.
 */

export interface RawField {
	name: string;
	type: string;
	required?: boolean;
	/** select options — array, or a comma-separated string. */
	options?: string[] | string | null;
	[key: string]: unknown;
}

export interface RawCollection {
	slug: string;
	name?: string;
	table_name?: string;
	schema_json?: { fields?: RawField[] } | string | null;
	system_field_options?: { fields?: RawField[] } | string | null;
}

export interface TypegenSource {
	url?: string;
	token?: string;
	/** Local JSON file path (array of collections) instead of a live API. */
	schemaFile?: string;
	fetchImpl?: typeof fetch;
}

/** Normalize a raw collection (from file or API) into a consistent shape. */
export function normalizeCollection(raw: RawCollection): RawCollection {
	const schemaJson = typeof raw.schema_json === 'string' ? safeParse(raw.schema_json) : raw.schema_json;
	const sysOptions = typeof raw.system_field_options === 'string' ? safeParse(raw.system_field_options) : raw.system_field_options;
	return { ...raw, schema_json: schemaJson ?? {}, system_field_options: sysOptions ?? {} };
}

function safeParse(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/** Fetch all collections (list + per-slug detail) from a live API. */
export async function fetchCollections(source: TypegenSource): Promise<RawCollection[]> {
	if (source.schemaFile) {
		const { readFileSync } = await import('node:fs');
		const raw = readFileSync(source.schemaFile, 'utf-8');
		const parsed = JSON.parse(raw) as RawCollection[] | { collections?: RawCollection[] };
		const list = Array.isArray(parsed) ? parsed : (parsed.collections ?? []);
		return list.map(normalizeCollection);
	}
	if (!source.url || !source.token) {
		throw new Error('Typegen needs either --schema <file> or --url + --token');
	}
	const fetchImpl = source.fetchImpl ?? fetch;
	const base = source.url.replace(/\/+$/, '');
	const list = (
		await fetchImpl(`${base}/collections`, {
			headers: { Authorization: `Bearer ${source.token}` },
		}).then((r) => {
			if (!r.ok) throw new Error(`Failed to list collections (${r.status}) — is the token admin/dev-token?`);
			return r.json() as Promise<{ success: boolean; data: RawCollection[] }>;
		})
	).data;

	const detailed = await Promise.all(
		list.map(async (c) => {
			const res = await fetchImpl(`${base}/collections/${encodeURIComponent(c.slug)}`, {
				headers: { Authorization: `Bearer ${source.token}` },
			});
			if (!res.ok) return normalizeCollection(c);
			const env = (await res.json().catch(() => null)) as { success?: boolean; data?: RawCollection } | null;
			return normalizeCollection(env?.data ?? c);
		}),
	);
	return detailed;
}

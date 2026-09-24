/**
 * Fetch EVERY row of a collection through the entity API.
 *
 * The list routes take `limit` (capped at 100 by the engine) + `cursor`; a bare
 * `?per_page=` is IGNORED and you get the 25-row default page back — which is how
 * the older seeds silently missed rows beyond page 1 and re-created duplicates on
 * a second run. This walks `meta.next_cursor` until exhausted, so a
 * whole-collection read is actually whole.
 *
 * Returns the raw rows array. Throws on a non-OK response.
 */
export async function listAllRows(baseUrl, token, slug, fields, pageSize = 100, extraParams = {}) {
	const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
	const rows = [];
	let cursor = null;
	const extra = Object.entries(extraParams)
		.map(([key, value]) => `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
		.join('');
	for (;;) {
		const qs = `?limit=${pageSize}${fields ? `&fields=${encodeURIComponent(fields)}` : ''}${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
		const res = await fetch(`${baseUrl}/api/entities/${slug}${qs}`, { headers });
		const body = await res.json().catch(() => null);
		if (!res.ok && !body?.success) {
			throw new Error(`GET ${slug} → HTTP ${res.status}: ${body?.error ?? JSON.stringify(body)}`);
		}
		const data = body?.data;
		const meta = body?.meta;
		rows.push(...(Array.isArray(data) ? data : (data?.items ?? [])));
		const next = Array.isArray(data) ? meta?.next_cursor : data?.next_cursor;
		const more = Array.isArray(data) ? meta?.has_more : data?.has_more;
		if (!more || !next) return rows;
		cursor = next;
	}
}

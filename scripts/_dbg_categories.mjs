// Reproduce fetchItemCatalog derivation against the live API (mirror decode).
const BASE = process.env.BASE || 'http://localhost:5175';
const H = { Authorization: 'Bearer dev-token' };

async function all(path) {
	const out = [];
	let cursor = null;
	while (true) {
		const qs = `?per_page=200&fields=${encodeURIComponent(path.fields)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
		const r = await fetch(`${BASE}/api/entities/${path.slug}${qs}`, { headers: H });
		const j = await r.json();
		const data = Array.isArray(j.data) ? j.data : j.data?.items ?? [];
		out.push(...data);
		const nc = j.data?.next_cursor ?? (j.meta && j.meta.next_cursor);
		if (!nc) return out;
		cursor = nc;
	}
}
function relId(v) {
	if (typeof v === 'string') return v || null;
	if (v && typeof v === 'object') return v.id || null;
	return null;
}
function label(v) { return (v && typeof v === 'object' && (v.name_en?.trim() || v.name_mm?.trim())) || ''; }

(async () => {
	const cats = await all({ slug: 'mro_item_categories', fields: 'id,name_en,name_mm' });
	const groups = await all({ slug: 'mro_item_name', fields: 'id,category' });
	const models = await all({ slug: 'mro_item_model', fields: 'id,item_name' });
	const groupToCat = new Map();
	for (const g of groups) if (g.id) groupToCat.set(g.id, relId(g.category) ?? undefined);
	const labelById = new Map();
	for (const c of cats) { const l = label(c); if (l) labelById.set(c.id, l); }
	const byModel = {};
	for (const m of models) { const gid = relId(m.item_name); byModel[m.id] = gid ? (groupToCat.get(gid) ?? undefined) : undefined; }
	const used = new Set(Object.values(byModel).filter(Boolean));
	const options = cats.filter((c) => used.has(c.id)).map((c) => ({ id: c.id, label: labelById.get(c.id) }));
	options.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
	console.log('models:', models.length, 'cat-mapped models:', Object.values(byModel).filter(Boolean).length);
	console.log('categories total:', cats.length, 'options(t used):', options.length);
	console.log('options:', options.map((o) => o.label).join(' | ') || '(EMPTY)');
})().catch((e) => { console.error('ERR', e); process.exit(1); });

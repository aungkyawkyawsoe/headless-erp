// Reconcile the live mro_item_name catalog to schema-defs contract: `name`
// required, name_en/name_mm OPTIONAL. The live D1 was provisioned earlier with
// name_en + name_mm NOT NULL — drift vs schema-defs.json and every tgapp/seed
// writer (which send only `name`). Relaxing the two optional name columns (a
// NOT NULL → nullable rebuild, data preserved) unsticks catalog creation for
// the seed AND the mro-categories "add group" form.
const BASE = process.argv[2] ?? 'http://localhost:8788';
const TOKEN = process.argv[3] ?? 'dev-token';
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function req(method, path, body) {
	const res = await fetch(`${BASE}${path}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
	const json = await res.json().catch(() => null);
	if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${json?.error ?? JSON.stringify(json)}`);
	return json;
}

const keep = (f) => ({
	name: f.name,
	type: f.type,
	label: f.label,
	required: f.name === 'name_en' || f.name === 'name_mm' ? false : !!f.required,
	...(f.index ? { index: true } : {}),
	...(f.related_collection ? { related_collection: f.related_collection } : {}),
	...(f.display_template ? { display_template: f.display_template } : {}),
	...(f.cascade_delete !== undefined ? { cascade_delete: f.cascade_delete } : {}),
});

const col = await req('GET', '/api/collections/mro_item_name');
const declared = (col.data.schema_json.fields ?? []).filter((f) =>
	['name', 'name_en', 'name_mm', 'category'].includes(f.name),
);
const relaxed = declared.map(keep);
const result = await req('PUT', '/api/collections/mro_item_name', { fields: relaxed });
const names = (result.data?.schema_json?.fields ?? []).map((f) => `${f.name}:${!!f.required}`);
console.log('mro_item_name relaxed →', names.join(','));

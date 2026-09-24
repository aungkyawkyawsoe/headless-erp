#!/usr/bin/env node
/**
 * Local demo seed — categorise `veh_issue_types` under `mro_item_categories`.
 *
 * The Master hub's Issues tab shows the SAME category strip as the groups tab,
 * fed from each issue type's `category` m2o. This seed:
 *   - ensures a small, realistic set of issue types exists (matched by
 *     `job_code`), creating any that are missing;
 *   - sets each row's `category` to the named `mro_item_categories` master.
 *
 * Idempotent: rows are matched by `job_code`; a row already pointing at the
 * right category is left untouched.
 *
 * Usage (against a LOCAL dev API on :8788):
 *   node scripts/seed-issue-categories.mjs
 *
 * Env: PROVISION_API (default http://127.0.0.1:8788),
 *      PROVISION_TOKEN (default dev-token).
 */

const BASE = process.env.PROVISION_API || 'http://127.0.0.1:8788';
const TOKEN = process.env.PROVISION_TOKEN || 'dev-token';
const HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

/** `job_code` → the `mro_item_categories.name_en` it files under. */
const ISSUE_TYPES = [
	{ job_code: 'JOB-ENG', name_en: 'Engine & Gearbox Service', name_mm: 'အင်ဂျင်/ဂီယာ ထိန်းသိမ်းမှု', category: 'Engine & Gear Box' },
	{ job_code: 'JOB-SUS', name_en: 'Suspension Repair', name_mm: 'ဆိုင်းစနစ် ပြုပြင်မှု', category: 'Suspension & Steering' },
	{ job_code: 'JOB-ELE', name_en: 'Lighting & Electronic Repair', name_mm: 'မီးနှင့် အီလက်ထရောနစ် ပြုပြင်မှု', category: 'Body & Lighting' },
	{ job_code: 'JOB-OIL', name_en: 'Oil & Fluid Service', name_mm: 'ဆီနှင့် အရည် လဲလှယ်မှု', category: 'Grease & Fluids' },
	{ job_code: 'JOB-TYR', name_en: 'Tyre & Wheel Service', name_mm: 'တာယာနှင့် ဘီး ဝန်ဆောင်မှု', category: 'Tyres & Wheels' },
	{ job_code: 'JOB-EQP', name_en: 'Tools & Equipment Service', name_mm: 'ကိရိယာနှင့် ပစ္စည်း ဝန်ဆောင်မှု', category: 'Tools & Equipment' },
	{ job_code: 'JOB-GEN', name_en: 'General Inspection', name_mm: 'အထွေထွေ စစ်ဆေးမှု', category: 'General' },
];

const log = (...a) => console.log(...a);
const fail = (m) => {
	console.error(`✗ ${m}`);
	process.exitCode = 1;
};

async function callRaw(path, opts = {}) {
	const res = await fetch(`${BASE}${path}`, { headers: HEADERS, ...opts });
	const text = await res.text();
	if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}
async function call(path, opts = {}) {
	const body = await callRaw(path, opts);
	return body && typeof body === 'object' && 'data' in body ? body.data : body;
}
async function fetchAll(slug, sort, fields) {
	const rows = [];
	let cursor;
	do {
		const q = new URLSearchParams({ limit: '100', sort });
		if (fields) q.set('fields', fields);
		if (cursor) q.set('cursor', cursor);
		const body = await callRaw(`/api/entities/${slug}?${q}`);
		rows.push(...body.data);
		cursor = body.meta.has_more ? body.meta.next_cursor : undefined;
	} while (cursor);
	return rows;
}
const idOf = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? v.id : '') || null;

async function seed() {
	log(`Categorising veh_issue_types against ${BASE}\n`);
	try {
		await call('/api/health');
	} catch (err) {
		fail(`API not reachable at ${BASE} — start it first (cd apps/api && npx wrangler dev): ${err.message}`);
		return;
	}

	const [issueTypes, categories] = await Promise.all([
		fetchAll('veh_issue_types', 'name_en', 'id,name_en,job_code,category'),
		fetchAll('mro_item_categories', 'name_en', 'id,name_en,name_mm'),
	]);
	const byJob = new Map(issueTypes.map((r) => [r.job_code, r]));
	const catByName = new Map(categories.map((c) => [c.name_en, c]));

	let created = 0;
	let updated = 0;
	let skipped = 0;

	for (const spec of ISSUE_TYPES) {
		const cat = catByName.get(spec.category);
		if (!cat) {
			fail(`mro_item_categories "${spec.category}" not found — seed the MRO masters first.`);
			continue;
		}
		const existing = byJob.get(spec.job_code);
		if (!existing) {
			await call('/api/entities/veh_issue_types', {
				method: 'POST',
				body: JSON.stringify({ name_en: spec.name_en, name_mm: spec.name_mm, job_code: spec.job_code, category: cat.id }),
			});
			log(`  ✓ + ${spec.job_code} ${spec.name_mm} → ${cat.name_en}`);
			created += 1;
			continue;
		}
		if (idOf(existing.category) === cat.id) {
			log(`  = ${spec.job_code} already under ${cat.name_en}`);
			skipped += 1;
			continue;
		}
		await call(`/api/entities/veh_issue_types/${existing.id}`, { method: 'PUT', body: JSON.stringify({ category: cat.id }) });
		log(`  ✓ ~ ${spec.job_code} → ${cat.name_en}`);
		updated += 1;
	}

	log(`\n✅ Done — ${created} created, ${updated} categorised, ${skipped} already set.`);
	log('   Issues tab: /app/mro-categories?tab=issues');
}

seed();

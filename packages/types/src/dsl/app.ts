/**
 * The compact App DSL — ONE document an agent writes to describe an app, decoded
 * into a `FactoryManifest` (the only thing that reaches the write path).
 *
 * It exists for tokens: an LLM emits short keys and a one-token field shorthand
 * (`"code:text!"`, `"supplier:m2o>supplier"`, `"status:select(draft,approved)"`)
 * instead of the full JSON. Decoding is deterministic and lossless, and the
 * decoded manifest still flows through `validateManifest`/`normalizeFields` — so
 * this is an ENCODING, never a second validator, and it cannot drift from what
 * the engine actually accepts. An entry may always be written in full form
 * instead of shorthand (the escape hatch); unknown keys are reported, not kept.
 */
import type {
	FactoryApiKeySpec,
	FactoryCollectionSpec,
	FactoryFieldSpec,
	FactoryKpiSpec,
	FactoryManifest,
	FactoryMenuSpec,
	FactoryPageSpec,
	FactoryPermissionSpec,
	FactoryRoleSpec,
	FactoryScheduleSpec,
	FactoryServerFunctionSpec,
	FactoryReportSpec,
	FactoryWorkflowSpec,
} from '../factory.ts';

/** Short type aliases → the canonical 41-type names. A wrong target is harmless:
 *  the real validator drops the field with a warning. */
const TYPE_ALIAS: Record<string, string> = {
	str: 'text',
	txt: 'text',
	num: 'number',
	int: 'integer',
	cur: 'currency',
	pct: 'percent',
	bool: 'boolean',
	dt: 'datetime',
	ts: 'timestamp',
	sel: 'select',
	rel: 'm2o',
	fk: 'm2o',
};

/** Permission letters for `grants[].can` (default `"r"`). */
const PERMISSION_LETTERS: Record<string, keyof FactoryPermissionSpec> = {
	r: 'can_read',
	w: 'can_write',
	c: 'can_create',
	d: 'can_delete',
	s: 'can_submit',
	a: 'can_approve',
};

export interface AppDoc {
	v: 1;
	cols?: Array<Record<string, unknown>>;
	pages?: Array<Record<string, unknown>>;
	roles?: Array<string | Record<string, unknown>>;
	grants?: Array<Record<string, unknown>>;
	menus?: Array<Record<string, unknown>>;
	kpis?: Array<Record<string, unknown>>;
	/** Full-form pass-through (no shorthand) so no capability is lost. */
	workflows?: FactoryWorkflowSpec[];
	serverFunctions?: FactoryServerFunctionSpec[];
	schedules?: FactoryScheduleSpec[];
	reports?: FactoryReportSpec[];
	apiKeys?: FactoryApiKeySpec[];
}

export interface AppDecode {
	manifest: FactoryManifest | null;
	warnings: string[];
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const obj = (v: unknown): Record<string, unknown> | null =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** `name:type[!][#][>target][(a,b,c)]` → a `FactoryFieldSpec`, or null when malformed. */
export function parseField(token: string): FactoryFieldSpec | null {
	const i = token.indexOf(':');
	if (i <= 0) return null;
	const name = token.slice(0, i).trim();
	let rest = token.slice(i + 1).trim();
	if (!name || !rest) return null;

	let options: string[] | undefined;
	const opt = /\(([^)]*)\)\s*$/.exec(rest);
	if (opt) {
		options = opt[1]
			.split(',')
			.map((o) => o.trim())
			.filter(Boolean);
		rest = rest.slice(0, opt.index).trim();
	}
	let related: string | undefined;
	const rel = />([A-Za-z0-9_.-]+)\s*$/.exec(rest);
	if (rel) {
		related = rel[1];
		rest = rest.slice(0, rel.index).trim();
	}
	const required = rest.includes('!');
	const unique = rest.includes('#');
	const rawType = rest.replace(/[!#]/g, '').trim();
	if (!rawType) return null;
	const type = TYPE_ALIAS[rawType] ?? rawType;
	return {
		name,
		type: type as FactoryFieldSpec['type'],
		...(required ? { required: true } : {}),
		...(unique ? { unique: true } : {}),
		...(related ? { related_collection: related } : {}),
		...(options ? { options } : {}),
	};
}

/**
 * Decode a compact app document into a `FactoryManifest`. Never throws: a
 * malformed entry is dropped with a warning, so a bad line cannot lose the app.
 */
export function decodeApp(input: unknown): AppDecode {
	const warnings: string[] = [];
	const o = obj(input);
	if (!o) return { manifest: null, warnings: ['app must be a JSON object'] };
	if (o.v !== undefined && o.v !== 1) warnings.push(`unknown app version ${JSON.stringify(o.v)} — treating as 1`);

	const collections: FactoryCollectionSpec[] = [];
	for (const raw of Array.isArray(o.cols) ? o.cols.slice(0, 50) : []) {
		const c = obj(raw);
		const slug = str(c?.s);
		if (!c || !slug) {
			warnings.push('dropped a collection with no slug (`s`)');
			continue;
		}
		const fields: FactoryFieldSpec[] = [];
		for (const rf of Array.isArray(c.f) ? c.f.slice(0, 100) : []) {
			if (typeof rf === 'string') {
				const parsed = parseField(rf);
				if (parsed) fields.push(parsed);
				else warnings.push(`collection "${slug}": dropped malformed field "${rf}"`);
				continue;
			}
			const f = obj(rf);
			if (f && str(f.name) && str(f.type)) fields.push(f as unknown as FactoryFieldSpec);
			else warnings.push(`collection "${slug}": dropped a field with no name/type`);
		}
		collections.push({
			slug,
			...(str(c.n) ? { name: str(c.n) as string } : {}),
			...(str(c.ns) ? { naming_series: str(c.ns) as string } : {}),
			fields,
			...(obj(c.pol) ? { policies: obj(c.pol) as Record<string, unknown> } : {}),
		});
	}

	const pages: FactoryPageSpec[] = [];
	for (const raw of Array.isArray(o.pages) ? o.pages.slice(0, 100) : []) {
		const p = obj(raw);
		const path = str(p?.p);
		const title = str(p?.t);
		if (!p || !path || !title) {
			warnings.push('dropped a page missing `p`/`t`');
			continue;
		}
		pages.push({
			path,
			title,
			...(str(p.m) ? { module: str(p.m) as string } : {}),
			...(Array.isArray(p.b) ? { blocks: p.b as Array<Record<string, unknown>> } : {}),
		});
	}

	const roles: FactoryRoleSpec[] = [];
	for (const raw of Array.isArray(o.roles) ? o.roles.slice(0, 50) : []) {
		if (typeof raw === 'string') {
			if (raw.trim()) roles.push({ name: raw.trim() });
			else warnings.push('dropped an empty role name');
			continue;
		}
		const r = obj(raw);
		const name = str(r?.n);
		if (!r || !name) {
			warnings.push('dropped a role with no name (`n`)');
			continue;
		}
		roles.push({ name, ...(str(r.d) ? { description: str(r.d) as string } : {}) });
	}

	const permissions: FactoryPermissionSpec[] = [];
	for (const raw of Array.isArray(o.grants) ? o.grants.slice(0, 200) : []) {
		const g = obj(raw);
		const role = str(g?.r);
		const collection = str(g?.c);
		if (!g || !role || !collection) {
			warnings.push('dropped a grant missing `r`/`c`');
			continue;
		}
		const letters = (str(g.can) ?? 'r').split('');
		const grant: Record<string, unknown> = { role, collection };
		for (const l of letters) {
			const key = PERMISSION_LETTERS[l];
			if (key) grant[key] = true;
			else warnings.push(`grant "${role}/${collection}": ignored unknown permission letter "${l}"`);
		}
		permissions.push(grant as unknown as FactoryPermissionSpec);
	}

	const menus: FactoryMenuSpec[] = [];
	for (const raw of Array.isArray(o.menus) ? o.menus.slice(0, 100) : []) {
		const m = obj(raw);
		const module = str(m?.m);
		const label = str(m?.l);
		if (!m || !module || !label) {
			warnings.push('dropped a menu item missing `m`/`l`');
			continue;
		}
		menus.push({
			module,
			label,
			...(str(m.t) ? { type: str(m.t) as string } : {}),
			...(str(m.target) ? { target: str(m.target) as string } : {}),
			...(str(m.i) ? { icon: str(m.i) as string } : {}),
			...(typeof m.o === 'number' ? { sort_order: m.o } : {}),
			...(Array.isArray(m.roles) ? { roles: m.roles.filter((x): x is string => typeof x === 'string') } : {}),
		});
	}

	const kpis: FactoryKpiSpec[] = [];
	for (const raw of Array.isArray(o.kpis) ? o.kpis.slice(0, 100) : []) {
		const k = obj(raw);
		const name = str(k?.n);
		const collection = str(k?.c);
		if (!k || !name || !collection) {
			warnings.push('dropped a kpi missing `n`/`c`');
			continue;
		}
		kpis.push({
			name,
			collection,
			agg: str(k.agg) ?? 'count',
			...(str(k.f) ? { field: str(k.f) as string } : {}),
			...(str(k.g) ? { group_by: str(k.g) as string } : {}),
			...(str(k.per) ? { period: str(k.per) as string } : {}),
			...(str(k.sched) ? { schedule: str(k.sched) as string } : {}),
		});
	}

	const known = new Set([
		'v',
		'cols',
		'pages',
		'roles',
		'grants',
		'menus',
		'kpis',
		'workflows',
		'serverFunctions',
		'schedules',
		'reports',
		'apiKeys',
	]);
	for (const key of Object.keys(o)) {
		if (!known.has(key)) warnings.push(`unknown key "${key}" ignored`);
	}

	return {
		manifest: {
			version: 1,
			collections,
			pages,
			roles,
			permissions,
			menus,
			kpis,
			...(Array.isArray(o.workflows) ? { workflows: o.workflows } : {}),
			...(Array.isArray(o.serverFunctions) ? { serverFunctions: o.serverFunctions } : {}),
			...(Array.isArray(o.schedules) ? { schedules: o.schedules } : {}),
			...(Array.isArray(o.reports) ? { reports: o.reports } : {}),
			...(Array.isArray(o.apiKeys) ? { apiKeys: o.apiKeys } : {}),
		},
		warnings,
	};
}

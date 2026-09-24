/**
 * Translation Routes — i18n / CMS translation system
 *
 * GET  /api/translations                      → Fetch compiled JSON bundle (R2 cached)
 * POST /api/translations/import               → Import translation rows (via CollectionService) + invalidate R2 cache
 * POST /api/translations/build                → Compile D1 rows into R2 JSON bundles
 */

import { Hono, type Context } from 'hono';
import { D1Client, QueryBuilder } from '@mmbix/core';
import { CollectionService } from '@/lib/services/collection.service';
import { requireAuth } from './auth';
import { success, fail } from '@/lib/api/response';
import { idempotencyMiddleware } from '@/plugins/idempotency/plugin';

type TBindings = {
	Bindings: { DB: D1Database; BUCKET: R2Bucket };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
};

type TranslationRow = {
	id: string;
	module_id: string;
	language: string;
	key: string;
	value: string;
	context: string;
	collection: string | null;
	field: string | null;
	created_at: string;
	updated_at: string;
};

type TranslationBundle = Record<string, Record<string, Record<string, string | Record<string, string>>>>;

const app = new Hono<TBindings>();
app.use('*', requireAuth);
// Stripe-style Idempotency-Key: keyed retries never duplicate; unkeyed pass through.
app.use('/import', idempotencyMiddleware());

function getServices(c: Context) {
	const auth = c.get('auth');
	const db = new D1Client(c.env.DB);
	return { db, collSvc: new CollectionService(db, auth) };
}

// ─── GET /api/translations?lang=my&module=hrm ──────────────

// 🔒 lang/module are interpolated into the R2 key (`translations/${lang}/${module}.json`)
// — strict charset validation prevents authenticated users from reading arbitrary
// `translations/*` keys via path traversal in the query params.
const KEY_CHARSET = /^[a-zA-Z0-9_-]{1,64}$/;

app.get('/', async (c) => {
	const lang = c.req.query('lang') || 'en';
	const module = c.req.query('module');

	if (!KEY_CHARSET.test(lang)) {
		return fail(c, 'Invalid lang — allowed: 1-64 chars of [a-zA-Z0-9_-]', 400);
	}
	if (module !== undefined && module !== null && !KEY_CHARSET.test(module)) {
		return fail(c, 'Invalid module — allowed: 1-64 chars of [a-zA-Z0-9_-]', 400);
	}

	// Try R2 cache first
	const r2Key = module ? `translations/${lang}/${module}.json` : `translations/${lang}.json`;
	try {
		const cached = await c.env.BUCKET.get(r2Key);
		if (cached) {
			c.header('X-Cache', 'HIT');
			c.header('ETag', cached.httpEtag || '');
			// The cached object is the bundle envelope itself ({ lang, translations }) —
			// return it through the standard success() envelope to match the MISS path.
			const parsed = JSON.parse(await cached.text()) as { lang?: string; translations: TranslationBundle };
			return success(c, { lang: parsed.lang ?? lang, translations: parsed.translations });
		}
	} catch {
		/* miss */
	}

	c.header('X-Cache', 'MISS');

	// Query D1
	const { db } = getServices(c);
	let qb = QueryBuilder.from('_translations')
		.select('module_id', 'language', 'key', 'value', 'context', 'collection', 'field')
		.where('language', lang)
		.orderBy('module_id')
		.orderBy('context')
		.orderBy('key');

	if (module) qb = qb.where('module_id', module);

	const rows = await db.all<TranslationRow>(qb.toSelect());

	const bundle: TranslationBundle = {};
	for (const row of rows) {
		const mod = row.module_id;
		const ctx = row.context || 'ui';
		if (!bundle[mod]) bundle[mod] = {};
		if (!bundle[mod][ctx]) bundle[mod][ctx] = {};
		const k = row.collection && row.field ? `${row.collection}.${row.field}` : row.key;
		(bundle[mod][ctx] as Record<string, string>)[k] = row.value;
	}

	return success(c, { lang, translations: bundle });
});

// ─── POST /api/translations/import ────────────────────────
// Uses the standard entity API (CollectionService) to create/update rows.
// The translations collection must exist in the entity registry.

app.post('/import', async (c) => {
	const body = await c.req.json<{
		data: Array<{
			module_id: string;
			language: string;
			key: string;
			value: string;
			context?: string;
			collection?: string;
			field?: string;
		}>;
		overwrite?: boolean;
	}>();
	const rows = body.data || [];
	const overwrite = body.overwrite || false;
	const { db, collSvc } = getServices(c);
	await collSvc.ensureMigrations();

	let imported = 0;
	let skipped = 0;

	for (const row of rows) {
		const ctx = row.context || 'ui';

		// Look up existing translation by unique key
		const existQuery = QueryBuilder.from('_translations')
			.select('id')
			.where('module_id', row.module_id)
			.where('language', row.language)
			.where('key', row.key)
			.where('context', ctx)
			.limit(1)
			.toSelect();

		const exist = await db.first<{ id: string }>(existQuery);

		if (exist) {
			if (!overwrite) {
				skipped++;
				continue;
			}
			await collSvc.updateItem('translations', exist.id, { value: row.value });
			imported++;
		} else {
			const itemData: Record<string, unknown> = {
				module_id: row.module_id,
				language: row.language,
				key: row.key,
				value: row.value,
				context: ctx,
				// DB columns are NOT NULL — use empty string instead of null
				collection: row.collection ?? '',
				field: row.field ?? '',
			};
			await collSvc.createItem('translations', itemData, c);
			imported++;
		}
	}

	// Invalidate affected R2 cache keys
	const affected = [...new Set(rows.map((r) => `${r.language}/${r.module_id}`))];
	for (const aff of affected) {
		try {
			await c.env.BUCKET.delete(`translations/${aff}.json`);
		} catch {
			/* best-effort */
		}
	}

	return success(c, { imported, skipped });
});

// ─── POST /api/translations/build ─────────────────────────

app.post('/build', async (c) => {
	const { db } = getServices(c);

	const languages = await db.all<{ language: string }>(QueryBuilder.from('_translations').distinct().select('language').toSelect());

	let built = 0;
	for (const langRow of languages) {
		const lang = langRow.language;
		const langRows = await db.all<TranslationRow>(
			QueryBuilder.from('_translations')
				.select('module_id', 'language', 'key', 'value', 'context', 'collection', 'field')
				.where('language', lang)
				.orderBy('module_id')
				.orderBy('context')
				.orderBy('key')
				.toSelect(),
		);

		const bundle: TranslationBundle = {};
		for (const row of langRows) {
			const mod = row.module_id;
			const ctx = row.context || 'ui';
			if (!bundle[mod]) bundle[mod] = {};
			if (!bundle[mod][ctx]) bundle[mod][ctx] = {};
			const k = row.collection && row.field ? `${row.collection}.${row.field}` : row.key;
			(bundle[mod][ctx] as Record<string, string>)[k] = row.value;
		}

		const r2Key = `translations/${lang}.json`;
		await c.env.BUCKET.put(r2Key, JSON.stringify({ lang, translations: bundle }), {
			httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=86400' },
		});
		built++;
	}

	return success(c, { languages_built: built });
});

export { app as translationRoutes };

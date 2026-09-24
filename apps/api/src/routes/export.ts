/**
 * Export/Import Routes — with RBAC
 *
 * GET  /api/export/:collection?format=json|csv       → Export (read permission)
 * POST /api/export/:collection/import                 → Import JSON (create/write permission)
 * POST /api/export/:collection/import/csv             → Import CSV (create permission)
 * GET  /api/export/schema                            → All schemas (admin only)
 */

import { Hono, type Context } from 'hono';
import { D1Client } from '@mmbix/core';
import { ExportImportService } from '@/lib/services/export.service';
import { CollectionService } from '@/lib/services/collection.service';
import { MigrationRunner } from '@mmbix/core';
import { requireAuth } from './auth';
import { businessGuard, requireAdmin } from '@/middleware/rbac-guard';
import { csvToRecords } from '@/lib/csv';
import { fail, success } from '@/lib/api/response';
import { clampPageSize, DEFAULT_PAGE_SIZE } from '@/lib/api/page-size';

const app = new Hono<{
	Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
	Variables: { auth: import('@/lib/services/auth.service').AuthContext };
}>();
app.use('*', requireAuth);

const svc = (c: Context) => {
	const auth = c.get('auth');
	return new ExportImportService(new D1Client(c.env.DB), auth);
};

// Schema export — admin only
app.get('/schema', requireAdmin, async (c) => {
	const json = await svc(c).exportSchema();
	const data = JSON.parse(json);
	return success(c, data);
});

app.get('/:collection', businessGuard('collection', 'read'), async (c) => {
	const format = (c.req.query('format') || 'json') as 'json' | 'csv';
	const includeTrashed = c.req.query('trashed') === 'true';
	// Page-size policy (enterprise): default 25, max 100 — exports are bounded
	// exactly like entity pages (a bigger export is a cursor-walk job, never one
	// oversized request).
	const limit = clampPageSize(parseInt(c.req.query('limit') ?? String(DEFAULT_PAGE_SIZE), 10));
	const fields = c.req
		.query('fields')
		?.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

	// Exact-match filters (filter[field][_eq]) — the same shape the entity list
	// API accepts, so exports mirror the visible (tab-filtered) table.
	const filters: Record<string, string> = {};
	// OR-group filters (filter[_or][N][field][_op]) — the approvals-style
	// "pending + routed to me" scoping, same shape as the list API.
	const orFilters: { field: string; op?: '_eq' | '_contains'; value: string }[] = [];
	for (const [key, value] of new URL(c.req.url).searchParams.entries()) {
		const m = key.match(/^filter\[([a-zA-Z0-9_]+)\]\[_eq\]$/);
		if (m) filters[m[1]] = value;
		const om = key.match(/^filter\[_or\]\[\d+\]\[([a-zA-Z0-9_]+)\]\[(_\w+)\]$/);
		if (om && ['_eq', '_contains'].includes(om[2])) orFilters.push({ field: om[1], op: om[2] as '_eq' | '_contains', value });
	}

	const data = await svc(c).exportCollection(c.req.param('collection'), {
		format,
		fields,
		includeTrashed,
		limit,
		filters,
		orFilters,
		// Pass-through so exports mirror the current table view (sort + search).
		sort: c.req.query('sort') || undefined,
		search: c.req.query('search') || undefined,
	});

	if (format === 'csv') {
		// Sanitize the collection slug for Content-Disposition — CRLF/control-char
		// injection into headers (same treatment as routes/entities.ts).
		const safeFilename = c.req.param('collection').replace(/[\r\n\\"]/g, '_');
		return c.newResponse(data, 200, {
			'Content-Type': 'text/csv',
			'Content-Disposition': `attachment; filename="${safeFilename}.csv"`,
		});
	}
	const jsonData = JSON.parse(data);
	return success(c, jsonData);
});

app.post('/:collection/import', businessGuard('collection', 'create'), async (c) => {
	// Delegates to the FULL collection import pipeline (same as
	// POST /api/entities/:collection/import): every row runs createItem with
	// linkage, defaults, validation, row-filter, audit and webhooks.
	const body = await c.req.json().catch(() => null);
	if (!body || body.data === undefined || body.data === null || String(body.data).trim() === '') {
		return fail(c, 'data is required (JSON array or CSV text)', 400);
	}
	// Accept both a JSON string and a raw array/object payload (legacy shape).
	const rawData = typeof body.data === 'string' ? body.data : JSON.stringify(body.data);
	const format = body.format === 'csv' ? 'csv' : 'json';

	let rows: Record<string, unknown>[];
	try {
		if (format === 'csv') {
			rows = csvToRecords(rawData);
		} else {
			const parsed: unknown = JSON.parse(rawData);
			if (!Array.isArray(parsed)) throw new Error('JSON data must be an array of objects');
			rows = parsed as Record<string, unknown>[];
		}
	} catch (e) {
		return fail(c, e instanceof Error ? e.message : 'Parse failed', 400);
	}
	if (rows.length === 0) return fail(c, 'No rows to import', 400);
	if (rows.length > 5000) return fail(c, 'Max 5000 rows per import', 400);

	const db = new D1Client(c.env.DB);
	await new MigrationRunner(db).runPending();
	const collSvc = new CollectionService(db, c.get('auth'));
	const errors: Array<{ row: number; error: string }> = [];
	let imported = 0;
	for (let i = 0; i < rows.length; i++) {
		try {
			await collSvc.createItem(c.req.param('collection'), rows[i], c);
			imported++;
		} catch (e) {
			const rowNumber = format === 'csv' ? i + 2 : i + 1;
			errors.push({ row: rowNumber, error: e instanceof Error ? e.message : 'Failed' });
		}
	}
	return success(c, { imported, skipped: errors.length, errors }, 201);
});

// Bulk CSV file upload — same full pipeline, one row per line.
app.post('/:collection/import/csv', businessGuard('collection', 'create'), async (c) => {
	const body = await c.req.parseBody();
	const file = body['file'] as File | string;
	if (!file) return fail(c, 'CSV file required. Send multipart/form-data with field "file"', 400);

	const db = new D1Client(c.env.DB);
	await new MigrationRunner(db).runPending();
	const collSvc = new CollectionService(db, c.get('auth'));

	const csvText = typeof file === 'string' ? file : await (file as File).text();
	const records = csvToRecords(csvText);
	if (records.length === 0) return fail(c, 'CSV must have header + at least 1 data row', 400);

	const results: Array<Record<string, unknown>> = [];
	let imported = 0,
		skipped = 0;
	const errors: Array<{ row: number; error: string }> = [];
	/** IDs of successfully imported items — for manual rollback if the batch fails partially.
	 *  D1 does not support explicit BEGIN/COMMIT/ROLLBACK for operations that cross
	 *  prepare().bind().run() calls (only batch() is atomic). Since createItem involves
	 *  validation, naming series, and audit logging, it cannot be reduced to simple SQL. */
	const importedIds: string[] = [];

	for (let i = 0; i < records.length; i++) {
		try {
			const created = await collSvc.createItem(c.req.param('collection'), records[i], c);
			results.push({ id: created.id, status: 'imported', row: i + 2 }); // row 1 = header
			importedIds.push(created.id as string);
			imported++;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Unknown error';
			if (/already exists|duplicate|UNIQUE constraint/i.test(msg)) {
				skipped++;
			} else {
				errors.push({ row: i + 2, error: msg });
			}
		}
	}

	const hasFailures = errors.length > 0;
	const extra = hasFailures ? { partial: true, imported_ids: importedIds } : {};
	return c.json(
		{
			success: true,
			data: { imported, skipped, errors, total_rows: records.length + 1, sample: results.slice(0, 5), ...extra },
		},
		201,
	);
});

export { app as exportRoutes };

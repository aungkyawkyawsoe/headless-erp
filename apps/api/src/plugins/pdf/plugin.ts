import type { Plugin, PluginRegistration, PluginContext } from '@mmbix/types/worker';
import { Hono } from 'hono';
import { D1Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { mergeRowData } from '@mmbix/core';
import { requireAuth } from '@/routes/auth';
import { businessGuard } from '@/middleware/rbac-guard';
import { fail } from '@/lib/api/response';

export function pdfPlugin(): Plugin {
	return {
		id: 'pdf-export',
		name: 'PDF/Print Export',
		version: '1.0.0',
		register(_ctx: PluginContext): PluginRegistration {
			type PdfEnv = {
				Bindings: { DB: D1Database; ADMIN_PASSWORD: string };
				Variables: { auth: import('@/lib/services/auth.service').AuthContext };
			};
			const app = new Hono<PdfEnv>();
			app.use('*', requireAuth);

			app.get('/:collection/:id/pdf', businessGuard('collection', 'read'), async (c) => {
				const { collection, id } = c.req.param();
				const db = new D1Client((c.env as Record<string, unknown>).DB as D1Database);
				const schema = await db.first<{ name: string; table_name: string }>(
					QueryBuilder.from('_entity_schemas').select('name', 'table_name').where('slug', collection).toSelect(),
				);
				if (!schema) return fail(c, 'Not found', 404);

				const doc = await db.first<Record<string, unknown>>(QueryBuilder.from(schema.table_name).select('*').where('id', id).toSelect());
				if (!doc) return fail(c, 'Document not found', 404);
				const item = mergeRowData(doc);

				const rows = Object.entries(item)
					.filter(([k]) => k !== '_meta' && k !== 'rowid' && k !== 'doc_status' && k !== 'deleted_at' && !k.startsWith('_'))
					.map(([key, value]) => {
						const v = value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
						return `<tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;background:#f9f9f9">${key}</td><td style="padding:8px;border:1px solid #ddd">${v}</td></tr>`;
					})
					.join('');

				return c.html(
					`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${schema.name} ${id}</title><style>body{font-family:sans-serif;margin:40px}h1{font-size:24px}table{border-collapse:collapse;width:100%;margin-top:20px}@media print{body{margin:20px}.no-print{display:none}}</style></head><body><div class="no-print"><button onclick="window.print()" style="padding:10px 20px;font-size:16px;cursor:pointer">Print / Save PDF</button></div><h1>${schema.name}</h1><table>${rows}</table><div style="margin-top:40px;font-size:12px;color:#999;text-align:center">Entity Engine | ${new Date().toISOString()}</div></body></html>`,
				);
			});

			return { routes: [{ path: '/api/pdf', handler: app as unknown as Hono }] };
		},
	};
}

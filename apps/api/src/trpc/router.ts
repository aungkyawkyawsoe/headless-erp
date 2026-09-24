/**
 * tRPC App Router — Full Type-Safe RPC with Complete REST API Parity
 *
 * Every procedure has the same RBAC protection as its REST counterpart.
 */

import { initTRPC } from '@trpc/server';
import { z } from 'zod/v4';
import type { TrpcContext } from './context';
import { CollectionService } from '@/lib/services/collection.service';
import { SmartCollectionService } from '@/lib/services/smart-collection.service';
import { AuthService } from '@/lib/services/auth.service';
import { findDirectoryEmployee, tgIdFromEmail } from '@/lib/services/telegram-gate.service';
import { syncDirectoryRole } from '@/lib/services/telegram-role.service';
import { initConfig } from '@mmbix/config';
import { ModuleService } from '@/lib/services/module.service';
import { ReportService } from '@/lib/services/report.service';
import { SearchService } from '@/lib/services/search.service';
import { ExportImportService } from '@/lib/services/export.service';
import { WebhookService } from '@/lib/services/webhook.service';
import { AuditService } from '@/lib/services/audit.service';
import { ScheduledJobService } from '@/lib/services/scheduler.service';
import { PermissionEvaluator } from '@/lib/services/permission-evaluator';
import { parseFieldSelection } from '@/lib/api/query-parser';
import { MigrationRunner } from '@mmbix/core';
import { APP_VERSION } from '@mmbix/config';
import { ValidationError } from '@mmbix/utils';
import { csvToRecords } from '@/lib/csv';
import { checkRateLimit } from '@/middleware/rate-limiter';
import { MAX_PAGE_SIZE } from '@/lib/api/page-size';

const t = initTRPC.context<TrpcContext>().create();

// ─── RBAC Middleware ────────────────────────────────────

const requireAuth = t.middleware(({ ctx, next }) => {
	if (!ctx.auth) throw new Error('Authentication required');
	return next({ ctx: { ...ctx, auth: ctx.auth } });
});

const requireAdmin = requireAuth.unstable_pipe(({ ctx, next }) => {
	if (!ctx.auth?.is_admin) throw new Error('Admin access required');
	return next({ ctx });
});

function requireBusiness(action: 'read' | 'write' | 'create' | 'delete', collectionKey = 'collection') {
	return requireAuth.unstable_pipe(async ({ ctx, next, getRawInput }) => {
		const auth = ctx.auth!;
		if (auth.is_admin) return next({ ctx });
		const raw = await getRawInput();
		const slug = (raw as Record<string, unknown>)?.[collectionKey] as string;
		if (!slug) throw new Error('Collection slug required');
		const allowed = await PermissionEvaluator.checkBusiness(ctx.db, auth, slug, action);
		if (!allowed) throw new Error(`No ${action} permission on "${slug}"`);
		return next({ ctx });
	});
}

// ─── Helpers ────────────────────────────────────────────

async function ensureMigrations(ctx: TrpcContext): Promise<void> {
	await new MigrationRunner(ctx.db).runPending();
}

function svc(ctx: TrpcContext): SmartCollectionService {
	return new SmartCollectionService(ctx.db, ctx.auth ?? undefined);
}

// ─── Input Schemas ──────────────────────────────────────

const collectionOnly = z.object({
	collection: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
});
const idInput = collectionOnly.extend({
	id: z.string().min(1),
	/** Directus-style field projection for detail reads (e.g. 'category.name', '*.*'). */
	fields: z.string().optional(),
});
const listInput = collectionOnly.extend({
	filter: z.record(z.string(), z.unknown()).optional(),
	sort: z.string().optional(),
	// NOTE: the max matches QueryParser's clamp (query-parser.ts) — page-size.ts
	// is the single source of truth; larger limits were silently truncated.
	limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
	search: z.string().optional(),
	cursor: z.string().optional(),
	/** Cursor direction: 'after' for next page, 'before' for previous page. */
	dir: z.enum(['after', 'before']).optional(),
	fields: z.string().optional(),
	aggregate: z.string().optional(),
	trashed: z.boolean().optional(),
});
const createInput = collectionOnly.extend({ data: z.record(z.string(), z.unknown()) });
const updateInput = collectionOnly.extend({ id: z.string().min(1), data: z.record(z.string(), z.unknown()) });
const loginInput = z.object({ email: z.string().min(1), password: z.string().min(1) });
const searchInput = z.object({
	q: z.string().min(1),
	collections: z.string().optional(),
	limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
	cursor: z.string().optional(),
});
const exportInput = z.object({
	collection: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
	format: z.enum(['json', 'csv']).optional(),
	// Page-size policy (enterprise): max 100 (page-size.ts) — the backend defines
	// the ceiling; clients only adjust within it.
	limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
	fields: z.string().optional(),
	trashed: z.boolean().optional(),
});
const importInput = z.object({
	collection: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
	format: z.enum(['json', 'csv']).optional(),
	onConflict: z.enum(['skip', 'overwrite', 'error']).optional(),
	data: z.union([z.string(), z.array(z.unknown())]),
});

// User/Role/Permission schemas
const createUserInput = z.object({
	email: z.string().min(1),
	password: z.string().min(6),
	full_name: z.string().min(1),
	role_id: z.string().optional(),
	employee_id: z.string().nullish(),
});
const updateUserInput = z.object({
	id: z.string().min(1),
	email: z.string().optional(),
	password: z.string().optional(),
	full_name: z.string().optional(),
	role_id: z.string().optional(),
	status: z.enum(['active', 'disabled']).optional(),
	// Nullable AND un-settable — `null` UNLINKS the account from its employee
	// (`AuthService.updateUser`), so it cannot be expressed as `.optional()`.
	employee_id: z.string().nullish(),
});
const createRoleInput = z.object({ name: z.string().min(1), description: z.string().optional() });
const setPermissionInput = z.object({
	role_id: z.string().min(1),
	collection_slug: z.string().min(1),
	can_read: z.boolean().optional(),
	can_write: z.boolean().optional(),
	can_create: z.boolean().optional(),
	can_delete: z.boolean().optional(),
	can_approve: z.boolean().optional(),
	can_submit: z.boolean().optional(),
	field_restrictions: z.string().optional(),
	row_filters: z.string().optional(),
});

// Webhook schemas
const createWebhookInput = z.object({
	name: z.string().min(1),
	url: z.string().min(1),
	collection_slug: z.string().min(1),
	events: z.array(z.enum(['create', 'update', 'delete', 'submit', 'approve'])),
	secret: z.string().optional(),
});
const updateWebhookInput = z.object({
	id: z.string().min(1),
	url: z.string().optional(),
	events: z.unknown().optional(),
	secret: z.string().optional(),
	enabled: z.boolean().optional(),
});

// Bulk/scheduler/report schemas
const bulkInput = z.object({
	collection: z
		.string()
		.min(1)
		.max(64)
		.regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
	action: z.enum(['create', 'update', 'delete']),
	items: z.array(z.unknown()).max(1000),
});
const auditInput = z.object({
	collection: z.string().min(1),
	documentId: z.string().optional(),
	limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional(),
});
const schedulerCreateInput = z.object({
	name: z.string().min(1),
	cron: z.string().min(1),
	action: z.string().min(1),
	description: z.string().optional(),
	collection_slug: z.string().optional(),
	config: z.unknown().optional(),
});
const schedulerUpdateInput = schedulerCreateInput.extend({ id: z.string().min(1) }).partial();
const reportInput = z.object({
	collection: z.string().min(1),
	group_by: z.string().optional(),
	aggregate: z.string().optional(),
	aggregate_field: z.string().optional(),
	filter: z.record(z.string(), z.unknown()).optional(),
});

// ─── Full Router ────────────────────────────────────────

export const appRouter = t.router({
	// ── Public ──────────────────────────────────────────
	health: t.procedure.query(() => ({ status: 'ok', version: APP_VERSION, timestamp: new Date().toISOString() })),

	// ── Auth ────────────────────────────────────────────
	auth: t.router({
		login: t.procedure.input(loginInput).mutation(async ({ input, ctx }) => {
			// Per-IP login rate limit — mirrors REST /api/auth/login (5/min).
			// Skipped in dev, exactly like the REST route.
			const env = ctx.env as Record<string, unknown>;
			const isDev = env.IS_DEV === 'true' || env.IS_DEV === true;
			if (!isDev) {
				const ip = ctx.ip || 'unknown';
				const rl = checkRateLimit('rllogin', ip, null, { window: 60, max: 5 });
				if (!rl.allowed) {
					throw new Error(`Rate limit exceeded. Retry after ${Math.ceil((rl.resetAt - Date.now()) / 1000)}s`);
				}
			}
			await ensureMigrations(ctx);
			const adminPassword = ((ctx.env as Record<string, unknown>).ADMIN_PASSWORD as string) || '';
			if (!adminPassword) throw new Error('ADMIN_PASSWORD required');
			const jwtSecret = ((ctx.env as Record<string, unknown>).JWT_SECRET as string) || adminPassword;
			await new AuthService(ctx.db).ensureAdminUser(
				((ctx.env as Record<string, unknown>).ADMIN_USERNAME as string) || 'admin',
				((ctx.env as Record<string, unknown>).ADMIN_PASSWORD as string) || 'admin',
				adminPassword,
				((ctx.env as Record<string, unknown>).IS_DEV as string) === 'true',
				((ctx.env as Record<string, unknown>).ADMIN_NAME as string) || 'Administrator',
			);
			const result = await new AuthService(ctx.db).login(input.email, input.password, adminPassword, jwtSecret);
			// Mirror REST /api/auth/login — the compact user shape, not the full record.
			return { token: result.token, user: { id: result.user.id, email: result.user.email, full_name: result.user.full_name } };
		}),
		me: t.procedure
			.use(requireAuth)
			.input(z.object({ collection: z.string().optional() }).optional())
			.query(async ({ input, ctx }) => {
				// Mirror REST /api/auth/me — AuthContext + field_restrictions for the
				// requested collection (the form UI hides fields the role can't see).
				const auth = ctx.auth!;

				// Directory gate for Telegram sessions — same as REST /auth/me: a
				// revoked link (tg_id removed from the directory) fails the session.
				// Runs in dev too (same contract as production). PASSWORD sessions are
				// gated too, but earlier: `AuthService.verifyToken` already refused the
				// bearer if the account's linked employee had gone, so this handler only
				// has to resolve the TELEGRAM directory row.
				const tgId = tgIdFromEmail(auth.email);
				// The directory row IS the acting employee — surfaced so a dashboard can
				// start employee-scoped reads without a second lookup (mirrors REST /auth/me).
				// A password session's employee is the one its token already carries.
				let employeeId: string | null = auth.employee_id ?? null;
				let directoryRole: string | null = null;
				if (tgId) {
					const cfg = initConfig(ctx.env);
					const directory = await findDirectoryEmployee(ctx.db, tgId, cfg);
					if (!directory) {
						throw new Error('Your Telegram account is no longer linked to the employee directory — contact HR to restore access');
					}
					employeeId = directory.id;
					directoryRole = directory.role;
				}

				// Directory → role sync, mirroring REST /auth/me: a role changed in the
				// directory (Studio or SQL) reaches an existing session here.
				let effectiveRole = { id: auth.role_id, name: auth.role_name };
				let effectiveIsAdmin = auth.is_admin;
				if (tgId) {
					const synced = await syncDirectoryRole(ctx.db, auth, directoryRole, initConfig(ctx.env));
					effectiveRole = { id: synced.id, name: synced.name };
					effectiveIsAdmin = synced.name === 'Administrator' || synced.isSystem;
				}

				let fieldRestrictions: string[] | null = null;
				if (input?.collection && effectiveRole.id && !effectiveIsAdmin) {
					fieldRestrictions = await PermissionEvaluator.getFieldRestrictions(ctx.db, effectiveRole.id, input.collection);
				}
				return {
					...auth,
					role_id: effectiveRole.id,
					role_name: effectiveRole.name,
					is_admin: effectiveIsAdmin,
					employee_id: employeeId,
					field_restrictions: fieldRestrictions,
				};
			}),
	}),

	// ── Entity CRUD ─────────────────────────────────────
	entity: t.router({
		collections: t.procedure.use(requireAdmin).query(async ({ ctx }) => {
			await ensureMigrations(ctx);
			// SAME lean projection as REST `/api/collections` — one cached read for
			// both transports. This path used to `SELECT *` every collection (whole
			// `schema_json` blobs) and strip them in JS, which is exactly the D1 byte
			// + Worker-memory waste the projection exists to avoid.
			return new CollectionService(ctx.db).getCollectionSummaries();
		}),
		createSchema: t.procedure
			.use(requireAdmin)
			.input(
				z.object({
					name: z.string().min(1),
					slug: z.string().optional(),
					description: z.string().optional(),
					fields: z.array(z.unknown()).optional(),
					naming_series: z.string().optional(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new CollectionService(ctx.db).createCollection(input as Parameters<typeof CollectionService.prototype.createCollection>[0]);
			}),
		list: t.procedure
			.use(requireBusiness('read'))
			.input(listInput)
			.query(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const u = new URL('http://localhost/api/entities/x');
				if (input.sort) u.searchParams.set('sort', input.sort);
				if (input.limit) u.searchParams.set('limit', String(input.limit));
				if (input.search) u.searchParams.set('search', input.search);
				if (input.cursor) u.searchParams.set('cursor', input.cursor);
				if (input.dir) u.searchParams.set('dir', input.dir);
				if (input.fields) u.searchParams.set('fields', input.fields);
				if (input.aggregate) u.searchParams.set('aggregate', input.aggregate);
				if (input.filter)
					for (const [k, v] of Object.entries(input.filter)) {
						if (v != null) u.searchParams.set(`filter[${k}]`, String(v));
					}
				return svc(ctx).listItems(input.collection, u, input.trashed ?? false);
			}),
		get: t.procedure
			.use(requireBusiness('read'))
			.input(idInput)
			.query(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const selection = input.fields ? parseFieldSelection(input.fields.split(',')) : null;
				return svc(ctx).getItem(input.collection, input.id, selection, input.fields ?? '');
			}),
		create: t.procedure
			.use(requireBusiness('create'))
			.input(createInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return svc(ctx).createItem(input.collection, input.data, ctx.execCtx);
			}),
		update: t.procedure
			.use(requireBusiness('write'))
			.input(updateInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return svc(ctx).updateItem(input.collection, input.id, input.data, ctx.execCtx);
			}),
		softDelete: t.procedure
			.use(requireBusiness('delete'))
			.input(idInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return svc(ctx).softDeleteItem(input.collection, input.id, ctx.execCtx);
			}),
		restore: t.procedure
			.use(requireBusiness('write'))
			.input(idInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return svc(ctx).restoreItem(input.collection, input.id, ctx.execCtx);
			}),
		hardDelete: t.procedure
			.use(requireAdmin)
			.input(idInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return svc(ctx).hardDeleteItem(input.collection, input.id, ctx.execCtx);
			}),
	}),

	// ── Module Management ───────────────────────────────
	module: t.router({
		list: t.procedure.use(requireAuth).query(async ({ ctx }) => {
			await ensureMigrations(ctx);
			return new ModuleService(ctx.db).getModules(false);
		}),
		detail: t.procedure
			.use(requireAuth)
			.input(z.object({ slug: z.string().min(1) }))
			.query(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new ModuleService(ctx.db).getModule(input.slug);
			}),
		create: t.procedure
			.use(requireAdmin)
			.input(
				z.object({
					name: z.string().min(1),
					slug: z.string().min(1),
					icon: z.string().optional(),
					description: z.string().optional(),
					version: z.string().optional(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new ModuleService(ctx.db).createModule(input);
			}),
		update: t.procedure
			.use(requireAdmin)
			.input(
				z.object({
					slug: z.string().min(1),
					name: z.string().optional(),
					icon: z.string().optional(),
					description: z.string().optional(),
					version: z.string().optional(),
					is_active: z.boolean().optional(),
					sort_order: z.number().optional(),
				}),
			)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const { slug, ...data } = input;
				return new ModuleService(ctx.db).updateModule(slug, data);
			}),
		delete: t.procedure
			.use(requireAdmin)
			.input(z.object({ slug: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new ModuleService(ctx.db).deleteModule(input.slug);
			}),
		listCollections: t.procedure
			.use(requireAuth)
			.input(z.object({ slug: z.string().min(1) }))
			.query(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new ModuleService(ctx.db).getModuleCollections(input.slug);
			}),
		attachCollection: t.procedure
			.use(requireAdmin)
			.input(z.object({ module_slug: z.string().min(1), collection_slug: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new ModuleService(ctx.db).attachCollection(input.module_slug, input.collection_slug);
			}),
		detachCollection: t.procedure
			.use(requireAdmin)
			.input(z.object({ module_slug: z.string().min(1), collection_slug: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new ModuleService(ctx.db).detachCollection(input.module_slug, input.collection_slug);
			}),
	}),

	// ── User Management (Admin Only) ────────────────────
	users: t.router({
		list: t.procedure.use(requireAdmin).query(async ({ ctx }) => {
			await ensureMigrations(ctx);
			return new AuthService(ctx.db).listUsers();
		}),
		get: t.procedure
			.use(requireAdmin)
			.input(z.object({ id: z.string().min(1) }))
			.query(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new AuthService(ctx.db).getUser(input.id);
			}),
		create: t.procedure
			.use(requireAdmin)
			.input(createUserInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const secret = ((ctx.env as Record<string, unknown>).ADMIN_PASSWORD as string) || '';
				return new AuthService(ctx.db).createUser(input, secret);
			}),
		update: t.procedure
			.use(requireAdmin)
			.input(updateUserInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const secret = ((ctx.env as Record<string, unknown>).ADMIN_PASSWORD as string) || '';
				// The whole patch MINUS the id, rather than a hand-listed set of fields: the
				// hand-listed shape silently dropped any field added to `updateUserInput`
				// later (it did exactly that to `employee_id`), and for that field the drop
				// was worse than a no-op — `undefined` already means "leave it alone", so a
				// caller could never UN-link an account over tRPC.
				const { id, ...patch } = input;
				return new AuthService(ctx.db).updateUser(id, patch, secret);
			}),
	}),

	// ── Role Management (Admin Only) ────────────────────
	roles: t.router({
		list: t.procedure.use(requireAdmin).query(async ({ ctx }) => {
			await ensureMigrations(ctx);
			return new AuthService(ctx.db).listRoles();
		}),
		create: t.procedure
			.use(requireAdmin)
			.input(createRoleInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new AuthService(ctx.db).createRole(input);
			}),
	}),

	// ── Permissions (Admin Only) ────────────────────────
	permissions: t.router({
		set: t.procedure
			.use(requireAdmin)
			.input(setPermissionInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const result = await new AuthService(ctx.db).setPermission(input);
				// Cache is invalidated inside setPermission, but double-ensure for safety
				if (input.role_id) PermissionEvaluator.invalidateBusinessCache(input.role_id);
				return result;
			}),
		get: t.procedure
			.use(requireAdmin)
			.input(z.object({ role_id: z.string().min(1) }))
			.query(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new AuthService(ctx.db).getPermissions(input.role_id);
			}),
	}),

	// ── Webhooks ────────────────────────────────────────
	webhooks: t.router({
		list: t.procedure.use(requireAuth).query(async ({ ctx }) => {
			const svc = new WebhookService(ctx.db);
			const all = await svc.list();
			if (ctx.auth!.is_admin) return all;
			const filtered = [];
			for (const wh of all) {
				if (await PermissionEvaluator.checkBusiness(ctx.db, ctx.auth!, wh.collection_slug, 'write')) filtered.push(wh);
			}
			return filtered;
		}),
		create: t.procedure
			.use(requireAuth)
			.input(createWebhookInput)
			.mutation(async ({ input, ctx }) => {
				if (!ctx.auth!.is_admin) {
					const allowed = await PermissionEvaluator.checkBusiness(ctx.db, ctx.auth!, input.collection_slug, 'write');
					if (!allowed) throw new Error(`No write permission on "${input.collection_slug}"`);
				}
				return new WebhookService(ctx.db).create(input);
			}),
		update: t.procedure
			.use(requireAuth)
			.input(updateWebhookInput)
			.mutation(async ({ input, ctx }) => {
				const wh = await new WebhookService(ctx.db).getById(input.id);
				if (!wh) throw new Error('Webhook not found');
				if (!ctx.auth!.is_admin) {
					const allowed = await PermissionEvaluator.checkBusiness(ctx.db, ctx.auth!, wh.collection_slug, 'write');
					if (!allowed) throw new Error(`No write permission on "${wh.collection_slug}"`);
				}
				return new WebhookService(ctx.db).update(input.id, {
					url: input.url,
					events: input.events,
					secret: input.secret,
					enabled: input.enabled,
				} as Record<string, unknown>);
			}),
		delete: t.procedure
			.use(requireAuth)
			.input(z.object({ id: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				const wh = await new WebhookService(ctx.db).getById(input.id);
				if (!wh) throw new Error('Webhook not found');
				if (!ctx.auth!.is_admin) {
					const allowed = await PermissionEvaluator.checkBusiness(ctx.db, ctx.auth!, wh.collection_slug, 'write');
					if (!allowed) throw new Error(`No write permission on "${wh.collection_slug}"`);
				}
				await new WebhookService(ctx.db).delete(input.id);
				return { deleted: true };
			}),
	}),

	// ── Bulk Operations ─────────────────────────────────
	bulk: t.router({
		execute: t.procedure
			.use(requireAuth)
			.input(bulkInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const actionMap = { create: 'create' as const, update: 'write' as const, delete: 'delete' as const };
				const permAction = actionMap[input.action];
				if (!ctx.auth!.is_admin) {
					const allowed = await PermissionEvaluator.checkBusiness(ctx.db, ctx.auth!, input.collection, permAction);
					if (!allowed) throw new Error(`No ${permAction} permission on "${input.collection}"`);
				}
				const cSvc = svc(ctx);
				const results: Array<Record<string, unknown>> = [];
				for (const rawItem of input.items) {
					try {
						const item = rawItem as Record<string, unknown>;
						if (input.action === 'create') {
							const r = await cSvc.createItem(input.collection, item);
							results.push({ id: r.id, status: 'created' });
						} else if (input.action === 'update') {
							const { id, ...data } = item;
							if (id) {
								const r = await cSvc.updateItem(input.collection, id as string, data);
								results.push({ id: r.id, status: 'updated' });
							}
						} else {
							const id = typeof item === 'string' ? item : item.id;
							if (id) {
								const r = await cSvc.softDeleteItem(input.collection, id as string);
								results.push({ id: r.id, status: 'deleted' });
							}
						}
					} catch {
						results.push({ error: 'Operation failed' });
					}
				}
				return { action: input.action, processed: results.length, results };
			}),
	}),

	// ── Audit Trail ─────────────────────────────────────
	audit: t.router({
		document: t.procedure
			.use(requireBusiness('read'))
			.input(auditInput)
			.query(async ({ input, ctx }) => {
				if (!input.documentId) throw new Error('documentId required');
				return new AuditService(ctx.db).getDocumentHistory(input.collection, input.documentId);
			}),
		collection: t.procedure
			.use(requireBusiness('read'))
			.input(z.object({ collection: z.string().min(1), limit: z.number().int().min(1).max(200).optional() }))
			.query(async ({ input, ctx }) => {
				return new AuditService(ctx.db).getCollectionHistory(input.collection, input.limit ?? 25);
			}),
	}),

	// ── Export/Import ───────────────────────────────────
	export: t.router({
		schema: t.procedure.use(requireAdmin).query(async ({ ctx }) => {
			await ensureMigrations(ctx);
			return JSON.parse(await new ExportImportService(ctx.db).exportSchema());
		}),
		data: t.procedure
			.use(requireBusiness('read'))
			.input(exportInput)
			.query(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const svc = new ExportImportService(ctx.db, ctx.auth ?? undefined);
				const r = await svc.exportCollection(input.collection, {
					format: input.format ?? 'json',
					limit: input.limit ?? 25,
					fields: input.fields
						?.split(',')
						.map((s) => s.trim())
						.filter(Boolean),
					includeTrashed: input.trashed ?? false,
				});
				return input.format === 'csv' ? r : JSON.parse(r);
			}),
		import: t.procedure
			.use(requireBusiness('create'))
			.input(importInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const format = input.format ?? 'json';
				const onConflict = input.onConflict ?? 'skip';

				// 'overwrite' means upsert-by-id. The safe pipeline below never
				// overwrites (createItem's id replay returns the existing live row,
				// so duplicate ids are effectively skipped) — granting non-admins a
				// semantic we don't actually implement would be misleading, so the
				// option is admin-only.
				if (onConflict === 'overwrite' && !ctx.auth?.is_admin) {
					throw new Error('onConflict "overwrite" is admin-only');
				}

				// Parse rows (JSON array or CSV text) — mirrors the REST import route
				// (routes/export.ts), including the row cap.
				const rawData = typeof input.data === 'string' ? input.data : JSON.stringify(input.data);
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
					throw new ValidationError(e instanceof Error ? e.message : 'Parse failed');
				}
				if (rows.length === 0) throw new ValidationError('No rows to import');
				if (rows.length > 5000) throw new ValidationError('Max 5000 rows per import');

				// Full pipeline per row (createItem: splitRowData strips system keys,
				// required-field validation, linkage, hooks, row-filter, audit,
				// webhooks) — never a raw insert.
				const collSvc = svc(ctx);
				const errors: Array<{ row: number; error: string }> = [];
				let imported = 0;
				for (let i = 0; i < rows.length; i++) {
					try {
						await collSvc.createItem(input.collection, rows[i] as Record<string, unknown>, ctx.execCtx);
						imported++;
					} catch (e) {
						const rowNumber = format === 'csv' ? i + 2 : i + 1;
						if (errors.length < 50) {
							errors.push({ row: rowNumber, error: e instanceof Error ? e.message : 'Failed' });
						}
					}
				}
				return { imported, skipped: rows.length - imported, errors };
			}),
	}),

	// ── Reports (Admin Only) ────────────────────────────
	report: t.router({
		dashboard: t.procedure.use(requireAdmin).query(async ({ ctx }) => {
			await ensureMigrations(ctx);
			return new ReportService(ctx.db).dashboard();
		}),
		generate: t.procedure
			.use(requireAdmin)
			.input(reportInput)
			.mutation(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				return new ReportService(ctx.db).generateReport(input);
			}),
	}),

	// ── Scheduler (Admin Only) ──────────────────────────
	scheduler: t.router({
		list: t.procedure.use(requireAdmin).query(async ({ ctx }) => new ScheduledJobService(ctx.db).list()),
		create: t.procedure
			.use(requireAdmin)
			.input(schedulerCreateInput)
			.mutation(async ({ input, ctx }) =>
				new ScheduledJobService(ctx.db).create(input as unknown as Parameters<typeof ScheduledJobService.prototype.create>[0]),
			),
		update: t.procedure
			.use(requireAdmin)
			.input(schedulerUpdateInput)
			.mutation(async ({ input, ctx }) =>
				new ScheduledJobService(ctx.db).update(input.id!, input as unknown as Parameters<typeof ScheduledJobService.prototype.update>[1]),
			),
		delete: t.procedure
			.use(requireAdmin)
			.input(z.object({ id: z.string().min(1) }))
			.mutation(async ({ input, ctx }) => {
				await new ScheduledJobService(ctx.db).delete(input.id);
				return { deleted: true };
			}),
		run: t.procedure.use(requireAdmin).mutation(async ({ ctx }) => new ScheduledJobService(ctx.db).runDueJobs()),
	}),

	// ── Search ──────────────────────────────────────────
	search: t.router({
		query: t.procedure
			.use(requireAuth)
			.input(searchInput)
			.query(async ({ input, ctx }) => {
				await ensureMigrations(ctx);
				const cols = input.collections
					?.split(',')
					.map((s) => s.trim())
					.filter(Boolean);
				const { data, meta } = await new SearchService(ctx.db, ctx.auth ?? null).searchGlobal({
					query: input.q,
					collections: cols,
					limit: input.limit ?? 25,
					cursor: input.cursor,
				});
				if (ctx.auth && !ctx.auth.is_admin) {
					const allowed = new Set<string>();
					for (const r of data) {
						if (r.collection && (await PermissionEvaluator.checkBusiness(ctx.db, ctx.auth, r.collection, 'read'))) {
							allowed.add(r.collection);
						}
					}
					return { results: data.filter((r) => allowed.has(r.collection)), meta };
				}
				return { results: data, meta };
			}),
		build: t.procedure.use(requireAdmin).mutation(async ({ ctx }) => {
			await ensureMigrations(ctx);
			return { indexed: await new SearchService(ctx.db).buildGlobalIndex() };
		}),
	}),
});

export type AppRouter = typeof appRouter;

/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { D1Client } from '@mmbix/core';
import { AuthService } from '@/lib/services/auth.service';
import { CollectionService } from '@/lib/services/collection.service';
import type { AuthContext } from '@/lib/services/auth.service';

/**
 * Write-path assurance — the two STRIDE gaps this pass closed.
 *
 * 1. `field_restrictions` (PoLP / least privilege). The whitelist was applied on
 *    READ only, so a role that could write a collection but not READ a column
 *    could still SET it. `ItemMutationService.assertWritableFields` now rejects a
 *    write naming a non-whitelisted field (403) and the write RESPONSE is redacted
 *    to the same whitelist.
 * 2. `WorkflowService._setStatus` (Repudiation / stale reads). Its raw UPDATE
 *    bypassed the engine's invalidation seam, so a submit/approve/reject served
 *    the pre-decision `doc_status` from the response cache and reported no
 *    `meta.changed`. It now calls `invalidateCollectionReads`.
 * 3. `row_filters` with more than one condition honoured the operator, but a
 *    SINGLE-condition filter collapsed every operator except null/nnull/in to
 *    `=` (DataFilterService._applySingleCondition) — a `neq`/`gte` scope silently
 *    matched equality. Both paths now share one operator table.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

interface Json {
	data: Record<string, unknown>;
	error?: string;
	message?: string;
	meta?: { changed?: { collections?: string[]; rows?: string[] } };
}

async function call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
	return SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: {
			...JSON_HEADERS,
			...(token ? { Authorization: `Bearer ${token}` } : ADMIN),
			...(init.headers ?? {}),
		},
	});
}

async function json(res: Response): Promise<Json> {
	return (await res.json()) as Json;
}

async function login(email: string): Promise<string> {
	const res = await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'write-assurance-pass' }) });
	expect(res.status).toBe(200);
	return (await json(res)).data.token as string;
}

describe('field_restrictions gates writes, not just reads', () => {
	const COLLECTION = 'field_write_probe';
	let token = '';

	beforeAll(async () => {
		const created = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({
				name: COLLECTION,
				slug: COLLECTION,
				fields: [
					{ name: 'name', type: 'text', required: false },
					{ name: 'secret', type: 'text', required: false },
				],
			}),
		});
		expect([201, 409]).toContain(created.status);

		const uniq = crypto.randomUUID();
		const role = (
			await json(
				await call('/api/users/roles', { method: 'POST', body: JSON.stringify({ name: `FieldWrite-${uniq}`, description: 'test' }) }),
			)
		).data.id as string;
		const perm = await call('/api/users/permissions', {
			method: 'POST',
			body: JSON.stringify({
				role_id: role,
				collection_slug: COLLECTION,
				can_read: true,
				can_create: true,
				can_write: true,
				field_restrictions: JSON.stringify(['name']),
			}),
		});
		expect(perm.status).toBe(201);

		const email = `field-write-${uniq}@test.local`;
		const user = await call('/api/users', {
			method: 'POST',
			body: JSON.stringify({ email, password: 'write-assurance-pass', full_name: 'Field Write', role_id: role }),
		});
		expect(user.status).toBe(201);
		token = await login(email);
	});

	it('rejects a create that names a field outside the whitelist', async () => {
		const res = await call(
			`/api/entities/${COLLECTION}`,
			{ method: 'POST', body: JSON.stringify({ name: 'ok', secret: 'classified' }) },
			token,
		);
		expect(res.status).toBe(403);
		expect(JSON.stringify(await json(res))).toMatch(/secret/);
	});

	it('allows a whitelisted create and redacts the write response', async () => {
		const res = await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ name: 'ok' }) }, token);
		expect(res.status).toBe(201);
		const body = await json(res);
		expect(body.data.name).toBe('ok');
		// The read whitelist hides the restricted column; the write response must match.
		expect('secret' in body.data).toBe(false);
	});

	it('rejects an update that names a field outside the whitelist', async () => {
		// Admin seeds a row that carries the restricted column.
		const seed = await json(
			await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ name: 'seeded', secret: 'top' }) }),
		);
		const id = seed.data.id as string;

		const blocked = await call(`/api/entities/${COLLECTION}/${id}`, { method: 'PUT', body: JSON.stringify({ secret: 'leak' }) }, token);
		expect(blocked.status).toBe(403);

		// A whitelisted update succeeds — and its response hides the restricted column.
		const ok = await call(`/api/entities/${COLLECTION}/${id}`, { method: 'PUT', body: JSON.stringify({ name: 'renamed' }) }, token);
		expect(ok.status).toBe(200);
		const body = await json(ok);
		expect(body.data.name).toBe('renamed');
		expect('secret' in body.data).toBe(false);
	});
});

describe('WorkflowService._setStatus invalidates the response cache', () => {
	const COLLECTION = 'wf_probe';

	beforeAll(async () => {
		const created = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({ name: COLLECTION, slug: COLLECTION, fields: [{ name: 'title', type: 'text', required: false }] }),
		});
		expect([201, 409]).toContain(created.status);
		// A no-level workflow enabled straight in schema_json (the Studio writes this
		// shape) — a submit then routes through WorkflowService.submit → _setStatus.
		// Written BEFORE any read of this slug so no warm schema cache hides it.
		await env.DB.prepare('UPDATE _entity_schemas SET schema_json = ? WHERE slug = ?')
			.bind(
				JSON.stringify({
					fields: [{ name: 'title', type: 'text', required: false }],
					workflow: { enabled: true, name: 'Probe', levels: [] },
				}),
				COLLECTION,
			)
			.run();
	});

	it('reports the collection in the change envelope of a submit', async () => {
		const created = await json(await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ title: 'draft me' }) }));
		expect(created.data.doc_status).toBe('draft');
		const id = created.data.id as string;

		const submitted = await call(`/api/entities/${COLLECTION}/${id}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'submitted' }),
		});
		expect(submitted.status).toBe(200);
		const body = await json(submitted);
		expect(body.data.doc_status).toBe('submitted');
		// The raw _setStatus UPDATE is exactly the write that used to leave the old
		// draft in the response cache and omit itself from meta.changed.
		expect(body.meta?.changed?.collections ?? []).toContain(COLLECTION);
	});
});

/**
 * A `table`-field composite write is the SANCTIONED path for a service-only
 * child: the MRO document headers are generic (draft CRUD) while their LINES are
 * `writes.mode: 'service'`, and the shipped draft flow creates both in one
 * generic POST. The lock therefore blocks DIRECT REST writes to the child —
 * never the parent's embedded write (the parent's own `freeze_when` gates the
 * document lifecycle). Pinned so a future pass does not "tighten" it and break
 * every document draft.
 */
describe('a service-only child is locked to direct REST writes, not to its parent', () => {
	const CHILD = 'svc_child_probe';
	const PARENT = 'svc_parent_probe';

	beforeAll(async () => {
		const child = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({
				name: CHILD,
				slug: CHILD,
				policies: { writes: { mode: 'service' } },
				fields: [
					{ name: 'label', type: 'text', required: false },
					{ name: 'parent_id', type: 'text', required: false },
				],
			}),
		});
		expect([201, 409]).toContain(child.status);
		const parent = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({
				name: PARENT,
				slug: PARENT,
				fields: [
					{ name: 'name', type: 'text', required: false },
					{ name: 'lines', type: 'table', required: false, related_collection: CHILD },
				],
			}),
		});
		expect([201, 409]).toContain(parent.status);
	});

	it('blocks a DIRECT create on the service-only child', async () => {
		const res = await call(`/api/entities/${CHILD}`, { method: 'POST', body: JSON.stringify({ label: 'direct' }) });
		expect(res.status).toBe(403);
	});

	it('allows the composite parent write that embeds the child rows', async () => {
		const res = await call(`/api/entities/${PARENT}`, {
			method: 'POST',
			body: JSON.stringify({ name: 'composite', lines: [{ label: 'ok' }] }),
		});
		expect(res.status).toBe(201);

		const children = await json(await call(`/api/entities/${CHILD}?limit=50`));
		expect((children.data as unknown as unknown[]).length).toBeGreaterThan(0);
	});
});

/**
 * `policies.actor_fields` must bind the payload's actor to the SIGNED session
 * (`AuthContext.employee_id`), never the client value — the MRO/attendance
 * forgery gap. Admins keep explicit control (trusted root).
 */
describe('actor_fields bind to the session, not the payload', () => {
	const COLLECTION = 'actor_bind_probe';

	function probeAuth(over: Partial<AuthContext>): AuthContext {
		return {
			user_id: crypto.randomUUID(),
			role_id: '',
			role_name: '',
			email: 'actor-probe@test.local',
			is_admin: false,
			employee_id: null,
			...over,
		};
	}

	beforeAll(async () => {
		const created = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({
				name: COLLECTION,
				slug: COLLECTION,
				policies: { actor_fields: ['owner_emp'] },
				fields: [
					{ name: 'label', type: 'text', required: false },
					{ name: 'owner_emp', type: 'text', required: false },
				],
			}),
		});
		expect([201, 409]).toContain(created.status);
	});

	it('overwrites a forged actor with the signed session employee', async () => {
		const svc = new CollectionService(new D1Client(env.DB), probeAuth({ employee_id: 'EMP-A' }));
		const row = await svc.createItem(COLLECTION, { label: 'me', owner_emp: 'EMP-B' });
		expect(row.owner_emp).toBe('EMP-A');
	});

	it('refuses the record from an identity with no employee directory row', async () => {
		const svc = new CollectionService(new D1Client(env.DB), probeAuth({ employee_id: null }));
		await expect(svc.createItem(COLLECTION, { label: 'nobody' })).rejects.toThrow(/no employee directory row/);
	});

	it('never rewrites the actor on update', async () => {
		const svc = new CollectionService(new D1Client(env.DB), probeAuth({ employee_id: 'EMP-A' }));
		const row = await svc.createItem(COLLECTION, { label: 'edit me' });
		const updated = await svc.updateItem(COLLECTION, row.id as string, { label: 'renamed', owner_emp: 'EMP-Z' });
		expect(updated.label).toBe('renamed');
		expect(updated.owner_emp).toBe('EMP-A');
	});

	it('lets a trusted-root admin name the actor explicitly', async () => {
		const created = await json(
			await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ label: 'admin', owner_emp: 'EMP-B' }) }),
		);
		expect(created.data.owner_emp).toBe('EMP-B');
	});
});

/**
 * The approvals plugin builds its own `CollectionService`. It used to build it
 * with NO auth, so the facade's row-filter check early-returned and this route
 * could move a document the caller cannot even see. It now threads the session
 * auth, so a row-excluded caller is refused.
 */
describe('the approvals plugin runs with the caller auth', () => {
	const COLLECTION = 'appr_probe';
	let token = '';
	let docId = '';

	beforeAll(async () => {
		const created = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({ name: COLLECTION, slug: COLLECTION, fields: [{ name: 'title', type: 'text', required: false }] }),
		});
		expect([201, 409]).toContain(created.status);

		const doc = await json(await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ title: 'to submit' }) }));
		docId = doc.data.id as string;

		const uniq = crypto.randomUUID();
		const role = (
			await json(await call('/api/users/roles', { method: 'POST', body: JSON.stringify({ name: `Appr-${uniq}`, description: 'test' }) }))
		).data.id as string;
		const perm = await call('/api/users/permissions', {
			method: 'POST',
			body: JSON.stringify({
				role_id: role,
				collection_slug: COLLECTION,
				can_read: true,
				can_write: true,
				can_create: true,
				can_submit: true,
				// Row filter that matches NOTHING — the caller cannot see this doc.
				row_filters: JSON.stringify({ combiner: 'and', conditions: [{ field: 'title', op: 'eq', value: 'definitely-not-it' }] }),
			}),
		});
		expect(perm.status).toBe(201);

		const email = `appr-${uniq}@test.local`;
		const user = await call('/api/users', {
			method: 'POST',
			body: JSON.stringify({ email, password: 'write-assurance-pass', full_name: 'Appr Probe', role_id: role }),
		});
		expect(user.status).toBe(201);
		token = await login(email);
	});

	it('refuses to submit a document the caller cannot see', async () => {
		const res = await call(`/api/approvals/${COLLECTION}/${docId}/submit`, { method: 'POST', body: JSON.stringify({}) }, token);
		expect(res.status).toBe(403);
		expect(JSON.stringify(await json(res))).toMatch(/access to this record/i);
	});
});

/**
 * Row filters are the engine's row-level PoLP gate, and they must apply to
 * WRITES (update / delete / restore) as well as reads — the attendance
 * cross-employee check-out hole was exactly a write the caller could see. This
 * pins both halves with an employee-scoped token.
 */
describe('row_filters gate reads AND writes', () => {
	const COLLECTION = 'rowscope_probe';
	const ROLE = crypto.randomUUID();
	const USER = crypto.randomUUID();
	const EMP_A = 'rowscope-emp-a';
	const EMP_B = 'rowscope-emp-b';
	let tokenA = '';
	let rowA = '';
	let rowB = '';

	beforeAll(async () => {
		const created = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({
				name: COLLECTION,
				slug: COLLECTION,
				fields: [
					{ name: 'label', type: 'text', required: false },
					{ name: 'owner', type: 'text', required: false },
				],
			}),
		});
		expect([201, 409]).toContain(created.status);

		await env.DB.prepare('INSERT INTO _roles (id, name, description, is_system) VALUES (?, ?, ?, 0)')
			.bind(ROLE, `RowScope-${ROLE.slice(0, 8)}`, 'test')
			.run();
		await env.DB.prepare(
			'INSERT INTO _role_permissions (id, role_id, collection_slug, can_read, can_write, can_create, can_delete, can_approve, can_submit, row_filters) VALUES (?, ?, ?, 1, 1, 1, 0, 0, 1, ?)',
		)
			.bind(
				crypto.randomUUID(),
				ROLE,
				COLLECTION,
				JSON.stringify({ combiner: 'and', conditions: [{ field: 'owner', op: 'eq', value: '$CURRENT_USER.employee_id' }] }),
			)
			.run();
		await env.DB.prepare("INSERT INTO _users (id, email, full_name, password_hash, role_id, status) VALUES (?, ?, ?, 'x', ?, 'active')")
			.bind(USER, `rowscope-${USER.slice(0, 8)}@test.local`, 'Row Scope', ROLE)
			.run();
		tokenA = await new AuthService(new D1Client(env.DB)).generateToken(USER, (env as unknown as Record<string, string>).JWT_SECRET, EMP_A);

		const a = await json(
			await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ label: 'mine', owner: EMP_A }) }),
		);
		rowA = a.data.id as string;
		const b = await json(
			await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ label: 'theirs', owner: EMP_B }) }),
		);
		rowB = b.data.id as string;
	});

	it('reads only the caller’s own rows', async () => {
		const res = await json(await call(`/api/entities/${COLLECTION}?limit=50&fields=id,owner`, {}, tokenA));
		const rows = res.data as unknown as Array<{ id: string; owner: string }>;
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.owner === EMP_A)).toBe(true);
		expect(rows.some((r) => r.id === rowB)).toBe(false);
	});

	it('refuses to update another employee’s row', async () => {
		const res = await call(`/api/entities/${COLLECTION}/${rowB}`, { method: 'PUT', body: JSON.stringify({ label: 'tamper' }) }, tokenA);
		expect(res.status).toBe(403);
	});

	it('allows updating the caller’s own row', async () => {
		const res = await call(`/api/entities/${COLLECTION}/${rowA}`, { method: 'PUT', body: JSON.stringify({ label: 'mine-2' }) }, tokenA);
		expect(res.status).toBe(200);
	});
});

describe('a SINGLE-condition row_filter honours its operator (regression)', () => {
	// Before the fix a one-condition filter passed only the VALUE to the query
	// builder, collapsing `neq/gt/gte/lt/lte/like/nin` into `=`. A `gte` scope then
	// matched nothing (or, for `neq`, the wrong rows) — silently wrong, not noisy.
	const COLLECTION = 'rowop_probe';
	const ROLE = crypto.randomUUID();
	const USER = crypto.randomUUID();
	let token = '';

	beforeAll(async () => {
		const created = await call('/api/collections', {
			method: 'POST',
			body: JSON.stringify({
				name: COLLECTION,
				slug: COLLECTION,
				fields: [
					{ name: 'label', type: 'text', required: false },
					{ name: 'bucket', type: 'number', required: false },
				],
			}),
		});
		expect([201, 409]).toContain(created.status);

		await env.DB.prepare('INSERT INTO _roles (id, name, description, is_system) VALUES (?, ?, ?, 0)')
			.bind(ROLE, `RowOp-${ROLE.slice(0, 8)}`, 'test')
			.run();
		// ONE condition with a comparison operator — the exact shape that regressed.
		await env.DB.prepare(
			'INSERT INTO _role_permissions (id, role_id, collection_slug, can_read, can_write, can_create, can_delete, can_approve, can_submit, row_filters) VALUES (?, ?, ?, 1, 0, 0, 0, 0, 0, ?)',
		)
			.bind(
				crypto.randomUUID(),
				ROLE,
				COLLECTION,
				JSON.stringify({ combiner: 'and', conditions: [{ field: 'bucket', op: 'gte', value: 10 }] }),
			)
			.run();
		await env.DB.prepare("INSERT INTO _users (id, email, full_name, password_hash, role_id, status) VALUES (?, ?, ?, 'x', ?, 'active')")
			.bind(USER, `rowop-${USER.slice(0, 8)}@test.local`, 'Row Op', ROLE)
			.run();
		token = await new AuthService(new D1Client(env.DB)).generateToken(USER, (env as unknown as Record<string, string>).JWT_SECRET);

		await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ label: 'low', bucket: 5 }) });
		await call(`/api/entities/${COLLECTION}`, { method: 'POST', body: JSON.stringify({ label: 'high', bucket: 20 }) });
	});

	it('returns only the rows satisfying the comparison (gte), not equality', async () => {
		const res = await json(await call(`/api/entities/${COLLECTION}?limit=50&fields=id,bucket`, {}, token));
		const rows = res.data as unknown as Array<{ bucket: number }>;
		expect(rows.length).toBe(1);
		expect(rows[0].bucket).toBe(20);
	});
});

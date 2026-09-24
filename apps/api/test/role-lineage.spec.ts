/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * Permission lineage — every `_role_permissions` row records WHO wrote it
 * (`source`) and, when a module declared it, the owning module
 * (`source_module`). An admin Studio write is `admin`; a role provisioner is
 * `provisioner`. The columns are exposed on the permissions read.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const AUTH_JSON = { ...JSON_HEADERS, ...ADMIN };

async function json<T>(path: string, init?: RequestInit): Promise<{ status: number; body: { data?: T; error?: string } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, { ...init, headers: { ...AUTH_JSON, ...(init?.headers ?? {}) } });
	const body = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
	return { status: res.status, body: body ?? {} };
}

describe('role permission lineage', () => {
	it('stamps an admin grant with source=admin and exposes it on the read', async () => {
		const role = await json<{ id: string }>('/api/users/roles', {
			method: 'POST',
			body: JSON.stringify({ name: 'Lineage Role', description: 'test' }),
		});
		expect(role.status).toBe(201);
		const roleId = role.body.data!.id;

		const perm = await json<{ source?: string | null; source_module?: string | null }>('/api/users/permissions', {
			method: 'POST',
			body: JSON.stringify({ role_id: roleId, collection_slug: 'orders', can_read: true }),
		});
		expect(perm.status).toBe(201);
		expect(perm.body.data!.source).toBe('admin');
		expect(perm.body.data!.source_module ?? null).toBeNull();

		const read = await json<Array<{ collection_slug: string; source?: string | null }>>(`/api/users/permissions/${roleId}`);
		expect(read.status).toBe(200);
		const row = read.body.data!.find((r) => r.collection_slug === 'orders')!;
		expect(row.source).toBe('admin');
	});
});

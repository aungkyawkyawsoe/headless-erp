#!/usr/bin/env node
/**
 * Add the RBAC `role` field to the `hrm_employees` directory through the
 * VALIDATED engine API (never raw SQL) — idempotent, no-op when present.
 *
 * Why: Telegram login assigns a role per employee (see
 * apps/api/src/routes/auth-telegram.ts → resolveEmployeeRole). Until this field
 * exists every Telegram user got the ONE configured default role (Employee);
 * with it, each employee's row names their role (Administrator / Employee /
 * Storekeeper) and the login grants exactly that role's `app_access` +
 * `_role_permissions` — so the Mini App launcher shows only allowed apps.
 *
 * The field is a nullable `select` (required:false) so populated tables migrate
 * with a plain ADD COLUMN. Options mirror the three shipped `_roles` names; the
 * login resolves by name (case-insensitive) and falls back to the default role
 * when the value is blank/unknown.
 *
 *   node scripts/add-employee-role-field.mjs [baseUrl] [bearerToken]
 */
const baseUrl = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');
const token = process.argv[3] ?? 'dev-token';
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const H = (init = {}) => ({ ...init, headers: { ...headers, ...(init.headers ?? {}) } });

const ROLE_FIELD = {
	name: 'role',
	type: 'select',
	label: 'Role',
	required: false,
	description: 'RBAC role for this employee’s Telegram login — determines which apps and collections they may access.',
	options: [
		{ value: 'Administrator', label: 'Administrator' },
		{ value: 'Employee', label: 'Employee' },
		{ value: 'Storekeeper', label: 'Storekeeper' },
	],
};

async function call(path, init = {}) {
	const res = await fetch(`${baseUrl}${path}`, H(init));
	const text = await res.text();
	if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
	if (!text) return null;
	try {
		const body = JSON.parse(text);
		return body && typeof body === 'object' && 'data' in body ? body.data : body;
	} catch {
		return text;
	}
}

const run = async () => {
	const col = await call('/api/collections/hrm_employees');
	if (!col || !col.schema_json) throw new Error(`hrm_employees not found (${JSON.stringify(col).slice(0, 200)})`);

	const fields = (col.schema_json.fields ?? []).filter((f) => f && typeof f.name === 'string');
	if (fields.some((f) => f.name === ROLE_FIELD.name)) {
		console.log('✅ hrm_employees.role present — no-op');
		return;
	}

	await call('/api/collections/hrm_employees', {
		method: 'PUT',
		body: JSON.stringify({ fields: [...fields, ROLE_FIELD] }),
	});
	console.log('✅ hrm_employees +role (select: Administrator / Employee / Storekeeper)');
};

run().catch((err) => {
	console.error('ABORTED:', err);
	process.exit(1);
});

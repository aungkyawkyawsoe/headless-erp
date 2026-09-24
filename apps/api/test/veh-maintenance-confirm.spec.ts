/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `veh_maintenance_logs` confirmation lock — the ပြင်ဆင် app's Service history
 * lets an operator correct a job until it is CONFIRMED, then the row is frozen:
 *
 *   1. a fresh log is `draft` and stays editable;
 *   2. `draft → confirmed` is a legal GENERIC doc_status transition (the engine's
 *      core machine now carries `confirmed` as a terminal posted state);
 *   3. once confirmed, `writes.freeze_when` rejects every generic update / delete
 *      — the admin bypass cannot reach it either (the freeze sits inside the
 *      mutation service), so a posted job can only be reversed out of band.
 */

const BASE_URL = 'http://localhost';
const ADMIN = { Authorization: 'Bearer dev-token' };
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const PLATE = 'aaaaaaaa-0000-4000-8000-0000000000f1';
const LOG = 'cccccccc-0000-4000-8000-0000000000f2';

const field = (name: string, type: string, extra: Record<string, unknown> = {}) => ({
	name,
	type,
	...(extra.required === undefined ? { required: false } : {}),
	...extra,
});

async function api(path: string, init?: RequestInit): Promise<{ status: number; body: { data?: unknown; error?: string } }> {
	const res = await SELF.fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...JSON_HEADERS, ...ADMIN, ...(init?.headers ?? {}) },
	});
	return { status: res.status, body: (await res.json().catch(() => ({}))) as { data?: unknown; error?: string } };
}

async function createCollection(slug: string, name: string, fields: Array<Record<string, unknown>>): Promise<void> {
	const res = await api('/api/collections', { method: 'POST', body: JSON.stringify({ name, slug, fields }) });
	expect(res.status, `create ${slug}`).toBe(201);
}

beforeAll(async () => {
	await createCollection('hrm_employees', 'HRM Employees', [field('name_en', 'text', { required: true })]);
	await createCollection('veh_fleets', 'VEH Fleets', [field('plate_no', 'text', { required: true })]);
	await createCollection('veh_issue_types', 'VEH Issue Types', [field('name_en', 'text'), field('job_code', 'text', { required: true })]);
	await createCollection('veh_maintenance_logs', 'VEH Maintenance Logs', [
		field('fleet', 'm2o', { related_collection: 'veh_fleets', display_template: '{{plate_no}}' }),
		field('started_at', 'date', { required: true }),
		field('end_at', 'date'),
		field('odo', 'text'),
		field('parts_cost', 'number'),
		field('labor_cost', 'number'),
		field('total_cost', 'formula', {
			formula: 'parts_cost + labor_cost',
			store: true,
			result_type: 'number',
		}),
		field('vendor_type', 'select', {
			options: [
				{ value: 'in_house', label: 'In-house' },
				{ value: 'external', label: 'External Vendor' },
			],
		}),
		field('technician', 'text'),
		field('note', 'text'),
		field('issues_type', 'm2o', { related_collection: 'veh_issue_types' }),
		field('approved_by', 'm2o', { related_collection: 'hrm_employees' }),
		field('driver', 'm2o', { related_collection: 'hrm_employees' }),
	]);

	// Fixtures — a plate + a draft log (explicit UUIDs; m2o values must be UUIDs).
	// The confirm policy is NOT set yet, so the default-deny can be pinned first.
	const created = await api('/api/entities/veh_fleets', {
		method: 'POST',
		body: JSON.stringify({ id: PLATE, plate_no: 'CF-11' }),
	});
	expect(created.status, 'create the fleet fixture').toBe(201);
	const log = await api('/api/entities/veh_maintenance_logs', {
		method: 'POST',
		body: JSON.stringify({ id: LOG, fleet: PLATE, started_at: '2026-09-01', parts_cost: 100 }),
	});
	expect(log.status, 'create the draft log').toBe(201);
});

describe('veh_maintenance_logs — confirm then freeze', () => {
	it('keeps a draft log editable but rejects a generic confirm until the collection opts in', async () => {
		const draft = await api(`/api/entities/veh_maintenance_logs/${LOG}?fields=id,doc_status,note`);
		expect(draft.body.data).toMatchObject({ doc_status: 'draft' });

		const edit = await api(`/api/entities/veh_maintenance_logs/${LOG}`, {
			method: 'PUT',
			body: JSON.stringify({ note: 'Injector service' }),
		});
		expect(edit.status, 'a draft log accepts an edit').toBe(200);

		// Default deny — `confirmed` is a domain-service-owned posted state.
		const denied = await api(`/api/entities/veh_maintenance_logs/${LOG}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'confirmed' }),
		});
		expect(denied.status, 'generic confirm without the opt-in').toBeGreaterThanOrEqual(400);
	});

	it('confirms a draft generically once `writes.confirmable` + `freeze_when` are set', async () => {
		// The SAME policy `apply-mro-schema` installs from schema-defs.json (a
		// partial-merge PUT is the engine's validated path).
		const policy = await api('/api/collections/veh_maintenance_logs/policies', {
			method: 'PUT',
			body: JSON.stringify({
				writes: { confirmable: true, freeze_when: { field: 'doc_status', values: ['confirmed'] } },
			}),
		});
		expect(policy.status, 'set the confirm policy').toBe(200);

		const res = await api(`/api/entities/veh_maintenance_logs/${LOG}`, {
			method: 'PUT',
			body: JSON.stringify({ doc_status: 'confirmed' }),
		});
		expect(res.status).toBe(200);
		expect((res.body.data as Record<string, unknown>).doc_status).toBe('confirmed');
	});

	it('rejects every generic write once confirmed — the admin bypass cannot reach it', async () => {
		const edit = await api(`/api/entities/veh_maintenance_logs/${LOG}`, {
			method: 'PUT',
			body: JSON.stringify({ note: 'sneaky edit' }),
		});
		expect(edit.status, 'update on a confirmed log').toBe(403);

		const del = await api(`/api/entities/veh_maintenance_logs/${LOG}`, { method: 'DELETE' });
		expect(del.status, 'delete on a confirmed log').toBe(403);

		const read = await api(`/api/entities/veh_maintenance_logs/${LOG}?fields=id,doc_status,note`);
		expect(read.body.data).toMatchObject({ doc_status: 'confirmed', note: 'Injector service' });
	});
});

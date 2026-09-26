// @vitest-environment jsdom
/**
 * RolesTab — the RBAC matrix, driven through a real DOM.
 *
 * `lib/role-matrix.spec.ts` covers the pure derivations (counts, tri-state,
 * dirty, badges). This file covers what that spec cannot: the controls the
 * operator actually clicks, and the ONE rule that makes the screen honest —
 * a bulk/master action acts on exactly the rows ON SCREEN, never the whole
 * library. A "toggle all" that silently reached the filtered-out rows would be
 * the single most dangerous bug this surface can have.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/api', () => ({
	listRoles: vi.fn(),
	listCollections: vi.fn(),
	listModules: vi.fn(),
	getRolePermissions: vi.fn(),
	setPermission: vi.fn(),
	updateRole: vi.fn(),
	createRole: vi.fn(),
}));

import {
	createRole,
	getRolePermissions,
	listCollections,
	listModules,
	listRoles,
	setPermission,
	updateRole,
	type RolePermission,
	type RoleRecord,
} from '../../lib/api';
import { emptyPermission } from '../../lib/role-matrix';
import { RolesTab } from './roles-tab';

const mockListRoles = vi.mocked(listRoles) as unknown as Mock;
const mockListCollections = vi.mocked(listCollections) as unknown as Mock;
const mockListModules = vi.mocked(listModules) as unknown as Mock;
const mockGetPerms = vi.mocked(getRolePermissions) as unknown as Mock;
const mockSetPermission = vi.mocked(setPermission) as unknown as Mock;
const mockUpdateRole = vi.mocked(updateRole) as unknown as Mock;
const mockCreateRole = vi.mocked(createRole) as unknown as Mock;

/** Column order of the six flag checkboxes inside a row. */
const FLAG_INDEX = { read: 0, write: 1, create: 2, delete: 3, approve: 4, submit: 5 } as const;

const ROLE_ADMIN: RoleRecord = {
	id: 'r-admin',
	name: 'Administrator',
	description: 'Full access',
	is_system: 1,
	app_access: null,
};
const ROLE_EMPLOYEE: RoleRecord = { id: 'r-emp', name: 'Employee', description: '', is_system: 0, app_access: ['sales'] };

/** A row's fields, layered over the engine's deny default. */
function perm(roleId: string, slug: string, over: Partial<RolePermission> = {}): RolePermission {
	return { ...emptyPermission(roleId, slug), id: `p-${slug}`, ...over };
}

/**
 * The Administrator's matrix — deliberately asymmetric so every tile is a
 * distinct number AND one row carries a governance note with no flags:
 *   orders    read+write (2 flags) + a 2-field whitelist  → '2 fields restricted'
 *   suppliers read (1 flag)       + a 1-condition RLS     → '1 row rule'
 *   invoices  no flags            + a 1-field whitelist   → '1 field restricted'
 * ⇒ granted 2/3 · flags 3 · row rules 1 · field locks 2.
 */
const ADMIN_PERMS: RolePermission[] = [
	perm('r-admin', 'orders', { can_read: true, can_write: true, field_restrictions: JSON.stringify(['name', 'qty']) }),
	perm('r-admin', 'suppliers', {
		can_read: true,
		row_filters: JSON.stringify({ conditions: [{ field: 'status', op: '_eq', value: 'active' }], combiner: 'and' }),
	}),
	perm('r-admin', 'invoices', { field_restrictions: JSON.stringify(['total']) }),
];
const EMPLOYEE_PERMS: RolePermission[] = [perm('r-emp', 'orders', { can_read: true })];

function renderTab() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<RolesTab token="tk" />
		</QueryClientProvider>,
	);
}

/** Wait for the matrix to land (the last row's slug to render is the signal). */
async function renderLoaded() {
	const view = renderTab();
	await screen.findByText('suppliers');
	return view;
}

/** One collection's row. The slug cell's text is exactly the slug. */
function rowOf(slug: string): HTMLElement {
	const cell = screen.getByText(slug, { selector: 'td' });
	const row = cell.closest('tr');
	if (!row) throw new Error(`no row for ${slug}`);
	return row as HTMLElement;
}

/** That row's Nth flag checkbox (FLAG_INDEX order). */
function flagBox(slug: string, flag: keyof typeof FLAG_INDEX): HTMLElement {
	return within(rowOf(slug)).getAllByRole('checkbox')[FLAG_INDEX[flag]] as HTMLElement;
}

const checked = (el: HTMLElement) => el.getAttribute('aria-checked');

/**
 * A column header's master toggle. Matched on EXACT text so it never resolves
 * to the bulk `Read all` button (a different control with a different scope).
 */
function columnToggle(label: string): HTMLElement {
	const btn = screen.getAllByRole('button').find((b) => (b.textContent ?? '').trim() === label);
	if (!btn) throw new Error(`no column toggle named ${label}`);
	return btn as HTMLElement;
}

/** The value span of a governance tile, read off its label's sibling. */
function tileValue(label: string): string {
	const labelEl = screen.getByText(label);
	return labelEl.previousElementSibling?.textContent?.trim() ?? '';
}

const filterInput = () => screen.getByPlaceholderText('Filter by collection') as HTMLInputElement;
const rowSave = (slug: string) => within(rowOf(slug)).getByRole('button', { name: /save/i }) as HTMLButtonElement;

beforeEach(() => {
	mockListRoles.mockReset().mockResolvedValue([ROLE_ADMIN, ROLE_EMPLOYEE]);
	mockListCollections.mockReset().mockResolvedValue([
		{ id: 'c1', name: 'Invoices', slug: 'invoices' },
		{ id: 'c2', name: 'Orders', slug: 'orders' },
		{ id: 'c3', name: 'Suppliers', slug: 'suppliers' },
	]);
	mockListModules.mockReset().mockResolvedValue([
		{ slug: 'sales', name: 'Sales', icon: 'x', version: '1' },
		{ slug: 'inventory', name: 'Inventory', icon: 'x', version: '1' },
	]);
	mockGetPerms
		.mockReset()
		.mockImplementation(((_token: string, roleId: string) =>
			Promise.resolve(roleId === 'r-admin' ? ADMIN_PERMS : EMPLOYEE_PERMS)) as never);
	mockSetPermission.mockReset().mockResolvedValue({} as never);
	mockUpdateRole.mockReset().mockResolvedValue({} as never);
	mockCreateRole.mockReset().mockResolvedValue({} as never);
});

afterEach(() => cleanup());

describe('RolesTab — the role rail', () => {
	it('lists every role and marks the selected one', async () => {
		await renderLoaded();

		expect(screen.getByRole('button', { name: /Administrator/ }).getAttribute('aria-current')).toBe('true');
		expect(screen.getByRole('button', { name: /Employee/ }).getAttribute('aria-current')).toBeNull();
	});

	it('re-seeds the matrix when another role is selected', async () => {
		await renderLoaded();
		expect(tileValue('Collections granted')).toBe('2 / 3');

		fireEvent.click(screen.getByRole('button', { name: /Employee/ }));

		await waitFor(() => expect(tileValue('Collections granted')).toBe('1 / 3'));
		expect(screen.getByRole('button', { name: /Employee/ }).getAttribute('aria-current')).toBe('true');
	});
});

describe('RolesTab — governance summary', () => {
	it('summarises the access as tiles derived from the engine flags', async () => {
		await renderLoaded();

		expect(tileValue('Collections granted')).toBe('2 / 3');
		expect(tileValue('Flag grants')).toBe('3');
		expect(tileValue('Row rules')).toBe('1');
		expect(tileValue('Field locks')).toBe('2');
		expect(tileValue('Apps open')).toBe('All'); // app_access null = every app
	});

	it('states each row\u2019s field whitelist / row rule in the Attributes & RLS column', async () => {
		await renderLoaded();

		expect(screen.getByText('2 fields restricted')).toBeTruthy();
		expect(screen.getByText('1 row rule')).toBeTruthy();
		expect(screen.getByText('1 field restricted')).toBeTruthy();
		// Every row carries a note here, so the fallback must be absent.
		expect(screen.queryByText('Unrestricted')).toBeNull();
	});
});

describe('RolesTab — bulk actions act on the rows on screen', () => {
	it('flips a column only across the FILTERED rows', async () => {
		await renderLoaded();

		fireEvent.change(filterInput(), { target: { value: 'orders' } });
		// One row on screen, Read fully on ⇒ the master toggle CLEARS it.
		expect(columnToggle('Read').getAttribute('title')).toContain('Clear');
		fireEvent.click(columnToggle('Read'));
		expect(checked(flagBox('orders', 'read'))).toBe('false');

		// Un-filter: the rows that were not on screen must be untouched.
		fireEvent.change(filterInput(), { target: { value: '' } });
		expect(checked(flagBox('suppliers', 'read'))).toBe('true');
		expect(checked(flagBox('orders', 'read'))).toBe('false');
	});

	it('clears every flag only on the FILTERED rows', async () => {
		await renderLoaded();

		fireEvent.change(filterInput(), { target: { value: 'suppliers' } });
		fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

		fireEvent.change(filterInput(), { target: { value: '' } });
		expect(checked(flagBox('suppliers', 'read'))).toBe('false');
		// The filtered-out row keeps its grant — the bulk op did not leak.
		expect(checked(flagBox('orders', 'read'))).toBe('true');
	});
});

describe('RolesTab — unsaved work is visible and only then savable', () => {
	it('shows "In sync" and a disabled per-row Save until that row is edited', async () => {
		await renderLoaded();

		expect(screen.getByText('In sync')).toBeTruthy();
		expect(screen.queryByText(/unsaved/)).toBeNull();
		expect(rowSave('orders').disabled).toBe(true);

		fireEvent.click(flagBox('orders', 'create'));

		expect(await screen.findByText('1 unsaved')).toBeTruthy();
		expect(screen.queryByText('In sync')).toBeNull();
		expect(rowSave('orders').disabled).toBe(false);
		// A different row's Save stays disabled — "dirty" is per row, not global.
		expect(rowSave('suppliers').disabled).toBe(true);
	});

	it('POSTs the FULL flag set of the edited row on save', async () => {
		await renderLoaded();

		fireEvent.click(flagBox('orders', 'create'));
		fireEvent.click(rowSave('orders'));

		await waitFor(() => expect(mockSetPermission).toHaveBeenCalledTimes(1));
		const [token, body] = mockSetPermission.mock.calls[0] as [string, Record<string, unknown>];
		expect(token).toBe('tk');
		expect(body).toMatchObject({
			role_id: 'r-admin',
			collection_slug: 'orders',
			can_read: true,
			can_write: true,
			can_create: true,
			can_delete: false,
			can_approve: false,
			can_submit: false,
			// The stored whitelist is forwarded verbatim (never widened / dropped).
			field_restrictions: ['name', 'qty'],
			row_filters: null,
		});
	});
});

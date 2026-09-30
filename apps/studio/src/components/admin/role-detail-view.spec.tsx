// @vitest-environment jsdom
/**
 * RoleDetailView — one role, two forms, driven through a real DOM.
 *
 * `mode="policy"` is the permission matrix (the IDP Access Policies page's form);
 * `mode="role"` is the profile (User Roles page, Studio Admin). `lib/role-matrix.spec.ts`
 * covers the pure derivations; this file covers the controls the operator clicks —
 * and the ONE rule that makes the matrix honest: a bulk/master action acts on
 * exactly the rows ON SCREEN, never the whole library. A "toggle all" that
 * silently reached the filtered-out rows would be the most dangerous bug this
 * surface can have.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/api', () => ({
	listRoles: vi.fn(),
	listUsers: vi.fn(),
	listCollections: vi.fn(),
	listModules: vi.fn(),
	getRolePermissions: vi.fn(),
	setPermission: vi.fn(),
	updateRole: vi.fn(),
	deleteRole: vi.fn(),
	createRole: vi.fn(),
}));

import {
	createRole,
	deleteRole,
	getRolePermissions,
	listCollections,
	listModules,
	listRoles,
	listUsers,
	setPermission,
	updateRole,
	type RolePermission,
	type RoleRecord,
} from '../../lib/api';
import { emptyPermission } from '../../lib/role-matrix';
import { RoleDetailView } from './role-detail-view';

const mockListRoles = vi.mocked(listRoles) as unknown as Mock;
const mockListUsers = vi.mocked(listUsers) as unknown as Mock;
const mockListCollections = vi.mocked(listCollections) as unknown as Mock;
const mockListModules = vi.mocked(listModules) as unknown as Mock;
const mockGetPerms = vi.mocked(getRolePermissions) as unknown as Mock;
const mockSetPermission = vi.mocked(setPermission) as unknown as Mock;
const mockUpdateRole = vi.mocked(updateRole) as unknown as Mock;
const mockDeleteRole = vi.mocked(deleteRole) as unknown as Mock;
const mockCreateRole = vi.mocked(createRole) as unknown as Mock;

/** Column order of the six flag checkboxes inside a row. */
const FLAG_INDEX = { read: 0, write: 1, create: 2, delete: 3, approve: 4, submit: 5 } as const;

const ROLE_ADMIN: RoleRecord = {
	id: 'r-admin',
	name: 'Administrator',
	description: 'Full access',
	is_system: true,
	app_access: null,
};
const ROLE_EMPLOYEE: RoleRecord = { id: 'r-emp', name: 'Employee', description: '', is_system: false, app_access: ['sales'] };
const NEW_ROLE: RoleRecord = { id: '', name: '', description: '', is_system: false, app_access: null };

const USERS = [
	{ id: 'u1', email: 'ada@mmbics.com', full_name: 'Ada Lovelace', role_id: 'r-admin', status: 'active' },
	{ id: 'u2', email: 'grace@mmbics.com', full_name: 'Grace Hopper', role_id: 'r-emp', status: 'active' },
	{ id: 'u3', email: 'alan@mmbics.com', full_name: 'Alan Turing', role_id: 'r-admin', status: 'active' },
];

/** A row's fields, layered over the engine's deny default. */
function perm(roleId: string, slug: string, over: Partial<RolePermission> = {}): RolePermission {
	return { ...emptyPermission(roleId, slug), id: `p-${slug}`, ...over };
}

/**
 * The Administrator's matrix — deliberately asymmetric so the per-row notes are
 * distinct AND one row carries a governance note with no flags:
 *   orders    read+write (2 flags) + a 2-field whitelist  → '2 fields restricted'
 *   suppliers read (1 flag)       + a 1-condition RLS     → '1 row rule'
 *   invoices  no flags            + a 1-field whitelist   → '1 field restricted'
 * The app registry beside it holds two apps, so the board has a row to leave out.
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

/** Render the view under one QueryClient; `rerenderAs` swaps the role (a remount, as the pages do via `key`). */
function renderView(
	role: RoleRecord,
	opts: {
		mode?: 'role' | 'policy';
		onCreated?: (id: string) => void;
		onOpenPermissions?: () => void;
		onDelete?: (id: string) => void;
		onBack?: () => void;
	} = {},
) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const wrap = (r: RoleRecord) => (
		<QueryClientProvider client={client}>
			<RoleDetailView
				key={r.id || 'new'}
				token="tk"
				role={r}
				mode={opts.mode ?? 'policy'}
				onBack={opts.onBack ?? vi.fn()}
				onDelete={opts.onDelete ?? vi.fn()}
				onCreated={opts.onCreated}
				onOpenPermissions={opts.onOpenPermissions}
			/>
		</QueryClientProvider>
	);
	const view = render(wrap(role));
	return { view, rerenderAs: (r: RoleRecord) => view.rerender(wrap(r)) };
}

/** Render in policy mode and wait for the matrix to land (the last slug is the signal). */
async function renderPolicy(role: RoleRecord = ROLE_ADMIN, opts?: Parameters<typeof renderView>[1]) {
	const handle = renderView(role, { mode: 'policy', ...opts });
	await screen.findByText('suppliers');
	return handle;
}

/** One collection's row. The slug cell's text is exactly the slug. */
function rowOf(slug: string): HTMLElement {
	const cell = screen.getByText(slug, { selector: 'td span' });
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

/** The one table's view switch — a ToggleGroup that starts on Collections. */
function viewSwitch(name: 'Collections' | 'Apps'): HTMLButtonElement {
	return screen.getByRole('button', { name }) as HTMLButtonElement;
}
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed');

const filterInput = () => screen.getByPlaceholderText('Filter by collection') as HTMLInputElement;
const appFilterInput = () => screen.getByPlaceholderText('Filter by app') as HTMLInputElement;

/**
 * Filter through the SHARED table's search box and wait for the table to settle.
 * The toolbar debounces the term it reports (300 ms), so the rows never change
 * synchronously — the caller names the row whose appearance or disappearance IS
 * the filter landing (the toolbar states no count to wait on).
 */
async function filterBy(input: HTMLInputElement, value: string, settle: () => void) {
	fireEvent.change(input, { target: { value } });
	await waitFor(settle);
}

/** The settle signals `filterBy` takes: a row leaving the table, or coming back. */
const rowGone = (slug: string) => () => expect(screen.queryByText(slug, { selector: 'td span' })).toBeNull();
const rowBack = (slug: string) => () => expect(screen.getByText(slug, { selector: 'td span' })).toBeTruthy();

/** The ONE Save — the form header's circular check, both modes. */
const saveButton = () => screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement;
/** The shared table toolbar a control belongs to. */
const toolbarOf = (el: HTMLElement) => el.closest('[data-slot="datatable-toolbar"]') as HTMLElement;

/** An app row, found by the module slug its `app_access` entry holds. */
function appRow(id: string): HTMLElement {
	const row = screen.getByText(id).closest('tr');
	if (!row) throw new Error(`no app row for ${id}`);
	return row as HTMLElement;
}
const appBox = (id: string) => within(appRow(id)).getByRole('checkbox') as HTMLElement;
/** The Open column's master toggle (the boards' counterpart of a flag toggle). */
const openToggle = () => columnToggle('Open');

beforeEach(() => {
	mockListRoles.mockReset().mockResolvedValue([ROLE_ADMIN, ROLE_EMPLOYEE]);
	mockListUsers.mockReset().mockResolvedValue(USERS);
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
	mockDeleteRole.mockReset().mockResolvedValue({ id: 'r-emp', deleted: true } as never);
	mockCreateRole
		.mockReset()
		.mockResolvedValue({ id: 'r-new', name: 'Storekeeper', description: '', is_system: false, app_access: null } as never);
});

afterEach(() => cleanup());

describe('RoleDetailView — the permissions table states each row\u2019s governance', () => {
	it('names every row\u2019s field whitelist / row rule in the Attributes & RLS column', async () => {
		await renderPolicy();

		expect(screen.getByText('2 fields restricted')).toBeTruthy();
		expect(screen.getByText('1 row rule')).toBeTruthy();
		expect(screen.getByText('1 field restricted')).toBeTruthy();
		// Every row carries a note here, so the fallback must be absent.
		expect(screen.queryByText('Unrestricted')).toBeNull();
	});
});

describe('RoleDetailView — bulk actions act on the rows on screen', () => {
	it('flips a column only across the FILTERED rows', async () => {
		await renderPolicy();

		await filterBy(filterInput(), 'orders', rowGone('suppliers'));
		// One row on screen, Read fully on ⇒ the master toggle CLEARS it.
		expect(columnToggle('Read').getAttribute('title')).toContain('Clear');
		fireEvent.click(columnToggle('Read'));
		expect(checked(flagBox('orders', 'read'))).toBe('false');

		// Un-filter: the rows that were not on screen must be untouched.
		await filterBy(filterInput(), '', rowBack('suppliers'));
		expect(checked(flagBox('suppliers', 'read'))).toBe('true');
		expect(checked(flagBox('orders', 'read'))).toBe('false');
	});

	it('clears every flag only on the FILTERED rows', async () => {
		await renderPolicy();

		await filterBy(filterInput(), 'suppliers', rowGone('orders'));
		fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

		await filterBy(filterInput(), '', rowBack('orders'));
		expect(checked(flagBox('suppliers', 'read'))).toBe('false');
		// The filtered-out row keeps its grant — the bulk op did not leak.
		expect(checked(flagBox('orders', 'read'))).toBe('true');
	});
});

describe('RoleDetailView — unsaved work is visible and only then savable', () => {
	it('marks unsaved work in the toolbar, and only then wakes the ONE Save', async () => {
		await renderPolicy();

		// Being in sync spends no ink — the mark and the Save's wake-up appear only
		// while something IS unsaved.
		expect(screen.queryByText(/unsaved/)).toBeNull();
		expect(saveButton().disabled).toBe(true);

		fireEvent.click(flagBox('orders', 'create'));

		const mark = await screen.findByText('1 unsaved');
		// It lives where the edits that raised it live — the matrix toolbar — while
		// the ONE Save rides the form's header.
		expect(mark.closest('[data-slot="datatable-toolbar"]')).toBeTruthy();
		expect(saveButton().disabled).toBe(false);
		// No per-row Save: the toolbar owns the write.
		expect(within(rowOf('orders')).queryByRole('button', { name: /save/i })).toBeNull();
	});

	it('POSTs the FULL flag set of the edited row on save', async () => {
		await renderPolicy();

		fireEvent.click(flagBox('orders', 'create'));
		fireEvent.click(saveButton());

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
		// An untouched row is never rewritten — only the dirty diff is sent.
		expect(mockSetPermission).toHaveBeenCalledTimes(1);
	});

	it('writes EVERY pending change at once — dirty rows and the board in one Save', async () => {
		await renderPolicy();

		// Two independent halves, edited from the two views …
		fireEvent.click(flagBox('orders', 'create'));
		fireEvent.click(viewSwitch('Apps'));
		await screen.findByText('Sales');
		fireEvent.click(appBox('inventory'));

		expect(await screen.findByText('2 unsaved')).toBeTruthy();

		// … and written by the ONE Save, wherever it is clicked from.
		fireEvent.click(saveButton());
		await waitFor(() => expect(mockSetPermission).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(mockUpdateRole).toHaveBeenCalledTimes(1));

		const [, body] = mockSetPermission.mock.calls[0] as [string, Record<string, unknown>];
		expect(body).toMatchObject({ collection_slug: 'orders', can_read: true, can_write: true, can_create: true });
		const [, roleId, patch] = mockUpdateRole.mock.calls[0] as [string, string, Record<string, unknown>];
		expect(roleId).toBe('r-admin');
		expect(patch.app_access).toEqual(['sales']);
		// The status line names BOTH halves it wrote.
		expect(await screen.findByText('Saved 1 collection row + the app board.')).toBeTruthy();
	});

	it('reports a row that fails instead of hiding it behind the ones that saved', async () => {
		mockSetPermission.mockRejectedValueOnce(new Error('row locked') as never);
		await renderPolicy();

		fireEvent.click(flagBox('orders', 'create'));
		fireEvent.click(flagBox('suppliers', 'write'));
		fireEvent.click(saveButton());

		// One row failed, the other still went — and the line says so.
		await waitFor(() => expect(mockSetPermission).toHaveBeenCalledTimes(2));
		expect(await screen.findByText(/Saved 1 collection row\. 1 failed: orders\./)).toBeTruthy();
	});
});

describe('RoleDetailView — one table, two views (Collections | Apps)', () => {
	/** Render, then switch the table to the app board. */
	async function renderApps(role: RoleRecord = ROLE_ADMIN) {
		await renderPolicy(role);
		fireEvent.click(viewSwitch('Apps'));
		await screen.findByText('Sales');
	}

	it('defaults to Collections and swaps the table in place', async () => {
		await renderPolicy();

		expect(pressed(viewSwitch('Collections'))).toBe('true');
		expect(pressed(viewSwitch('Apps'))).toBe('false');
		// The collections table is up: its flag masters and rows are there …
		expect(columnToggle('Read')).toBeTruthy();
		expect(screen.queryByText('Sales')).toBeNull();

		fireEvent.click(viewSwitch('Apps'));

		// … and the SAME table area now holds the app board in that same shape.
		expect(pressed(viewSwitch('Apps'))).toBe('true');
		expect(pressed(viewSwitch('Collections'))).toBe('false');
		expect(appRow('sales')).toBeTruthy();
		expect(appRow('inventory')).toBeTruthy();
		expect(openToggle()).toBeTruthy();
		expect(screen.queryByText('suppliers')).toBeNull();
		expect(screen.queryByPlaceholderText('Filter by collection')).toBeNull();
	});

	it('states what an empty catalog means for the board', async () => {
		mockListModules.mockResolvedValue([]);
		await renderPolicy();

		fireEvent.click(viewSwitch('Apps'));

		// This deployment really has no apps — the board says so instead of rendering
		// an indistinguishable empty table.
		expect(await screen.findByText('This deployment has no apps.')).toBeTruthy();
	});

	it('reads the unrestricted board (`null`) as every app open', async () => {
		await renderApps();

		// Administrator: `app_access: null` ⇒ every app, including ones added later.
		expect(checked(appBox('sales'))).toBe('true');
		expect(checked(appBox('inventory'))).toBe('true');
		// In sync — the board already matches what is persisted.
		expect(saveButton().disabled).toBe(true);
	});

	it('materialises the explicit list the moment one app is left out', async () => {
		await renderApps();

		fireEvent.click(appBox('inventory'));

		expect(checked(appBox('inventory'))).toBe('false');
		expect(checked(appBox('sales'))).toBe('true');
		// The board is ONE role field, saved whole: the mark counts it as one pending
		// change, and only then does the toolbar's Save wake up.
		expect(await screen.findByText('1 unsaved')).toBeTruthy();
		expect(saveButton().disabled).toBe(false);

		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateRole).toHaveBeenCalledTimes(1));
		const [token, roleId, patch] = mockUpdateRole.mock.calls[0] as [string, string, Record<string, unknown>];
		expect(token).toBe('tk');
		expect(roleId).toBe('r-admin');
		// Leaving the unrestricted board writes the rest EXPLICITLY — the app that
		// stayed ticked never keeps riding on the "every app" default.
		expect(patch.app_access).toEqual(['sales']);
		expect(await screen.findByText('Saved the app board.')).toBeTruthy();
	});

	it('opens exactly the apps on screen, and never claims "every app" from behind a filter', async () => {
		await renderApps(ROLE_EMPLOYEE);

		// Employee: `['sales']` — inventory is closed.
		expect(checked(appBox('sales'))).toBe('true');
		expect(checked(appBox('inventory'))).toBe('false');

		await filterBy(appFilterInput(), 'inventory', rowGone('sales'));
		fireEvent.click(openToggle());

		// Every row on screen is open; the filtered-out row kept its own state.
		expect(checked(appBox('inventory'))).toBe('true');
		await filterBy(appFilterInput(), '', rowBack('sales'));
		expect(checked(appBox('sales'))).toBe('true');

		fireEvent.click(saveButton());
		await waitFor(() => expect(mockUpdateRole).toHaveBeenCalledTimes(1));
		const [, , patch] = mockUpdateRole.mock.calls[0] as [string, string, Record<string, unknown>];
		// "All shown" is not "all" — behind a filter the board is the explicit union.
		expect(patch.app_access).toEqual(['sales', 'inventory']);
	});

	it('opens the unrestricted board when every app on screen is opened, unfiltered', async () => {
		await renderApps(ROLE_EMPLOYEE);

		fireEvent.click(openToggle());

		// Unfiltered, "every app on screen" IS the board that also covers apps added later.
		expect(await screen.findByText('1 unsaved')).toBeTruthy();
		expect(saveButton().disabled).toBe(false);

		fireEvent.click(saveButton());
		await waitFor(() => expect(mockUpdateRole).toHaveBeenCalledTimes(1));
		const [, , patch] = mockUpdateRole.mock.calls[0] as [string, string, Record<string, unknown>];
		expect(patch.app_access).toBeNull();
	});

	it('re-seeds the matrix when the host re-points the view at another role', async () => {
		const handle = await renderPolicy();
		expect(checked(flagBox('suppliers', 'read'))).toBe('true');

		// The pages swap roles by remounting with a new key (the URL changed) — the
		// very same grid must now read the Employee's grants.
		handle.rerenderAs(ROLE_EMPLOYEE);
		await waitFor(() => expect(checked(flagBox('suppliers', 'read'))).toBe('false'));
		expect(checked(flagBox('orders', 'read'))).toBe('true');
	});
});

describe('RoleDetailView — the policy form IS the table (no identity fields above it)', () => {
	it('keeps the view switch and the bulk ops in the toolbar — the ONE Save rides the header', async () => {
		await renderPolicy();

		// Nothing above the table: no name field, no description editor — the
		// identity half belongs to the role profile.
		expect(screen.queryByPlaceholderText('e.g. Storekeeper')).toBeNull();
		expect(screen.queryByPlaceholderText('A description of this role...')).toBeNull();

		// The controls the editor has share the table's toolbar row with the search box.
		const collectionsToolbar = toolbarOf(viewSwitch('Collections'));
		expect(collectionsToolbar).toBeTruthy();
		expect(within(collectionsToolbar).getByRole('button', { name: 'Read all' })).toBeTruthy();
		expect(within(collectionsToolbar).getByPlaceholderText('Filter by collection')).toBeTruthy();
		// No count statement in the toolbar — the rows on screen are the count.
		expect(screen.queryByText(/\d+ collections/)).toBeNull();

		// The ONE Save is the header's circular check — never a toolbar button
		// (Directus puts it in the form header too).
		expect(within(collectionsToolbar).queryByRole('button', { name: /^Save$/ })).toBeNull();
		expect(toolbarOf(saveButton())).toBeNull();

		// The SAME header Save serves the app view: one action for both halves.
		fireEvent.click(viewSwitch('Apps'));
		await screen.findByText('Sales');
		const appToolbar = toolbarOf(viewSwitch('Apps'));
		expect(within(appToolbar).queryByRole('button', { name: /^Save$/ })).toBeNull();
		expect(within(appToolbar).getByPlaceholderText('Filter by app')).toBeTruthy();
		expect(toolbarOf(saveButton())).toBeNull();
	});

	it('renders the view switch as ICONS — the name rides aria-label + title', async () => {
		await renderPolicy();

		const cases = [
			['Collections', 'Per-collection flags'],
			['Apps', 'Which apps this role opens'],
		] as const;
		for (const [name, title] of cases) {
			const btn = viewSwitch(name);
			expect(btn.querySelector('svg')).toBeTruthy();
			expect(btn.textContent).toBe(''); // no visible label
			expect(btn.getAttribute('title')).toBe(title); // the tooltip
		}
	});

	it('names the policy and whom it binds in the header — the one thing the matrix cannot say', async () => {
		await renderPolicy(ROLE_ADMIN);

		// The header IS this form's naming: the bare policy name (no " Role"
		// suffix — that title belongs to the role profile) + its member count.
		expect(screen.getByText('Administrator')).toBeTruthy();
		expect(screen.queryByText('Administrator Role')).toBeNull();
		expect(screen.getByText('Applies to 2 users.')).toBeTruthy();
	});
});

describe('RoleDetailView — the role profile (role mode)', () => {
	it('states the role\u2019s identity — the NAME frozen only on a SYSTEM role, the description always editable', async () => {
		renderView(ROLE_ADMIN, { mode: 'role' });

		// The page says which record it is on, the way Directus titles a role page.
		expect(await screen.findByText('Administrator Role')).toBeTruthy();

		const nameInput = (await screen.findByPlaceholderText('e.g. Storekeeper')) as HTMLInputElement;
		expect(nameInput.value).toBe('Administrator');
		// A system role cannot be renamed (the server refuses it), so its field
		// stays frozen — with the reason stated.
		expect(nameInput.disabled).toBe(true);
		expect(screen.getByText('System roles cannot be renamed.')).toBeTruthy();
		expect(screen.getByPlaceholderText('A description of this role...')).toBeTruthy();
		// Directus's Role Icon / Parent Role are NOT modelled by `_roles` — the form
		// must not render a picker that cannot write (a dead control is a lie).
		expect(screen.queryByText('Role Icon')).toBeNull();
		expect(screen.queryByText('Parent Role')).toBeNull();
		// The matrix is the OTHER form — none of it is here.
		expect(screen.queryByPlaceholderText('Filter by collection')).toBeNull();
		expect(screen.queryByText(/unsaved/)).toBeNull();

		// A plain role IS renamable — the API cascades the rename onto the
		// directory — so its name field is live and states no such note.
		cleanup();
		renderView(ROLE_EMPLOYEE, { mode: 'role' });
		const editable = (await screen.findByPlaceholderText('e.g. Storekeeper')) as HTMLInputElement;
		expect(editable.value).toBe('Employee');
		expect(editable.disabled).toBe(false);
		expect(screen.queryByText('System roles cannot be renamed.')).toBeNull();
	});

	it('lists the users who hold the role, and hides Delete on a system role', async () => {
		renderView(ROLE_ADMIN, { mode: 'role' });

		// The list is a two-column table: the headers name the values …
		expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
		expect(screen.getByText('ada@mmbics.com')).toBeTruthy();
		expect(screen.getByText('Name')).toBeTruthy();
		expect(screen.getByText('Email')).toBeTruthy();
		// … and every row shares the header's grid, so the columns cannot misalign.
		const headerGrid = (screen.getByText('Name').parentElement as HTMLElement).style.gridTemplateColumns;
		expect(headerGrid).not.toBe('');
		expect((screen.getByText('Ada Lovelace').parentElement as HTMLElement).style.gridTemplateColumns).toBe(headerGrid);
		// Grace holds the Employee role — she is not in this list.
		expect(screen.queryByText('Grace Hopper')).toBeNull();
		expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();

		cleanup();
		renderView(ROLE_EMPLOYEE, { mode: 'role' });
		expect(await screen.findByText('Grace Hopper')).toBeTruthy();
		expect(screen.getByRole('button', { name: /Delete/ })).toBeTruthy();
	});

	it('leaves the form through the header ✕ — icon-only, the name on aria-label', async () => {
		const onBack = vi.fn();
		renderView(ROLE_ADMIN, { mode: 'role', onBack });

		const close = screen.getByRole('button', { name: 'Close' });
		// Directus's circular controls carry no text — the name rides aria-label.
		expect(close.textContent).toBe('');
		expect(close.className).toContain('rounded-full');
		fireEvent.click(close);
		expect(onBack).toHaveBeenCalledTimes(1);

		// The Save is that same shape: a circular icon-only check.
		const save = screen.getByRole('button', { name: 'Save' });
		expect(save.textContent).toBe('');
		expect(save.className).toContain('rounded-full');
	});

	it('wakes the Save only when the description changes — and writes exactly that', async () => {
		renderView(ROLE_ADMIN, { mode: 'role' });

		// An untouched profile has nothing to write.
		expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(screen.getByPlaceholderText('A description of this role...'), { target: { value: 'Everything, everywhere' } });
		const save = screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement;
		expect(save.disabled).toBe(false);

		fireEvent.click(save);
		await waitFor(() => expect(mockUpdateRole).toHaveBeenCalledTimes(1));
		// Only the changed field travels — an identical re-send would touch
		// `updated_at`, which every cached authz lookup keys off.
		expect(mockUpdateRole).toHaveBeenCalledWith('tk', 'r-admin', { description: 'Everything, everywhere' });
		expect(await screen.findByText('Saved the role profile.')).toBeTruthy();
	});

	it('sends a rename as just the name, and says the directory followed', async () => {
		renderView(ROLE_EMPLOYEE, { mode: 'role' });

		const nameInput = (await screen.findByPlaceholderText('e.g. Storekeeper')) as HTMLInputElement;
		expect(saveButton().disabled).toBe(true);
		fireEvent.change(nameInput, { target: { value: 'Store Keeper' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateRole).toHaveBeenCalledWith('tk', 'r-emp', { name: 'Store Keeper' }));
		expect(await screen.findByText('Role renamed to \u201cStore Keeper\u201d.')).toBeTruthy();
	});

	it('deletes a non-system role behind the confirm, and hands the id back', async () => {
		const onDelete = vi.fn();
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		renderView(ROLE_EMPLOYEE, { mode: 'role', onDelete });

		fireEvent.click(await screen.findByRole('button', { name: /Delete/ }));
		await waitFor(() => expect(mockDeleteRole).toHaveBeenCalledWith('tk', 'r-emp'));
		expect(onDelete).toHaveBeenCalledWith('r-emp');
		expect(confirmSpy).toHaveBeenCalledTimes(1);

		confirmSpy.mockRestore();
	});

	it('creates a new role from the blank profile and reports its id', async () => {
		const onCreated = vi.fn();
		renderView(NEW_ROLE, { mode: 'role', onCreated });

		// A new role IS nameable — and nameless, there is nothing to save.
		expect(screen.getByText('New role')).toBeTruthy();
		const nameInput = screen.getByPlaceholderText('e.g. Storekeeper') as HTMLInputElement;
		expect(nameInput.disabled).toBe(false);
		expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(nameInput, { target: { value: 'Storekeeper' } });
		fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

		await waitFor(() =>
			expect(mockCreateRole).toHaveBeenCalledWith('tk', { name: 'Storekeeper', description: undefined, app_access: null }),
		);
		await waitFor(() => expect(onCreated).toHaveBeenCalledWith('r-new'));
	});

	it('offers the route into the permission editor only when the host wires one', async () => {
		cleanup();
		renderView(ROLE_ADMIN, { mode: 'role' });
		// Studio Admin has no policy page — no dead link.
		expect(screen.queryByRole('button', { name: /Collection flags/ })).toBeNull();

		cleanup();
		const onOpenPermissions = vi.fn();
		renderView(ROLE_ADMIN, { mode: 'role', onOpenPermissions });

		const link = await screen.findByRole('button', { name: /Collection flags/ });
		fireEvent.click(link);
		expect(onOpenPermissions).toHaveBeenCalledTimes(1);
	});
});

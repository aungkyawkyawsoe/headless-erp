// @vitest-environment jsdom
/**
 * RolesTab — Studio Admin's role registry, list → detail.
 *
 * The tab renders the roles table FIRST (the registry is the page) and opens a
 * role's profile form on a row click, the same shape the IDP portal's User Roles
 * page uses. The role-matrix behaviours (bulk ops, dirty gating, the board) live
 * in `role-detail-view.spec.tsx`, driven through `mode="policy"` — this file only
 * pins what Studio Admin's mount decides: table first, profile on click, and NO
 * matrix anywhere in the tab (permissions are the portal's Access Policies page).
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
	createRole: vi.fn(),
}));

import {
	createRole,
	getRolePermissions,
	listCollections,
	listModules,
	listRoles,
	listUsers,
	setPermission,
	updateRole,
	type RoleRecord,
} from '../../lib/api';
import { RolesTab } from './roles-tab';

const mockListRoles = vi.mocked(listRoles) as unknown as Mock;
const mockListUsers = vi.mocked(listUsers) as unknown as Mock;
const mockListCollections = vi.mocked(listCollections) as unknown as Mock;
const mockListModules = vi.mocked(listModules) as unknown as Mock;
const mockGetPerms = vi.mocked(getRolePermissions) as unknown as Mock;
const mockSetPermission = vi.mocked(setPermission) as unknown as Mock;
const mockUpdateRole = vi.mocked(updateRole) as unknown as Mock;
const mockCreateRole = vi.mocked(createRole) as unknown as Mock;

const ROLE_ADMIN: RoleRecord = { id: 'r-admin', name: 'Administrator', description: 'Full access', is_system: true, app_access: null };
const ROLE_EMPLOYEE: RoleRecord = { id: 'r-emp', name: 'Employee', description: 'Day to day', is_system: false, app_access: ['sales'] };

const USERS = [
	{ id: 'u1', email: 'ada@mmbics.com', full_name: 'Ada Lovelace', role_id: 'r-admin', status: 'active' },
	{ id: 'u2', email: 'grace@mmbics.com', full_name: 'Grace Hopper', role_id: 'r-emp', status: 'active' },
];

function renderTab() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<RolesTab token="tk" />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	mockListRoles.mockReset().mockResolvedValue([ROLE_ADMIN, ROLE_EMPLOYEE]);
	mockListUsers.mockReset().mockResolvedValue(USERS);
	mockListCollections.mockReset().mockResolvedValue([]);
	mockListModules.mockReset().mockResolvedValue([]);
	mockGetPerms.mockReset().mockResolvedValue([] as never);
	mockSetPermission.mockReset().mockResolvedValue({} as never);
	mockUpdateRole.mockReset().mockResolvedValue({} as never);
	mockCreateRole
		.mockReset()
		.mockResolvedValue({ id: 'r-new', name: 'Storekeeper', description: '', is_system: false, app_access: null } as never);
});

afterEach(() => cleanup());

describe('RolesTab — the registry, then the profile', () => {
	it('renders the table first; a row click opens that role\u2019s profile', async () => {
		renderTab();
		await screen.findByText('Administrator');

		// The table IS the page — no profile chrome is up before a pick.
		expect(screen.queryByText('Users in Role')).toBeNull();
		expect(screen.queryByPlaceholderText('e.g. Storekeeper')).toBeNull();

		fireEvent.click(screen.getByText('Administrator').closest('tr') as HTMLElement);

		// The profile: the identity half, stated rather than editable …
		expect(await screen.findByText('Users in Role')).toBeTruthy();
		const nameInput = screen.getByPlaceholderText('e.g. Storekeeper') as HTMLInputElement;
		expect(nameInput.value).toBe('Administrator');
		expect(nameInput.disabled).toBe(true);
		// … with the users who hold the role, from the one users read.
		expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
		expect(screen.queryByText('Grace Hopper')).toBeNull();
		// … and NO matrix: permissions are the portal's Access Policies page.
		expect(screen.queryByPlaceholderText('Filter by collection')).toBeNull();

		// The header's ✕ leaves the form — back to the registry.
		fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		expect(await screen.findByText('Employee')).toBeTruthy();
	});

	it('creates a role from the toolbar action and returns to the registry', async () => {
		renderTab();
		await screen.findByText('Administrator');

		fireEvent.click(screen.getByRole('button', { name: 'New role' }));

		// The blank profile: the name is the one required thing, and it IS editable.
		const nameInput = (await screen.findByPlaceholderText('e.g. Storekeeper')) as HTMLInputElement;
		expect(nameInput.disabled).toBe(false);
		expect((screen.getByRole('button', { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(nameInput, { target: { value: 'Storekeeper' } });
		fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));

		await waitFor(() =>
			expect(mockCreateRole).toHaveBeenCalledWith('tk', { name: 'Storekeeper', description: undefined, app_access: null }),
		);
		// The tab hands the registry back — the fresh role appears once the list re-reads.
		expect(await screen.findByText('Employee')).toBeTruthy();
	});
});

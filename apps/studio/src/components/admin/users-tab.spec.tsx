// @vitest-environment jsdom
/**
 * UsersTab — the `_users` registry, driven through a real DOM.
 *
 * The pure derivation is covered by `lib/users.spec.ts`; this file covers the
 * part that spec cannot: which controls a row actually OFFERS. Two guarantees
 * matter most and are pinned here —
 *
 *   1. an edit writes only what changed (an identical re-send would touch
 *      `updated_at`, which every authz lookup keys off, evicting permission
 *      caches for a no-op), and
 *   2. a Telegram-provisioned row offers no password control and no writable
 *      role, because the login route re-syncs those from the employee directory
 *      on every sign-in — a control there would silently not stick.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/api', () => ({
	listUsers: vi.fn(),
	listRoles: vi.fn(),
	listItems: vi.fn(),
	getServerMeta: vi.fn(),
	createUser: vi.fn(),
	updateUser: vi.fn(),
}));

import { createUser, getServerMeta, listItems, listRoles, listUsers, updateUser } from '../../lib/api';
import { UsersTab } from './users-tab';

const mockListUsers = vi.mocked(listUsers) as unknown as Mock;
const mockListRoles = vi.mocked(listRoles) as unknown as Mock;
const mockListItems = vi.mocked(listItems) as unknown as Mock;
const mockGetServerMeta = vi.mocked(getServerMeta) as unknown as Mock;
const mockCreateUser = vi.mocked(createUser) as unknown as Mock;
const mockUpdateUser = vi.mocked(updateUser) as unknown as Mock;

const ROLE_ADMIN = { id: 'r-admin', name: 'Administrator' };
const ROLE_EMPLOYEE = { id: 'r-emp', name: 'Employee' };
const ROLE_STORE = { id: 'r-store', name: 'Storekeeper' };

/** The bootstrap-admin shape — this is the row the tests treat as "you". */
const ADMIN_ROW = {
	id: 'u-admin',
	email: 'dev@mmbics.com',
	full_name: 'Administrator',
	role_id: 'r-admin',
	status: 'active' as const,
	last_login: '2026-09-01T10:00:00.000Z',
	created_at: '2026-08-01 09:00:00',
};
/** Telegram-provisioned: `findOrCreateUser`'s exact email marker, never signed in. */
const TELEGRAM_ROW = {
	id: 'u-tg',
	email: 'tg-42@telegram.local',
	full_name: 'Aung Kyaw',
	role_id: 'r-emp',
	status: 'active' as const,
	last_login: null,
	created_at: '2026-08-02 09:00:00',
};
/** A password account that has been suspended, LINKED to an employee. */
const STORE_ROW = {
	id: 'u-store',
	email: 'store@mmbics.com',
	full_name: 'Mya Mya',
	role_id: 'r-store',
	status: 'suspended' as const,
	employee_id: 'e-store',
	last_login: '2026-08-20 03:15:00',
	created_at: '2026-08-03 09:00:00',
};
/** An account lined up but not yet usable — no credential exists for it. */
const INVITED_ROW = {
	id: 'u-inv',
	email: 'invited@mmbics.com',
	full_name: 'Nu Nu',
	role_id: 'r-emp',
	status: 'invited' as const,
	employee_id: null,
	last_login: null,
	created_at: '2026-08-04 09:00:00',
};
/** The bootstrap admin — no employee link at all (a legitimate state). */
const ADMIN_ROW_UNLINKED = { ...ADMIN_ROW, employee_id: null };

/**
 * The employee directory. Deliberately named differently from every ACCOUNT
 * (Burmese here, and a distinct set of names) so a column cell can never be
 * confused with the account name in the same row.
 */
interface SpecEmployee {
	id: string;
	name_mm?: string | null;
	name_en?: string | null;
	etg_id?: string | null;
}
const EMP_STORE: SpecEmployee = { id: 'e-store', name_mm: 'မမြး', name_en: 'Mya Mya' };
const EMP_TG: SpecEmployee = { id: 'e-aung', name_mm: 'အောင်ကျော်', name_en: 'Aung Kyaw', etg_id: '42' };
/** On the roster, no account yet — it must still be findable and selectable. */
const EMP_SPARE: SpecEmployee = { id: 'e-spare', name_mm: null, name_en: 'Zaw Zaw', etg_id: null };
const EMPLOYEES: SpecEmployee[] = [EMP_STORE, EMP_TG, EMP_SPARE];

/** The view is URL state — show what the router sees after each pick. */
function LocationProbe() {
	const { search } = useLocation();
	return <span data-testid="url">{search}</span>;
}

/**
 * Render the tab under a Router — required now that the directory's view is
 * URL-backed (`?view=`). The DEFAULT entry is `?view=all`, so every test that
 * spans the fixture's accounts (the suspended Storekeeper included) sees them;
 * the view tests below pass their own entry, and one pins the bare-URL landing.
 */
function renderTab(currentEmail?: string, entry = '/idp/users?view=all', viewsInToolbar = false) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[entry]}>
				<UsersTab token="tk" currentEmail={currentEmail} viewsInToolbar={viewsInToolbar} />
				<LocationProbe />
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

/** Wait for the users read to land (the last row to render is the signal). */
async function renderLoaded(currentEmail?: string) {
	const view = renderTab(currentEmail);
	await screen.findByText('Mya Mya');
	return view;
}

/** The controls of one account's row, scoped so a shared label cannot leak in. */
function rowOf(name: string): HTMLElement {
	const cell = screen.getByText(name);
	const row = cell.closest('tr');
	if (!row) throw new Error(`no row for ${name}`);
	return row;
}

/** Open one account's editor. It is a full-surface REGION rather than a modal
 *  dialog: the list is unmounted while it is open, so there is no overlay and no
 *  second surface behind it. */
function openEdit(email: string) {
	fireEvent.click(screen.getByRole('button', { name: `Edit ${email}` }));
	return screen.getByRole('region', { name: /edit user/i });
}

const textbox = (name: string) => screen.getByLabelText(name) as HTMLInputElement;

/** Type into the shared table's toolbar search box. It DEBOUNCES the term (300 ms)
 *  before the caller's predicate sees it, so the caller must await the row set. */
function searchUsers(value: string) {
	fireEvent.change(textbox('Search users'), { target: { value } });
}
const roleSelect = () => screen.getByLabelText('Role') as HTMLSelectElement;
/** The employee link is a SEARCHABLE picker (a Combobox, not a `<select>`). */
const employeeInput = () => screen.getByLabelText('Employee') as HTMLInputElement;
/** Every `search=` term the tab actually asked the directory for. The two bounded
 *  link lookups carry no `search`, so a term here means the PICKER ran. */
const searchedTerms = () =>
	mockListItems.mock.calls
		.map((call) => (call[2] as { search?: string } | undefined)?.search)
		.filter((term): term is string => typeof term === 'string');
/** Let a debounce elapse so its (absent) effect can be asserted — a disabled query
 *  never runs its fetch, so "no read" is only provable by waiting it out. */
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Open the picker's popup. base-ui opens a Combobox on POINTER DOWN over the
 *  input — a bare synthetic `click` leaves it closed. */
function openEmployeePicker(): HTMLInputElement {
	const input = employeeInput();
	fireEvent.focus(input);
	fireEvent.mouseDown(input);
	return input;
}

/** The picker's popup, so a query is scoped to it: the dialog's Role `<select>`
 *  puts native `<option>`s on the same page, and those answer `role=option` too. */
const employeeListbox = () => within(screen.getByRole('listbox'));

/** Select an option. base-ui commits a selection on the up + click pair, so a
 *  lone synthetic `click` does not. */
function clickOption(el: HTMLElement): void {
	fireEvent.mouseDown(el);
	fireEvent.mouseUp(el);
	fireEvent.click(el);
}

/** Open an option from the picker's popup and select it. A searched option only
 *  arrives a debounce (300 ms) after the term is typed, hence the generous
 *  `findByRole` timeout — the whole point of the debounce. */
async function pickEmployee(term: string, option: RegExp): Promise<void> {
	const input = openEmployeePicker();
	if (term) fireEvent.change(input, { target: { value: term } });
	clickOption(await screen.findByRole('option', { name: option }, { timeout: 2000 }));
}
/** The ONE Save — the form header's circular ✓, icon-only (the role form's own
 *  shape), so it is found by its aria-label rather than by text. */
const saveButton = () => screen.getByRole('button', { name: 'Save' });
/** …and the ✕ beside it, the only way out of the whole-surface form. */
const closeButton = () => screen.getByRole('button', { name: 'Close' });
/** The lifecycle control — a real `<select>` (the Directus shape), so its state
 *  is read off `.value` and `.disabled`, not an aria attribute. */
const statusSelect = () => screen.getByLabelText('Status') as HTMLSelectElement;

/**
 * The directory read the tab makes, dispatched on the params it was called with —
 * there are three shapes now, and a single blanket `mockResolvedValue` would let a
 * broken query pass CI (a test that hands `listItems` one answer for three
 * different questions proves nothing about any of them):
 *
 *   filter[id][_in]     — the password accounts' employees (one bounded lookup)
 *   filter[etg_id][_in] — the Telegram accounts' employees (the other)
 *   search=             — the picker's own term
 */
function employeeRead(
	_token: string,
	_slug: string,
	params?: { filters?: Record<string, { value?: string }>; search?: string },
): { rows: typeof EMPLOYEES; meta: { limit: number; has_more: boolean } } {
	const meta = { limit: 500, has_more: false };
	const filters = params?.filters ?? {};
	if (filters.id?.value !== undefined) {
		const ids = String(filters.id.value).split(',');
		return { rows: EMPLOYEES.filter((e) => ids.includes(e.id)), meta };
	}
	if (filters.etg_id?.value !== undefined) {
		const tgIds = String(filters.etg_id.value).split(',');
		return { rows: EMPLOYEES.filter((e) => e.etg_id != null && tgIds.includes(String(e.etg_id))), meta };
	}
	// The picker's search — the engine's `?search=` matches the row's text columns,
	// so both names are in scope (the label prefers `name_mm`).
	const term = (params?.search ?? '').trim().toLowerCase();
	return {
		rows: term ? EMPLOYEES.filter((e) => `${e.name_mm ?? ''} ${e.name_en ?? ''}`.toLowerCase().includes(term)) : [],
		meta,
	};
}

beforeEach(() => {
	mockListUsers.mockReset();
	mockListRoles.mockReset();
	mockListItems.mockReset();
	mockGetServerMeta.mockReset();
	mockCreateUser.mockReset();
	mockUpdateUser.mockReset();
	mockListUsers.mockResolvedValue([ADMIN_ROW_UNLINKED, TELEGRAM_ROW, STORE_ROW]);
	mockListRoles.mockResolvedValue([ROLE_ADMIN, ROLE_EMPLOYEE, ROLE_STORE]);
	mockListItems.mockImplementation(employeeRead);
	mockGetServerMeta.mockResolvedValue({
		platform: 'mmbix-headless',
		version: '0.0.0',
		identity: { directory_collection: 'directory', directory_field: 'etg_id' },
	});
	mockCreateUser.mockResolvedValue({ id: 'u-new', email: 'new@mmbics.com', full_name: 'New Person' });
	mockUpdateUser.mockResolvedValue({ ...STORE_ROW, status: 'active' });
});

afterEach(() => cleanup());

describe('UsersTab — the table', () => {
	it('states how each account signs in, its role and its state', async () => {
		await renderLoaded();

		const telegram = within(rowOf('Aung Kyaw'));
		expect(telegram.getByText('Telegram')).toBeTruthy();
		expect(telegram.getByText('Employee')).toBeTruthy();
		// Never signed in is a state, not a blank cell.
		expect(telegram.getByText('Never')).toBeTruthy();

		const store = within(rowOf('Mya Mya'));
		expect(store.getByText('Password')).toBeTruthy();
		expect(store.getByText('Storekeeper')).toBeTruthy();
		expect(store.getByText('Suspended')).toBeTruthy();
		// SQLite's CURRENT_TIMESTAMP-style timestamp reads as UTC, not as local time.
		expect(store.getByText('2026-08-20 03:15')).toBeTruthy();
	});

	it('counts every account, and searches them by role as well as by name', async () => {
		await renderLoaded();
		// The count rides the table's OWN pagination (rows 0–3 of the 3 accounts) —
		// there is no title bar above it repeating the number.
		expect(screen.getByText('0–3')).toBeTruthy();

		// The shared toolbar owns the search box; the widget owns the predicate, so a
		// role NAME matches even though no column holds it.
		searchUsers('storekeeper');

		await waitFor(() => expect(screen.queryByText('Aung Kyaw')).toBeNull());
		expect(screen.getByText('Mya Mya')).toBeTruthy();
		expect(screen.queryByText('Administrator')).toBeNull();

		searchUsers('');
		await waitFor(() => expect(screen.getByText('Aung Kyaw')).toBeTruthy());
	});

	it('never renders a credential column', async () => {
		await renderLoaded();
		// The API strips `password_hash` (SAFE_USER_FIELDS) and the table has no
		// column for it — this pins that no "Password" header creeps in beside the
		// "Signs in via" one that legitimately reads `Password` for an account.
		expect(screen.queryByRole('columnheader', { name: /^password$/i })).toBeNull();
	});

	it('lands on Active for a bare URL — the Directus default view', async () => {
		// `/idp/users` with no param is Directus's `/admin/users`: Active Users.
		renderTab(undefined, '/idp/users');
		expect(await screen.findByText('dev@mmbics.com')).toBeTruthy();
		// The suspended account is not in the Active view — it is reached through
		// its own view, not by misreading the default.
		expect(screen.queryByText('Mya Mya')).toBeNull();
	});

	it('filters to the view the URL names — the views are filters over ONE read', async () => {
		renderTab(undefined, '/idp/users?view=suspended');
		expect(await screen.findByText('Mya Mya')).toBeTruthy();
		expect(screen.queryByText('Aung Kyaw')).toBeNull();
		expect(screen.queryByText('dev@mmbics.com')).toBeNull();
	});

	it('reads an out-of-vocabulary value as the default rather than showing nothing', async () => {
		renderTab(undefined, '/idp/users?view=banana');
		expect(await screen.findByText('dev@mmbics.com')).toBeTruthy();
		expect(screen.queryByText('Mya Mya')).toBeNull();
	});

	it('names the empty VIEW — "no matches" would blame the search box', async () => {
		renderTab(undefined, '/idp/users?view=invited');
		expect(await screen.findByText(/no invited accounts/i)).toBeTruthy();
	});

	it('renders the toolbar toggle only for a surface that asks for it (Studio Admin)', async () => {
		// The portal carries the views in its panel; a second control here would be
		// the same filter twice.
		await renderLoaded();
		expect(screen.queryByRole('button', { name: 'Suspended Users' })).toBeNull();

		cleanup();
		renderTab(undefined, '/studio', true);
		expect(await screen.findByText('dev@mmbics.com')).toBeTruthy();
		// Pressing a view moves BOTH the URL (one state) and the rows.
		fireEvent.click(screen.getByRole('button', { name: 'Suspended Users' }));
		await waitFor(() => expect(screen.getByTestId('url').textContent).toBe('?view=suspended'));
		expect(await screen.findByText('Mya Mya')).toBeTruthy();
		expect(screen.queryByText('Aung Kyaw')).toBeNull();
		// Back to the default and the canonical bare URL returns (the param is
		// deleted, never written).
		fireEvent.click(screen.getByRole('button', { name: 'Active Users' }));
		await waitFor(() => expect(screen.getByTestId('url').textContent).toBe(''));
		expect(await screen.findByText('Aung Kyaw')).toBeTruthy();
	});
});

describe('UsersTab — creating an account', () => {
	it('POSTs the email, name, password, the default Employee role and the derived Active status', async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		fireEvent.change(textbox('Email'), { target: { value: 'new@mmbics.com' } });
		fireEvent.change(textbox('Full name'), { target: { value: 'New Person' } });
		fireEvent.change(textbox('Password'), { target: { value: 'a-good-password' } });
		// The status is left alone — a password makes the account Active by the
		// SAME rule the select displays.
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
		expect(mockCreateUser).toHaveBeenCalledWith('tk', {
			email: 'new@mmbics.com',
			password: 'a-good-password',
			full_name: 'New Person',
			role_id: 'r-emp',
			status: 'active',
			// Left unlinked on purpose — an admin/HR login is a legitimate account
			// shape, so the field defaults to none rather than inventing one.
			employee_id: null,
		});
	});

	it('creates an INVITED account when no password is given — the status select says so live', async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		// Before a password exists the select itself reads Invited — the displayed
		// rule and the payload are the same rule, so nothing has to be guessed.
		expect(statusSelect().value).toBe('invited');

		fireEvent.change(textbox('Email'), { target: { value: 'new@mmbics.com' } });
		fireEvent.change(textbox('Full name'), { target: { value: 'New Person' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
		// No password KEY at all — an invited account is defined by having none.
		expect(mockCreateUser).toHaveBeenCalledWith('tk', {
			email: 'new@mmbics.com',
			password: undefined,
			full_name: 'New Person',
			role_id: 'r-emp',
			status: 'invited',
			employee_id: null,
		});
	});

	it('refuses an ACTIVE account with no password, and says what to do', async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		fireEvent.change(textbox('Email'), { target: { value: 'new@mmbics.com' } });
		fireEvent.change(textbox('Full name'), { target: { value: 'New Person' } });
		// Picking Active explicitly overrides the derived Invited — and an active
		// account without a credential is a login that could never succeed.
		fireEvent.change(statusSelect(), { target: { value: 'active' } });
		fireEvent.click(saveButton());

		expect(await screen.findByText(/a password is required for an active account/i)).toBeTruthy();
		expect(mockCreateUser).not.toHaveBeenCalled();
	});

	it('refuses a password shorter than the API floor without making a request', async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		fireEvent.change(textbox('Email'), { target: { value: 'new@mmbics.com' } });
		fireEvent.change(textbox('Full name'), { target: { value: 'New Person' } });
		fireEvent.change(textbox('Password'), { target: { value: 'short' } });
		fireEvent.click(saveButton());

		expect(await screen.findByText(/at least 6 characters/i)).toBeTruthy();
		expect(mockCreateUser).not.toHaveBeenCalled();
	});

	it('surfaces a rejected create instead of leaving the editor', async () => {
		mockCreateUser.mockRejectedValue(new Error('User with email "new@mmbics.com" already exists'));
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		fireEvent.change(textbox('Email'), { target: { value: 'new@mmbics.com' } });
		fireEvent.change(textbox('Full name'), { target: { value: 'New Person' } });
		fireEvent.change(textbox('Password'), { target: { value: 'a-good-password' } });
		fireEvent.click(saveButton());

		expect(await screen.findByText(/already exists/i)).toBeTruthy();
		// Still on the form, with what the operator typed intact.
		expect(screen.getByRole('region', { name: /new user/i })).toBeTruthy();
		expect(textbox('Email').value).toBe('new@mmbics.com');
	});
});

describe('UsersTab — editing a password account', () => {
	it('PUTs only the field that changed', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');

		fireEvent.change(roleSelect(), { target: { value: 'r-emp' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		// No status (unchanged), no password (blank), no name (unchanged) — writing
		// identical values would only churn `updated_at`.
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-store', { role_id: 'r-emp' });
	});

	it('dims the ✓ until a writable field differs from the row', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');

		// The role form's own rule: the circular ✓ is disabled while the draft
		// equals the row — a save that would write nothing cannot be clicked.
		expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
		// Even a forced click writes nothing (the guard is behind the gate too).
		fireEvent.click(saveButton());
		expect(mockUpdateUser).not.toHaveBeenCalled();

		fireEvent.change(textbox('Full name'), { target: { value: 'Store Manager' } });
		expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
	});

	it('re-activates a suspended account through the status control', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');

		expect(statusSelect().value).toBe('suspended');
		fireEvent.change(statusSelect(), { target: { value: 'active' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-store', { status: 'active' });
	});

	it('activates an INVITED account by choosing Active and setting a password', async () => {
		mockListUsers.mockResolvedValue([ADMIN_ROW_UNLINKED, TELEGRAM_ROW, INVITED_ROW]);
		renderTab();
		await screen.findByText('Nu Nu');
		openEdit('invited@mmbics.com');

		expect(statusSelect().value).toBe('invited');
		fireEvent.change(statusSelect(), { target: { value: 'active' } });
		fireEvent.change(textbox('Password'), { target: { value: 'a-good-password' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		// Both halves in ONE request — the state that lets them in, and the
		// credential the API requires before it will grant it.
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-inv', { status: 'active', password: 'a-good-password' });
	});

	it('sets a new password without touching anything else', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');

		fireEvent.change(textbox('New password'), { target: { value: 'a-brand-new-one' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-store', { password: 'a-brand-new-one' });
	});
});

describe('UsersTab — which employee an account acts as', () => {
	it('names the employee for a linked account AND for a Telegram row, and says when there is none', async () => {
		await renderLoaded();

		// A password account resolves through its own link.
		expect(await within(rowOf('Mya Mya')).findByText('မမြး')).toBeTruthy();
		// A Telegram account carries no link — its identity is the directory row its
		// `tg-<id>` address matches, so it must be named by the SAME employee.
		expect(await within(rowOf('Aung Kyaw')).findByText('အောင်ကျော်')).toBeTruthy();
		// An account with no employee is a real state (the bootstrap admin), and it is
		// stated rather than left as an empty cell. Located by its ADDRESS: the row's
		// name and its role are both "Administrator".
		expect(within(rowOf('dev@mmbics.com')).getByText('Not linked')).toBeTruthy();
	});

	it('finds an account by the employee it acts as', async () => {
		await renderLoaded();

		searchUsers('မမြး');

		await waitFor(() => expect(screen.queryByText('Aung Kyaw')).toBeNull());
		expect(screen.getByText('Mya Mya')).toBeTruthy();
	});

	it('links and un-links an account, sending null to un-link (not an omitted field)', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');

		// The roster employee with no account yet is FOUND by name and offered — the
		// picker asks the directory for what is typed rather than listing the staff.
		await pickEmployee('zaw', /Zaw Zaw/);
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-store', { employee_id: 'e-spare' });

		// Un-linking is the fix for a binding made to the wrong person, so it has to be
		// expressible — and it sends `null`, which the API distinguishes from `undefined`.
		// The save closed the dialog (as it does on success), so open it again.
		mockUpdateUser.mockClear();
		openEdit('store@mmbics.com');
		await pickEmployee('', /Not linked/);
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-store', { employee_id: null });
	});

	// The floor. A one- or two-character term matches most of a 250-row staff, so
	// firing it would be the whole-directory read this picker exists to avoid — and
	// the list it returns is not one an operator can choose from anyway.
	it('asks the directory for NOTHING until three characters are typed', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');
		expect(searchedTerms()).toEqual([]);

		const input = openEmployeePicker();
		// Only the account's current employee and "Not linked" are offered — the
		// roster is not listed up front, so the staff never crosses the wire.
		expect(employeeListbox().getAllByRole('option')).toHaveLength(2);
		expect(screen.queryByText('Zaw Zaw')).toBeNull();

		fireEvent.change(input, { target: { value: 'z' } });
		fireEvent.change(input, { target: { value: 'za' } });
		// Past the debounce: the term settled below the floor, and no read fired.
		await settle(500);
		expect(searchedTerms()).toEqual([]);
	});

	// The point of the change: one query per settled term, not per keystroke — and
	// a bounded one (`limit: EMPLOYEE_SEARCH_LIMIT`), so a broad term costs the same
	// as a narrow one.
	it('asks the directory ONCE per settled term — the debounce, not the keystroke', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');

		const input = openEmployeePicker();
		fireEvent.change(input, { target: { value: 'z' } });
		fireEvent.change(input, { target: { value: 'za' } });
		fireEvent.change(input, { target: { value: 'zaw' } });

		await screen.findByRole('option', { name: /Zaw Zaw/ }, { timeout: 2000 });
		// Exactly one read, for the term that settled — the two earlier keystrokes
		// never reached the server at all, and the one that did is BOUNDED.
		expect(searchedTerms()).toEqual(['zaw']);
		const [searchCall] = mockListItems.mock.calls.filter((c) => (c[2] as { search?: string })?.search === 'zaw');
		expect(searchCall[2]).toMatchObject({ limit: 20 });
	});

	// The user's ask, end to end: an employee who has no account yet is found by
	// typing a name, picked, and the account is linked to them.
	it('links a SEARCHED employee the roster never listed up front', async () => {
		await renderLoaded();
		const dialog = openEdit('store@mmbics.com');
		// Nothing on the roster is rendered until it is searched for.
		expect(within(dialog).queryByText('Zaw Zaw')).toBeNull();

		await pickEmployee('zaw', /Zaw Zaw/);
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-store', { employee_id: 'e-spare' });
	});

	it('offers no employee control on a Telegram row — its employee is its address', async () => {
		await renderLoaded();
		openEdit('tg-42@telegram.local');

		expect(screen.queryByLabelText('Employee')).toBeNull();
	});

	it('degrades instead of breaking when the deployment has no employee directory', async () => {
		// A factory-core deployment has no configured directory — the server
		// advertises `identity.directory_collection: null`, so no employee read is
		// issued and the accounts stay administrable.
		mockGetServerMeta.mockResolvedValue({
			platform: 'mmbix-headless',
			version: '0.0.0',
			identity: { directory_collection: null, directory_field: null },
		});
		mockListItems.mockRejectedValue(new Error('Collection "directory" not found'));
		await renderLoaded();

		// Every account still lists…
		expect(screen.getByText('Mya Mya')).toBeTruthy();

		// …and the reason the picker is closed is stated AT the control it closes,
		// never as a bare disabled field.
		openEdit('store@mmbics.com');
		expect(employeeInput().disabled).toBe(true);
		expect(screen.getByText(/no employee directory/i)).toBeTruthy();
	});
});

describe('UsersTab — the editor takes the whole surface', () => {
	it('unmounts the list instead of floating over it, and the header ✕ brings the list back', async () => {
		await renderLoaded();
		const editor = openEdit('store@mmbics.com');

		// Not a modal: no dialog role, no overlay to click outside of — and, the point,
		// no table behind it, so nothing half-read sits next to the form.
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.queryByRole('table')).toBeNull();
		// The account being edited is named by the editor itself.
		expect(within(editor).getByText('store@mmbics.com')).toBeTruthy();

		// The actions are the role form's own chrome: the circular ✓ and ✕ in the
		// header — no back button and no bottom bar to duplicate them.
		expect(closeButton()).toBeTruthy();
		expect(saveButton()).toBeTruthy();
		expect(screen.queryByRole('button', { name: /^cancel$/i })).toBeNull();

		fireEvent.click(closeButton());

		expect(await screen.findByRole('table')).toBeTruthy();
		expect(screen.queryByRole('region')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
	});

	it('offers the create form the Status control — how an invite is expressed — and no checkbox', async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		const editor = screen.getByRole('region', { name: /new user/i });
		expect(within(editor).getByLabelText('Password')).toBeTruthy();
		// The lifecycle control is how a create is expressed as an invite, and it
		// reads the DERIVED state before any password exists.
		expect(statusSelect().value).toBe('invited');
		// The old two-state checkbox is gone — one vocabulary, one control.
		expect(screen.queryByRole('checkbox')).toBeNull();
	});
});

describe('UsersTab — the operator cannot lock themselves out', () => {
	it('offers no way to change the status of the account the session is signed in as', async () => {
		await renderLoaded('dev@mmbics.com');
		openEdit('dev@mmbics.com');

		expect(await screen.findByText(/your own account/i)).toBeTruthy();
		expect(statusSelect().disabled).toBe(true);
		expect(await screen.findByText(/cannot change the status of the account you are signed in with/i)).toBeTruthy();
	});

	it('honours that block even if the control is forced, and writes no status', async () => {
		await renderLoaded('dev@mmbics.com');
		openEdit('dev@mmbics.com');

		// The behavioural guarantee behind the disabled state: whatever the DOM
		// says, the form cannot end up asking for a self-status change. Forcing the
		// select AND editing a writable field reaches Submit — and what it writes
		// is the name alone.
		fireEvent.change(statusSelect(), { target: { value: 'suspended' } });
		fireEvent.change(textbox('Full name'), { target: { value: 'Dev Admin' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-admin', { full_name: 'Dev Admin' });
	});

	it('still allows a non-status edit on your own account', async () => {
		await renderLoaded('dev@mmbics.com');
		openEdit('dev@mmbics.com');

		fireEvent.change(textbox('Full name'), { target: { value: 'Dev Admin' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-admin', { full_name: 'Dev Admin' });
	});

	it('treats a case-different email as the same account', async () => {
		await renderLoaded('Dev@MmBics.com');
		openEdit('dev@mmbics.com');

		expect(statusSelect().disabled).toBe(true);
	});
});

describe('UsersTab — a Telegram-provisioned account', () => {
	it('offers no password field and no writable name or role', async () => {
		await renderLoaded();
		openEdit('tg-42@telegram.local');

		// No password exists for these rows and none is offered.
		expect(screen.queryByLabelText('New password')).toBeNull();
		expect(textbox('Full name').disabled).toBe(true);
		expect(textbox('Email').disabled).toBe(true);
		expect(roleSelect().disabled).toBe(true);
		// …and it says why, so a missing control is not mistaken for a bug.
		expect(screen.getByText(/re-read from the directory on every Telegram sign-in/i)).toBeTruthy();
	});

	it('still suspends, and writes nothing but the status — the directory owns the rest', async () => {
		await renderLoaded();
		openEdit('tg-42@telegram.local');

		// The status control DOES stick for these rows, unlike the name and role the
		// login route re-syncs on every sign-in — so it is offered.
		expect(statusSelect().disabled).toBe(false);
		fireEvent.change(statusSelect(), { target: { value: 'suspended' } });
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-tg', { status: 'suspended' });
	});
});

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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../lib/api', () => ({
	listUsers: vi.fn(),
	listRoles: vi.fn(),
	listItems: vi.fn(),
	createUser: vi.fn(),
	updateUser: vi.fn(),
}));

import { createUser, listItems, listRoles, listUsers, updateUser } from '../../lib/api';
import { UsersTab } from './users-tab';

const mockListUsers = vi.mocked(listUsers) as unknown as Mock;
const mockListRoles = vi.mocked(listRoles) as unknown as Mock;
const mockListItems = vi.mocked(listItems) as unknown as Mock;
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
/** A password account that has been blocked, LINKED to an employee. */
const STORE_ROW = {
	id: 'u-store',
	email: 'store@mmbics.com',
	full_name: 'Mya Mya',
	role_id: 'r-store',
	status: 'disabled' as const,
	employee_id: 'e-store',
	last_login: '2026-08-20 03:15:00',
	created_at: '2026-08-03 09:00:00',
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

function renderTab(currentEmail?: string) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<UsersTab token="tk" currentEmail={currentEmail} />
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
const saveButton = () => screen.getByRole('button', { name: /save changes/i });
/** base-ui renders the box as a `<span role="checkbox">` and expresses disabled
 *  state as `aria-disabled` (there is no `.disabled` property). Matched on the
 *  label so any mirrored hidden input cannot make a unique query ambiguous. */
const disableBox = () =>
	screen.getAllByRole('checkbox').find((el) => el.getAttribute('aria-label') === 'Disabled — block sign-in') as HTMLElement;
const boxChecked = () => disableBox().getAttribute('aria-checked');
const boxDisabled = () => disableBox().getAttribute('aria-disabled') === 'true';

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
	mockCreateUser.mockReset();
	mockUpdateUser.mockReset();
	mockListUsers.mockResolvedValue([ADMIN_ROW_UNLINKED, TELEGRAM_ROW, STORE_ROW]);
	mockListRoles.mockResolvedValue([ROLE_ADMIN, ROLE_EMPLOYEE, ROLE_STORE]);
	mockListItems.mockImplementation(employeeRead);
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
		expect(store.getByText('Disabled')).toBeTruthy();
		// SQLite's CURRENT_TIMESTAMP-style timestamp reads as UTC, not as local time.
		expect(store.getByText('2026-08-20 03:15')).toBeTruthy();
	});

	it('counts every account, and searches them by role as well as by name', async () => {
		await renderLoaded();
		expect(screen.getByText('3')).toBeTruthy();

		fireEvent.change(textbox('Search users'), { target: { value: 'storekeeper' } });

		expect(screen.getByText('Mya Mya')).toBeTruthy();
		expect(screen.queryByText('Aung Kyaw')).toBeNull();
		expect(screen.queryByText('Administrator')).toBeNull();

		fireEvent.change(textbox('Search users'), { target: { value: '' } });
		expect(screen.getByText('Aung Kyaw')).toBeTruthy();
	});

	it('never renders a credential column', async () => {
		await renderLoaded();
		// The API strips `password_hash` (SAFE_USER_FIELDS) and the table has no
		// column for it — this pins that no "Password" header creeps in beside the
		// "Signs in via" one that legitimately reads `Password` for an account.
		expect(screen.queryByRole('columnheader', { name: /^password$/i })).toBeNull();
	});
});

describe('UsersTab — creating an account', () => {
	it('POSTs the email, name, password and the default Employee role', async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		fireEvent.change(textbox('Email'), { target: { value: 'new@mmbics.com' } });
		fireEvent.change(textbox('Full name'), { target: { value: 'New Person' } });
		fireEvent.change(textbox('Password'), { target: { value: 'a-good-password' } });
		// The role is deliberately left alone — Employee is the pre-selected default.
		fireEvent.click(screen.getByRole('button', { name: /create user/i }));

		await waitFor(() => expect(mockCreateUser).toHaveBeenCalledTimes(1));
		expect(mockCreateUser).toHaveBeenCalledWith('tk', {
			email: 'new@mmbics.com',
			password: 'a-good-password',
			full_name: 'New Person',
			role_id: 'r-emp',
			// Left unlinked on purpose — an admin/HR login is a legitimate account
			// shape, so the field defaults to none rather than inventing one.
			employee_id: null,
		});
	});

	it('refuses a password shorter than the API floor without making a request', async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		fireEvent.change(textbox('Email'), { target: { value: 'new@mmbics.com' } });
		fireEvent.change(textbox('Full name'), { target: { value: 'New Person' } });
		fireEvent.change(textbox('Password'), { target: { value: 'short' } });
		fireEvent.click(screen.getByRole('button', { name: /create user/i }));

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
		fireEvent.click(screen.getByRole('button', { name: /create user/i }));

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

	it('writes nothing when the form was not touched', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');

		fireEvent.click(saveButton());

		expect(await screen.findByText(/nothing changed/i)).toBeTruthy();
		expect(mockUpdateUser).not.toHaveBeenCalled();
	});

	it('re-enables a blocked account through the status control', async () => {
		await renderLoaded();
		openEdit('store@mmbics.com');

		expect(boxChecked()).toBe('true');
		fireEvent.click(disableBox());
		expect(boxChecked()).toBe('false');
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-store', { status: 'active' });
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

		fireEvent.change(textbox('Search users'), { target: { value: 'မမြး' } });
		expect(screen.getByText('Mya Mya')).toBeTruthy();
		expect(screen.queryByText('Aung Kyaw')).toBeNull();
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
		// A factory-core deployment (`DOMAIN_MODULES=none`) has no `hrm_employees`
		// collection — accounts must still be administrable.
		mockListItems.mockRejectedValue(new Error('Collection "hrm_employees" not found'));
		await renderLoaded();

		expect(await screen.findByText(/no employee directory/i)).toBeTruthy();
		openEdit('store@mmbics.com');
		expect(employeeInput().disabled).toBe(true);
	});
});

describe('UsersTab — the editor takes the whole surface', () => {
	it('unmounts the list instead of floating over it, and Cancel brings the list back', async () => {
		await renderLoaded();
		const editor = openEdit('store@mmbics.com');

		// Not a modal: no dialog role, no overlay to click outside of — and, the point,
		// no table behind it, so nothing half-read sits next to the form.
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(screen.queryByRole('table')).toBeNull();
		// The account being edited is named by the editor itself.
		expect(within(editor).getByText('store@mmbics.com')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

		expect(await screen.findByRole('table')).toBeTruthy();
		expect(screen.queryByRole('region')).toBeNull();
		expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();
	});

	it('offers the create form its own fields — and no state control it could not use', async () => {
		await renderLoaded();
		fireEvent.click(screen.getByRole('button', { name: /new user/i }));

		const editor = screen.getByRole('region', { name: /new user/i });
		expect(within(editor).getByLabelText('Password')).toBeTruthy();
		// A brand-new account has no stored state to flip, so the control is ABSENT
		// rather than a checkbox that would change nothing.
		expect(screen.queryByRole('checkbox')).toBeNull();
	});
});

describe('UsersTab — the operator cannot lock themselves out', () => {
	it('offers no way to disable the account the session is signed in as', async () => {
		await renderLoaded('dev@mmbics.com');
		openEdit('dev@mmbics.com');

		expect(await screen.findByText(/your own account/i)).toBeTruthy();
		expect(boxDisabled()).toBe(true);
		expect(await screen.findByText(/cannot disable the account you are signed in with/i)).toBeTruthy();
	});

	it('honours that block even if the control is forced, and writes no status', async () => {
		await renderLoaded('dev@mmbics.com');
		openEdit('dev@mmbics.com');

		// The behavioural guarantee behind the disabled state: whatever the DOM
		// attribute says, the form cannot end up asking for a self-disable.
		fireEvent.click(disableBox());
		fireEvent.click(saveButton());

		expect(await screen.findByText(/nothing changed/i)).toBeTruthy();
		expect(boxChecked()).toBe('false');
		expect(mockUpdateUser).not.toHaveBeenCalled();
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

		expect(boxDisabled()).toBe(true);
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

	it('still blocks sign-in, and writes nothing but the status', async () => {
		await renderLoaded();
		openEdit('tg-42@telegram.local');

		fireEvent.click(disableBox());
		fireEvent.click(saveButton());

		await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledTimes(1));
		expect(mockUpdateUser).toHaveBeenCalledWith('tk', 'u-tg', { status: 'disabled' });
	});
});

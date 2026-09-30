/**
 * Users-table logic — the pure half of `UsersTab`.
 *
 * `_users` holds several kinds of principal in ONE table: the bootstrap admin,
 * admin/HR password accounts, and the employee identities the Telegram login
 * route provisions. Nothing in the row states which is which — there is no
 * `kind` column and no `provider` column (the Directus analogue) — so the kind
 * has to be DERIVED. That derivation lives here, next to the route that writes
 * the marker, rather than as an `email.endsWith(...)` scattered through the UI.
 *
 * Keeping it out of the component is what makes it testable without a DOM, and
 * the two things that can actually be wrong (the identity pattern and the
 * timestamp parsing) are exactly the two things that are easy to get subtly
 * wrong.
 */

import type { StudioUser } from './api';

/** The columns the tab reads from the employee directory: the id plus the two
 *  names a link is labelled with, and `etg_id` so a Telegram account — whose link
 *  is the id inside its address, not a column — is named by the same employee as
 *  everybody else. Declared ONCE: the table's lookup reads and the picker's search
 *  must ask for the same shape, or one of them would label a row differently. */
export const EMPLOYEE_FIELDS = 'id,name_mm,name_en,etg_id';

/** One employee directory row, as the tab reads it. */
export interface EmployeeRow {
	id: string;
	name_mm?: unknown;
	name_en?: unknown;
	etg_id?: unknown;
}

/** The domain the Telegram login route stamps on its provisioned rows
 *  (`apps/api/src/routes/auth-telegram.ts` → `findOrCreateUser`). */
export const TELEGRAM_EMAIL_DOMAIN = '@telegram.local';

/**
 * `tg-<id>@telegram.local` — the ONLY shape that route ever writes.
 *
 * Matched strictly, numeric id included, rather than by suffix alone: a suffix
 * test would mislabel a real person's address on any domain ending the same way,
 * and this predicate decides whether offering a password control makes sense.
 * `(\d+)` is a CAPTURE because `telegramIdOf` reads the id back out of it — the
 * two must not drift into two patterns for one address shape.
 */
const TELEGRAM_EMAIL = /^tg-(\d+)@telegram\.local$/;

/** How an account authenticates. A Telegram row has no password by construction. */
export type IdentityKind = 'telegram' | 'password';

export function identityKindOf(user: Pick<StudioUser, 'email'>): IdentityKind {
	return TELEGRAM_EMAIL.test(user.email ?? '') ? 'telegram' : 'password';
}

/**
 * The Telegram user id a provisioned account is registered under, or null.
 *
 * A Telegram account carries no employee link — its identity IS the directory
 * row whose `etg_id` matches this id (that is the gate `findDirectoryEmployee`
 * runs), so resolving "which employee?" for such a row means going through the
 * address rather than a column. Strictly matched, exactly like
 * `identityKindOf`, so a human address can never be read as a Telegram id.
 */
export function telegramIdOf(user: Pick<StudioUser, 'email'>): string | null {
	return TELEGRAM_EMAIL.exec(user.email ?? '')?.[1] ?? null;
}

export const IDENTITY_KIND_LABEL: Record<IdentityKind, string> = {
	telegram: 'Telegram',
	password: 'Password',
};

/**
 * The ONE employee display name — `name_mm` first, then `name_en`, then the
 * employee id.
 *
 * Mirrors what the mini app already shows for an employee
 * (`apps/tgapp/src/modules/employees/data/api.ts`: `name_mm ?? name_en`), so the
 * same person cannot read one way in the Users table and another in the app. The
 * Burmese name leads because it is the one the crew uses day to day.
 */
export function employeeLabelOf(employee: { id: string; name_mm?: unknown; name_en?: unknown }): string {
	const mm = typeof employee.name_mm === 'string' ? employee.name_mm.trim() : '';
	const en = typeof employee.name_en === 'string' ? employee.name_en.trim() : '';
	return mm || en || employee.id;
}

/** `hrm_employees.id` → display name, for the one employee read the tab makes. */
export function employeeNameMap(employees: Array<{ id: string; name_mm?: unknown; name_en?: unknown }>): Map<string, string> {
	return new Map(employees.map((employee) => [employee.id, employeeLabelOf(employee)]));
}

/**
 * `etg_id` → display name — the Telegram half of the same naming.
 *
 * A Telegram account carries no `employee_id`, so the table cannot name it from
 * the link column: it is the employee whose `etg_id` its address encodes. Keeping
 * this next to `employeeNameMap` means both link kinds are labelled by ONE
 * function (`employeeLabelOf`), so the same person cannot read two ways.
 */
export function employeeTgNameMap(
	employees: Array<{ id: string; etg_id?: unknown; name_mm?: unknown; name_en?: unknown }>,
): Map<string, string> {
	const map = new Map<string, string>();
	for (const employee of employees) {
		const tgId = employee.etg_id == null ? '' : String(employee.etg_id).trim();
		if (tgId) map.set(tgId, employeeLabelOf(employee));
	}
	return map;
}

/**
 * The DISTINCT employees a set of accounts refers to — the bound on the one
 * directory read the table makes.
 *
 * An account links to its employee one of two ways (`telegramIdOf`): a password
 * account through `_users.employee_id`, a Telegram account through the `etg_id`
 * its address encodes. The engine has no OR group in this client, so the two are
 * returned as two id sets — each exactly the rows that must be NAMED, nothing
 * more. That keeps the read proportional to the number of ACCOUNTS rather than
 * the size of the staff, which is the point: the roster read this replaces pulled
 * every employee over the wire to label a couple of rows.
 *
 * Both halves are read independently: a row that carries a link AND a Telegram
 * address (they do not in practice) would otherwise lose one of the two names it
 * appears under.
 */
export function employeeLinkLookup(users: Array<Pick<StudioUser, 'email' | 'employee_id'>>): { ids: string[]; tgIds: string[] } {
	const ids = new Set<string>();
	const tgIds = new Set<string>();
	for (const user of users) {
		if (user.employee_id) ids.add(user.employee_id);
		const tgId = telegramIdOf(user);
		if (tgId) tgIds.add(tgId);
	}
	return { ids: [...ids].sort(), tgIds: [...tgIds].sort() };
}

/**
 * How long a query must be before the employee picker searches the DIRECTORY.
 *
 * Below this the control searches nothing. A one- or two-character `LIKE '%a%'`
 * matches most of a 250-row directory, so firing it would be the whole-directory
 * read this picker exists to avoid — one round trip per keystroke, for a list the
 * operator cannot choose from anyway. Three characters is where a name becomes a
 * name.
 */
export const EMPLOYEE_SEARCH_MIN = 3;

/** How many directory rows one picker search asks for: enough to choose from,
 *  without dragging a broad term's whole result set over the wire. */
export const EMPLOYEE_SEARCH_LIMIT = 20;

/**
 * The picker's "Not linked" choice.
 *
 * A sentinel rather than the empty string: base-ui's Combobox reads an empty
 * value as "nothing selected", so an explicit option needs a value of its own.
 * The component translates it back to `''` at its boundary, so the sentinel never
 * reaches the API — and it cannot collide with an employee id, which are UUIDs.
 */
export const NO_EMPLOYEE = '__none__';

/**
 * The account's sign-in state as THREE values rather than two.
 *
 * `unknown` is load-bearing. `status` is always in the API's projection today,
 * but a UI that renders a missing value as "active" is making a claim it cannot
 * back — and the claim is specifically about whether this account can sign in.
 * Unknown is the honest answer, and the Admin API's `updateUser` ignores a
 * falsy `status`, so a row really can arrive without one.
 */
export type UserState = 'active' | 'disabled' | 'unknown';

export function userStateOf(user: Pick<StudioUser, 'status'>): UserState {
	if (user.status === 'active') return 'active';
	if (user.status === 'disabled') return 'disabled';
	return 'unknown';
}

/** What the row is called — the display name when there is one, else the email. */
export function displayNameOf(user: Pick<StudioUser, 'email' | 'full_name'>): string {
	return (user.full_name ?? '').trim() || user.email;
}

/**
 * The two timestamp shapes the engine actually stores, normalised to epoch ms.
 *
 * `last_login` is written as ISO-8601 with an explicit `Z` (`AuthService.login`),
 * but `created_at` comes from SQLite's `CURRENT_TIMESTAMP` — `YYYY-MM-DD HH:MM:SS`,
 * which is UTC yet carries NO zone marker. `Date.parse` reads that second shape as
 * LOCAL time, so every row would shift by the operator's offset and two operators
 * in different zones would disagree about the same account. Both are UTC here.
 */
function epochOf(value: string): number {
	const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(value);
	if (sqlite) return Date.parse(`${sqlite[1]}T${sqlite[2]}Z`);
	return Date.parse(value);
}

/**
 * A timestamp for the table, fixed-shape and UTC (`YYYY-MM-DD HH:mm`).
 *
 * Deliberately not `toLocaleString`: the Studio is a shared admin surface, so the
 * same row must read the same way on every operator's machine. Absent means "has
 * never signed in" — a real and common state for a freshly created account — so it
 * gets a word, not an empty cell that reads like a rendering bug.
 */
export function formatStamp(value: string | null | undefined): string {
	if (value === null || value === undefined || value === '') return 'Never';
	const ms = epochOf(value);
	if (Number.isNaN(ms)) return '—';
	return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * Case-insensitive substring search across the things an operator actually
 * searches BY: the email they already know, the name they can see, the role
 * (which is how "who is a Storekeeper?" gets asked of a 300-row table), and the
 * employee the account acts as — which is how "which account is U Kyaw Min?"
 * gets asked, and it matches whatever the Employee column SHOWS (a Telegram
 * account resolves through its `tg-<id>` address, not a column).
 *
 * `roleNameOf` / `employeeOf` are injected rather than looked up here because the
 * role registry and the employee directory are their own cached reads; the
 * component owns both and passes resolvers in.
 */
export function filterUsers(
	users: StudioUser[],
	query: string,
	roleNameOf: (roleId: string | null | undefined) => string = () => '',
	employeeOf: (user: StudioUser) => string = () => '',
): StudioUser[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return users;
	return users.filter((user) =>
		[user.email, user.full_name ?? '', roleNameOf(user.role_id), employeeOf(user)].some((field) => field.toLowerCase().includes(needle)),
	);
}

/** `role_id` → role name, for the one table read and every row's label. */
export function roleNameMap(roles: Array<{ id: string; name: string }>): Map<string, string> {
	return new Map(roles.map((role) => [role.id, role.name]));
}

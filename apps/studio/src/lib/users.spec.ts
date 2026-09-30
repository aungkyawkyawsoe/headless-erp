/**
 * Users-table logic — the pure half of `UsersTab`.
 *
 * Two things here are easy to get subtly wrong and are therefore the reason this
 * file exists at all: the Telegram-identity pattern (which decides whether the UI
 * offers a password control) and the timestamp parsing (`_users.created_at` comes
 * from SQLite's `CURRENT_TIMESTAMP`, which has no zone marker).
 */
import { describe, expect, it } from 'vitest';
import type { StudioUser } from './api';
import {
	EMPLOYEE_FIELDS,
	EMPLOYEE_SEARCH_LIMIT,
	EMPLOYEE_SEARCH_MIN,
	employeeLabelOf,
	employeeLinkLookup,
	employeeNameMap,
	employeeTgNameMap,
	filterUsers,
	formatStamp,
	IDENTITY_KIND_LABEL,
	identityKindOf,
	displayNameOf,
	NO_EMPLOYEE,
	roleNameMap,
	telegramIdOf,
	userStateOf,
} from './users';

function user(over: Partial<StudioUser> = {}): StudioUser {
	return { id: 'u1', email: 'a@b.com', full_name: 'A', ...over };
}

describe('identityKindOf — the marker the Telegram login route writes', () => {
	it('classifies the exact shape `findOrCreateUser` provisions', () => {
		expect(identityKindOf(user({ email: 'tg-123456789@telegram.local' }))).toBe('telegram');
	});

	it('classifies an ordinary address as a password account', () => {
		expect(identityKindOf(user({ email: 'dev@mmbics.com' }))).toBe('password');
	});

	// A suffix-only test would mislabel a real person's address and then hide the
	// password control on an account that genuinely has one.
	it('does not treat the domain alone as proof', () => {
		expect(identityKindOf(user({ email: 'someone@telegram.local' }))).toBe('password');
	});

	// `tg-<id>` — the id is always numeric, so a non-numeric marker is not one of ours.
	it('requires the numeric id, not just the prefix', () => {
		expect(identityKindOf(user({ email: 'tg-admin@telegram.local' }))).toBe('password');
	});

	it('is case-sensitive, matching the lowercasing the API applies on create', () => {
		expect(identityKindOf(user({ email: 'TG-1@telegram.local' }))).toBe('password');
	});

	it('labels both kinds', () => {
		expect(IDENTITY_KIND_LABEL.telegram).toBe('Telegram');
		expect(IDENTITY_KIND_LABEL.password).toBe('Password');
	});
});

describe('telegramIdOf — the id an account is registered under', () => {
	it('reads the id back out of the provisioned address', () => {
		expect(telegramIdOf(user({ email: 'tg-123456789@telegram.local' }))).toBe('123456789');
	});

	// The regex carries the capture group `telegramIdOf` reads, so the two can
	// never drift — but the string is still returned as WRITTEN, so a query against
	// the directory's `etg_id` compares like with like (including leading zeros).
	it('keeps the id exactly as written', () => {
		expect(telegramIdOf(user({ email: 'tg-007@telegram.local' }))).toBe('007');
	});

	it('returns null for anything that is not a provisioned address', () => {
		expect(telegramIdOf(user({ email: 'someone@telegram.local' }))).toBeNull();
		expect(telegramIdOf(user({ email: 'tg-admin@telegram.local' }))).toBeNull();
		expect(telegramIdOf(user({ email: 'dev@mmbics.com' }))).toBeNull();
	});
});

describe('employee labels', () => {
	it('prefers the Burmese name, and falls back to English then the id', () => {
		expect(employeeLabelOf({ id: 'e1', name_mm: 'မမြး', name_en: 'Mya Mya' })).toBe('မမြး');
		expect(employeeLabelOf({ id: 'e1', name_mm: '  ', name_en: 'Mya Mya' })).toBe('Mya Mya');
		expect(employeeLabelOf({ id: 'e1' })).toBe('e1');
	});

	// A column can arrive null (not just absent) from the engine — a bare
	// `name_mm.trim()` would throw and blank the whole table.
	it('survives null name columns', () => {
		expect(employeeLabelOf({ id: 'e1', name_mm: null, name_en: null })).toBe('e1');
		expect(employeeLabelOf({ id: 'e1', name_mm: 'မမြး', name_en: null })).toBe('မမြး');
	});

	it('maps every employee by id', () => {
		const map = employeeNameMap([
			{ id: 'e1', name_mm: 'မမြး' },
			{ id: 'e2', name_en: 'Aung Kyaw' },
		]);
		expect(map.get('e1')).toBe('မမြး');
		expect(map.get('e2')).toBe('Aung Kyaw');
	});
});

describe('userStateOf — three values, not two', () => {
	it('reads the two stored states', () => {
		expect(userStateOf({ status: 'active' })).toBe('active');
		expect(userStateOf({ status: 'disabled' })).toBe('disabled');
	});

	// The claim is "this account can sign in" — a missing value must not assert it.
	it('reports a missing status as unknown rather than active', () => {
		expect(userStateOf({})).toBe('unknown');
		expect(userStateOf({ status: undefined })).toBe('unknown');
	});
});

describe('displayNameOf', () => {
	it('prefers the display name', () => {
		expect(displayNameOf(user({ full_name: 'Daw Mya', email: 'mya@x.com' }))).toBe('Daw Mya');
	});

	it('falls back to the email for an absent or blank name', () => {
		expect(displayNameOf({ email: 'mya@x.com' })).toBe('mya@x.com');
		expect(displayNameOf({ email: 'mya@x.com', full_name: '   ' })).toBe('mya@x.com');
	});
});

describe('formatStamp', () => {
	it('says "Never" for an account that has not signed in', () => {
		expect(formatStamp(null)).toBe('Never');
		expect(formatStamp(undefined)).toBe('Never');
		expect(formatStamp('')).toBe('Never');
	});

	it('renders an ISO instant in UTC, minute precision', () => {
		expect(formatStamp('2026-09-01T10:00:00.000Z')).toBe('2026-09-01 10:00');
	});

	/**
	 * The regression this guards: SQLite's `CURRENT_TIMESTAMP` has no `Z`, and
	 * `Date.parse` reads that shape as LOCAL — so on a UTC+6:30 machine the same
	 * row would print `03:30` and two operators would disagree about one account.
	 * The asserted string is the UTC instant, whatever the test machine's zone.
	 */
	it('reads SQLite CURRENT_TIMESTAMP as UTC, not as local time', () => {
		expect(formatStamp('2026-09-01 10:00:00')).toBe('2026-09-01 10:00');
	});

	it('shows an unknown shape as unknown rather than inventing a date', () => {
		expect(formatStamp('not a date')).toBe('—');
	});
});

describe('filterUsers', () => {
	const rows: StudioUser[] = [
		user({ id: 'u1', email: 'dev@mmbics.com', full_name: 'Administrator', role_id: 'r1' }),
		user({ id: 'u2', email: 'tg-42@telegram.local', full_name: 'Aung Kyaw', role_id: 'r2' }),
		user({ id: 'u3', email: 'store@mmbics.com', full_name: 'Mya Mya', role_id: 'r3' }),
		user({ id: 'u4', email: 'former@mmbics.com', full_name: 'Former Staff', role_id: null, status: 'disabled' }),
	];
	const roleNameOf = (id?: string | null) => (id === 'r1' ? 'Administrator' : id === 'r2' ? 'Employee' : id === 'r3' ? 'Storekeeper' : '');

	it('returns every row for an empty or whitespace query', () => {
		expect(filterUsers(rows, '', roleNameOf)).toHaveLength(4);
		expect(filterUsers(rows, '   ', roleNameOf)).toHaveLength(4);
	});

	it('matches the email', () => {
		expect(filterUsers(rows, 'store@', roleNameOf).map((r) => r.id)).toEqual(['u3']);
	});

	it('matches the display name, case-insensitively', () => {
		expect(filterUsers(rows, 'aung', roleNameOf).map((r) => r.id)).toEqual(['u2']);
	});

	// "who is a Storekeeper?" is the question a 300-row table gets asked.
	it('matches the ROLE, not just the account fields', () => {
		expect(filterUsers(rows, 'storekeeper', roleNameOf).map((r) => r.id)).toEqual(['u3']);
	});

	it('returns nothing when nothing matches', () => {
		expect(filterUsers(rows, 'nobody', roleNameOf)).toEqual([]);
	});

	it('works without a role resolver', () => {
		expect(filterUsers(rows, 'aung').map((r) => r.id)).toEqual(['u2']);
	});

	// Which account acts as a given employee is the second question this table gets
	// asked, and it has to match what the Employee column SHOWS — including for a
	// Telegram account, whose employee is not stored on the row at all but resolved
	// from its address by the caller's resolver.
	it('matches the employee an account acts as', () => {
		const employeeOf = (u: StudioUser) => (u.id === 'u3' ? 'မမြး' : u.id === 'u2' ? 'အောင်ကျော်' : '');
		expect(filterUsers(rows, 'မမြး', roleNameOf, employeeOf).map((r) => r.id)).toEqual(['u3']);
		expect(filterUsers(rows, 'အောင်ကျော်', roleNameOf, employeeOf).map((r) => r.id)).toEqual(['u2']);
	});

	it('works without an employee resolver', () => {
		expect(filterUsers(rows, 'store@', roleNameOf).map((r) => r.id)).toEqual(['u3']);
	});
});

describe('employeeTgNameMap — a Telegram account named by the same employee as the rest', () => {
	it('indexes the directory by etg_id, through the one employee label', () => {
		const map = employeeTgNameMap([
			{ id: 'e1', etg_id: '42', name_mm: 'အောင်ကျော်', name_en: 'Aung Kyaw' },
			{ id: 'e2', etg_id: 7, name_en: 'Zaw Zaw' },
			{ id: 'e3', etg_id: null, name_en: 'No Telegram id' },
		]);
		expect(map.get('42')).toBe('အောင်ကျော်');
		// A numeric column reaches the client as a number — the id is still a string.
		expect(map.get('7')).toBe('Zaw Zaw');
		// Nobody to name: an idle row must not land under an empty key.
		expect(map.size).toBe(2);
	});

	it('falls back exactly like employeeLabelOf, so one employee cannot read two ways', () => {
		const map = employeeTgNameMap([{ id: 'e1', etg_id: '42', name_mm: '   ', name_en: 'Aung Kyaw' }]);
		expect(map.get('42')).toBe('Aung Kyaw');
	});
});

/**
 * `employeeLinkLookup` is the bound on the table's only directory read: it turns
 * a set of accounts into the distinct employees that must be NAMED — never more.
 * The roster read this replaced pulled every employee over the wire.
 */
describe('employeeLinkLookup — the ids to read, and nothing else', () => {
	it('collects each employee once, from both kinds of link', () => {
		const { ids, tgIds } = employeeLinkLookup([
			user({ id: 'u1', employee_id: 'e-store' }),
			user({ id: 'u2', employee_id: 'e-store' }), // the same employee twice
			user({ id: 'u3', email: 'tg-42@telegram.local' }),
			user({ id: 'u4' }), // the bootstrap admin — no link at all
		]);
		expect(ids).toEqual(['e-store']);
		expect(tgIds).toEqual(['42']);
	});

	// Pinned ordering: an id set that arrived in a different order would key a
	// different cache entry (and re-read) for the same accounts.
	it('is deterministic — the same accounts yield the same ordered ids', () => {
		const rows = [user({ id: 'u1', employee_id: 'e-b' }), user({ id: 'u2', employee_id: 'e-a' })];
		expect(employeeLinkLookup(rows)).toEqual(employeeLinkLookup([...rows].reverse()));
		expect(employeeLinkLookup(rows).ids).toEqual(['e-a', 'e-b']);
	});

	// Reading the two halves separately is what keeps both names: an account that
	// carried a link AND a Telegram address would otherwise lose one of them.
	it('reads both halves independently', () => {
		const { ids, tgIds } = employeeLinkLookup([user({ email: 'tg-7@telegram.local', employee_id: 'e-x' })]);
		expect(ids).toEqual(['e-x']);
		expect(tgIds).toEqual(['7']);
	});

	// The strict pattern again: a human address must never be read as an id, or
	// the read would ask the directory for an employee who does not exist.
	it('never reads a human address as a Telegram id', () => {
		const { tgIds } = employeeLinkLookup([
			user({ email: 'someone@telegram.local' }),
			user({ email: 'tg-admin@telegram.local' }),
			user({ email: 'dev@mmbics.com' }),
		]);
		expect(tgIds).toEqual([]);
	});
});

/**
 * The picker's budget — the bound that keeps naming a link proportional to what
 * is TYPED rather than to the size of the staff.
 */
describe('the employee picker budget', () => {
	// Below three characters a `LIKE '%x%'` matches most of a 250-row directory,
	// so firing it would be the whole-roster read this picker exists to avoid —
	// one round trip per keystroke, over rows nobody could choose from.
	it('searches the directory only from three characters', () => {
		expect(EMPLOYEE_SEARCH_MIN).toBe(3);
	});

	// One search is capped, so a broad term costs the same as a narrow one.
	it('caps what one search returns', () => {
		expect(EMPLOYEE_SEARCH_LIMIT).toBe(20);
	});

	// base-ui reads an empty Combobox value as "nothing selected", so "Not linked"
	// needs a value of its own — one that cannot be mistaken for an employee id.
	it('gives "Not linked" a sentinel that cannot be an employee id', () => {
		expect(NO_EMPLOYEE).not.toBe('');
	});

	// The lookup reads and the picker's search must ask for the SAME columns, or
	// one of them would label a row differently from the other.
	it('asks for the columns the employee label is built from', () => {
		const fields = EMPLOYEE_FIELDS.split(',');
		expect(fields).toContain('name_mm');
		expect(fields).toContain('name_en');
		expect(fields).toContain('etg_id');
	});
});

describe('roleNameMap', () => {
	it('indexes roles by id', () => {
		const map = roleNameMap([
			{ id: 'r1', name: 'Administrator' },
			{ id: 'r2', name: 'Employee' },
		]);
		expect(map.get('r2')).toBe('Employee');
		expect(map.get('nope')).toBeUndefined();
	});
});

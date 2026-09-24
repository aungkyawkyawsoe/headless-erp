import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList, Input } from '@mmbix/design-system';
import { ArrowLeft, Plus, Save } from 'lucide-react';
import { createUser, updateUser, type StudioUser, type UpdateStudioUserInput } from '../../lib/api';
import { itemsQuery, rolesQuery, serverMetaQuery, usersQuery } from '../../lib/queries';
import { invalidateUsers } from '../../lib/query-client';
import {
	displayNameOf,
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
	NO_EMPLOYEE,
	roleNameMap,
	telegramIdOf,
	userStateOf,
	type EmployeeRow,
	type UserState,
} from '../../lib/users';

/**
 * Users — the `_users` registry, the Directus-style account table.
 *
 * ONE table backs three surfaces (the mini app's employees, the Studio, the IDP
 * portal) and holds three kinds of principal in the same rows: the bootstrap
 * admin, password accounts, and the identities the Telegram login route
 * provisions. So the job here is to make those kinds READABLE and each row's
 * editable surface match what the backend will actually honour — never to invent
 * a second place where credentials live.
 *
 * Credentials deliberately have no column: the API never returns `password_hash`
 * (`AuthService.SAFE_USER_FIELDS`) and this screen only ever WRITES a new one.
 * "Change the password" therefore reads as "set a new one" — there is nothing to
 * reveal, and nothing here should ever suggest otherwise.
 *
 * Mounted by BOTH the Studio Admin settings page and the IDP portal (the same
 * component, the pattern `RolesTab` already follows) so the two surfaces cannot
 * drift into two implementations.
 */

/** Mirrors `AuthService.createUser`'s own floor — the client blocks the 400
 *  instead of round-tripping for it. */
const MIN_PASSWORD_LENGTH = 6;

/** How long after the last keystroke a name becomes a directory search. */
const SEARCH_DEBOUNCE_MS = 300;

const sectionTitle = {
	fontSize: '0.66rem',
	fontWeight: 700,
	textTransform: 'uppercase' as const,
	letterSpacing: '0.05em',
	color: '#64748b',
};
const note = { fontSize: '0.7rem', color: '#9ca3af', margin: 0 };
const field = {
	width: '100%',
	boxSizing: 'border-box' as const,
	height: 28,
	fontSize: '0.74rem',
	padding: '0 0.45rem',
	borderRadius: 6,
	border: '1px solid var(--mmbix-border, #e5e7eb)',
	background: 'var(--mmbix-card, #fff)',
	outline: 'none',
};
const th = { textAlign: 'left' as const, padding: '0.2rem 0.4rem', color: '#9ca3af', fontWeight: 600 };
const td = { padding: '0.3rem 0.4rem', verticalAlign: 'top' as const };

/** Pre-attentive state colour — the column is scanned, not read. */
const STATE_COLOR: Record<UserState, string> = { active: '#059669', disabled: '#dc2626', unknown: '#9ca3af' };
const STATE_LABEL: Record<UserState, string> = { active: 'Active', disabled: 'Disabled', unknown: 'Unknown' };

/** The dialog is one component in two modes — a new account, or one row. */
type Editor = { mode: 'new' } | { mode: 'edit'; user: StudioUser };

interface FormState {
	email: string;
	fullName: string;
	password: string;
	roleId: string;
	/** The directory row this account signs in as; `''` = not linked. */
	employeeId: string;
	disabled: boolean;
}

const employeeName = { fontWeight: 600 } as const;
const muted = { color: '#9ca3af' } as const;

export function UsersTab({ token, currentEmail }: { token: string; currentEmail?: string }) {
	const queryClient = useQueryClient();
	// Both reads are session-level and shared: `qk.users()` is also what the API
	// Keys tab resolves its owner labels from, `qk.roles()` what every role picker
	// in the Studio reads. Opening this tab twice therefore costs zero reads.
	const usersQ = useQuery(usersQuery(token));
	const rolesQ = useQuery(rolesQuery(token));
	const metaQ = useQuery(serverMetaQuery(token));
	const users = useMemo(() => usersQ.data ?? [], [usersQ.data]);
	const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
	// The employee-directory collection is CONFIG-DRIVEN server-side (advertised
	// on `/api/meta`) — never a hardcoded name. Empty ⇒ this deployment has no
	// directory, so the employee column is absent (accounts stay administrable).
	const directory = metaQ.data?.identity?.directory_collection ?? '';

	// ── The employee directory, read by LOOKUP — never as a roster ────────────
	//
	// Naming what the table shows needs exactly the employees the ACCOUNTS refer to:
	// a password account's `_users.employee_id`, a Telegram account's `etg_id` (the
	// id inside its `tg-<id>` address). So that is what is asked for, as two bounded
	// `_in` reads — each capped by the number of accounts, not by the size of the
	// staff. The roster read this replaces pulled every employee (a 500-row ceiling)
	// over the wire to label a couple of rows.
	//
	// A deployment with no configured directory collection fails whichever read
	// actually runs — deliberately NOT a hard error: accounts stay administrable
	// and the employee control says so.
	const linkLookup = useMemo(() => employeeLinkLookup(users), [users]);
	const linkedQ = useQuery({
		...itemsQuery(token, directory, {
			fields: EMPLOYEE_FIELDS,
			limit: 500,
			filters: { id: { operator: '_in', value: linkLookup.ids.join(',') } },
		}),
		enabled: !!token && !!directory && linkLookup.ids.length > 0,
	});
	const linkedTgQ = useQuery({
		...itemsQuery(token, directory, {
			fields: EMPLOYEE_FIELDS,
			limit: 500,
			filters: { etg_id: { operator: '_in', value: linkLookup.tgIds.join(',') } },
		}),
		enabled: !!token && !!directory && linkLookup.tgIds.length > 0,
	});

	// The picker's own search — the one directory read whose size follows what is
	// TYPED, so the control needs no roster to offer every employee.
	const [employeeTerm, setEmployeeTerm] = useState('');
	const [employeeSearch, setEmployeeSearch] = useState('');
	// Debounced: a typed name costs one search, not one per keystroke.
	useEffect(() => {
		const t = setTimeout(() => setEmployeeSearch(employeeTerm), SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(t);
	}, [employeeTerm]);
	const employeeSearchQ = useQuery({
		...itemsQuery(token, directory, {
			search: employeeSearch.trim(),
			fields: EMPLOYEE_FIELDS,
			limit: EMPLOYEE_SEARCH_LIMIT,
		}),
		// Below the floor a term matches most of the directory — the read this picker
		// exists to avoid — so nothing is asked for until a name starts to be a name.
		enabled: !!token && !!directory && employeeSearch.trim().length >= EMPLOYEE_SEARCH_MIN,
	});

	const searchRows = useMemo(() => (employeeSearchQ.data?.rows ?? []) as unknown as EmployeeRow[], [employeeSearchQ.data]);
	const employees = useMemo(
		() => [...((linkedQ.data?.rows ?? []) as unknown as EmployeeRow[]), ...((linkedTgQ.data?.rows ?? []) as unknown as EmployeeRow[])],
		[linkedQ.data, linkedTgQ.data],
	);
	// A directory is available when the server advertises one AND no directory
	// read has failed (a missing table degrades to "no directory", never a crash).
	const directoryAvailable = !!directory && !(linkedQ.error ?? linkedTgQ.error ?? employeeSearchQ.error);

	const roleNames = useMemo(() => roleNameMap(roles), [roles]);
	const roleNameOf = useMemo(
		() => (id: string | null | undefined) => {
			if (!id) return 'No role';
			return roleNames.get(id) ?? 'Unknown role';
		},
		[roleNames],
	);

	// The label source. The lookup reads cover the accounts; the picker's own search
	// results are folded in so an option is labelled the instant it arrives, with no
	// second read.
	const employeeNames = useMemo(() => {
		const map = employeeNameMap(employees);
		for (const row of searchRows) map.set(row.id, employeeLabelOf(row));
		return map;
	}, [employees, searchRows]);
	// `etg_id` → employee, so a Telegram account resolves to the same employee the
	// password rows name, from the row it is actually linked through.
	const employeeNamesByTgId = useMemo(() => employeeTgNameMap(employees), [employees]);

	/** Which employee an account acts as — by explicit link, or (Telegram) by the
	 *  address the login route provisions it under. Empty when neither resolves. */
	const employeeOf = useMemo(
		() => (user: StudioUser) => {
			if (user.employee_id) return employeeNames.get(user.employee_id) ?? user.employee_id;
			const tgId = telegramIdOf(user);
			return tgId ? (employeeNamesByTgId.get(tgId) ?? '') : '';
		},
		[employeeNames, employeeNamesByTgId],
	);

	const [query, setQuery] = useState('');
	const [editor, setEditor] = useState<Editor | null>(null);
	const [form, setForm] = useState<FormState>({ email: '', fullName: '', password: '', roleId: '', employeeId: '', disabled: false });
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<string | null>(null);

	const filtered = useMemo(() => filterUsers(users, query, roleNameOf, employeeOf), [users, query, roleNameOf, employeeOf]);

	/** The account this session is signed in as. Editing it is allowed; DISABLING it
	 *  is not — that would revoke the operator's own access, and the recovery path
	 *  is another admin, not this screen. */
	const selfEmail = (currentEmail ?? '').trim().toLowerCase();
	const isSelf = (user: StudioUser) => selfEmail !== '' && user.email.toLowerCase() === selfEmail;

	function openNew() {
		// Default to the role most new accounts here want, so the common case is one
		// less decision — never to no role at all, which the API would accept and
		// which produces an account that can do nothing.
		const preferred = roles.find((r) => /^employee$/i.test(r.name)) ?? roles[0];
		setForm({ email: '', fullName: '', password: '', roleId: preferred?.id ?? '', employeeId: '', disabled: false });
		setMsg(null);
		// A term typed for a previous editor session must not re-run against this one.
		setEmployeeTerm('');
		setEmployeeSearch('');
		setEditor({ mode: 'new' });
	}

	function openEdit(user: StudioUser) {
		setForm({
			email: user.email,
			fullName: user.full_name ?? '',
			password: '',
			roleId: user.role_id ?? '',
			employeeId: user.employee_id ?? '',
			disabled: userStateOf(user) === 'disabled',
		});
		setMsg(null);
		setEmployeeTerm('');
		setEmployeeSearch('');
		setEditor({ mode: 'edit', user });
	}

	/** Leave the editor for the list. The message belongs to the LIST's frame, so it
	 *  goes with it — a stale "Account updated." must not greet the next account. */
	function closeEditor() {
		setEditor(null);
		setMsg(null);
	}

	async function submit() {
		if (!editor) return;
		const isTelegram = editor.mode === 'edit' && identityKindOf(editor.user) === 'telegram';
		const name = form.fullName.trim();
		const email = form.email.trim();

		if (!email) return setMsg('An email is required — it is the sign-in identity.');
		// A Telegram row's role and name are re-synced from the employee directory on
		// every sign-in, so this form does not pretend to own them.
		if (!isTelegram && !name) return setMsg('A full name is required.');
		if (!isTelegram && !form.roleId) return setMsg('Pick a role — an account without one can do nothing.');
		if (editor.mode === 'new' && form.password.length < MIN_PASSWORD_LENGTH) {
			return setMsg(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
		}

		setBusy(true);
		setMsg(null);
		try {
			if (editor.mode === 'new') {
				await createUser(token, {
					email,
					password: form.password,
					full_name: name,
					role_id: form.roleId,
					employee_id: form.employeeId || null,
				});
			} else {
				const user = editor.user;
				const disabledNow = userStateOf(user) === 'disabled';
				const body: UpdateStudioUserInput = {};
				// Only what actually changed — an identical re-send would touch
				// `updated_at`, which each authz lookup keys off, evicting every
				// permission cache for a no-op.
				if (!isTelegram) {
					if (name !== (user.full_name ?? '').trim()) body.full_name = name;
					if (form.roleId !== (user.role_id ?? '')) body.role_id = form.roleId;
					if (email.toLowerCase() !== user.email.toLowerCase()) body.email = email;
					// `null` UNLINKS (the API distinguishes it from `undefined`), so a
					// binding made to the wrong person can be taken back.
					if (form.employeeId !== (user.employee_id ?? '')) body.employee_id = form.employeeId || null;
				}
				// Disabling yourself is the one edit this screen refuses to make.
				if (!isSelf(user) && form.disabled !== disabledNow) body.status = form.disabled ? 'disabled' : 'active';
				if (form.password) body.password = form.password;

				if (Object.keys(body).length === 0) {
					setMsg('Nothing changed.');
					setBusy(false);
					return;
				}
				await updateUser(token, user.id, body);
			}
			setEditor(null);
			await invalidateUsers(queryClient);
			setMsg(editor.mode === 'new' ? 'Account created.' : 'Account updated.');
		} catch (err) {
			setMsg(err instanceof Error ? err.message : 'Save failed');
		} finally {
			setBusy(false);
		}
	}

	const editingTelegram = editor?.mode === 'edit' && identityKindOf(editor.user) === 'telegram';
	const editingSelf = editor?.mode === 'edit' && isSelf(editor.user);
	// A Telegram row has no password by construction (the login route stores an
	// unverifiable marker) — so the field is absent rather than a control whose
	// value nothing would ever check.
	const showPassword = !editingTelegram;
	const loadError = usersQ.error ?? rolesQ.error;
	// ONE judgement for the message's tone AND its announcement: a refused save is an
	// alert, a confirmation is just a sentence. Kept as one regex so the colour and
	// the role can never disagree about which message this was.
	const msgIsFailure = msg !== null && /fail|required|least|changed|Nothing/i.test(msg);

	// ── The employee picker's view ────────────────────────────────────────────
	// The options are "Not linked", the account's CURRENT employee (so the selection
	// renders before anything is typed), then whatever the search returned — and
	// nothing else. That is what keeps the control's cost proportional to what was
	// typed instead of to the size of the staff.
	const employeeOptions = useMemo(() => {
		const ids = [NO_EMPLOYEE];
		if (form.employeeId) ids.push(form.employeeId);
		for (const row of searchRows) if (!ids.includes(row.id)) ids.push(row.id);
		return ids;
	}, [form.employeeId, searchRows]);

	const employeeLabel = (id: string, long = false): string => {
		if (id === NO_EMPLOYEE) return long ? 'Not linked — can sign in, cannot act as an employee' : 'Not linked';
		return employeeNames.get(id) ?? id;
	};

	// What the popup says when it has nothing to offer. Stated rather than left as
	// an empty box: an empty list reads like a bug, and "type more" is an
	// instruction the operator can act on.
	const typed = employeeTerm.trim();
	const employeeHint = !directoryAvailable
		? null // the note above the table already says the directory is missing
		: typed.length > 0 && typed.length < EMPLOYEE_SEARCH_MIN
			? `Type ${EMPLOYEE_SEARCH_MIN} or more characters to search the directory.`
			: employeeSearchQ.isFetching
				? 'Searching…'
				: employeeSearch.trim().length >= EMPLOYEE_SEARCH_MIN && employeeSearchQ.isSuccess && searchRows.length === 0
					? 'No employee matches that name.'
					: null;

	// ── The editor: the WHOLE tab surface ─────────────────────────────────────
	//
	// Deliberately NOT a 420px modal. The account being edited is the subject of
	// this screen, so it gets the screen: a title bar that names it, the fields on a
	// grid that uses whatever width it has (`auto-fit`, so a narrow IDP-portal
	// column still collapses to one), and the actions on their own bar. The Employee
	// picker is the control this screen exists for, and its search popup was exactly
	// the cramped case a modal card created.
	//
	// The LIST is unmounted while this shows, so there is no overlay to click and no
	// doubt left about which of the two the operator is looking at.
	if (editor) {
		const isNew = editor.mode === 'new';
		return (
			<section
				role="region"
				aria-labelledby="user-editor-title"
				style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0.75rem 0.9rem' }}
			>
				{/* Leaving is a NAMED action now. The list is gone, so there is nothing to
				    click outside of and no way back that the operator has to guess. */}
				<div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
					<Button variant="outline" size="sm" onClick={closeEditor}>
						<ArrowLeft size={12} /> Users
					</Button>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
						<h2 id="user-editor-title" style={{ margin: 0, fontSize: '0.92rem', fontWeight: 700 }}>
							{isNew ? 'New user' : 'Edit user'}
						</h2>
						{/* Which account this is — the one thing an editor for a table cannot
						    leave the operator to infer from the form's contents. */}
						<p style={{ ...note, overflowWrap: 'anywhere' }}>
							{isNew ? 'An account for somebody who signs in with an email and password.' : editor.user.email}
						</p>
					</div>
				</div>

				{editingSelf && <p style={note}>This is your own account.</p>}

				{editingTelegram && (
					<p style={{ ...note, maxWidth: '46rem' }}>
						This account is provisioned from the employee directory. Its name and role are re-read from the directory on every Telegram
						sign-in, so they are shown read-only here — change the employee&apos;s role in the directory instead.
					</p>
				)}

				<div
					style={{
						display: 'grid',
						gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
						gap: '0.8rem 1rem',
						alignItems: 'start',
					}}
				>
					<Field id="user-email" label="Email">
						<Input
							id="user-email"
							type="email"
							autoComplete="off"
							autoFocus
							value={form.email}
							// A Telegram row's email is the marker the login route looks itself up
							// by; renaming it would orphan the account and provision a second one.
							disabled={editingTelegram}
							onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
							style={field}
						/>
					</Field>

					<Field id="user-name" label="Full name">
						<Input
							id="user-name"
							value={form.fullName}
							disabled={editingTelegram}
							onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
							style={field}
						/>
					</Field>

					<Field id="user-role" label="Role">
						<select
							id="user-role"
							value={form.roleId}
							disabled={editingTelegram}
							onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
							style={field}
						>
							<option value="">Pick a role…</option>
							{roles.map((role) => (
								<option key={role.id} value={role.id}>
									{role.name}
								</option>
							))}
						</select>
					</Field>

					{/* The link that makes a web sign-in ACT as somebody. Absent for a Telegram
					    row on purpose: its employee is the directory row its `tg-<id>` address
					    already names, so offering a second, editable link would give the same
					    fact two sources of truth — and the wrong one would win. */}
					{!editingTelegram && (
						<Field
							id="user-employee"
							label="Employee"
							hint={<p style={note}>Signs in as this employee, and stops working the moment they are offboarded.</p>}
						>
							{/* A SEARCHABLE picker, not a 250-option `<select>`: the directory is asked
							    for only what is TYPED (three or more characters, debounced), so naming a
							    link costs one bounded read instead of dragging the whole staff over the
							    wire — and a directory of 250 is choosable from, unlike a 250-row select. */}
							<Combobox
								value={form.employeeId || NO_EMPLOYEE}
								items={employeeOptions}
								onValueChange={(v) => setForm((f) => ({ ...f, employeeId: v && v !== NO_EMPLOYEE ? String(v) : '' }))}
								onInputValueChange={(v) => setEmployeeTerm(String(v))}
								// The SERVER already filtered; re-filtering its results by the raw term
								// would hide a match found on a field the label does not show (an `eid`,
								// a Burmese name the row renders in English).
								filter={null}
								itemToStringLabel={(v) => employeeLabel(String(v))}
							>
								<ComboboxInput
									id="user-employee"
									aria-label="Employee"
									showTrigger
									placeholder={`Search by name (${EMPLOYEE_SEARCH_MIN}+ characters)…`}
									disabled={!directoryAvailable}
									style={field}
								/>
								<ComboboxContent align="start" sideOffset={4} style={{ width: 360 }}>
									<ComboboxList>
										{(id: string) => (
											<ComboboxItem key={id} value={id}>
												{employeeLabel(id, true)}
											</ComboboxItem>
										)}
									</ComboboxList>
									{employeeHint && <p style={{ ...note, padding: '0.35rem 0.6rem 0.45rem' }}>{employeeHint}</p>}
								</ComboboxContent>
							</Combobox>
						</Field>
					)}

					{showPassword && (
						<Field id="user-password" label={isNew ? 'Password' : 'New password'}>
							<Input
								id="user-password"
								type="password"
								autoComplete="new-password"
								value={form.password}
								onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
								placeholder={isNew ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Leave blank to keep the current one'}
								style={field}
							/>
						</Field>
					)}
				</div>

				{!isNew && (
					<div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
						<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
							<Checkbox
								aria-label="Disabled — block sign-in"
								checked={form.disabled}
								disabled={editingSelf}
								onCheckedChange={(checked) => setForm((f) => ({ ...f, disabled: checked === true }))}
							/>
							<span style={{ fontSize: '0.72rem' }}>Disabled — blocks sign-in immediately</span>
						</div>
						{editingSelf && <p style={note}>You cannot disable the account you are signed in with.</p>}
					</div>
				)}

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
						paddingTop: 10,
					}}
				>
					<Button variant="outline" size="sm" onClick={closeEditor}>
						Cancel
					</Button>
					<Button size="sm" onClick={() => void submit()} disabled={busy}>
						<Save size={12} /> {busy ? 'Saving…' : isNew ? 'Create user' : 'Save changes'}
					</Button>
					{msg && (
						<p role={msgIsFailure ? 'alert' : undefined} style={{ ...note, color: msgIsFailure ? '#d97706' : '#059669' }}>
							{msg}
						</p>
					)}
				</div>
			</section>
		);
	}

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0.75rem 0.9rem' }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
				<span style={sectionTitle}>Users</span>
				<span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>{users.length}</span>
				<Button size="sm" style={{ marginLeft: 'auto' }} disabled={!rolesQ.isSuccess} onClick={openNew}>
					<Plus size={12} /> New user
				</Button>
			</div>
			<p style={note}>
				Every account that can sign in. Employees sign in through Telegram (provisioned from the employee directory) or here with an email
				and password — an account that is linked to an employee acts as that employee, and stops working the moment they are offboarded.
			</p>

			<Input
				aria-label="Search users"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search by name, email, role or employee"
			/>

			{loadError && (
				<p role="alert" style={{ ...note, color: '#dc2626' }}>
					{loadError instanceof Error ? loadError.message : 'Failed to load users'}
				</p>
			)}

			{!directoryAvailable && (
				<p style={note}>No employee directory in this deployment — accounts can still be managed, and a link is shown by its id.</p>
			)}

			{usersQ.isLoading ? (
				<p style={note}>Loading accounts…</p>
			) : filtered.length === 0 ? (
				<p style={note}>
					{users.length === 0 ? 'No accounts yet — create one to allow an email + password sign-in.' : `No account matches “${query}”.`}
				</p>
			) : (
				<div style={{ overflowX: 'auto', maxHeight: 460, overflowY: 'auto' }}>
					<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
						<thead style={{ position: 'sticky', top: 0, background: 'var(--mmbix-card, #fff)', zIndex: 1 }}>
							<tr>
								<th style={th}>Account</th>
								<th style={th}>Signs in via</th>
								<th style={th}>Employee</th>
								<th style={th}>Role</th>
								<th style={th}>Status</th>
								<th style={th}>Last sign-in</th>
								<th style={th}>Created</th>
								<th style={{ ...th, textAlign: 'right' }} />
							</tr>
						</thead>
						<tbody>
							{filtered.map((user) => {
								const state = userStateOf(user);
								return (
									<tr key={user.id} style={{ borderTop: '1px solid var(--mmbix-border, #e5e7eb)' }}>
										<td style={td}>
											<div style={{ fontWeight: 600 }}>{displayNameOf(user)}</div>
											<div style={{ fontSize: '0.66rem', color: '#9ca3af' }}>{user.email}</div>
										</td>
										<td style={{ ...td, color: '#6b7280' }}>{IDENTITY_KIND_LABEL[identityKindOf(user)]}</td>
										<td style={td}>
											{/* Which employee this account acts as. An account with none can sign in
											    but cannot punch, file leave or move stock — a state worth SEEING, so
											    it is stated rather than left as an empty cell. */}
											{employeeOf(user) ? <span style={employeeName}>{employeeOf(user)}</span> : <span style={muted}>Not linked</span>}
										</td>
										<td style={{ ...td, color: user.role_id ? '#1d4ed8' : '#9ca3af' }}>{roleNameOf(user.role_id)}</td>
										<td style={{ ...td, fontWeight: 700, color: STATE_COLOR[state] }}>{STATE_LABEL[state]}</td>
										<td style={{ ...td, color: '#6b7280', whiteSpace: 'nowrap' }}>{formatStamp(user.last_login)}</td>
										<td style={{ ...td, color: '#9ca3af', whiteSpace: 'nowrap' }}>{formatStamp(user.created_at)}</td>
										<td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
											<Button size="sm" variant="outline" aria-label={`Edit ${user.email}`} onClick={() => openEdit(user)}>
												Edit
											</Button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			{msg && (
				<span role={msgIsFailure ? 'alert' : undefined} style={{ fontSize: '0.72rem', color: msgIsFailure ? '#d97706' : '#059669' }}>
					{msg}
				</span>
			)}
		</div>
	);
}

/**
 * One labelled field of the editor's grid.
 *
 * Extracted so the editor reads as a form rather than as repeated label + control
 * scaffolding — and so every label stays a real `<label for>`, which is the
 * contract the screen readers and the specs both rely on (`getByLabelText`).
 * `minWidth: 0` keeps a long employee name from stretching its grid track.
 */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
			<label htmlFor={id} style={note}>
				{label}
			</label>
			{children}
			{hint}
		</div>
	);
}

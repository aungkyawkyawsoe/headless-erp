import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	Button,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	Input,
	NativeSelect,
	NativeSelectOption,
	ToggleGroup,
	ToggleGroupItem,
} from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { Check, X } from 'lucide-react';
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
import { resolveUserView, USER_VIEWS, useUserView, type UserViewId } from '../../lib/user-view';
import StatusBadge from '../StatusBadge';

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
 *
 * The directory's saved VIEWS (Active / Suspended / Invited / All —
 * `lib/user-view.ts`) are URL state (`?view=`) in both homes. The portal renders
 * them in its panel, exactly as Directus keeps them in the sidebar; Studio Admin
 * has no panel, so it passes `viewsInToolbar` and they ride the table's toolbar.
 * One state, one vocabulary, two placements.
 */

/** Mirrors `AuthService.createUser`'s own floor — the client blocks the 400
 *  instead of round-tripping for it. */
const MIN_PASSWORD_LENGTH = 6;

/** How long after the last keystroke a name becomes a directory search. */
const SEARCH_DEBOUNCE_MS = 300;

const note = { fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', margin: 0 };
/** The editor's field labels — the role form's own section titles, so the two
 *  forms read as ONE design language (`role-detail-view.tsx`). */
const sectionTitle: React.CSSProperties = {
	fontSize: '0.62rem',
	fontWeight: 700,
	textTransform: 'uppercase',
	letterSpacing: '0.07em',
	color: 'var(--mmbix-muted-foreground, #64748b)',
};

/** State label; the colour comes from the ONE tokenized StatusBadge (see `lib/status.ts`). */
const STATE_LABEL: Record<UserState, string> = { active: 'Active', invited: 'Invited', suspended: 'Suspended', unknown: 'Unknown' };

/** The empty state's wording per view — the VIEW is named, because "no matches"
 *  would blame a search box nobody typed in. `all` can only be empty when there
 *  are no rows at all, which the branch above already owns. */
const VIEW_EMPTY: Record<UserViewId, string> = {
	active: 'No active accounts.',
	suspended: 'No suspended accounts.',
	invited: 'No invited accounts.',
	all: 'No accounts.',
};

/** The dialog is one component in two modes — a new account, or one row. */
type Editor = { mode: 'new' } | { mode: 'edit'; user: StudioUser };

interface FormState {
	email: string;
	fullName: string;
	password: string;
	roleId: string;
	/** The directory row this account signs in as; `''` = not linked. */
	employeeId: string;
	/** The lifecycle state the form would write. `unknown` means the row arrived
	 *  without one — shown honestly, and never written back as a value. */
	status: UserState;
	/** True once the operator picks a status themselves. In NEW mode the select
	 *  otherwise mirrors the credential rule: no password yet ⇒ `invited`. */
	statusPicked: boolean;
}

/** Whether a save would write anything — the header's ✓ is dimmed until it
 *  would, the role form's own rule. A NEW account needs its identity (an email)
 *  to exist; an EDIT form counts only the fields `submit` may actually write —
 *  a Telegram row's name/role/email are re-synced from the directory on every
 *  sign-in, and nobody changes their own status — so the control can never
 *  promise a write the API would ignore. */
function userFormDirty(form: FormState, editor: Editor, selfEmail: string): boolean {
	if (editor.mode === 'new') return form.email.trim() !== '';
	const u = editor.user;
	const selfRow = selfEmail !== '' && u.email.toLowerCase() === selfEmail;
	if (identityKindOf(u) !== 'telegram') {
		if (form.email.trim().toLowerCase() !== u.email.toLowerCase()) return true;
		if (form.fullName.trim() !== (u.full_name ?? '')) return true;
		if (form.roleId !== (u.role_id ?? '')) return true;
		if (form.employeeId !== (u.employee_id ?? '')) return true;
	}
	if (!selfRow && form.status !== 'unknown' && form.status !== userStateOf(u)) return true;
	return form.password !== '';
}

const employeeName = { fontWeight: 600 } as const;
const muted = { color: 'var(--mmbix-muted-foreground, #9ca3af)' } as const;

export function UsersTab({
	token,
	currentEmail,
	viewsInToolbar = false,
	onEditorChange,
}: {
	token: string;
	currentEmail?: string;
	/**
	 * Whether the saved views ride the table's TOOLBAR. The portal sets nothing:
	 * its panel (tier 2, `ViewsPanel`) carries them as the Directus sidebar does,
	 * and a second control in the toolbar would be the same filter twice. Studio
	 * Admin has no panel — its sidebar is the admin tab list — so it passes
	 * `true` and the toggle rides the toolbar instead. Either way the state is
	 * the SAME `?view=` (`lib/user-view.ts`), so the two surfaces cannot
	 * disagree about which view is up.
	 */
	viewsInToolbar?: boolean;
	/**
	 * Reports whether the whole-surface editor is open, so the host can react.
	 * The IDP portal uses it to drop its shell header while the form is up — the
	 * form carries its own Directus-style header (the title + the circular ✓/✕)
	 * and the crumb row above it would be a second chrome band, the exact rule
	 * `UserRolesPage` follows. Studio Admin passes nothing: its chrome belongs to
	 * the admin tab shell, which stays.
	 */
	onEditorChange?: (open: boolean) => void;
}) {
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
	// Which saved view the table shows. URL-backed (`?view=` — replace): the
	// panel, the toolbar toggle (where one renders) and a pasted link are all the
	// same state. A bare URL lands on Active — the Directus default.
	const { view, selectView } = useUserView();
	const [editor, setEditor] = useState<Editor | null>(null);
	const [form, setForm] = useState<FormState>({
		email: '',
		fullName: '',
		password: '',
		roleId: '',
		employeeId: '',
		status: 'active',
		statusPicked: false,
	});
	const [busy, setBusy] = useState(false);
	// The one status line: its text, and whether it was a refusal — a single flag
	// decides BOTH the tone and the `role="alert"` announcement, so a failure can
	// never render (or be announced) as a confirmation.
	const [msg, setMsg] = useState<string | null>(null);
	const [msgFailed, setMsgFailed] = useState(false);
	function say(text: string, failed = false) {
		setMsg(text);
		setMsgFailed(failed);
	}
	// The host's view of the editor's open state (see `onEditorChange`) — one
	// effect rather than a call in each open/close path, so a future way in or
	// out cannot forget to report.
	useEffect(() => {
		onEditorChange?.(editor !== null);
	}, [editor, onEditorChange]);

	const filtered = useMemo(() => {
		const base = filterUsers(users, query, roleNameOf, employeeOf);
		// The view rides ON TOP of the text search — two independent predicates, so
		// "suspended, named Mya" is expressible. `all` claims nothing about a row.
		return view === 'all' ? base : base.filter((u) => userStateOf(u) === view);
	}, [users, query, roleNameOf, employeeOf, view]);

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
		setForm({ email: '', fullName: '', password: '', roleId: preferred?.id ?? '', employeeId: '', status: 'active', statusPicked: false });
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
			status: userStateOf(user),
			statusPicked: true,
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
		setMsgFailed(false);
	}

	// The editor's Status control shows the SAME rule the payload applies (see
	// `submit`), so what is displayed is what will be sent: in NEW mode the state
	// follows the credential until the operator says otherwise — no password yet
	// means the account will be created `invited`.
	const shownStatus: UserState = editor?.mode === 'new' && !form.statusPicked ? (form.password ? 'active' : 'invited') : form.status;

	async function submit() {
		if (!editor) return;
		const isTelegram = editor.mode === 'edit' && identityKindOf(editor.user) === 'telegram';
		const name = form.fullName.trim();
		const email = form.email.trim();

		if (!email) return say('An email is required — it is the sign-in identity.', true);
		// A Telegram row's role and name are re-synced from the employee directory on
		// every sign-in, so this form does not pretend to own them.
		if (!isTelegram && !name) return say('A full name is required.', true);
		if (!isTelegram && !form.roleId) return say('Pick a role — an account without one can do nothing.', true);
		if (editor.mode === 'new') {
			// A password is OPTIONAL now (blank ⇒ invited), but a real one must clear
			// the same floor the API enforces.
			if (form.password && form.password.length < MIN_PASSWORD_LENGTH) {
				return say(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`, true);
			}
			if (!form.password && shownStatus === 'active') {
				return say('A password is required for an active account — set one, or choose Invited.', true);
			}
		}

		setBusy(true);
		setMsg(null);
		try {
			if (editor.mode === 'new') {
				await createUser(token, {
					email,
					full_name: name,
					role_id: form.roleId,
					employee_id: form.employeeId || null,
					// `unknown` is only reachable on an EDIT form (a row that arrived
					// without a status); a new form can never produce it — and if one
					// ever did, `invited` is the only safe reading: an account that
					// cannot sign in until it is deliberately activated.
					status: shownStatus === 'unknown' ? 'invited' : shownStatus,
					// Absent, never empty — an invited account is DEFINED by having no
					// credential, so no password key may be sent for it.
					password: form.password || undefined,
				});
			} else {
				const user = editor.user;
				const statusNow = userStateOf(user);
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
				// Suspending or re-activating carries the same self-guard; `unknown` is
				// never written — it is what the row READS as, not a state to store.
				if (!isSelf(user) && form.status !== 'unknown' && form.status !== statusNow) body.status = form.status;
				if (form.password) body.password = form.password;

				if (Object.keys(body).length === 0) {
					say('Nothing changed.', true);
					setBusy(false);
					return;
				}
				await updateUser(token, user.id, body);
			}
			setEditor(null);
			await invalidateUsers(queryClient);
			say(editor.mode === 'new' ? 'Account created.' : 'Account updated.');
		} catch (err) {
			say(err instanceof Error ? err.message : 'Save failed', true);
		} finally {
			setBusy(false);
		}
	}

	const editingTelegram = editor?.mode === 'edit' && identityKindOf(editor.user) === 'telegram';
	const editingSelf = editor?.mode === 'edit' && isSelf(editor.user);
	/** The row is invited — its password field ACTIVATES it, so it asks for one. */
	const editingInvited = editor?.mode === 'edit' && userStateOf(editor.user) === 'invited';
	// A Telegram row has no password by construction (the login route stores an
	// unverifiable marker) — so the field is absent rather than a control whose
	// value nothing would ever check.
	const showPassword = !editingTelegram;
	// Two distinct failures, two distinct homes: a failed USERS read is what the
	// table could not show, so it belongs in the table's own error state; a failed
	// ROLES read only costs the Role column its names — said above the table.
	const usersError = usersQ.error ? (usersQ.error instanceof Error ? usersQ.error.message : 'Failed to load users') : null;
	const rolesError = rolesQ.error ? (rolesQ.error instanceof Error ? rolesQ.error.message : 'Failed to load roles') : null;
	// ONE judgement for the message's tone AND its announcement — the flag the
	// writer set, never a word-sniff over the text, so a server error phrased in
	// new words still reads (and is announced) as a failure.
	const msgIsFailure = msg !== null && msgFailed;

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
		? null // the picker is disabled, so the FIELD's hint carries this, not the popup
		: typed.length > 0 && typed.length < EMPLOYEE_SEARCH_MIN
			? `Type ${EMPLOYEE_SEARCH_MIN} or more characters to search the directory.`
			: employeeSearchQ.isFetching
				? 'Searching…'
				: employeeSearch.trim().length >= EMPLOYEE_SEARCH_MIN && employeeSearchQ.isSuccess && searchRows.length === 0
					? 'No employee matches that name.'
					: null;

	// ── The editor: the WHOLE tab surface ─────────────────────────────────────
	//
	// Deliberately NOT a 420px modal, and deliberately the SAME chrome as the role
	// profile form (`role-detail-view.tsx`, mode='role'): the record names itself
	// on the left with a note under it, the circular icon-only actions sit at the
	// header's right edge — the ONE Save (a ✓, dimmed until a writable field
	// differs) and the ✕ that leaves the form — and the fields are a TWO-COLUMN
	// grid of uppercase-labelled DS controls (Email | Full name, Role | Status,
	// Employee | Password), so the form reads in two glances instead of one long
	// scroll. There is no back button and no bottom action bar; the ✕ is the way
	// out, so the form reads as one surface, not a dialog with scaffolding.
	//
	// The LIST is unmounted while this shows, so there is no overlay to click and no
	// doubt left about which of the two the operator is looking at.
	if (editor) {
		const isNew = editor.mode === 'new';
		const canSave = userFormDirty(form, editor, selfEmail);
		return (
			<section
				role="region"
				aria-labelledby="user-editor-title"
				style={{ padding: '1.25rem', maxWidth: 960, margin: '0 auto' }}
			>
				<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: '1.5rem' }}>
					<div style={{ minWidth: 0 }}>
						<h1 id="user-editor-title" style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
							{isNew ? 'New user' : 'Edit user'}
						</h1>
						{/* Which account this is — the one thing an editor for a table cannot
						    leave the operator to infer from the form's contents. */}
						<p style={{ ...note, overflowWrap: 'anywhere' }}>
							{isNew ? 'An account for somebody who signs in with an email and password.' : editor.user.email}
						</p>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
						<Button
							variant="default"
							size="icon"
							className="rounded-full"
							disabled={busy || !canSave}
							title={!canSave ? 'No changes to save' : isNew ? 'Create the account' : 'Save changes'}
							aria-label="Save"
							onClick={() => void submit()}
						>
							<Check />
						</Button>
						<Button variant="secondary" size="icon" className="rounded-full" title="Close" aria-label="Close" onClick={closeEditor}>
							<X />
						</Button>
					</div>
				</div>

				{editingSelf && <p style={{ ...note, marginBottom: '1rem' }}>This is your own account.</p>}

				{editingTelegram && (
					<p style={{ ...note, maxWidth: '46rem', marginBottom: '1rem' }}>
						This account is provisioned from the employee directory. Its name and role are re-read from the directory on every Telegram
						sign-in, so they are shown read-only here — change the employee&apos;s role in the directory instead.
					</p>
				)}

				{/* TWO columns, paired by what the field decides: who the account is
				    (Email | Full name), what it may do (Role | Status) and what it acts
				    as (Employee | Password). Rows flow, so a Telegram row (no Employee,
				    no Password) simply ends at the shorter grid. */}
				<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.25rem 1.5rem' }}>
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
						/>
					</Field>

					<Field id="user-name" label="Full name">
						<Input
							id="user-name"
							value={form.fullName}
							disabled={editingTelegram}
							onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
						/>
					</Field>

					<Field id="user-role" label="Role">
						<NativeSelect
							id="user-role"
							className="w-full"
							value={form.roleId}
							disabled={editingTelegram}
							onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
						>
							<NativeSelectOption value="">Pick a role…</NativeSelectOption>
							{roles.map((role) => (
								<NativeSelectOption key={role.id} value={role.id}>
									{role.name}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>

					{/* The lifecycle state — the same field Directus puts on a user's
					    Admin Options. The hint states what the CHOSEN state means, because
					    the two non-obvious ones (invited cannot sign in yet, suspended is
					    blocked now) are exactly what the operator is deciding. */}
					<Field
						id="user-status"
						label="Status"
						hint={
							editingSelf ? (
								<p style={note}>You cannot change the status of the account you are signed in with.</p>
							) : (
								<p style={note}>
									{shownStatus === 'invited'
										? 'Invited — the account exists but cannot sign in until a password is set.'
										: shownStatus === 'suspended'
											? 'Suspended — sign-in is blocked immediately.'
											: 'Active — can sign in.'}
								</p>
							)
						}
					>
						<NativeSelect
							id="user-status"
							className="w-full"
							value={shownStatus}
							disabled={editingSelf}
							onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as UserState, statusPicked: true }))}
						>
							{/* Rendered only while the row genuinely has no status, and disabled —
							    it is what the control must SHOW, never a state to write. */}
							{shownStatus === 'unknown' && (
								<NativeSelectOption value="unknown" disabled>
									Unknown — no status stored
								</NativeSelectOption>
							)}
							<NativeSelectOption value="active">Active</NativeSelectOption>
							<NativeSelectOption value="invited">Invited</NativeSelectOption>
							<NativeSelectOption value="suspended">Suspended</NativeSelectOption>
						</NativeSelect>
					</Field>

					{/* The link that makes a web sign-in ACT as somebody. Absent for a Telegram
					    row on purpose: its employee is the directory row its `tg-<id>` address
					    already names, so offering a second, editable link would give the same
					    fact two sources of truth — and the wrong one would win. */}
					{!editingTelegram && (
						<Field
							id="user-employee"
							label="Employee"
							hint={
								<p style={note}>
									{directoryAvailable
										? 'Signs in as this employee, and stops working the moment they are offboarded.'
										: 'No employee directory in this deployment — accounts can still be managed, and a link is shown by its id.'}
								</p>
							}
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
									className="w-full"
									showTrigger
									placeholder={`Search by name (${EMPLOYEE_SEARCH_MIN}+ characters)…`}
									disabled={!directoryAvailable}
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
						<Field id="user-password" label={isNew || editingInvited ? 'Password' : 'New password'}>
							<Input
								id="user-password"
								type="password"
								autoComplete="new-password"
								value={form.password}
								onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
								placeholder={
									isNew
										? shownStatus === 'invited'
											? 'Optional — leave blank to invite without one'
											: `At least ${MIN_PASSWORD_LENGTH} characters`
										: editingInvited
											? 'Set one to activate this account'
											: 'Leave blank to keep the current one'
								}
							/>
						</Field>
					)}
				</div>

				{msg && (
					<span
						role={msgIsFailure ? 'alert' : undefined}
						style={{
							display: 'block',
							marginTop: 12,
							fontSize: '0.72rem',
							color: msgIsFailure ? 'var(--mmbix-tone-warning-fg, #d97706)' : 'var(--mmbix-tone-positive-fg, #059669)',
						}}
					>
						{msg}
					</span>
				)}
			</section>
		);
	}

	// ── The list's columns (design-system DataTable) ──────────────────────────
	//
	// The same facts the raw table rendered, now as a real DataTable — the SHARED
	// table every other Studio surface uses: its toolbar owns the search box and the
	// Create action, so those controls exist once, in the system's shape. The
	// cross-field search is the caller's predicate (`manualFiltering`): it matches a
	// role NAME and an employee NAME, which a per-column accessor cannot.
	const columns: ColumnDef<StudioUser>[] = [
		{
			id: 'account',
			accessorKey: 'email',
			header: 'Account',
			cell: ({ row }) => (
				<div style={{ minWidth: 0 }}>
					<div style={{ fontWeight: 600 }}>{displayNameOf(row.original)}</div>
					<div style={{ fontSize: '0.66rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{row.original.email}</div>
				</div>
			),
		},
		{
			id: 'identity',
			header: 'Signs in via',
			accessorFn: (u) => IDENTITY_KIND_LABEL[identityKindOf(u)],
			cell: ({ row }) => (
				<span style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{IDENTITY_KIND_LABEL[identityKindOf(row.original)]}</span>
			),
		},
		{
			id: 'employee',
			header: 'Employee',
			accessorFn: (u) => employeeOf(u),
			cell: ({ row }) => {
				// Which employee this account acts as. An account with none can sign in
				// but cannot punch, file leave or move stock — a state worth SEEING, so
				// it is stated rather than left as an empty cell.
				const name = employeeOf(row.original);
				return name ? <span style={employeeName}>{name}</span> : <span style={muted}>Not linked</span>;
			},
		},
		{
			id: 'role',
			header: 'Role',
			accessorFn: (u) => roleNameOf(u.role_id),
			cell: ({ row }) => (
				<span style={{ color: row.original.role_id ? 'var(--mmbix-tone-info-fg, #1d4ed8)' : 'var(--mmbix-muted-foreground, #9ca3af)' }}>
					{roleNameOf(row.original.role_id)}
				</span>
			),
		},
		{
			id: 'status',
			header: 'Status',
			accessorFn: (u) => userStateOf(u),
			cell: ({ row }) => {
				const state = userStateOf(row.original);
				return <StatusBadge status={state} label={STATE_LABEL[state]} />;
			},
		},
		{
			id: 'last_login',
			accessorKey: 'last_login',
			header: 'Last sign-in',
			cell: ({ row }) => (
				<span style={{ color: 'var(--mmbix-muted-foreground, #6b7280)', whiteSpace: 'nowrap' }}>
					{formatStamp(row.original.last_login)}
				</span>
			),
		},
		{
			id: 'created_at',
			accessorKey: 'created_at',
			header: 'Created',
			cell: ({ row }) => (
				<span style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)', whiteSpace: 'nowrap' }}>
					{formatStamp(row.original.created_at)}
				</span>
			),
		},
		{
			id: 'actions',
			header: '',
			align: 'right',
			enableSorting: false,
			cell: ({ row }) => (
				<Button size="sm" variant="outline" aria-label={`Edit ${row.original.email}`} onClick={() => openEdit(row.original)}>
					Edit
				</Button>
			),
		},
	];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0.75rem 0.9rem' }}>
			{/* No title bar and no preamble: this surface IS the table, so the count
			    rides the table's own pagination and every action rides its toolbar. */}
			{rolesError && (
				<p role="alert" style={{ ...note, color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
					{rolesError}
				</p>
			)}

			<DataTable
				columns={columns}
				data={filtered}
				rowKey="id"
				density="compact"
				defaultPageSize={25}
				stickyHeader
				borderStyle="row"
				globalFilter={query}
				onGlobalFilterChange={setQuery}
				manualFiltering
				// The create action appears only once the roles are in — an account
				// without a role can do nothing, so the form must be able to offer one.
				onCreate={rolesQ.isSuccess ? openNew : undefined}
				isLoading={usersQ.isLoading}
				error={usersError}
				// The views render here ONLY on a surface that has no panel to carry
				// them (Studio Admin). The portal's panel IS the Directus sidebar, so
				// putting them here too would be one filter with two controls — the
				// same `?view=`, drawn twice. Pressing the active view is IGNORED, so
				// the table can never land in a "no view" state.
				toolbarActions={
					viewsInToolbar ? (
						<ToggleGroup
							value={[view]}
							onValueChange={(vals) => {
								const v = vals?.[0];
								if (v) selectView(resolveUserView(v));
							}}
							variant="outline"
							size="sm"
							spacing={0}
							aria-label="Filter by status"
						>
							{USER_VIEWS.map((v) => (
								<ToggleGroupItem key={v.id} value={v.id}>
									{v.label}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					) : undefined
				}
				labels={{
					searchPlaceholder: 'Search by name, email, role or employee',
					searchLabel: 'Search users',
					create: 'New user',
					// Three genuinely different empty states: nothing exists yet, the
					// search matched nothing, or the VIEW has nothing in it — the last
					// one names the view, because "no matches" would blame the search
					// box for an empty Invited list.
					empty:
						users.length === 0
							? 'No accounts yet — create one to allow an email + password sign-in.'
							: query
								? `No account matches “${query}”.`
								: VIEW_EMPTY[view],
				}}
			/>

			{msg && (
				<span
					role={msgIsFailure ? 'alert' : undefined}
					style={{
						fontSize: '0.72rem',
						color: msgIsFailure ? 'var(--mmbix-tone-warning-fg, #d97706)' : 'var(--mmbix-tone-positive-fg, #059669)',
					}}
				>
					{msg}
				</span>
			)}
		</div>
	);
}

/**
 * One labelled field of the editor's stack — the role form's own shape: an
 * uppercase section title over the control, notes underneath.
 *
 * Extracted so the editor reads as a form rather than as repeated label + control
 * scaffolding — and so every label stays a real `<label for>`, which is the
 * contract the screen readers and the specs both rely on (`getByLabelText`).
 */
function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
	return (
		<div style={{ minWidth: 0 }}>
			<label htmlFor={id} style={{ ...sectionTitle, marginBottom: 6, display: 'block' }}>
				{label}
			</label>
			{children}
			{hint}
		</div>
	);
}

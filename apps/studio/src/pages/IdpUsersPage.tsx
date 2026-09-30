import { useState } from 'react';
import IdpShell from '../components/IdpShell';
import { UsersTab } from '../components/admin/users-tab';

/**
 * Users — the account registry surfaced inside the IDP (developer) portal as its
 * own rail item, next to Roles & Access, mirroring the same table used under
 * Studio Admin.
 *
 * Same component, second home (the pattern `UserRolesPage` sets for the roles
 * registry): roles and the accounts that hold them are two halves of one
 * question — "who can do what?" — so an operator granting a role can see who is
 * actually on it without switching portals.
 */
export default function IdpUsersPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	// The account editor carries its own Directus-style header (the title + the
	// circular ✓/✕), so while it is open the shell's crumb row is dropped — the
	// same rule the two Roles & Access pages follow. The editor is the tab's own
	// state (not URL state), so the tab reports it up.
	const [editing, setEditing] = useState(false);
	return (
		<IdpShell
			token={token}
			user={user}
			breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Users' }]}
			showHeader={!editing}
		>
			<div style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'auto' }}>
				<UsersTab token={token} currentEmail={user.email} onEditorChange={setEditing} />
			</div>
		</IdpShell>
	);
}

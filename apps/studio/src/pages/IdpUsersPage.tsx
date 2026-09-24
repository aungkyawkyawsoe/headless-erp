import IdpShell from '../components/IdpShell';
import { UsersTab } from '../components/admin/users-tab';

/**
 * Users — the account registry surfaced inside the IDP (developer) portal, next
 * to Roles & Access, mirroring the same table used under Studio Admin.
 *
 * Same component, second home (the pattern `IdpAccessPage` already sets for
 * `RolesTab`): roles and the accounts that hold them are two halves of one
 * question — "who can do what?" — so an operator granting a role can see who is
 * actually on it without switching portals.
 */
export default function IdpUsersPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Users' }]} activeNav="users">
			<div style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'auto' }}>
				<UsersTab token={token} currentEmail={user.email} />
			</div>
		</IdpShell>
	);
}

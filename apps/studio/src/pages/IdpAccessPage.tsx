import IdpShell from '../components/IdpShell';
import { RolesTab } from '../components/admin/roles-tab';

/**
 * Roles & Access — the RBAC admin surfaced inside the IDP (developer) portal,
 * alongside Collections/Catalog, mirroring the same editor used under Studio Admin
 * (roles → mini-app board + per-role collection-permission flags). Wrapped in IdpShell
 * so it lives in the IDP left-nav instead of only under Studio Settings.
 */
export default function IdpAccessPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Roles & Access' }]} activeNav="roles">
			<div style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'auto' }}>
				<RolesTab token={token} />
			</div>
		</IdpShell>
	);
}

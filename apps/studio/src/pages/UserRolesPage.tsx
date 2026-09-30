import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import IdpShell from '../components/IdpShell';
import { RolesListView } from '../components/admin/roles-list-view';
import { RoleDetailView } from '../components/admin/role-detail-view';
import { rolesQuery } from '../lib/queries';
import { useViewState } from '../lib/view-state';
import type { RoleRecord } from '../lib/api';

/** The blank role the New-role action opens — `saveAll` creates it by name. */
const NEW_ROLE: RoleRecord = { id: '', name: '', description: '', is_system: false, app_access: null };

/**
 * User Roles — the role registry inside the IDP portal.
 *
 * The TABLE comes first (the registry page); clicking a row shows that role's
 * profile form. `?role=<id>` is view state (replace): it names the open form,
 * `?role=new` opens the create form, and Back clears it — so a reload reopens
 * the same form and the back arrow leaves the page in one press.
 */
export default function UserRolesPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const navigate = useNavigate();
	const { searchParams, update } = useViewState();

	const rolesQ = useQuery(rolesQuery(token));
	const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
	const roleParam = searchParams.get('role');
	const selectedRole = roleParam === 'new' ? NEW_ROLE : (roles.find((r) => r.id === roleParam) ?? null);

	const close = () =>
		update((p) => {
			p.delete('role');
			return p;
		});

	return (
		<IdpShell
			token={token}
			user={user}
			breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { href: '#/idp/access', label: 'Roles & Access' }, { label: 'User Roles' }]}
			// The edit form carries its own Directus-style header (name + the
			// circular actions) — the shell's crumb row would be a second chrome
			// band above it, so it is dropped while the form is open.
			showHeader={!selectedRole}
		>
			<div style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'auto' }}>
				{selectedRole ? (
					<RoleDetailView
						key={selectedRole.id || 'new'}
						token={token}
						role={selectedRole}
						mode="role"
						onBack={close}
						onDelete={close}
						onCreated={(id) => update((p) => p.set('role', id))}
						// The permission editor is the Access Policies page — a real
						// navigation (path change → push), since it is another page.
						onOpenPermissions={selectedRole.id ? () => navigate(`/idp/access/policies?policy=${selectedRole.id}`) : undefined}
					/>
				) : (
					<RolesListView
						token={token}
						onSelect={(role) => update((p) => p.set('role', role.id))}
						onCreate={() => update((p) => p.set('role', 'new'))}
					/>
				)}
			</div>
		</IdpShell>
	);
}

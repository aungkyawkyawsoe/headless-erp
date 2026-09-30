import { useState } from 'react';
import { RolesListView } from './roles-list-view';
import { RoleDetailView } from './role-detail-view';
import type { RoleRecord } from '../../lib/api';

/** The blank role the New-role action opens — `saveAll` creates it by name. */
const NEW_ROLE: RoleRecord = { id: '', name: '', description: '', is_system: false, app_access: null };

/**
 * Roles & Access (Studio Admin) — the role registry, then the role profile.
 *
 * List → detail like every other Studio registry: the table renders first, a row
 * click (or New role) opens the profile form. The profile is the identity half
 * (name, description, the users who hold the role); the permission MATRIX lives
 * on the portal's Access Policies page, the same split Directus makes between a
 * role page and a policy page — so no two surfaces can present two matrices.
 */
export function RolesTab({ token }: { token: string }) {
	const [selected, setSelected] = useState<RoleRecord | null>(null);

	if (selected) {
		return (
			<RoleDetailView
				key={selected.id || 'new'}
				token={token}
				role={selected}
				mode="role"
				onBack={() => setSelected(null)}
				// TODO: delete via API; the list re-reads once it is wired.
				onDelete={() => setSelected(null)}
				onCreated={() => setSelected(null)}
			/>
		);
	}

	return <RolesListView token={token} onSelect={setSelected} onCreate={() => setSelected(NEW_ROLE)} />;
}

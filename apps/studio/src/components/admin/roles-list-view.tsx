import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { Globe, ShieldCheck, Users } from 'lucide-react';
import { rolesQuery, usersQuery } from '../../lib/queries';
import type { RoleRecord } from '../../lib/api';

/** Icon for a role — system roles get special treatment. */
function roleIcon(role: RoleRecord) {
	if (role.name === 'Administrator') return <ShieldCheck size={18} />;
	if (role.name === 'Public') return <Globe size={18} />;
	return <Users size={18} />;
}

/** The color accent for a role row — system roles stand out. */
function roleAccent(role: RoleRecord): string {
	if (role.name === 'Administrator') return 'var(--mmbix-tone-warning-fg, #d97706)';
	if (role.is_system === true) return 'var(--mmbix-muted-foreground, #64748b)';
	return 'var(--mmbix-foreground, #0f172a)';
}

/**
 * The roles registry — the table BOTH role surfaces open on: the portal's User
 * Roles page and Studio Admin. Clicking a row hands the role to the caller,
 * which decides where its detail form lives (view state in the portal).
 */
export function RolesListView({
	token,
	onSelect,
	onCreate,
}: {
	token: string;
	onSelect?: (role: RoleRecord) => void;
	onCreate?: () => void;
}) {
	const [query, setQuery] = useState('');

	const rolesQ = useQuery(rolesQuery(token));
	const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
	const usersQ = useQuery(usersQuery(token));

	// Counts derive from the ONE users read every surface shares — the old
	// per-role query re-fetched the whole user list once per role.
	const roleUserCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const user of usersQ.data ?? []) {
			if (!user.role_id) continue;
			counts[user.role_id] = (counts[user.role_id] ?? 0) + 1;
		}
		return counts;
	}, [usersQ.data]);

	const filtered = useMemo(() => {
		if (!query.trim()) return roles;
		const q = query.toLowerCase();
		return roles.filter(
			(r) => r.name.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q),
		);
	}, [roles, query]);

	const columns: ColumnDef<RoleRecord>[] = [
		{
			id: 'name',
			header: 'Name',
			cell: ({ row }) => {
				const role = row.original;
				return (
					<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
						<span
							style={{
								width: 32,
								height: 32,
								borderRadius: 8,
								background: 'var(--mmbix-muted, #f3f4f6)',
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								color: roleAccent(role),
								flexShrink: 0,
							}}
						>
							{roleIcon(role)}
						</span>
						<div style={{ minWidth: 0 }}>
							<div style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap', color: roleAccent(role) }}>
								{role.name}
							</div>
							{role.is_system === true && (
								<div style={{ fontSize: '0.6rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', marginTop: 1 }}>
									System role
								</div>
							)}
						</div>
					</div>
				);
			},
		},
		{
			id: 'users',
			header: 'Users',
			align: 'center',
			cell: ({ row }) => (
				<span style={{ fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #64748b)' }}>
					{usersQ.isPending ? '--' : (roleUserCounts[row.original.id] ?? 0)}
				</span>
			),
		},
		{
			id: 'description',
			header: 'Description',
			cell: ({ row }) => (
				<span style={{ fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #64748b)' }}>
					{row.original.description || '--'}
				</span>
			),
		},
	];

	return (
		<div style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'auto' }}>
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
				onCreate={rolesQ.isSuccess ? onCreate : undefined}
				isLoading={rolesQ.isLoading}
				error={rolesQ.error instanceof Error ? rolesQ.error.message : undefined}
				onRowClick={(row) => onSelect?.(row)}
				labels={{
					searchPlaceholder: 'Search Role...',
					searchLabel: 'Search roles',
					create: 'New role',
					empty: query ? `No role matches "${query}".` : 'No roles yet.',
					loading: 'Loading roles…',
				}}
			/>
		</div>
	);
}

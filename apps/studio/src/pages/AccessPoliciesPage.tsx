import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import IdpShell from '../components/IdpShell';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { ShieldCheck } from 'lucide-react';
import { RoleDetailView } from '../components/admin/role-detail-view';
import { rolesQuery, usersQuery } from '../lib/queries';
import { useViewState } from '../lib/view-state';
import type { RoleRecord } from '../lib/api';

/**
 * Access Policies — one row per role's permission set, and the editor behind it.
 *
 * The TABLE comes first; clicking a row opens that policy's form (the collection
 * flag matrix + app board), the same table-then-form rule the User Roles page
 * follows. `?policy=<id>` is view state (replace). In this engine a role's
 * policy is its grant set, so the rows are roles — but this page edits the PERMS,
 * while User Roles edits the identity, which is what keeps the two forms apart.
 */
export default function AccessPoliciesPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const { searchParams, update } = useViewState();
	const [query, setQuery] = useState('');

	const rolesQ = useQuery(rolesQuery(token));
	const roles = useMemo(() => rolesQ.data ?? [], [rolesQ.data]);
	const usersQ = useQuery(usersQuery(token));

	// The affected-user count per policy — from the ONE shared users read.
	const userCounts = useMemo(() => {
		const counts: Record<string, number> = {};
		for (const user of usersQ.data ?? []) {
			if (!user.role_id) continue;
			counts[user.role_id] = (counts[user.role_id] ?? 0) + 1;
		}
		return counts;
	}, [usersQ.data]);

	const policyId = searchParams.get('policy');
	const selected = roles.find((r) => r.id === policyId) ?? null;

	const close = () =>
		update((p) => {
			p.delete('policy');
			return p;
		});

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
					<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
						<ShieldCheck size={16} style={{ color: 'var(--mmbix-muted-foreground, #64748b)' }} />
						<span style={{ fontWeight: 500 }}>{role.name}</span>
						{role.is_system === true && (
							<span style={{ fontSize: '0.6rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>System role</span>
						)}
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
					{usersQ.isPending ? '--' : (userCounts[row.original.id] ?? 0)}
				</span>
			),
		},
		{
			id: 'apps',
			header: 'Apps',
			cell: ({ row }) => {
				const apps = row.original.app_access;
				const label = apps === null || apps === undefined ? 'All apps' : apps.length === 1 ? '1 app' : `${apps.length} apps`;
				return <span style={{ fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #64748b)' }}>{label}</span>;
			},
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
		<IdpShell
			token={token}
			user={user}
			breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { href: '#/idp/access', label: 'Roles & Access' }, { label: 'Access Policies' }]}
			// The policy form carries its own Directus-style header (name + the
			// circular actions) — the shell's crumb row is dropped while it is open,
			// the same rule the User Roles form follows.
			showHeader={!selected}
		>
			<div style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'auto' }}>
				{selected ? (
					<RoleDetailView key={selected.id} token={token} role={selected} mode="policy" onBack={close} onDelete={close} />
				) : (
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
						isLoading={rolesQ.isLoading}
						error={rolesQ.error instanceof Error ? rolesQ.error.message : undefined}
						onRowClick={(row) => update((p) => p.set('policy', row.id))}
						labels={{
							searchPlaceholder: 'Search Policy...',
							searchLabel: 'Search policies',
							empty: query ? `No policy matches "${query}".` : 'No policies yet.',
							loading: 'Loading policies…',
						}}
					/>
				)}
			</div>
		</IdpShell>
	);
}

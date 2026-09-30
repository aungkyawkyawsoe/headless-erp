import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, Badge, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { Box } from 'lucide-react';
import { appColor, smartIconFor } from '@mmbix/ui-views';
import type { CatalogEntry } from '../lib/api';
import { idpCatalogQuery, modulesQuery } from '../lib/queries';
import { invalidateIdp } from '../lib/query-client';
import { messageOf } from '../lib/errors';
import IdpShell from '../components/IdpShell';
import IdpStatusBadge from '../components/IdpStatusBadge';
import ManageAppDialog from '../components/ManageAppDialog';

const WRAPPER: React.CSSProperties = {
	padding: '1rem',
	display: 'flex',
	flexDirection: 'column',
	gap: '1.25rem',
	width: '100%',
	boxSizing: 'border-box',
	minWidth: 0,
};

export default function IdpCatalogPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [createOpen, setCreateOpen] = useState(false);

	// Catalog + the full module list (for the Manage App dialog's selector) are
	// keyed queries — a revisit is instant and the module list is shared with the
	// launcher grid and the app workbench.
	const catalogQ = useQuery(idpCatalogQuery(token));
	const modulesQ = useQuery(modulesQuery(token));
	const catalog = catalogQ.data ?? [];
	const modules = modulesQ.data ?? [];
	const loading = catalogQ.isPending;
	const error = messageOf(catalogQ.error);

	const columns: ColumnDef<CatalogEntry>[] = [
		{
			id: 'name',
			accessorKey: 'name',
			header: 'App',
			filter: { id: 'name', label: 'App', type: 'text' },
			cell: ({ row }) => {
				const Icon = smartIconFor(row.original.icon, Box);
				const bg = row.original.bg_color ?? appColor(row.original.slug);
				const fg = row.original.icon_color ?? '#ffffff';
				return (
					<div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
						<span
							style={{
								width: 28,
								height: 28,
								borderRadius: 8,
								background: bg,
								color: fg,
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								flexShrink: 0,
							}}
						>
							<Icon size={14} />
						</span>
						<div style={{ minWidth: 0 }}>
							<div style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.original.name}</div>
							<div style={{ fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{row.original.slug}</div>
						</div>
					</div>
				);
			},
		},
		{
			id: 'owner',
			accessorKey: 'owner',
			header: 'Owner',
			cell: ({ row }) => (
				<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
					<span style={{ fontSize: '0.78rem' }}>{row.original.owner ?? '—'}</span>
					{row.original.owner_role && (
						<Badge variant="outline" style={{ fontSize: '0.58rem', fontWeight: 600 }}>
							{row.original.owner_role}
						</Badge>
					)}
				</div>
			),
		},
		{
			id: 'version',
			accessorKey: 'version',
			header: 'Version',
			cell: ({ row }) => <span style={{ fontSize: '0.78rem' }}>{row.original.version}</span>,
		},
		{
			id: 'environments',
			header: 'Environments',
			cell: ({ row }) => (
				<div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
					{row.original.environments.length === 0 ? (
						<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>—</span>
					) : (
						row.original.environments.map((env) => (
							<span key={env.environment_id} title={`${env.environment} · ${env.version ?? 'no version'}`}>
								<IdpStatusBadge status={env.status} />
							</span>
						))
					)}
				</div>
			),
		},
	];

	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Catalog' }]} activeNav="catalog">
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading…</p>
				) : catalog.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Box size={32} />
							</EmptyMedia>
							<EmptyTitle>No apps in the catalog</EmptyTitle>
							<EmptyDescription>Scaffold one from a golden-path template under Create.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<DataTable
						columns={columns}
						data={catalog}
						rowKey="id"
						density="compact"
						defaultPageSize={25}
						// "+" icon button next to the filter — opens the create-app dialog.
						onCreate={() => setCreateOpen(true)}
						toolbarIconOnly
						// Row click opens the app's schema designer (AppDetailPage auto-selects
						// the first collection, e.g. /apps/hr?collection=org_companies).
						onRowClick={(row) => navigate(`/apps/${row.slug}`)}
					/>
				)}
			</div>

			{/* Create-app dialog — name / icon / colours; on save the new module shows up as a catalog row. */}
			<ManageAppDialog
				token={token}
				open={createOpen}
				onOpenChange={setCreateOpen}
				modules={modules}
				initialMode="new"
				onSaved={() => void invalidateIdp(queryClient)}
			/>
		</IdpShell>
	);
}

import { Alert, AlertDescription } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { useQuery } from '@tanstack/react-query';
import { idpAuditQuery } from '../lib/queries';
import { messageOf } from '../lib/errors';
import type { IdpAuditEntry } from '../lib/api';
import IdpShell from '../components/IdpShell';

const WRAPPER: React.CSSProperties = {
	padding: '1rem',
	display: 'flex',
	flexDirection: 'column',
	gap: '1.25rem',
	width: '100%',
	boxSizing: 'border-box',
	minWidth: 0,
};

/**
 * `created_at` is written by us as an ISO string (UTC, with `Z`); a bare
 * SQLite `CURRENT_TIMESTAMP` has no zone, and `Date.parse` would shift it by
 * the operator's offset — so append `Z` only when one is missing.
 */
function utc(ts: string): string {
	if (!ts) return '—';
	const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(ts) ? ts : `${ts.replace(' ', 'T')}Z`;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? ts : d.toISOString().replace('T', ' ').slice(0, 19);
}

/** Append-only governance trail — who did what, when. */
export default function IdpAuditPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const auditQ = useQuery(idpAuditQuery(token, 100));
	const rows = auditQ.data ?? [];
	const loading = auditQ.isPending;
	const error = messageOf(auditQ.error);

	const columns: ColumnDef<IdpAuditEntry>[] = [
		{
			id: 'created_at',
			accessorKey: 'created_at',
			header: 'When (UTC)',
			cell: ({ row }) => <span style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{utc(row.original.created_at)}</span>,
		},
		{
			id: 'action',
			accessorKey: 'action',
			header: 'Action',
			cell: ({ row }) => <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{row.original.action}</span>,
		},
		{ id: 'entity', accessorKey: 'entity', header: 'Entity' },
		{
			id: 'entity_id',
			accessorKey: 'entity_id',
			header: 'Target',
			cell: ({ row }) => (
				<span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
					{row.original.entity_id ? `${row.original.entity_id.slice(0, 8)}…` : '—'}
				</span>
			),
		},
		{
			id: 'actor_email',
			accessorKey: 'actor_email',
			header: 'Actor',
			cell: ({ row }) => <span>{row.original.actor_email ?? '—'}</span>,
		},
	];

	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Audit' }]} activeNav="audit">
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading…</p>
				) : rows.length === 0 ? (
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>No governance actions recorded yet.</p>
				) : (
					<DataTable columns={columns} data={rows} rowKey="id" density="compact" defaultPageSize={25} />
				)}
			</div>
		</IdpShell>
	);
}

import { Alert, AlertDescription, Progress } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { useQuery } from '@tanstack/react-query';
import { idpUsageQuery } from '../lib/queries';
import { messageOf } from '../lib/errors';
import IdpShell, { IdpStat } from '../components/IdpShell';

const WRAPPER: React.CSSProperties = {
	padding: '1rem',
	display: 'flex',
	flexDirection: 'column',
	gap: '1.25rem',
	width: '100%',
	boxSizing: 'border-box',
	minWidth: 0,
};

/** A single activity series rendered as proportional bar rows — no card, no chart lib. */
function Series({ title, series }: { title: string; series: Array<{ day: string; n: number }> }) {
	const max = Math.max(1, ...series.map((s) => s.n));
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', minWidth: 0 }}>
			<span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{title}</span>
			{series.length === 0 ? (
				<p style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)', margin: 0 }}>No activity recorded.</p>
			) : (
				series.map((s) => (
					<div key={s.day} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
						<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)', width: 90, flexShrink: 0 }}>{s.day}</span>
						<Progress value={(s.n / max) * 100} style={{ flex: 1, minWidth: 0 }}>
							<span />
						</Progress>
						<span style={{ fontSize: '0.78rem', fontWeight: 600, width: 32, textAlign: 'right', flexShrink: 0 }}>{s.n}</span>
					</div>
				))
			)}
		</div>
	);
}

export default function IdpUsagePage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	// Same `qk.idpUsage(30)` entry the IDP home page reads — no duplicate fetch.
	const usageQ = useQuery(idpUsageQuery(token, 30));
	const usage = usageQ.data ?? null;
	const loading = usageQ.isPending;
	const error = messageOf(usageQ.error);

	const templateColumns: ColumnDef<{ template: string; count: number }>[] = [
		{ id: 'template', accessorKey: 'template', header: 'Template' },
		{
			id: 'count',
			accessorKey: 'count',
			header: 'Apps',
			cell: ({ row }) => <span style={{ fontWeight: 600 }}>{row.original.count}</span>,
		},
	];

	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Usage' }]} activeNav="usage">
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading…</p>
				) : usage ? (
					<>
						{/* Totals — plain stat strip, no card chrome. */}
						<div
							style={{
								display: 'grid',
								gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
								gap: '1rem',
								minWidth: 0,
							}}
						>
							<IdpStat label="Modules" value={usage.totals.modules} />
							<IdpStat label="Collections" value={usage.totals.collections} />
							<IdpStat label="Deployments" value={usage.totals.deployments} />
							<IdpStat label="Ownership" value={usage.totals.ownership} />
						</div>

						{/* Template adoption — table-driven. */}
						{usage.template_adoption.length > 0 && (
							<DataTable
								columns={templateColumns}
								data={usage.template_adoption}
								rowKey="template"
								density="compact"
								defaultPageSize={25}
							/>
						)}

						{/* Activity series — one plain section per metric. */}
						<Series title="Modules created" series={usage.series.modules} />
						<Series title="Collections created" series={usage.series.collections} />
						<Series title="Deployments" series={usage.series.deployments} />
						<Series title="Ownership" series={usage.series.ownership} />
					</>
				) : null}
			</div>
		</IdpShell>
	);
}

import { Alert, AlertDescription, Progress, ProgressLabel, ProgressValue } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { useQuery } from '@tanstack/react-query';
import { idpScorecardQuery, idpUsageQuery } from '../lib/queries';
import { messageOf } from '../lib/errors';
import IdpShell, { IdpStat } from '../components/IdpShell';

const WRAPPER: React.CSSProperties = {
	padding: '1rem',
	display: 'flex',
	flexDirection: 'column',
	gap: '1rem',
	width: '100%',
	boxSizing: 'border-box',
	minWidth: 0,
};

/** Factory-activity row — one metric per row, table-driven (no card chrome). */
interface ActivityRow {
	metric: string;
	count: number;
}

const TEMPLATE_COLUMNS: ColumnDef<{ template: string; count: number }>[] = [
	{ id: 'template', accessorKey: 'template', header: 'Template' },
	{
		id: 'count',
		accessorKey: 'count',
		header: 'Apps',
		cell: ({ row }) => <span style={{ fontWeight: 600 }}>{row.original.count}</span>,
	},
];

export default function IdpHomePage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	// Both reads are the SAME cache entries the Usage page uses, so navigating
	// between the two never re-fetches them.
	const scorecardQ = useQuery(idpScorecardQuery(token));
	const usageQ = useQuery(idpUsageQuery(token, 30));
	const scorecard = scorecardQ.data ?? null;
	const usage = usageQ.data ?? null;
	const loading = scorecardQ.isPending || usageQ.isPending;
	const error = messageOf(scorecardQ.error) ?? messageOf(usageQ.error);

	const activityRows: ActivityRow[] = usage
		? [
				{ metric: 'Modules', count: usage.totals.modules },
				{ metric: 'Collections', count: usage.totals.collections },
				{ metric: 'Deployments', count: usage.totals.deployments },
				{ metric: 'Ownership', count: usage.totals.ownership },
			]
		: [];

	const activityColumns: ColumnDef<ActivityRow>[] = [
		{ id: 'metric', accessorKey: 'metric', header: 'Metric' },
		{
			id: 'count',
			accessorKey: 'count',
			header: 'Count',
			cell: ({ row }) => <span style={{ fontWeight: 600 }}>{row.original.count}</span>,
		},
	];

	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Home' }]} activeNav="home">
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading…</p>
				) : (
					<>
						{/* Scorecard — plain stat strip, no card chrome. */}
						{scorecard && (
							<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
								<div
									style={{
										display: 'grid',
										gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
										gap: '1rem',
										minWidth: 0,
									}}
								>
									<IdpStat label="Apps" value={scorecard.total} />
									<IdpStat label="With owner" value={scorecard.with_owner} />
									<IdpStat label="Live deployments" value={scorecard.with_live_deployment} />
								</div>
								<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
									<Progress value={scorecard.owner_coverage_pct}>
										<ProgressLabel>Owner coverage</ProgressLabel>
										<ProgressValue>{() => `${scorecard.owner_coverage_pct}%`}</ProgressValue>
									</Progress>
									<Progress value={scorecard.deploy_coverage_pct}>
										<ProgressLabel>Deploy coverage</ProgressLabel>
										<ProgressValue>{() => `${scorecard.deploy_coverage_pct}%`}</ProgressValue>
									</Progress>
								</div>
								{/* MECE breakdown — mutually exclusive buckets. */}
								<div
									style={{
										display: 'grid',
										gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
										gap: '1rem',
										minWidth: 0,
									}}
								>
									<IdpStat label="Owned + live" value={scorecard.owned_and_live} color="#15803d" />
									<IdpStat label="Owned, not live" value={scorecard.owned_not_live} color="#b45309" />
									<IdpStat label="Unowned + live" value={scorecard.unowned_live} color="#1d4ed8" />
									<IdpStat label="Unowned, not live" value={scorecard.unowned_not_live} color="#6b7280" />
								</div>
							</div>
						)}

						{/* Factory activity — table-driven. */}
						{usage && (
							<div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: 0 }}>
								<DataTable columns={activityColumns} data={activityRows} rowKey="metric" density="compact" defaultPageSize={25} />
								{usage.template_adoption.length > 0 && (
									<DataTable
										columns={TEMPLATE_COLUMNS}
										data={usage.template_adoption}
										rowKey="template"
										density="compact"
										defaultPageSize={25}
									/>
								)}
							</div>
						)}
					</>
				)}
			</div>
		</IdpShell>
	);
}

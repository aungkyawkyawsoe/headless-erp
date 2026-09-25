import { Alert, AlertDescription, Badge, Progress } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { useQuery } from '@tanstack/react-query';
import { idpPoliciesQuery } from '../lib/queries';
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

type ModuleRuleRow = { id: string; slug: string; name: string; status: 'pass' | 'fail'; violations: string[] };

/**
 * Governance scorecard — every module evaluated against the policy rules, with
 * the exact rules it violates. This is the actionable counterpart to the
 * coverage percentages on the Home page: "which module fails which rule".
 */
export default function IdpPoliciesPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const policiesQ = useQuery(idpPoliciesQuery(token));
	const data = policiesQ.data ?? null;
	const loading = policiesQ.isPending;
	const error = messageOf(policiesQ.error);

	const labelOf = new Map((data?.rules ?? []).map((r) => [r.id, r.label]));

	const columns: ColumnDef<ModuleRuleRow>[] = [
		{
			id: 'name',
			accessorKey: 'name',
			header: 'Module',
			cell: ({ row }) => <span style={{ fontWeight: 600 }}>{row.original.name}</span>,
		},
		{
			id: 'status',
			accessorKey: 'status',
			header: 'Policy',
			cell: ({ row }) => {
				const ok = row.original.status === 'pass';
				return (
					<Badge
						variant="outline"
						style={
							ok
								? { color: '#15803d', background: '#ecfdf5', borderColor: '#86efac', fontWeight: 600 }
								: { color: '#b91c1c', background: '#fef2f2', borderColor: '#fca5a5', fontWeight: 600 }
						}
					>
						{ok ? 'Pass' : 'Fail'}
					</Badge>
				);
			},
		},
		{
			id: 'violations',
			accessorKey: 'violations',
			header: 'Violations',
			cell: ({ row }) =>
				row.original.violations.length === 0 ? (
					<span style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>—</span>
				) : (
					<span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
						{row.original.violations.map((v) => (
							<Badge key={v} variant="outline" style={{ color: '#b45309', background: '#fffbeb', borderColor: '#fcd34d' }}>
								{labelOf.get(v) ?? v}
							</Badge>
						))}
					</span>
				),
		},
	];

	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Policies' }]} activeNav="policies">
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading…</p>
				) : data ? (
					<>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', minWidth: 0 }}>
							<IdpStat label="Modules" value={data.summary.total} />
							<IdpStat label="Passing" value={data.summary.passing} color="#15803d" />
							<IdpStat label="Failing" value={data.summary.failing} color="#b91c1c" />
						</div>

						{/* Per-rule coverage — each rule's pass % across the catalog. */}
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minWidth: 0 }}>
							{data.summary.rules.map((r) => (
								<div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
									<span style={{ fontSize: '0.78rem', width: 150, flexShrink: 0 }} title={r.description}>
										{r.label}
									</span>
									<Progress value={r.pass_pct} style={{ flex: 1, minWidth: 0 }}>
										<span />
									</Progress>
									<span style={{ fontSize: '0.78rem', fontWeight: 600, width: 64, textAlign: 'right', flexShrink: 0 }}>
										{r.passed}/{r.total}
									</span>
								</div>
							))}
						</div>

						{data.modules.length > 0 && (
							<DataTable columns={columns} data={data.modules} rowKey="id" density="compact" defaultPageSize={25} />
						)}
					</>
				) : null}
			</div>
		</IdpShell>
	);
}

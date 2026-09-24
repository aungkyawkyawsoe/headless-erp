import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	Alert,
	AlertDescription,
	Button,
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
	Input,
	Label,
	Textarea,
} from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { GitBranch, Play, Rocket, RotateCcw, Search } from 'lucide-react';
import {
	createDeployment,
	planDeployment,
	applyDeployment,
	rollbackDeployment,
	type IdpDeployment,
	type IdpPlanResult,
	type IdpApplyResult,
} from '../lib/api';
import { idpDeploymentsQuery, idpEnvironmentsQuery, modulesQuery } from '../lib/queries';
import { invalidateIdp } from '../lib/query-client';
import { messageOf } from '../lib/errors';
import IdpShell from '../components/IdpShell';
import IdpStatusBadge from '../components/IdpStatusBadge';

const WRAPPER: React.CSSProperties = {
	padding: '1rem',
	display: 'flex',
	flexDirection: 'column',
	gap: '1.25rem',
	width: '100%',
	boxSizing: 'border-box',
	minWidth: 0,
};

const FIELD: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.3rem', minWidth: 0 };
const SELECT: React.CSSProperties = {
	height: '1.75rem',
	borderRadius: 4,
	border: '1px solid var(--mmbix-border, #e5e7eb)',
	background: 'var(--mmbix-background, #fff)',
	padding: '0 0.4rem',
	fontSize: '0.8rem',
	color: 'inherit',
};

function fmtDate(v: string | null | undefined): string {
	if (!v) return '—';
	const d = new Date(v);
	return isNaN(d.getTime()) ? v : d.toLocaleString();
}

export default function IdpDeploymentsPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const queryClient = useQueryClient();

	// Deployments + the two selectors, all keyed. `modules` and `environments` are
	// shared cache entries with the launcher grid and the Environments page.
	const deploymentsQ = useQuery(idpDeploymentsQuery(token));
	const modulesQ = useQuery(modulesQuery(token));
	const environmentsQ = useQuery(idpEnvironmentsQuery(token));
	const deployments = deploymentsQ.data ?? [];
	const modules = modulesQ.data ?? [];
	const environments = environmentsQ.data ?? [];
	const loading = deploymentsQ.isPending;

	// Write-action errors only — read errors are derived below.
	const [actionError, setActionError] = useState<string | null>(null);
	const error = actionError ?? messageOf(deploymentsQ.error) ?? messageOf(modulesQ.error) ?? messageOf(environmentsQ.error);

	// New-deployment form.
	const [showForm, setShowForm] = useState(false);
	const [form, setForm] = useState({ module_id: '', environment_id: '', version: '', git_ref: '', snapshot_json: '' });
	const [creating, setCreating] = useState(false);

	// Per-row action state.
	const [busyId, setBusyId] = useState<string | null>(null);
	const [detail, setDetail] = useState<{ dep: IdpDeployment; plan?: IdpPlanResult; apply?: IdpApplyResult; message?: string } | null>(null);

	const run = async (id: string, fn: () => Promise<unknown>) => {
		setBusyId(id);
		setActionError(null);
		try {
			await fn();
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Action failed');
		} finally {
			setBusyId(null);
		}
	};

	const handleCreate = async () => {
		if (!form.module_id || !form.environment_id) {
			setActionError('Module and environment are required');
			return;
		}
		setCreating(true);
		setActionError(null);
		try {
			await createDeployment(token, {
				module_id: form.module_id,
				environment_id: form.environment_id,
				version: form.version || '1.0.0',
				git_ref: form.git_ref || null,
				snapshot_json: form.snapshot_json || null,
				status: 'draft',
			});
			setShowForm(false);
			setForm({ module_id: '', environment_id: '', version: '', git_ref: '', snapshot_json: '' });
			await invalidateIdp(queryClient);
		} catch (e) {
			setActionError(e instanceof Error ? e.message : 'Failed to create deployment');
		} finally {
			setCreating(false);
		}
	};

	const handlePlan = (dep: IdpDeployment) =>
		run(dep.id, async () => {
			const plan = await planDeployment(token, dep.id);
			setDetail({ dep, plan });
		});

	const handleApply = (dep: IdpDeployment, force = false) =>
		run(dep.id, async () => {
			const apply = await applyDeployment(token, dep.id, force);
			setDetail({ dep, apply });
			await invalidateIdp(queryClient);
		});

	const handleRollback = (dep: IdpDeployment) =>
		run(dep.id, async () => {
			const apply = await rollbackDeployment(token, dep.id);
			setDetail({ dep, apply, message: 'Rolled back to the previous live snapshot.' });
			await invalidateIdp(queryClient);
		});

	const columns: ColumnDef<IdpDeployment>[] = [
		{
			id: 'environment',
			accessorKey: 'environment',
			header: 'Environment',
			cell: ({ row }) => (
				<div style={{ minWidth: 0 }}>
					<div style={{ fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
						{row.original.environment ?? row.original.environment_id}
					</div>
					<div style={{ fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>{row.original.kind ?? '—'}</div>
				</div>
			),
		},
		{
			id: 'version',
			accessorKey: 'version',
			header: 'Version',
			cell: ({ row }) => <span style={{ fontSize: '0.78rem' }}>{row.original.version ?? '—'}</span>,
		},
		{
			id: 'git_ref',
			accessorKey: 'git_ref',
			header: 'Git Ref',
			cell: ({ row }) => (
				<span style={{ fontSize: '0.72rem', fontFamily: 'var(--mmbix-font-mono, monospace)' }}>{row.original.git_ref ?? '—'}</span>
			),
		},
		{
			id: 'status',
			accessorKey: 'status',
			header: 'Status',
			cell: ({ row }) => <IdpStatusBadge status={row.original.status} />,
		},
		{
			id: 'deployed_at',
			accessorKey: 'deployed_at',
			header: 'Deployed',
			cell: ({ row }) => <span style={{ fontSize: '0.78rem' }}>{fmtDate(row.original.deployed_at)}</span>,
		},
		{
			id: 'actions',
			header: 'Actions',
			cell: ({ row }) => {
				const d = row.original;
				const busy = busyId === d.id;
				return (
					<div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
						<Button size="xs" variant="outline" disabled={busy} onClick={() => handlePlan(d)}>
							<Search /> Plan
						</Button>
						<Button size="xs" variant="default" disabled={busy || !d.snapshot_json} onClick={() => handleApply(d)}>
							<Rocket /> Apply
						</Button>
						<Button size="xs" variant="destructive" disabled={busy || d.status !== 'live'} onClick={() => handleRollback(d)}>
							<RotateCcw /> Rollback
						</Button>
					</div>
				);
			},
		},
	];

	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Deployments' }]} activeNav="deployments">
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
					<div>
						<div style={{ fontSize: '1rem', fontWeight: 600 }}>Deployments</div>
						<div style={{ fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
							GitOps: apply a git-pinned schema snapshot to an environment.
						</div>
					</div>
					<Button size="sm" onClick={() => setShowForm((v) => !v)}>
						<Play /> New Deployment
					</Button>
				</div>

				{showForm && (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '0.75rem',
							padding: '0.75rem',
							border: '1px solid var(--mmbix-border, #e5e7eb)',
							borderRadius: 8,
						}}
					>
						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
							<div style={FIELD}>
								<Label>Module</Label>
								<select style={SELECT} value={form.module_id} onChange={(e) => setForm({ ...form, module_id: e.target.value })}>
									<option value="">Select module…</option>
									{modules.map((m) => (
										<option key={m.slug} value={m.slug}>
											{m.name}
										</option>
									))}
								</select>
							</div>
							<div style={FIELD}>
								<Label>Environment</Label>
								<select style={SELECT} value={form.environment_id} onChange={(e) => setForm({ ...form, environment_id: e.target.value })}>
									<option value="">Select environment…</option>
									{environments.map((e) => (
										<option key={e.environment_id} value={e.environment_id}>
											{e.environment}
										</option>
									))}
								</select>
							</div>
							<div style={FIELD}>
								<Label>Version</Label>
								<Input value={form.version} placeholder="1.0.0" onChange={(e) => setForm({ ...form, version: e.target.value })} />
							</div>
							<div style={FIELD}>
								<Label>Git Ref</Label>
								<Input
									value={form.git_ref}
									placeholder="v1.0.0 / commit SHA"
									onChange={(e) => setForm({ ...form, git_ref: e.target.value })}
								/>
							</div>
						</div>
						<div style={FIELD}>
							<Label>Schema Snapshot (JSON)</Label>
							<Textarea
								rows={5}
								placeholder="Paste the full schema snapshot (from GET /api/snapshot/export). Leave empty to deploy metadata only."
								value={form.snapshot_json}
								onChange={(e) => setForm({ ...form, snapshot_json: e.target.value })}
							/>
						</div>
						<div style={{ display: 'flex', gap: '0.5rem' }}>
							<Button size="sm" disabled={creating} onClick={handleCreate}>
								{creating ? 'Creating…' : 'Create Deployment'}
							</Button>
							<Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
								Cancel
							</Button>
						</div>
					</div>
				)}

				{detail && (
					<div
						style={{
							display: 'flex',
							flexDirection: 'column',
							gap: '0.5rem',
							padding: '0.75rem',
							border: '1px solid var(--mmbix-border, #e5e7eb)',
							borderRadius: 8,
							background: 'var(--mmbix-muted, #f9fafb)',
						}}
					>
						<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
							<div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
								Deployment {detail.dep.version ?? ''} · {detail.dep.environment ?? detail.dep.environment_id}
							</div>
							<Button size="xs" variant="ghost" onClick={() => setDetail(null)}>
								Dismiss
							</Button>
						</div>
						{detail.message && <div style={{ fontSize: '0.78rem' }}>{detail.message}</div>}
						{detail.plan && (
							<div style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
								<div>
									<strong>Migration plan</strong> — {detail.plan.summary.totalChanges} change(s),{' '}
									{detail.plan.summary.safeToApply ? 'safe to apply' : '⚠ breaking changes'}
								</div>
								{detail.plan.summary.breakingChanges.length > 0 && (
									<div style={{ color: 'var(--mmbix-destructive, #dc2626)' }}>
										{detail.plan.summary.breakingChanges.map((b) => (
											<div key={b}>• {b}</div>
										))}
									</div>
								)}
							</div>
						)}
						{detail.apply && (
							<div style={{ fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
								<div>
									<strong>Apply result</strong> —{' '}
									{detail.apply.already_applied
										? 'already applied (idempotent no-op)'
										: detail.apply.applied
											? 'applied successfully'
											: 'not applied'}
								</div>
								{detail.apply.checksum && (
									<div style={{ fontFamily: 'var(--mmbix-font-mono, monospace)' }}>checksum: {detail.apply.checksum}</div>
								)}
								{detail.apply.results && (
									<div>
										{detail.apply.results.map((r) => (
											<div key={r.slug}>
												• {r.slug}: {r.status}
											</div>
										))}
									</div>
								)}
							</div>
						)}
					</div>
				)}

				{loading ? (
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading…</p>
				) : deployments.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<GitBranch size={32} />
							</EmptyMedia>
							<EmptyTitle>No deployments</EmptyTitle>
							<EmptyDescription>Create a deployment to apply a schema snapshot to an environment.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<DataTable columns={columns} data={deployments} rowKey="id" density="compact" defaultPageSize={25} />
				)}
			</div>
		</IdpShell>
	);
}

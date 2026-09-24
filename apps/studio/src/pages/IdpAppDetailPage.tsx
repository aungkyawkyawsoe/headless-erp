import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
	Alert,
	AlertDescription,
	Badge,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
	NativeSelect,
	NativeSelectOption,
	Separator,
} from '@mmbix/design-system';
import { Box, History, Rocket } from 'lucide-react';
import { promoteDeployment, type IdpDeployment } from '../lib/api';
import { idpCatalogQuery, idpDeploymentsQuery, idpHistoryQuery } from '../lib/queries';
import { invalidateIdp } from '../lib/query-client';
import { messageOf } from '../lib/errors';
import IdpShell from '../components/IdpShell';
import IdpStatusBadge from '../components/IdpStatusBadge';

/** Terminal workflow states — no further promotion is possible. */
function isTerminal(status: string): boolean {
	const s = (status ?? '').toLowerCase();
	return s === 'live' || s === 'rolled_back';
}

function fmtDate(v: string | null | undefined): string {
	if (!v) return '—';
	const d = new Date(v);
	return isNaN(d.getTime()) ? v : d.toLocaleString();
}

const WRAPPER: React.CSSProperties = {
	padding: '1rem',
	display: 'flex',
	flexDirection: 'column',
	gap: '1.25rem',
	width: '100%',
	boxSizing: 'border-box',
	minWidth: 0,
};

export default function IdpAppDetailPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	const { slug } = useParams<{ slug: string }>();
	const queryClient = useQueryClient();

	// Catalog + deployments are shared query entries (the catalog page and the
	// deployments page read the same ones); this page only FILTERS them by slug.
	const catalogQ = useQuery(idpCatalogQuery(token));
	const deploymentsQ = useQuery(idpDeploymentsQuery(token));
	const entry = useMemo(() => (catalogQ.data ?? []).find((c) => c.slug === slug) ?? null, [catalogQ.data, slug]);
	const deployments = useMemo(
		() => (entry ? (deploymentsQ.data ?? []).filter((d) => d.module_id === entry.id) : []),
		[entry, deploymentsQ.data],
	);
	const loading = catalogQ.isPending || deploymentsQ.isPending;

	// Promote confirm dialog.
	const [promoteTarget, setPromoteTarget] = useState<IdpDeployment | null>(null);
	const [promoting, setPromoting] = useState(false);
	const [promoteError, setPromoteError] = useState<string | null>(null);

	// Deployment history — the pick is local UI state; the DEFAULT (first) is
	// derived, so there is no seeding effect racing the data load.
	const [pickedId, setPickedId] = useState<string | null>(null);
	const selectedDeploymentId = pickedId ?? deployments[0]?.id ?? null;
	const historyQ = useQuery(idpHistoryQuery(token, selectedDeploymentId));
	const history = selectedDeploymentId ? (historyQ.data ?? []) : [];
	const historyLoading = !!selectedDeploymentId && historyQ.isPending;

	const error = messageOf(catalogQ.error) ?? messageOf(deploymentsQ.error);

	async function confirmPromote() {
		if (!promoteTarget) return;
		setPromoting(true);
		setPromoteError(null);
		try {
			await promoteDeployment(token, promoteTarget.id);
			setPromoteTarget(null);
			// Promotion advances the workflow → catalog badges + deployments change.
			await invalidateIdp(queryClient);
		} catch (err) {
			setPromoteError(err instanceof Error ? err.message : 'Promotion failed');
		} finally {
			setPromoting(false);
		}
	}

	return (
		<IdpShell
			token={token}
			user={user}
			breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { href: '#/idp/catalog', label: 'Catalog' }, { label: entry?.name ?? slug ?? 'App' }]}
			activeNav="catalog"
		>
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<p style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>Loading…</p>
				) : !entry ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Box size={32} />
							</EmptyMedia>
							<EmptyTitle>App not found</EmptyTitle>
							<EmptyDescription>No catalog entry matches “{slug}”.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<>
						{/* Header */}
						<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
							<div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
								<span
									style={{
										width: 34,
										height: 34,
										borderRadius: 10,
										background: 'var(--mmbix-muted, #f3f4f6)',
										color: '#6b7280',
										display: 'inline-flex',
										alignItems: 'center',
										justifyContent: 'center',
										flexShrink: 0,
									}}
								>
									<Box size={18} />
								</span>
								<div style={{ minWidth: 0 }}>
									<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
										<h1 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, lineHeight: 1.1 }}>{entry.name}</h1>
										<Badge variant="outline" style={{ fontSize: '0.68rem', fontWeight: 600 }}>
											v{entry.version}
										</Badge>
									</div>
									<p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
										{entry.slug} · Owner: {entry.owner ?? '—'} {entry.owner_role ? `(${entry.owner_role})` : ''}
									</p>
								</div>
							</div>
						</div>

						{/* Environments + deployments */}
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: 0 }}>
							<span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Environments</span>
							{entry.environments.length === 0 ? (
								<p style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)', margin: 0 }}>
									No environments configured.
								</p>
							) : (
								entry.environments.map((env) => {
									const dep = deployments.find((d) => d.environment_id === env.environment_id);
									const terminal = isTerminal(env.status);
									return (
										<div
											key={env.environment_id}
											style={{
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'space-between',
												gap: '1rem',
												padding: '0.6rem 0.75rem',
												border: '1px solid var(--mmbix-border, #e5e7eb)',
												borderRadius: 8,
												flexWrap: 'wrap',
											}}
										>
											<div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
												<div style={{ minWidth: 0 }}>
													<div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{env.environment}</div>
													<div style={{ fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
														{env.kind} · v{env.version ?? '—'} · deployed {fmtDate(env.deployed_at)}
													</div>
												</div>
											</div>
											<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
												<IdpStatusBadge status={env.status} />
												{dep && (
													<Button
														size="sm"
														variant="outline"
														disabled={terminal}
														title={terminal ? 'Workflow is terminal (live / rolled back)' : 'Advance the deployment workflow'}
														onClick={() => {
															setPromoteTarget(dep);
															setPromoteError(null);
														}}
													>
														<Rocket size={13} /> Promote
													</Button>
												)}
											</div>
										</div>
									);
								})
							)}
						</div>

						{/* Deployment history */}
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: 0 }}>
							<span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Deployment history</span>
							{deployments.length === 0 ? (
								<p style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)', margin: 0 }}>No deployments yet.</p>
							) : (
								<>
									<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
										<NativeSelect value={selectedDeploymentId ?? ''} onChange={(e) => setPickedId(e.target.value)}>
											{deployments.map((d) => (
												<NativeSelectOption key={d.id} value={d.id}>
													{d.environment ?? d.environment_id} · {d.version ?? '—'}
												</NativeSelectOption>
											))}
										</NativeSelect>
										<span style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
											{historyLoading ? 'Loading…' : `${history.length} event${history.length === 1 ? '' : 's'}`}
										</span>
									</div>
									<Separator />
									{history.length === 0 ? (
										<p style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)', margin: 0 }}>
											{historyLoading ? 'Loading…' : 'No history recorded for this deployment.'}
										</p>
									) : (
										<div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
											{history.map((h) => (
												<div
													key={h.id}
													style={{
														display: 'flex',
														alignItems: 'center',
														justifyContent: 'space-between',
														gap: '1rem',
														fontSize: '0.78rem',
														flexWrap: 'wrap',
													}}
												>
													<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
														<History size={13} style={{ color: 'var(--mmbix-muted-foreground, #6b7280)', flexShrink: 0 }} />
														<span>
															{h.from_state ? (
																<>
																	<Badge variant="outline" style={{ fontSize: '0.6rem', fontWeight: 600 }}>
																		{h.from_state}
																	</Badge>{' '}
																	→{' '}
																</>
															) : null}
															<Badge variant="outline" style={{ fontSize: '0.6rem', fontWeight: 600 }}>
																{h.to_state}
															</Badge>
														</span>
													</div>
													<span style={{ color: 'var(--mmbix-muted-foreground, #6b7280)', fontSize: '0.7rem' }}>
														{h.actor ?? 'system'} · {fmtDate(h.created_at)}
													</span>
												</div>
											))}
										</div>
									)}
								</>
							)}
						</div>

						{/* Promote confirm dialog */}
						<Dialog open={promoteTarget !== null} onOpenChange={(open) => !open && setPromoteTarget(null)}>
							<DialogContent style={{ maxWidth: 420 }}>
								<DialogHeader>
									<DialogTitle>Promote deployment</DialogTitle>
									<DialogDescription>
										Advance the workflow for {promoteTarget?.environment ?? 'this deployment'} (v{promoteTarget?.version ?? '—'}) to the
										next state.
									</DialogDescription>
								</DialogHeader>
								{promoteError && <p style={{ color: '#dc2626', fontSize: '0.82rem', margin: 0 }}>{promoteError}</p>}
								<DialogFooter>
									<Button type="button" variant="outline" onClick={() => setPromoteTarget(null)}>
										Cancel
									</Button>
									<Button type="button" disabled={promoting} onClick={() => void confirmPromote()}>
										{promoting ? 'Promoting…' : 'Promote'}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</>
				)}
			</div>
		</IdpShell>
	);
}

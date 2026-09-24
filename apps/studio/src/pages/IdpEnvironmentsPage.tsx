import { Alert, AlertDescription, Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@mmbix/design-system';
import { Server } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { idpEnvironmentsQuery } from '../lib/queries';
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

function fmtDate(v: string | null | undefined): string {
	if (!v) return '—';
	const d = new Date(v);
	return isNaN(d.getTime()) ? v : d.toLocaleString();
}

export default function IdpEnvironmentsPage({ token, user }: { token: string; user: { email: string; full_name: string } }) {
	// Shared `qk.idpEnvironments()` entry — the Deployments page reads the same one.
	const environmentsQ = useQuery(idpEnvironmentsQuery(token));
	const environments = environmentsQ.data ?? [];
	const loading = environmentsQ.isPending;
	const error = messageOf(environmentsQ.error);

	return (
		<IdpShell token={token} user={user} breadcrumbs={[{ href: '#/idp', label: 'IDP' }, { label: 'Environments' }]} activeNav="environments">
			<div style={WRAPPER}>
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				{loading ? (
					<p style={{ fontSize: '0.8rem', color: 'var(--mmbix-muted-foreground, #6b7280)', margin: 0 }}>Loading…</p>
				) : environments.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<Server size={32} />
							</EmptyMedia>
							<EmptyTitle>No environments</EmptyTitle>
							<EmptyDescription>No deployment environments have been configured.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					environments.map((env) => (
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
							<div style={{ minWidth: 0 }}>
								<div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{env.environment}</div>
								<div style={{ fontSize: '0.7rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
									{env.kind} · v{env.version ?? '—'} · deployed {fmtDate(env.deployed_at)}
								</div>
							</div>
							<IdpStatusBadge status={env.status} />
						</div>
					))
				)}
			</div>
		</IdpShell>
	);
}

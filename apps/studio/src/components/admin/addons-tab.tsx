import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@mmbix/design-system';
import { Blocks, Download, Trash2 } from 'lucide-react';
import { installAddon, uninstallAddon, type AddonEntry } from '../../lib/api';
import { addonsQuery, modulesQuery } from '../../lib/queries';
import { qk } from '../../lib/query-keys';
import StatusBadge from '../StatusBadge';

/* ── Add-ons tab — install/remove modules at runtime (the zero-waste gate) ──
 *
 * Lists the compiled add-ons with their install state + dependency/capability
 * graph. Install/uninstall hit `/api/addons` (admin) and immediately flip the
 * route gate + `/api/meta`; nothing is redeployed. */

const SCOPE_COLOR: Record<AddonEntry['scope'], string> = {
	platform: '#0ea5e9',
	domain: '#8b5cf6',
	ui: 'var(--mmbix-tone-warning-fg, #f59e0b)',
};

const th = { textAlign: 'left' as const, padding: '0.25rem 0.5rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', fontWeight: 600 };
const td = { padding: '0.35rem 0.5rem', verticalAlign: 'top' as const, whiteSpace: 'normal' as const };

export function AddonsTab({ token }: { token: string }) {
	const queryClient = useQueryClient();
	const addonsQ = useQuery(addonsQuery(token));
	const addons = useMemo(() => addonsQ.data?.addons ?? [], [addonsQ.data]);
	const issues = useMemo(() => addonsQ.data?.issues ?? [], [addonsQ.data]);
	const [busyId, setBusyId] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);

	useEffect(() => {
		if (addonsQ.error) setMsg(addonsQ.error instanceof Error ? addonsQ.error.message : 'Failed to load add-ons');
	}, [addonsQ.error]);

	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: qk.addons() });
		// The module switcher reads `/api/modules` (DB) — refresh it too so an
		// install/uninstall is reflected everywhere.
		await queryClient.invalidateQueries({ queryKey: modulesQuery(token).queryKey });
	};

	const toggle = async (entry: AddonEntry) => {
		setBusyId(entry.id);
		setMsg(null);
		try {
			if (entry.installed) await uninstallAddon(token, entry.id);
			else await installAddon(token, entry.id);
			await refresh();
		} catch (e) {
			setMsg(e instanceof Error ? e.message : 'Action failed');
		} finally {
			setBusyId(null);
		}
	};

	return (
		<div style={{ padding: '0.5rem 0.75rem' }}>
			<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', margin: '0 0 0.6rem' }}>
				Install or remove add-ons at runtime. An uninstalled add-on&apos;s routes answer 404 and its tables/hooks do not run — zero waste,
				no redeploy.
			</p>

			{msg && (
				<p role="alert" style={{ fontSize: '0.72rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)', margin: '0 0 0.5rem' }}>
					{msg}
				</p>
			)}

			{addonsQ.isLoading ? (
				<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>Loading add-ons…</p>
			) : addons.length === 0 ? (
				<p style={{ fontSize: '0.72rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>No add-ons in this build.</p>
			) : (
				<Table style={{ width: '100%', fontSize: '0.74rem' }}>
					<TableHeader>
						<TableRow>
							<TableHead style={th}>Add-on</TableHead>
							<TableHead style={th}>Scope</TableHead>
							<TableHead style={th}>Depends / Capabilities</TableHead>
							<TableHead style={th}>State</TableHead>
							<TableHead style={th} />
						</TableRow>
					</TableHeader>
					<TableBody>
						{addons.map((a) => (
							<TableRow key={a.id}>
								<TableCell style={td}>
									<strong>{a.name}</strong>
									<div style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
										{a.id} · v{a.version}
									</div>
								</TableCell>
								<TableCell style={td}>
									<Badge style={{ background: SCOPE_COLOR[a.scope], color: '#fff' }}>{a.scope}</Badge>
								</TableCell>
								<TableCell style={{ ...td, color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
									{a.depends.length > 0 && <div>needs: {a.depends.join(', ')}</div>}
									{a.provides.length > 0 && <div>provides: {a.provides.join(', ')}</div>}
									{a.requires.length > 0 && <div>requires: {a.requires.join(', ')}</div>}
									{a.depends.length + a.provides.length + a.requires.length === 0 && <span>—</span>}
								</TableCell>
								<TableCell style={td}>
									<StatusBadge status={a.installed ? 'installed' : 'not installed'} />
								</TableCell>
								<TableCell style={{ ...td, textAlign: 'right' as const }}>
									<Button
										variant={a.installed ? 'outline' : 'default'}
										size="sm"
										disabled={busyId === a.id || !a.available}
										onClick={() => void toggle(a)}
										title={a.installed ? 'Uninstall' : 'Install'}
									>
										{a.installed ? <Trash2 size={13} /> : <Download size={13} />}
										{a.installed ? 'Remove' : 'Install'}
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}

			{issues.length > 0 && (
				<div style={{ marginTop: '0.75rem' }}>
					<p style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--mmbix-tone-warning-fg, #b45309)', margin: '0 0 0.25rem' }}>
						<Blocks size={12} /> Graph issues
					</p>
					<ul style={{ fontSize: '0.7rem', color: 'var(--mmbix-tone-warning-fg, #b45309)', margin: 0, paddingLeft: '1.1rem' }}>
						{issues.map((i, n) => (
							<li key={`${i.id}-${n}`}>
								{i.id}: {i.issue}
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

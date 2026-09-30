import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { Blocks, Download, Trash2 } from 'lucide-react';
import { installAddon, uninstallAddon, type AddonEntry } from '../../lib/api';
import { addonsQuery, modulesQuery } from '../../lib/queries';
import { qk } from '../../lib/query-keys';
import StatusBadge from '../StatusBadge';

/* ── Add-ons tab — install/remove modules at runtime (the zero-waste gate) ──
 *
 * Lists the compiled add-ons with their install state + dependency/capability
 * graph. Install/uninstall hit `/api/addons` (admin) and immediately flip the
 * route gate + `/api/meta`; nothing is redeployed. Rendered through the SHARED
 * `DataTable` — the same table component every other Studio surface uses. */

const SCOPE_COLOR: Record<AddonEntry['scope'], string> = {
	platform: '#0ea5e9',
	domain: '#8b5cf6',
	ui: 'var(--mmbix-tone-warning-fg, #f59e0b)',
};

export function AddonsTab({ token }: { token: string }) {
	const queryClient = useQueryClient();
	const addonsQ = useQuery(addonsQuery(token));
	const addons = useMemo(() => addonsQ.data?.addons ?? [], [addonsQ.data]);
	const issues = useMemo(() => addonsQ.data?.issues ?? [], [addonsQ.data]);
	const [query, setQuery] = useState('');
	const [busyId, setBusyId] = useState<string | null>(null);
	const [msg, setMsg] = useState<string | null>(null);

	// The caller owns the predicate: the rows below are already the filtered set.
	// A search term narrows on what the row SHOWS (name + id), not on hidden state.
	const shown = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return addons;
		return addons.filter((a) => `${a.name} ${a.id}`.toLowerCase().includes(q));
	}, [addons, query]);

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

	const columns: ColumnDef<AddonEntry>[] = [
		{
			id: 'addon',
			header: 'Add-on',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row: { original: a } }) => (
				<div>
					<strong>{a.name}</strong>
					<div style={{ color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>
						{a.id} · v{a.version}
					</div>
				</div>
			),
		},
		{
			id: 'scope',
			header: 'Scope',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row: { original: a } }) => <Badge style={{ background: SCOPE_COLOR[a.scope], color: '#fff' }}>{a.scope}</Badge>,
		},
		{
			id: 'graph',
			header: 'Depends / Capabilities',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row: { original: a } }) => (
				<div style={{ color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
					{a.depends.length > 0 && <div>needs: {a.depends.join(', ')}</div>}
					{a.provides.length > 0 && <div>provides: {a.provides.join(', ')}</div>}
					{a.requires.length > 0 && <div>requires: {a.requires.join(', ')}</div>}
					{a.depends.length + a.provides.length + a.requires.length === 0 && <span>—</span>}
				</div>
			),
		},
		{
			id: 'state',
			header: 'State',
			enableSorting: false,
			enableHeaderMenu: false,
			cell: ({ row: { original: a } }) => <StatusBadge status={a.installed ? 'installed' : 'not installed'} />,
		},
		{
			id: 'actions',
			header: '',
			enableSorting: false,
			enableHeaderMenu: false,
			align: 'right',
			cell: ({ row: { original: a } }) => (
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
			),
		},
	];

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

			<DataTable<AddonEntry>
				columns={columns}
				data={shown}
				rowKey="id"
				globalFilter={query}
				onGlobalFilterChange={setQuery}
				manualFiltering
				density="compact"
				stickyHeader
				showFilters={false}
				showPagination={false}
				isLoading={addonsQ.isLoading}
				error={addonsQ.error ? (addonsQ.error instanceof Error ? addonsQ.error.message : 'Failed to load add-ons') : null}
				labels={{
					searchPlaceholder: 'Search add-ons',
					searchLabel: 'Search add-ons',
					empty: addons.length === 0 ? 'No add-ons in this build.' : `No add-on matches “${query}”.`,
				}}
			/>

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

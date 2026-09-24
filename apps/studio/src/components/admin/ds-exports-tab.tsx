import { Button, NativeSelect, NativeSelectOption, Switch } from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { RefreshCw } from 'lucide-react';
import type { DsExport, StudioMeta } from '../../lib/studioMeta';
import type { AdminApi } from './types';

/* ── Design-system exports tab (curation) ──────────────────── */

const DS_CATEGORIES = ['general', 'layout', 'content', 'data', 'navigation', 'feedback', 'form'];

export function DsExportsTab({ meta, api }: { meta: StudioMeta | null; api: AdminApi }) {
	const rows = meta?.dsExports ?? [];

	const patch = (d: DsExport, part: Partial<Pick<DsExport, 'is_used' | 'category' | 'has_props'>>) =>
		void api('/api/studio/ds-export', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: d.export_name,
				is_used: part.is_used ?? d.is_used,
				category: part.category ?? d.category,
				has_props: part.has_props ?? d.has_props,
			}),
		});

	const dsExportColumns: ColumnDef<DsExport>[] = [
		{
			id: 'export_name',
			accessorKey: 'export_name',
			header: 'Export',
			filter: { id: 'export_name', label: 'Export', type: 'text' },
			cell: ({ value }) => (
				<span title={String(value)} style={{ fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
					{String(value)}
				</span>
			),
		},
		{
			id: 'ds_level',
			accessorKey: 'ds_level',
			header: 'Level',
			filter: {
				id: 'ds_level',
				label: 'Level',
				type: 'select',
				options: (['atom', 'block', 'module'] as const).map((l) => ({ label: `${l}s`, value: l })),
			},
			cell: ({ value }) => (
				<span
					style={{
						fontSize: '0.68rem',
						fontWeight: 700,
						textTransform: 'uppercase',
						letterSpacing: '0.05em',
						color: 'var(--mmbix-muted-foreground, #6b7280)',
					}}
				>
					{String(value)}
				</span>
			),
		},
		{
			id: 'is_used',
			accessorKey: 'is_used',
			header: 'In palette',
			enableSorting: false,
			cell: ({ row }) => (
				<Switch
					checked={row.original.is_used === 1}
					onCheckedChange={(v) => patch(row.original, { is_used: v ? 1 : 0 })}
					aria-label={`Show ${row.original.export_name}`}
				/>
			),
		},
		{
			id: 'category',
			accessorKey: 'category',
			header: 'Category',
			enableSorting: false,
			width: '150px',
			filter: { id: 'category', label: 'Category', type: 'select', options: DS_CATEGORIES.map((c) => ({ label: c, value: c })) },
			cell: ({ row }) => (
				<NativeSelect
					size="sm"
					value={row.original.category}
					aria-label={`Category for ${row.original.export_name}`}
					onChange={(e) => patch(row.original, { category: e.target.value })}
					style={{ width: 120 }}
				>
					{DS_CATEGORIES.map((c) => (
						<NativeSelectOption key={c} value={c}>
							{c}
						</NativeSelectOption>
					))}
				</NativeSelect>
			),
		},
	];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
			<DataTable
				columns={dsExportColumns}
				data={rows}
				rowKey="export_name"
				density="compact"
				defaultPageSize={25}
				toolbarActions={
					// Re-scan runs node against the LOCAL studio.db (dev-only) — the prod D1
					// ds_exports is seeded at deploy time instead.
					import.meta.env.DEV ? (
						<Button size="sm" variant="outline" onClick={() => void api('/api/studio/sync-ds', { method: 'POST' })}>
							<RefreshCw size={13} /> Re-scan DS
						</Button>
					) : undefined
				}
			/>
		</div>
	);
}

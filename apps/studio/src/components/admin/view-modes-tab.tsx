import { useState } from 'react';
import {
	Badge,
	Button,
	Checkbox,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
} from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { Save, Trash2 } from 'lucide-react';
import { dsIcon, type StudioMeta, type ViewMode } from '../../lib/studioMeta';
import type { AdminApi } from './types';

/* ── View modes tab (CRUD) ────────────────────────────────── */

export function ViewModesTab({ meta, api }: { meta: StudioMeta | null; api: AdminApi }) {
	const [editing, setEditing] = useState<ViewMode | null>(null);
	const [open, setOpen] = useState(false);
	const modes = meta?.viewModes ?? [];

	const cap = (m: ViewMode, k: 'data_configurable' | 'groupable' | 'field_visible' | 'sortable' | 'block_fallback') => m[k] === 1;

	const viewModeColumns: ColumnDef<ViewMode>[] = [
		{
			id: 'label',
			accessorKey: 'label',
			header: 'View mode',
			filter: { id: 'label', label: 'View mode', type: 'text' },
			cell: ({ row }) => (
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<span
						style={{
							width: 28,
							height: 28,
							borderRadius: 6,
							background: 'var(--mmbix-muted, #f3f4f6)',
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							color: '#6b7280',
							flexShrink: 0,
						}}
					>
						{dsIcon(row.original.icon, 14)}
					</span>
					<span style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.original.label}</span>
					<Badge variant="outline" style={{ fontSize: '0.58rem', fontFamily: 'monospace' }}>
						{row.original.key}
					</Badge>
				</div>
			),
		},
		{
			id: 'capabilities',
			header: 'Capabilities',
			enableSorting: false,
			cell: ({ row }) => (
				<div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
					{cap(row.original, 'data_configurable') && (
						<Badge variant="outline" style={{ fontSize: '0.55rem', fontWeight: 600 }}>
							data
						</Badge>
					)}
					{cap(row.original, 'groupable') && (
						<Badge variant="outline" style={{ fontSize: '0.55rem', fontWeight: 600 }}>
							group
						</Badge>
					)}
					{cap(row.original, 'field_visible') && (
						<Badge variant="outline" style={{ fontSize: '0.55rem', fontWeight: 600 }}>
							fields
						</Badge>
					)}
					{cap(row.original, 'sortable') && (
						<Badge variant="outline" style={{ fontSize: '0.55rem', fontWeight: 600 }}>
							sort
						</Badge>
					)}
					{cap(row.original, 'block_fallback') && (
						<Badge variant="outline" style={{ fontSize: '0.55rem', fontWeight: 600 }}>
							block
						</Badge>
					)}
					{row.original.description && <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>{row.original.description}</span>}
				</div>
			),
		},
		{
			id: 'actions',
			header: '',
			enableSorting: false,
			enableHiding: false,
			align: 'right',
			width: '96px',
			cell: ({ row }) => (
				<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}>
					<Button
						variant="ghost"
						size="icon-xs"
						title="Edit"
						onClick={() => {
							setEditing(row.original);
							setOpen(true);
						}}
					>
						<Save size={13} />
					</Button>
					<Button
						variant="ghost"
						size="icon-xs"
						title="Delete"
						style={{ color: '#dc2626' }}
						onClick={() => {
							if (confirm(`Delete view mode "${row.original.label}"?`))
								void api(`/api/studio/view-mode?key=${encodeURIComponent(row.original.key)}`, { method: 'DELETE' });
						}}
					>
						<Trash2 size={13} />
					</Button>
				</div>
			),
		},
	];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
			<DataTable
				columns={viewModeColumns}
				data={modes}
				rowKey="key"
				density="compact"
				defaultPageSize={25}
				onCreate={() => {
					setEditing(null);
					setOpen(true);
				}}
				labels={{ create: 'New view mode' }}
			/>
			{open && (
				<ViewModeEditor
					mode={editing}
					onClose={() => setOpen(false)}
					onSaved={async (payload) => {
						await api('/api/studio/view-mode', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify(payload),
						});
						setOpen(false);
					}}
				/>
			)}
		</div>
	);
}

function ViewModeEditor({
	mode,
	onClose,
	onSaved,
}: {
	mode: ViewMode | null;
	onClose: () => void;
	onSaved: (payload: Record<string, unknown>) => Promise<void>;
}) {
	const [key, setKey] = useState(mode?.key ?? '');
	const [label, setLabel] = useState(mode?.label ?? '');
	const [icon, setIcon] = useState(mode?.icon ?? 'table-2');
	const [description, setDescription] = useState(mode?.description ?? '');
	const [flags, setFlags] = useState({
		data_configurable: mode?.data_configurable === 1,
		block_fallback: mode?.block_fallback === 1,
		groupable: mode?.groupable === 1,
		field_visible: mode?.field_visible === 1,
		sortable: mode?.sortable === 1,
	});
	const [sortOrder, setSortOrder] = useState(mode?.sort_order ?? 0);

	const flag = (k: keyof typeof flags, v: boolean) => setFlags((p) => ({ ...p, [k]: v }));

	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent style={{ maxWidth: 500 }}>
				<DialogHeader>
					<DialogTitle>{mode ? `Edit ${mode.label}` : 'New view mode'}</DialogTitle>
					<DialogDescription>A canvas view (icon button in the builder). Templates attach views to these keys.</DialogDescription>
				</DialogHeader>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Key</Label>
							<Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="timeline" disabled={!!mode} />
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Label</Label>
							<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Timeline" />
						</div>
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Icon (lucide)</Label>
							<Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="table-2" />
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Sort order</Label>
							<Input
								type="number"
								value={String(sortOrder)}
								onChange={(e) => setSortOrder(Number(e.target.value))}
								style={{ width: '100%' }}
							/>
						</div>
					</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
						<Label>Description</Label>
						<Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Horizontal timeline of records" />
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
						{(Object.keys(flags) as (keyof typeof flags)[]).map((k) => (
							<label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', cursor: 'pointer' }}>
								<Checkbox checked={flags[k]} onCheckedChange={(v) => flag(k, !!v)} />
								{k}
							</label>
						))}
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!key.trim() || !label.trim()}
						onClick={() =>
							void onSaved({
								key: key.trim(),
								label: label.trim(),
								icon: icon.trim() || 'table-2',
								description: description.trim() || null,
								data_configurable: flags.data_configurable ? 1 : 0,
								block_fallback: flags.block_fallback ? 1 : 0,
								groupable: flags.groupable ? 1 : 0,
								field_visible: flags.field_visible ? 1 : 0,
								sortable: flags.sortable ? 1 : 0,
								sort_order: sortOrder,
							})
						}
					>
						Save view mode
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

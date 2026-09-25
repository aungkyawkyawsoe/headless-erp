import { useState } from 'react';
import {
	Badge,
	Button,
	confirmDialog,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Textarea,
} from '@mmbix/design-system';
import { DataTable, type ColumnDef } from '@mmbix/design-system/datatable';
import { Database, Save, Trash2 } from 'lucide-react';
import type { StudioMeta } from '../../lib/studioMeta';
import type { AdminApi } from './types';

/* ── Studio config tab (CRUD) ─────────────────────────────── */

export function StudioConfigTab({ meta, api }: { meta: StudioMeta | null; api: AdminApi }) {
	const [editing, setEditing] = useState<{ config_key: string; config_val: string; description: string | null } | null>(null);
	const [open, setOpen] = useState(false);
	const rows = meta?.configRows ?? [];

	const configColumns: ColumnDef<(typeof rows)[number]>[] = [
		{
			id: 'config_key',
			accessorKey: 'config_key',
			header: 'Key',
			filter: { id: 'config_key', label: 'Key', type: 'text' },
			cell: ({ row }) => (
				<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
					<span
						style={{
							width: 26,
							height: 26,
							borderRadius: 6,
							background: 'var(--mmbix-muted, #f3f4f6)',
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							color: 'var(--mmbix-muted-foreground, #6b7280)',
							flexShrink: 0,
						}}
					>
						<Database size={13} />
					</span>
					<div style={{ minWidth: 0 }}>
						<div style={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: 'monospace' }}>{row.original.config_key}</div>
						{row.original.description && (
							<div style={{ fontSize: '0.68rem', color: 'var(--mmbix-muted-foreground, #9ca3af)', marginTop: 2 }}>
								{row.original.description}
							</div>
						)}
					</div>
				</div>
			),
		},
		{
			id: 'config_val',
			accessorKey: 'config_val',
			header: 'Value',
			cell: ({ value }) => (
				<Badge
					variant="outline"
					style={{
						fontSize: '0.55rem',
						fontFamily: 'monospace',
						maxWidth: 240,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						display: 'block',
					}}
				>
					{String(value)}
				</Badge>
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
						style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}
						onClick={async () => {
							if (
								!(await confirmDialog({
									title: 'Delete config',
									description: `Delete config "${row.original.config_key}"?`,
									destructive: true,
									confirmLabel: 'Delete',
								}))
							)
								return;
							await api(`/api/studio/config?key=${encodeURIComponent(row.original.config_key)}`, { method: 'DELETE' });
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
				columns={configColumns}
				data={rows}
				rowKey="config_key"
				density="compact"
				defaultPageSize={25}
				onCreate={() => {
					setEditing(null);
					setOpen(true);
				}}
				labels={{ create: 'New key' }}
			/>
			{open && (
				<StudioConfigEditor
					row={editing}
					onClose={() => setOpen(false)}
					onSaved={async (payload) => {
						await api('/api/studio/config', {
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

function StudioConfigEditor({
	row,
	onClose,
	onSaved,
}: {
	row: { config_key: string; config_val: string; description: string | null } | null;
	onClose: () => void;
	onSaved: (payload: Record<string, unknown>) => Promise<void>;
}) {
	const [configKey, setConfigKey] = useState(row?.config_key ?? '');
	const [configVal, setConfigVal] = useState(row?.config_val ?? '{}');
	const [description, setDescription] = useState(row?.description ?? '');
	const [error, setError] = useState<string | null>(null);

	const valid = (): boolean => {
		try {
			JSON.parse(configVal);
			setError(null);
			return true;
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Invalid JSON');
			return false;
		}
	};

	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent style={{ maxWidth: 520 }}>
				<DialogHeader>
					<DialogTitle>{row ? `Edit ${row.config_key}` : 'New config key'}</DialogTitle>
					<DialogDescription>Global studio settings — stored as JSON values, read by the builder.</DialogDescription>
				</DialogHeader>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
						<Label>Config key</Label>
						<Input
							value={configKey}
							onChange={(e) => setConfigKey(e.target.value)}
							placeholder="default_template"
							disabled={!!row}
							style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
						/>
					</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
						<Label>Value (JSON)</Label>
						<Textarea
							rows={3}
							value={configVal}
							onChange={(e) => setConfigVal(e.target.value)}
							placeholder='"table-form"'
							style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
						/>
						{error && <p style={{ fontSize: '0.7rem', color: 'var(--mmbix-tone-danger-fg, #dc2626)', margin: 0 }}>{error}</p>}
					</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
						<Label>Description</Label>
						<Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Template used for a fresh page" />
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!configKey.trim()}
						onClick={() => {
							if (!valid()) return;
							void onSaved({ config_key: configKey.trim(), config_val: configVal, description: description.trim() || null });
						}}
					>
						Save config
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

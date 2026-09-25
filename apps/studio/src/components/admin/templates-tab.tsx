import { useState } from 'react';
import {
	Badge,
	Button,
	Checkbox,
	confirmDialog,
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
import { LayoutTemplate, Save, Trash2 } from 'lucide-react';
import type { StudioMeta } from '../../lib/studioMeta';
import type { AdminApi } from './types';

/* ── Templates tab ──────────────────────────────────────────── */

export function TemplatesTab({ meta, api }: { meta: StudioMeta | null; api: AdminApi }) {
	const [editingKey, setEditingKey] = useState<string | null>(null);
	const [label, setLabel] = useState('');
	const [views, setViews] = useState<string[]>([]);
	const [adding, setAdding] = useState(false);
	const viewModes = meta?.viewModes ?? [];

	const open = (key: string | null, tplLabel: string, tplViews: string[]) => {
		setEditingKey(key);
		setLabel(tplLabel);
		setViews(tplViews);
	};

	const templateColumns: ColumnDef<StudioMeta['templates'][number]>[] = [
		{
			id: 'label',
			accessorKey: 'label',
			header: 'Template',
			filter: { id: 'label', label: 'Template', type: 'text' },
			cell: ({ row }) => (
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<LayoutTemplate size={14} style={{ color: 'var(--mmbix-muted-foreground, #6b7280)', flexShrink: 0 }} />
					<span style={{ fontSize: '0.82rem', fontWeight: 600 }}>{row.original.label}</span>
					{row.original.is_default === 1 && (
						<Badge variant="outline" style={{ fontSize: '0.55rem', color: 'var(--mmbix-primary, #2563eb)' }}>
							default
						</Badge>
					)}
				</div>
			),
		},
		{
			id: 'views',
			header: 'Views',
			enableSorting: false,
			cell: ({ row }) => (
				<div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
					{row.original.views.map((v) => (
						<Badge key={v} variant="outline" style={{ fontSize: '0.55rem', fontWeight: 600 }}>
							{v}
						</Badge>
					))}
					{row.original.views.length === 0 && (
						<span style={{ fontSize: '0.65rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>—</span>
					)}
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
							open(row.original.key, row.original.label, row.original.views);
							setAdding(true);
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
									title: 'Delete template',
									description: `Delete template "${row.original.label}"?`,
									destructive: true,
									confirmLabel: 'Delete',
								}))
							)
								return;
							await api(`/api/studio/template?key=${encodeURIComponent(row.original.key)}`, { method: 'DELETE' });
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
				columns={templateColumns}
				data={meta?.templates ?? []}
				rowKey="key"
				density="compact"
				defaultPageSize={25}
				onCreate={() => {
					open(null, '', []);
					setAdding(true);
				}}
				labels={{ create: 'New template' }}
			/>

			<Dialog open={adding} onOpenChange={setAdding}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editingKey ? 'Edit template' : 'New template'}</DialogTitle>
						<DialogDescription>Each template exposes a set of designer views (the icon bar in the builder).</DialogDescription>
					</DialogHeader>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Label</Label>
							<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Table with Kanban & Form" />
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Views</Label>
							<div
								style={{
									display: 'flex',
									flexDirection: 'column',
									gap: 6,
									border: '1px solid var(--mmbix-border, #e5e7eb)',
									borderRadius: 8,
									padding: '0.6rem',
								}}
							>
								{viewModes.map((vm) => (
									<div key={vm.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
										<Checkbox
											id={`tv-${vm.key}`}
											checked={views.includes(vm.key)}
											onCheckedChange={(checked) => setViews((prev) => (checked ? [...prev, vm.key] : prev.filter((v) => v !== vm.key)))}
										/>
										<Label htmlFor={`tv-${vm.key}`} style={{ cursor: 'pointer', flex: 1 }}>
											{vm.label}
										</Label>
										<span style={{ fontSize: '0.65rem', color: 'var(--mmbix-muted-foreground, #9ca3af)' }}>{vm.key}</span>
									</div>
								))}
							</div>
						</div>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setAdding(false)}>
							Cancel
						</Button>
						<Button
							disabled={!label.trim()}
							onClick={async () => {
								const key =
									editingKey ??
									label
										.trim()
										.toLowerCase()
										.replace(/[^a-z0-9]+/g, '-')
										.replace(/^-|-$/g, '');
								await api('/api/studio/template', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ key, label: label.trim(), views }),
								});
								setAdding(false);
							}}
						>
							Save template
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

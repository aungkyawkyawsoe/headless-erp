import { useState } from 'react';
import {
	Badge,
	Button,
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
import { Save, Trash2 } from 'lucide-react';
import type { AdminApi } from './types';
import type { StudioMeta, EventAction } from '../../lib/studioMeta';

/* ── Event actions tab (CRUD) ──────────────────────────────── */

export function EventsTab({ meta, api }: { meta: StudioMeta | null; api: AdminApi }) {
	const [editing, setEditing] = useState<EventAction | null>(null);
	const [open, setOpen] = useState(false);
	const actions = meta?.eventActions ?? [];

	const params = (a: EventAction): { name: string; label: string; type: string }[] => {
		try {
			return JSON.parse(a.params_json || '[]');
		} catch {
			return [];
		}
	};

	const eventColumns: ColumnDef<EventAction>[] = [
		{
			id: 'label',
			accessorKey: 'label',
			header: 'Action',
			filter: { id: 'label', label: 'Action', type: 'text' },
			cell: ({ row }) => (
				<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
					<span style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{row.original.label}</span>
					<Badge variant="outline" style={{ fontSize: '0.58rem', fontFamily: 'monospace' }}>
						{row.original.action_key}
					</Badge>
				</div>
			),
		},
		{
			id: 'params',
			header: 'Params',
			enableSorting: false,
			cell: ({ row }) => (
				<div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
					{params(row.original).map((p) => (
						<Badge key={p.name} variant="outline" style={{ fontSize: '0.55rem', fontWeight: 600 }}>
							{p.name}: {p.type}
						</Badge>
					))}
					{params(row.original).length === 0 && <span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>no params</span>}
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
							if (confirm(`Delete action "${row.original.label}"?`))
								void api(`/api/studio/event-action?action_key=${encodeURIComponent(row.original.action_key)}`, { method: 'DELETE' });
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
				columns={eventColumns}
				data={actions}
				rowKey="action_key"
				density="compact"
				defaultPageSize={25}
				onCreate={() => {
					setEditing(null);
					setOpen(true);
				}}
				labels={{ create: 'New action' }}
			/>
			{open && (
				<EventActionEditor
					action={editing}
					onClose={() => setOpen(false)}
					onSaved={async (payload) => {
						await api('/api/studio/event-action', {
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

function EventActionEditor({
	action,
	onClose,
	onSaved,
}: {
	action: EventAction | null;
	onClose: () => void;
	onSaved: (payload: Record<string, unknown>) => Promise<void>;
}) {
	const [actionKey, setActionKey] = useState(action?.action_key ?? '');
	const [label, setLabel] = useState(action?.label ?? '');
	const [params, setParams] = useState(action?.params_json ?? '[]');
	const [sortOrder, setSortOrder] = useState(action?.sort_order ?? 0);
	const [error, setError] = useState<string | null>(null);

	const valid = (): boolean => {
		try {
			const p = JSON.parse(params);
			if (!Array.isArray(p)) throw new Error('params must be a JSON array');
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
					<DialogTitle>{action ? `Edit ${action.label}` : 'New event action'}</DialogTitle>
					<DialogDescription>An action designers can attach to a click event, with typed params.</DialogDescription>
				</DialogHeader>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Action key</Label>
							<Input value={actionKey} onChange={(e) => setActionKey(e.target.value)} placeholder="notify" disabled={!!action} />
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Label</Label>
							<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Show notification" />
						</div>
					</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
						<Label>{'Params (JSON array of {name, label, type, required})'}</Label>
						<Textarea
							rows={5}
							value={params}
							onChange={(e) => setParams(e.target.value)}
							placeholder='[{"name":"message","label":"Message","type":"text","required":true}]'
							style={{ fontFamily: 'monospace', fontSize: '0.72rem' }}
						/>
						{error && <p style={{ fontSize: '0.7rem', color: '#dc2626', margin: 0 }}>{error}</p>}
					</div>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
						<Label>Sort order</Label>
						<Input type="number" value={String(sortOrder)} onChange={(e) => setSortOrder(Number(e.target.value))} style={{ width: 120 }} />
					</div>
				</div>
				<DialogFooter>
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button
						disabled={!actionKey.trim() || !label.trim()}
						onClick={() => {
							if (!valid()) return;
							void onSaved({ action_key: actionKey.trim(), label: label.trim(), params_json: params, sort_order: sortOrder });
						}}
					>
						Save action
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

import { useState } from 'react';
import {
	Badge,
	Button,
	Combobox,
	ComboboxContent,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
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
import type { StudioMeta, StylePreset } from '../../lib/studioMeta';
import type { AdminApi } from './types';

/* ── Style presets tab (CRUD) ──────────────────────────────── */

export function StylesTab({ meta, api }: { meta: StudioMeta | null; api: AdminApi }) {
	const [editing, setEditing] = useState<StylePreset | null>(null);
	const [open, setOpen] = useState(false);
	const groups = meta?.stylePresets ?? {};
	const sortedGroups = Object.keys(groups).sort();
	// Flatten the group → presets map into rows; add a composite key for the table.
	const presetRows = sortedGroups.flatMap((g) => groups[g].map((p) => ({ ...p, row_key: `${p.group_key}:${p.value_key}` })));

	const styleColumns: ColumnDef<(typeof presetRows)[number]>[] = [
		{
			id: 'group_key',
			accessorKey: 'group_key',
			header: 'Group',
			filter: { id: 'group_key', label: 'Group', type: 'select', options: sortedGroups.map((g) => ({ label: g, value: g })) },
			cell: ({ value }) => (
				<span
					style={{
						fontSize: '0.72rem',
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
		{ id: 'value_key', accessorKey: 'value_key', header: 'Value key' },
		{ id: 'label', accessorKey: 'label', header: 'Label', filter: { id: 'label', label: 'Label', type: 'text' } },
		{
			id: 'css_value',
			accessorKey: 'css_value',
			header: 'CSS value',
			enableSorting: false,
			cell: ({ value }) =>
				value ? (
					<Badge variant="outline" style={{ fontSize: '0.55rem', fontFamily: 'monospace' }}>
						{String(value)}
					</Badge>
				) : (
					<span style={{ fontSize: '0.65rem', color: '#9ca3af' }}>—</span>
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
							if (confirm(`Delete preset "${row.original.label}"?`))
								void api(
									`/api/studio/style-preset?group_key=${encodeURIComponent(row.original.group_key)}&value_key=${encodeURIComponent(row.original.value_key)}`,
									{ method: 'DELETE' },
								);
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
				columns={styleColumns}
				data={presetRows}
				rowKey="row_key"
				density="compact"
				defaultPageSize={25}
				onCreate={() => {
					setEditing(null);
					setOpen(true);
				}}
				labels={{ create: 'New preset' }}
			/>
			{open && (
				<StylePresetEditor
					preset={editing}
					groups={sortedGroups}
					onClose={() => setOpen(false)}
					onSaved={async (payload) => {
						await api('/api/studio/style-preset', {
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

function StylePresetEditor({
	preset,
	groups,
	onClose,
	onSaved,
}: {
	preset: StylePreset | null;
	groups: string[];
	onClose: () => void;
	onSaved: (payload: Record<string, unknown>) => Promise<void>;
}) {
	const [groupKey, setGroupKey] = useState(preset?.group_key ?? (groups.includes('size') ? 'size' : (groups[0] ?? 'size')));
	const [valueKey, setValueKey] = useState(preset?.value_key ?? '');
	const [label, setLabel] = useState(preset?.label ?? '');
	const [cssValue, setCssValue] = useState(preset?.css_value ?? '');
	const [sortOrder, setSortOrder] = useState(preset?.sort_order ?? 0);

	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent style={{ maxWidth: 480 }}>
				<DialogHeader>
					<DialogTitle>{preset ? `Edit ${preset.label}` : 'New style preset'}</DialogTitle>
					<DialogDescription>A named value inside a style group — e.g. size·md = 8px padding.</DialogDescription>
				</DialogHeader>
				<div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.25rem 0' }}>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Group</Label>
							<Combobox
								value={groupKey}
								onValueChange={(v) => {
									if (v) setGroupKey(String(v));
								}}
								onInputValueChange={() => {}}
								itemToStringLabel={(v) => String(v)}
							>
								<ComboboxInput showTrigger style={{ width: '100%' }} />
								<ComboboxContent align="start" sideOffset={4} style={{ width: 200 }}>
									<ComboboxList>
										{groups.map((g) => (
											<ComboboxItem key={g} value={g}>
												{g}
											</ComboboxItem>
										))}
									</ComboboxList>
								</ComboboxContent>
							</Combobox>
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Value key</Label>
							<Input value={valueKey} onChange={(e) => setValueKey(e.target.value)} placeholder="md" disabled={!!preset} />
						</div>
					</div>
					<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>Label</Label>
							<Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="MD" />
						</div>
						<div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
							<Label>CSS value</Label>
							<Input
								value={cssValue}
								onChange={(e) => setCssValue(e.target.value)}
								placeholder="8px"
								style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
							/>
						</div>
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
						disabled={!groupKey.trim() || !valueKey.trim()}
						onClick={() =>
							void onSaved({
								group_key: groupKey.trim(),
								value_key: valueKey.trim(),
								label: label.trim() || valueKey.trim(),
								css_value: cssValue.trim() || null,
								sort_order: sortOrder,
							})
						}
					>
						Save preset
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

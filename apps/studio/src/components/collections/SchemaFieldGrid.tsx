/**
 * Schema view — the focused collection's fields as a card grid (each card opens
 * the field "⋯" menu), with the "No fields yet" hint when the collection has
 * none. Extracted out of the Collections workbench; behaviour unchanged.
 */
import {
	Badge,
	Card,
	CardContent,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@mmbix/design-system';
import { MoreVertical, Settings2, Trash2 } from 'lucide-react';
import { FieldTypeIcon } from '../formlayout';
import type { FieldDefinition } from '../../lib/api';

export function SchemaFieldGrid({
	fields,
	onEditField,
	onRemoveField,
}: {
	fields: FieldDefinition[];
	onEditField: (field: FieldDefinition) => void;
	onRemoveField: (name: string) => void;
}) {
	if (fields.length === 0) {
		return (
			<div
				style={{
					border: '1px dashed var(--mmbix-border, #e5e7eb)',
					borderRadius: 10,
					padding: '2rem 1rem',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					gap: '0.35rem',
					textAlign: 'center',
				}}
			>
				<p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>No fields yet</p>
				<p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--mmbix-muted-foreground, #6b7280)' }}>
					Pick a field type from the right panel to design the collection’s columns.
				</p>
			</div>
		);
	}
	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
			{fields.map((f) => (
				<Card key={f.name} style={{ padding: 0, ...(f.required ? { borderColor: 'var(--mmbix-primary, #0f766e)' } : {}) }}>
					<CardContent style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.38rem 0.6rem' }}>
						<FieldTypeIcon type={f.type} />
						<span
							style={{
								flex: 1,
								minWidth: 0,
								display: 'inline-flex',
								alignItems: 'baseline',
								gap: 2,
								fontSize: '0.82rem',
								fontWeight: 500,
								overflow: 'hidden',
							}}
						>
							<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flexShrink: 1 }}>
								{f.label || f.name}
							</span>
							{f.required && (
								<span
									title="Required"
									style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)', flexShrink: 0, lineHeight: 1, fontSize: '0.85rem' }}
								>
									*
								</span>
							)}
						</span>
						<Badge variant="outline" style={{ fontSize: '0.6rem', fontWeight: 600, textTransform: 'capitalize' }}>
							{f.type}
						</Badge>
						<DropdownMenu>
							<DropdownMenuTrigger
								title="Field options"
								style={{
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									width: 24,
									height: 24,
									borderRadius: 5,
									border: 'none',
									background: 'transparent',
									color: 'var(--mmbix-muted-foreground, #9ca3af)',
									cursor: 'pointer',
								}}
							>
								<MoreVertical size={13} />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" style={{ minWidth: 180 }}>
								<DropdownMenuItem onClick={() => onEditField(f)}>
									<Settings2 size={13} /> Edit properties
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => onRemoveField(f.name)} style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
									<Trash2 size={13} /> Delete field
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

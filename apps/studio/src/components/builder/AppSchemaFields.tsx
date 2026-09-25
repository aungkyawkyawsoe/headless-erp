/**
 * Schema view — the focused model's fields as a card grid (each card opens the
 * field "⋯" menu). Extracted out of the AppDetailPage; behaviour unchanged.
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
import { MoreVertical } from 'lucide-react';
import { FieldTypeIcon } from '../formlayout';
import type { FieldDefinition } from '../../lib/api';

export function AppSchemaFields({ fields, onRemoveField }: { fields: FieldDefinition[]; onRemoveField: (name: string) => void }) {
	return (
		<div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
			{fields.map((f) => (
				<Card key={f.name} style={{ ...(f.required ? { borderColor: 'var(--mmbix-primary, #0f766e)' } : {}) }}>
					<CardContent style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0.65rem' }}>
						<FieldTypeIcon type={f.type} />
						<span
							style={{
								flex: 1,
								minWidth: 0,
								fontSize: '0.82rem',
								fontWeight: 500,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
							}}
						>
							{f.label || f.name}
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
							<DropdownMenuContent align="end">
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => onRemoveField(f.name)} style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
									<span style={{ width: 13, display: 'inline-flex' }} />
									Delete field
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</CardContent>
				</Card>
			))}
		</div>
	);
}

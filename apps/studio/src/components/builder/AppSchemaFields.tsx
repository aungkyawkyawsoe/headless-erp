/**
 * Schema view — the focused model's fields as a card grid (each card opens the
 * field "⋯" menu via FieldRowMenu). Extracted out of the AppDetailPage;
 * behaviour unchanged. This surface carries no field-editing flow, so its menu
 * is delete-only and FieldRowMenu omits the entries it cannot run.
 */
import { Badge, Card, CardContent } from '@mmbix/design-system';
import { FieldTypeIcon } from '../formlayout';
import { FieldRowMenu } from '../collections/FieldRowMenu';
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
						<FieldRowMenu field={f} onRemove={onRemoveField} />
					</CardContent>
				</Card>
			))}
		</div>
	);
}

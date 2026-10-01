/**
 * Schema view — the focused collection's fields as a card grid (each card opens
 * the field "⋯" menu via FieldRowMenu), with the "No fields yet" hint when the
 * collection has none. Extracted out of the Collections workbench.
 *
 * The grid STATES each field's place on the detail form SPATIALLY, because the
 * "⋯" menu's Hide/width entries change a state this grid is exactly where an
 * operator looks for their effect — without it a click was silent: the entry
 * wrote, nothing on the surface moved, and the feature read as dead. The width
 * is a card SPAN, not a label: the named wide widths (full / fill) take both
 * grid columns, half (and a custom span) takes one — the same 2-column shape
 * the form gives them. A hidden field keeps its stored span and renders dimmed
 * with an eye-off mark, so hiding neither reflows the grid nor loses the
 * placement showing it again will restore.
 */
import { Badge, Card, CardContent } from '@mmbix/design-system';
import { EyeOff } from 'lucide-react';
import { FieldTypeIcon } from '../formlayout';
import { FieldRowMenu, WIDTH_LABELS, type FieldLayoutBinding } from './FieldRowMenu';
import type { FieldDefinition } from '../../lib/api';

/** Grid columns a card spans — the widths the form renders full-bleed take both. */
function spanOf(layout: FieldLayoutBinding | undefined): number {
	return layout && (layout.width === 'full' || layout.width === 'fill') ? 2 : 1;
}

/** The card's hover tooltip: the ONE fact the card cannot state spatially. */
function cardTitle(layout: FieldLayoutBinding | undefined): string | undefined {
	if (!layout) return undefined;
	if (layout.hidden) return 'Hidden on the detail form';
	return layout.width ? `${WIDTH_LABELS[layout.width]} width on the detail form` : undefined;
}

export function SchemaFieldGrid({
	fields,
	onEditField,
	onDuplicateField,
	onRemoveField,
	layoutOf,
}: {
	fields: FieldDefinition[];
	onEditField: (field: FieldDefinition) => void;
	onDuplicateField: (field: FieldDefinition) => void;
	onRemoveField: (name: string) => void;
	/** Each field's place on the detail form — omit on a surface that holds no layout. */
	layoutOf?: (field: FieldDefinition) => FieldLayoutBinding;
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
			{fields.map((f) => {
				const layout = layoutOf?.(f);
				return (
				<Card
					key={f.name}
					title={cardTitle(layout)}
					style={{
						padding: 0,
						gridColumn: `span ${spanOf(layout)}`,
						...(f.required ? { borderColor: 'var(--mmbix-primary, #0f766e)' } : {}),
						...(layout?.hidden ? { opacity: 0.55 } : {}),
					}}
				>
					<CardContent style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.38rem 0.6rem' }}>
						<FieldTypeIcon type={f.type} />
						{layout?.hidden && (
							<EyeOff
								size={12}
								role="img"
								aria-label="Hidden on the detail form"
								style={{ flexShrink: 0, color: 'var(--mmbix-muted-foreground, #9ca3af)' }}
							/>
						)}
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
						<FieldRowMenu
							field={f}
							onEdit={onEditField}
							onDuplicate={onDuplicateField}
							onRemove={onRemoveField}
							layout={layout}
						/>
					</CardContent>
				</Card>
				);
			})}
		</div>
	);
}

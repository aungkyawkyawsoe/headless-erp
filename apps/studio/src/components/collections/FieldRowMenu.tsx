/**
 * The per-field "⋯" menu every schema surface renders — Directus's field actions in
 * our vocabulary: edit the properties, duplicate the field, put it on / take it off
 * the detail form, set how wide it sits there, delete the column. ONE component for
 * both field lists (the collections workbench and the app workbench), so the two can
 * never offer different actions for the same field.
 *
 * An entry renders only when its handler is passed AND the field can carry it: a
 * surface that cannot edit a field shows no dead "Edit" entry, and a field a duplicate
 * cannot be honest for (m2m / table — see `canDuplicateField`) shows no "Duplicate"
 * even where the capability exists (Poka-Yoke — a wrong state, not an error message).
 *
 * The layout group (`layout`) comes from a surface that holds the collection's form
 * layout — in this Studio the LAYOUT, not the schema, decides what the detail form
 * renders. Its width entries are absent until the field is actually on the form: a
 * width for a field that renders nowhere has nothing to set.
 */
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '@mmbix/design-system';
import { Columns2, Copy, Eye, EyeOff, MoreVertical, RectangleHorizontal, Settings2, StretchHorizontal, Trash2 } from 'lucide-react';
import { canDuplicateField } from '../../lib/field-ops';
import type { FieldWidth } from '../formlayout/types';
import type { FieldDefinition } from '../../lib/api';

/** What the host knows about a field's place on the detail form (see lib/field-layout). */
export interface FieldLayoutBinding {
	/** The field is placed on the form. */
	placed: boolean;
	/** The width it renders with — null when that is not one of the named widths. */
	width: FieldWidth | null;
	onSetWidth: (width: FieldWidth) => void;
	onSetPlaced: (placed: boolean) => void;
}

/** The three named widths, in the order Directus lists them. */
const WIDTH_CHOICES: Array<{ width: FieldWidth; label: string; Icon: typeof Columns2 }> = [
	{ width: 'half', label: 'Half width', Icon: Columns2 },
	{ width: 'full', label: 'Full width', Icon: RectangleHorizontal },
	{ width: 'fill', label: 'Fill width', Icon: StretchHorizontal },
];

export function FieldRowMenu({
	field,
	onEdit,
	onDuplicate,
	onRemove,
	layout,
}: {
	field: FieldDefinition;
	/** Open the properties drawer for this field. */
	onEdit?: (field: FieldDefinition) => void;
	/** Append a `<name>_copy` duplicate of this field to the collection. */
	onDuplicate?: (field: FieldDefinition) => void;
	/** Delete the column (the caller confirms first). */
	onRemove?: (name: string) => void;
	/** The field's place on the detail form — pass it where the host holds the layout. */
	layout?: FieldLayoutBinding;
}) {
	const duplicate = onDuplicate && canDuplicateField(field) ? onDuplicate : null;
	if (!onEdit && !duplicate && !onRemove && !layout) return null;
	return (
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
					flexShrink: 0,
				}}
			>
				<MoreVertical size={13} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" style={{ minWidth: 180 }}>
				{onEdit && (
					<DropdownMenuItem onClick={() => onEdit(field)}>
						<Settings2 size={13} /> Edit field
					</DropdownMenuItem>
				)}
				{duplicate && (
					<DropdownMenuItem onClick={() => duplicate(field)}>
						<Copy size={13} /> Duplicate field
					</DropdownMenuItem>
				)}
				{layout && (
					<DropdownMenuItem onClick={() => layout.onSetPlaced(!layout.placed)}>
						{layout.placed ? <EyeOff size={13} /> : <Eye size={13} />}
						{layout.placed ? 'Hide field on detail' : 'Show field on detail'}
					</DropdownMenuItem>
				)}
				{layout?.placed && (
					<>
						<DropdownMenuSeparator />
						{WIDTH_CHOICES.map(({ width, label, Icon }) => (
							<DropdownMenuItem
								key={width}
								// The width the form renders with is DISABLED, the way Directus states it —
								// the entry can't change anything, so it must not invite a click.
								disabled={layout.width === width}
								onClick={() => layout.onSetWidth(width)}
							>
								<Icon size={13} /> {label}
							</DropdownMenuItem>
						))}
					</>
				)}
				{onRemove && (onEdit || duplicate || layout) && <DropdownMenuSeparator />}
				{onRemove && (
					<DropdownMenuItem onClick={() => onRemove(field.name)} style={{ color: 'var(--mmbix-tone-danger-fg, #dc2626)' }}>
						<Trash2 size={13} /> Delete field
					</DropdownMenuItem>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export default FieldRowMenu;

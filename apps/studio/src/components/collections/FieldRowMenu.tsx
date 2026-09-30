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
 * layout. Its Hide/Show entry states the CURRENT fact — the field renders on the form,
 * or it does not — so the entry never claims a state the form is not in, and the width
 * trio is always listed because a pick on an unplaced field PLACES it at that width
 * rather than writing a width nothing renders.
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
	/** The field is explicitly hidden — the flag the Hide entry writes. */
	hidden: boolean;
	/** The width it renders with — null only for a custom span (no entry disabled). */
	width: FieldWidth | null;
	onSetWidth: (width: FieldWidth) => void;
	/** Hide the field (true) or show it again (false — an unplaced field is placed). */
	onSetHidden: (hidden: boolean) => void;
}

/** The three named widths, short — the ONE vocabulary the menu's entries and the
 *  schema card's width chip both read, so a width can never read two ways. */
export const WIDTH_LABELS: Record<FieldWidth, string> = { half: 'Half', full: 'Full', fill: 'Fill' };

/** The three named widths, in the order Directus lists them. */
const WIDTH_CHOICES: Array<{ width: FieldWidth; label: string; Icon: typeof Columns2 }> = [
	{ width: 'half', label: `${WIDTH_LABELS.half} width`, Icon: Columns2 },
	{ width: 'full', label: `${WIDTH_LABELS.full} width`, Icon: RectangleHorizontal },
	{ width: 'fill', label: `${WIDTH_LABELS.fill} width`, Icon: StretchHorizontal },
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
	// The field renders on the detail form unless it is HIDDEN — the layout never
	// carrying a field does not take it off the form; the form appends it
	// (lib/form-view). The Hide/Show entry states this fact in Directus's wording,
	// so a visible field always offers "Hide" and a hidden one "Show".
	const onForm = !!layout && !layout.hidden;
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
					<DropdownMenuItem onClick={() => layout.onSetHidden(onForm)}>
						{onForm ? <EyeOff size={13} /> : <Eye size={13} />}
						{onForm ? 'Hide field on detail' : 'Show field on detail'}
					</DropdownMenuItem>
				)}
				{layout && (
					<>
						<DropdownMenuSeparator />
						{WIDTH_CHOICES.map(({ width, label, Icon }) => (
							<DropdownMenuItem
								key={width}
								// The width the form renders with is DISABLED, the way Directus states it —
								// the entry can't change anything, so it must not invite a click. An unplaced
								// field has no rendered width, so no entry is disabled and the pick places it.
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

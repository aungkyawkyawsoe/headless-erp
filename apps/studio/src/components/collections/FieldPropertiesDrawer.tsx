/**
 * Edit-field properties — the field "⋯" menu opens this Directus-style right
 * drawer so per-field properties (index/unique/required/options/…) can be
 * changed. Property changes auto-save (debounced) to the backend; the drawer
 * only reports edits and asks to close. Extracted out of the Collections
 * workbench; behaviour unchanged.
 */
import type { CSSProperties } from 'react';
import { Button, Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@mmbix/design-system';
import { X } from 'lucide-react';
import { FieldInspector } from '../formlayout';
import type { FieldDefinition, FieldTypeDef } from '../../lib/api';

export function FieldPropertiesDrawer({
	field,
	fields,
	fieldTypes,
	token,
	onUpdate,
	onRemove,
	onClose,
}: {
	field: FieldDefinition | null;
	fields: FieldDefinition[];
	fieldTypes: FieldTypeDef[];
	token: string;
	onUpdate: (name: string, patch: Partial<FieldDefinition>) => void;
	onRemove: (name: string) => void;
	/** Flush any queued edit then clear the focused field (used by close / X / Done). */
	onClose: () => void;
}) {
	return (
		<Drawer
			open={field !== null}
			onOpenChange={(o) => {
				if (!o) onClose();
			}}
			swipeDirection="right"
		>
			<DrawerContent
				style={
					{
						// Full-height panel, flush to the screen edge — wider than the default sheet.
						'--drawer-content-width': 'min(680px, 100vw)',
						'--drawer-inset': '0px',
						borderRadius: 0,
					} as CSSProperties
				}
			>
				<DrawerHeader
					style={{
						display: 'flex',
						flexDirection: 'row',
						alignItems: 'flex-start',
						justifyContent: 'space-between',
						gap: 12,
						padding: '1rem 1.25rem',
						borderBottom: '1px solid var(--mmbix-border, #e5e7eb)',
					}}
				>
					<div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
						<DrawerTitle>Edit field — {field?.label || field?.name}</DrawerTitle>
						<DrawerDescription>Property changes are saved to the collection schema automatically.</DrawerDescription>
					</div>
					<button
						type="button"
						title="Close"
						aria-label="Close field properties"
						onClick={onClose}
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							justifyContent: 'center',
							width: 28,
							height: 28,
							borderRadius: 6,
							border: 'none',
							background: 'transparent',
							color: 'var(--mmbix-muted-foreground, #9ca3af)',
							cursor: 'pointer',
							flexShrink: 0,
						}}
					>
						<X size={16} />
					</button>
				</DrawerHeader>
				<div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
					{field && (
						<FieldInspector
							field={field}
							fields={fields}
							fieldTypes={fieldTypes}
							token={token}
							update={(patch) => onUpdate(field.name, patch)}
							remove={() => onRemove(field.name)}
						/>
					)}
				</div>
				<DrawerFooter
					style={{
						display: 'flex',
						flexDirection: 'row',
						alignItems: 'center',
						justifyContent: 'flex-end',
						gap: 8,
						padding: '0.9rem 1.25rem',
						borderTop: '1px solid var(--mmbix-border, #e5e7eb)',
					}}
				>
					<Button variant="outline" size="sm" onClick={onClose}>
						Done
					</Button>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}

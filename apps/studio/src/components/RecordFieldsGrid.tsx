/**
 * The record form's section grid — every record surface renders its fields through
 * THIS component (the detail view and the create dialog), so one layout edit can
 * never make the two forms disagree. Section headings appear only when the layout
 * has more than one section (one section needs no label), each section is its own
 * `repeat(columns, …)` grid, and every field sits in a `span n` cell of its
 * group's column count — the same arithmetic the layout canvas renders.
 */
import type { ReactNode } from 'react';
import { GroupIcon } from '@mmbix/ui-views';
import type { FormSection } from '../lib/form-view';
import type { FieldDefinition } from '../lib/api';

export function RecordFieldsGrid({
	sections,
	renderField,
}: {
	/** The sections `formSections()` resolved for this record. */
	sections: FormSection[];
	/** Render ONE field at its resolved span (the span is also on the wrapping cell). */
	renderField: (field: FieldDefinition, span: number) => ReactNode;
}) {
	if (sections.length === 0) return null;
	// Headings are for disambiguation: with a single section a label is pure ink.
	const titled = sections.length > 1;
	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
			{sections.map((section, i) => (
				<section key={`${section.title || 'group'}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
					{titled && section.title && (
						<h3
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: 6,
								margin: 0,
								fontSize: '0.72rem',
								fontWeight: 700,
								textTransform: 'uppercase',
								letterSpacing: '0.04em',
								color: 'var(--mmbix-muted-foreground, #6b7280)',
							}}
						>
							{section.icon && <GroupIcon name={section.icon} size={13} />}
							{section.title}
						</h3>
					)}
					<div style={{ display: 'grid', gridTemplateColumns: `repeat(${section.columns}, minmax(0, 1fr))`, gap: '1rem' }}>
						{section.fields.map((f, fi) => (
							<div key={f.name} style={{ gridColumn: `span ${section.spans[fi] ?? 1}`, minWidth: 0 }}>
								{renderField(f, section.spans[fi] ?? 1)}
							</div>
						))}
					</div>
				</section>
			))}
		</div>
	);
}

export default RecordFieldsGrid;

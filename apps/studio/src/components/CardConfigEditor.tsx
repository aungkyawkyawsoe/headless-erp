import { useEffect } from 'react';
import { SYSTEM_FIELD_NAMES } from '../lib/api';
import { useBuilder } from './PageBuilderContext';
import { PropCombobox } from './formlayout/properties';
import { PropRow, PropSection, Segmented } from './formlayout/properties';
import { DEFAULT_CARD_FIELDS, type CardViewConfig } from '@mmbix/ui-views';

/**
 * CardConfigEditor — the card view's property panel (right pane).
 * Edits the view's `card` config: data (collection), card (title/image fields,
 * grid columns). The middle canvas renders a pure live preview
 * (CardViewGrid) — all sections of this editor live in the right pane.
 */
export default function CardConfigEditor({
	view = 'card',
	showData = true,
	compact: _compact = false,
}: {
	view?: string;
	showData?: boolean;
	compact?: boolean;
}) {
	const { viewConfigs, setViewConfig, collections, schemas, fetchSchema } = useBuilder();
	const vc = viewConfigs[view] ?? {};
	const schema = vc.collection ? (schemas[vc.collection] ?? null) : null;

	useEffect(() => {
		if (vc.collection && !schemas[vc.collection]) void fetchSchema(vc.collection);
	}, [vc.collection, schemas, fetchSchema]);

	const fields = (schema?.schema_json.fields ?? []).filter((f) => !SYSTEM_FIELD_NAMES.has(f.name));
	const cv = vc.card ?? {};
	const patch = (p: Partial<CardViewConfig>) => setViewConfig(view, { card: { ...cv, ...p } });

	// Seed a curated field list when a collection is first bound — otherwise the
	// uncurated fallback would dump every field on the card (and persist that on
	// save). Seeding happens once per collection (fields was never set).
	useEffect(() => {
		if (!vc.collection || cv.fields !== undefined || fields.length === 0) return;
		patch({ fields: fields.slice(0, DEFAULT_CARD_FIELDS).map((f) => ({ name: f.name, visible: true })) });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [vc.collection, fields.length]);

	// Set one slot of a list config (footerFields/counterFields) — gaps collapse.
	const setSlot = (key: 'footerFields' | 'counterFields', index: number, value: string) => {
		const next = [...(cv[key] ?? [])];
		next[index] = value || '';
		const cleaned = next.filter(Boolean);
		patch({ [key]: cleaned.length > 0 ? cleaned : undefined } as Partial<CardViewConfig>);
	};

	const columns = cv.columns ?? 3;

	// Field-picker options for the card slots — '' = none/auto (clears the slot).
	const pickerOptions = [{ value: '', label: 'None' }, ...fields.map((f) => ({ value: f.name, label: f.label || f.name }))];
	const titleOptions = [{ value: '', label: 'Auto' }, ...fields.map((f) => ({ value: f.name, label: f.label || f.name }))];

	return (
		<div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
			{showData && (
				<PropSection title="Data" defaultOpen>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
						<PropRow label="Collection">
							<PropCombobox
								value={vc.collection ?? ''}
								options={collections.map((c) => ({ value: c.slug, label: `${c.name} (${c.slug})` }))}
								onChange={(v) => setViewConfig(view, { collection: v })}
								placeholder="Pick a collection"
							/>
						</PropRow>
						{vc.collection && (
							<>
								<PropRow label="Title field" hint="Rendered as the card's heading — auto-picks the first visible field when empty.">
									<PropCombobox
										value={cv.titleField ?? ''}
										options={titleOptions}
										onChange={(v) => patch({ titleField: v || undefined })}
										placeholder="Auto"
									/>
								</PropRow>
								<PropRow label="Image field" hint="File/image field shown as the card photo — optional.">
									<PropCombobox
										value={cv.imageField ?? ''}
										options={pickerOptions}
										onChange={(v) => patch({ imageField: v || undefined })}
										placeholder="None"
									/>
								</PropRow>
								<PropRow label="Layout" hint="Hero — image band on top; Row — photo sidebar with details (directory cards).">
									<Segmented
										value={cv.layout ?? 'hero'}
										options={[
											{ value: 'hero', label: 'Hero' },
											{ value: 'row', label: 'Row' },
										]}
										onChange={(layout) => patch({ layout })}
									/>
								</PropRow>
								{cv.layout === 'row' && (
									<>
										<PropRow label="Status field" hint="Boolean/select field — colors the dot on the photo (active → green).">
											<PropCombobox
												value={cv.statusField ?? ''}
												options={pickerOptions}
												onChange={(v) => patch({ statusField: v || undefined })}
												placeholder="None"
											/>
										</PropRow>
										<PropRow label="Overlay fields" hint="1–2 fields overlaid on the photo's bottom edge (e.g. code, department).">
											<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
												<PropCombobox
													value={cv.overlayFields?.[0] ?? ''}
													options={pickerOptions}
													onChange={(v) => patch({ overlayFields: [v || undefined, cv.overlayFields?.[1]].filter(Boolean) as string[] })}
													placeholder="None"
												/>
												<PropCombobox
													value={cv.overlayFields?.[1] ?? ''}
													options={pickerOptions}
													onChange={(v) => patch({ overlayFields: [cv.overlayFields?.[0], v || undefined].filter(Boolean) as string[] })}
													placeholder="None"
												/>
											</div>
										</PropRow>
										<PropRow label="Badge field" hint="Blue pill next to the title (e.g. gender — male/female become ♂/♀).">
											<PropCombobox
												value={cv.badgeField ?? ''}
												options={pickerOptions}
												onChange={(v) => patch({ badgeField: v || undefined })}
												placeholder="None"
											/>
										</PropRow>
										<PropRow label="Age field" hint="Date field whose age appends to the badge (e.g. date_of_birth → ♂ 24).">
											<PropCombobox
												value={cv.ageField ?? ''}
												options={pickerOptions}
												onChange={(v) => patch({ ageField: v || undefined })}
												placeholder="None"
											/>
										</PropRow>
										<PropRow label="Accent field" hint="Teal line under the title (e.g. designation).">
											<PropCombobox
												value={cv.accentField ?? ''}
												options={pickerOptions}
												onChange={(v) => patch({ accentField: v || undefined })}
												placeholder="None"
											/>
										</PropRow>
										<PropRow label="Subtitle field" hint="Muted line under the accent (e.g. department).">
											<PropCombobox
												value={cv.subtitleField ?? ''}
												options={pickerOptions}
												onChange={(v) => patch({ subtitleField: v || undefined })}
												placeholder="None"
											/>
										</PropRow>
										<PropRow label="Footer pills" hint="Compact soft pills at the card bottom (e.g. employment type) — up to 3.">
											<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
												{([0, 1, 2] as const).map((i) => (
													<PropCombobox
														key={i}
														value={cv.footerFields?.[i] ?? ''}
														options={pickerOptions}
														onChange={(v) => setSlot('footerFields', i, v)}
														placeholder="None"
													/>
												))}
											</div>
										</PropRow>
										<PropRow label="Counter fields" hint="Up to 3 numeric/relation fields as colored boxes (green/orange/red).">
											<div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
												{([0, 1, 2] as const).map((i) => (
													<PropCombobox
														key={i}
														value={cv.counterFields?.[i] ?? ''}
														options={pickerOptions}
														onChange={(v) => setSlot('counterFields', i, v)}
														placeholder="None"
													/>
												))}
											</div>
										</PropRow>
									</>
								)}
								<PropRow label="Grid columns" hint="How many cards sit side by side — rendered exactly as chosen.">
									<Segmented
										value={columns}
										options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: n }))}
										onChange={(n) => patch({ columns: n })}
									/>
								</PropRow>
							</>
						)}
					</div>
				</PropSection>
			)}
		</div>
	);
}

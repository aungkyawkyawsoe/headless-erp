import { useEffect, useRef, useState } from 'react';
import { Spinner, toast } from '@mmbix/design-system';
import { CardViewGrid } from '@mmbix/ui-views';
import { useBuilder } from './PageBuilderContext';
import { updateItem, uploadFile } from '../lib/api';
import { useCollectionPreview } from '../lib/use-collection-preview';

/**
 * CardLayoutCanvas — the middle-column card canvas (layout mode).
 * A pure WYSIWYG live preview: the collection's records rendered as
 * design-system cards with the current card config (preview == runtime).
 * All card properties (Data, Card, Fields) live in the right pane.
 */
export default function CardLayoutCanvas() {
	const { token, viewConfigs, schemas, fetchSchema, focusCollection, setViewConfig } = useBuilder();
	const { collection, schema, fields, rows, setRows, loading, vc } = useCollectionPreview(
		token,
		viewConfigs,
		schemas,
		fetchSchema,
		focusCollection,
		'card',
	);
	const cv = vc.card ?? {};

	// Seed the canvas from the collection's RUNTIME card config (schema_json.card_view)
	// when the page has no card config of its own yet — so Studio preview == runtime
	// even before the designer touches anything (e.g. configs saved from the API).
	// A page config counts as "set" only when it carries the LAYOUT choice — a
	// fields-only seed (e.g. the editor's auto-seed) must not block the runtime layout.
	useEffect(() => {
		const runtime = (schema?.schema_json as { card_view?: unknown } | undefined)?.card_view as
			import('@mmbix/ui-views').CardViewConfig | undefined;
		const pageCard = vc.card;
		const unconfigured = !pageCard?.layout;
		if (!collection || !runtime || !unconfigured) return;
		setViewConfig('card', { collection, card: runtime });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [collection, schema, vc.card]);

	// Photo picker — the card photo's "+" opens the OS file dialog DIRECTLY (no menu)
	// and uploads the chosen image onto that record, exactly like the runtime frontend.
	const fileRef = useRef<HTMLInputElement>(null);
	const pickIdRef = useRef<string | null>(null);
	const [photoBusy, setPhotoBusy] = useState(false);
	const imageField = cv.imageField ?? '';
	const pickPhoto = async (file: File | undefined) => {
		const id = pickIdRef.current;
		pickIdRef.current = null;
		if (!file || !id || !imageField) return;
		setPhotoBusy(true);
		try {
			const res = await uploadFile(token, file);
			await updateItem(token, collection, id, { [imageField]: res.url });
			setRows((rows) => rows.map((r) => (String(r.id) === id ? { ...r, [imageField]: res.url } : r)));
			toast.add({ title: 'Photo updated', type: 'success', timeout: 2000 });
		} catch (e) {
			toast.add({
				title: 'Photo upload failed',
				description: e instanceof Error ? e.message : 'Unknown error',
				type: 'error',
				timeout: 4000,
			});
		} finally {
			setPhotoBusy(false);
		}
	};

	return (
		<div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
			<div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.9rem', background: 'var(--mmbix-background, #fff)' }}>
				{!collection ? (
					<div
						style={{
							border: '1px dashed var(--mmbix-border, #d1d5db)',
							borderRadius: 10,
							padding: '1.25rem',
							color: '#9ca3af',
							fontSize: '0.8rem',
							textAlign: 'center',
						}}
					>
						Pick a collection in the right panel to design the card view.
					</div>
				) : (
					<>
						{/* Live preview — real records rendered with the current card config. */}
						{loading && rows.length === 0 ? (
							<div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#9ca3af', fontSize: '0.8rem', padding: '1rem 0.25rem' }}>
								<Spinner /> Loading records…
							</div>
						) : rows.length === 0 ? (
							<div
								style={{
									border: '1px dashed var(--mmbix-border, #d1d5db)',
									borderRadius: 10,
									padding: '1.25rem',
									color: '#9ca3af',
									fontSize: '0.8rem',
									textAlign: 'center',
								}}
							>
								No records yet — the preview shows real data once the collection has rows.
							</div>
						) : (
							<CardViewGrid
								rows={rows}
								fields={fields}
								cv={cv}
								onPickImage={
									imageField
										? (id) => {
												if (photoBusy) return;
												pickIdRef.current = id;
												fileRef.current?.click();
											}
										: undefined
								}
							/>
						)}
					</>
				)}
			</div>
			{/* Hidden OS file picker — the card photo's "+" opens this directly (no menu). */}
			<input
				ref={fileRef}
				type="file"
				accept="image/*"
				style={{ display: 'none' }}
				onChange={(e) => {
					void pickPhoto(e.target.files?.[0]);
					e.target.value = '';
				}}
			/>
		</div>
	);
}

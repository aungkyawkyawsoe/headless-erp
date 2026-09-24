import { memo, useCallback, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { Cog, Droplet, Loader2, Truck } from 'lucide-react';

import { CARD_FRAME } from '@/shared/components/card';
import { ImageCropSheet } from '@/shared/components/image-crop-sheet';
import { hapticImpact } from '@/shared/platform/haptics';
import { notifyFailed, notifySaved } from '@/shared/save-feedback';
import { uploadImage } from '@/shared/api/media';

import { setFleetImage } from '../data/api';
import { FLUID_KIND_LABELS, KM_LEFT_TONE_CLASS, kmLeftShort, kmLeftTone, kmLeftLabel } from '../data/status';
import type { FleetCardModel } from '../data/types';

/**
 * Fleet card — ultra-compact layout inspired by the reference design:
 *
 *  ┌──────┬──────────────────────────────────────┐
 *  │      │ 9D/2547                     10 W  24 ft│  ← PLATE, first and alone
 *  │      │ FAW · BOX TRUCK · 2023               │  ← brand · unit · year (display face)
 *  │ img  │ YGN · Hlaing                          │  ← license place · township
 *  │      │ 🛢 1,200 km  ⚙ 800 km                │
 *  └──────┴──────────────────────────────────────┘
 *
 *  - **Left tile** — the truck's photo full-height, gradient.
 *    A truck glyph until a photo is uploaded.
 *  - **Header** — the truck's identity in the DISPLAY face (`font-display`, Exo
 *    2), stacked so a scan lands on the plate first: the PLATE on its own line,
 *    then brand · unit type · year, then the license place · township. The
 *    plate is deliberately NOT sharing its line with the region — a plate is
 *    the one string that identifies the truck, and two facts on one baseline
 *    made neither of them read first.
 *  - **Spec tags** — "10 W" (wheel) + "24 ft" (length), pinned to the card's
 *    TOP-RIGHT on the plate's own line. They are numbers with units (the `W` /
 *    `ft` suffix says which is which), so a wheel and a ruler glyph beside them
 *    were decoration that ate the width the plate needed.
 *  - **Care strip** — horizontally scrollable km-left chips per fluid.
 *
 *  The whole card body links to the on-board inventory; the photo tile
 *  opens the photo picker/upload sheet.
 */

/** One spec tag — a bare number-with-unit ("10 W", "24 ft"), no glyph. */
function SpecChip({ label }: { label: string }) {
	return (
		<span className="inline-flex shrink-0 items-center rounded border border-border/70 bg-muted/50 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
			{label}
		</span>
	);
}

function CareChip({ icon, label, kmLeft }: { icon: React.ReactNode; label: string; kmLeft: number }) {
	const tone = kmLeftTone(kmLeft);
	return (
		<span
			title={`${label}: ${kmLeftLabel(kmLeft)}`}
			className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${KM_LEFT_TONE_CLASS[tone]}`}
		>
			{icon}
			<span>{kmLeftShort(kmLeft)}</span>
		</span>
	);
}

/** Upload failure → the operator-facing sentence. */
function uploadErrorMessage(err: unknown): string {
	const status = err && typeof err === 'object' && 'status' in err ? (err as { status?: unknown }).status : undefined;
	if (status === 413) return 'Image is too large — choose a smaller one.';
	if (status === 400 || status === 415 || status === 422) return 'Unsupported image file — choose a PNG/JPEG.';
	return 'Check the connection and try again.';
}

interface FleetCardProps {
	fleet: FleetCardModel;
}

export const FleetCard = memo(function FleetCard({ fleet }: FleetCardProps) {
	// Identity line
	const metaText = [fleet.brandLabel, fleet.unitLabel, fleet.year].filter((part): part is string => Boolean(part)).join(' · ');
	const detailHref = `/app/tyres/vehicle/${fleet.id}?tab=list`;

	// Local upload state
	const [preview, setPreview] = useState<string | null>(fleet.image);
	const [editorFile, setEditorFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const pickForCrop = (file: File | null) => {
		if (!file) return;
		if (file.size === 0 || (file.type && !file.type.startsWith('image/'))) {
			notifyFailed('Couldn\u2019t use that file', 'Choose a PNG/JPEG image.');
			return;
		}
		hapticImpact('light');
		setEditorFile(file);
	};

	const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
		pickForCrop(e.target.files?.[0] ?? null);
		e.target.value = '';
	};

	const uploadEditedImage = useCallback(
		async (file: File) => {
			setEditorFile(null);
			setBusy(true);
			const previous = preview;
			let objectUrl: string | null = null;
			try {
				objectUrl = URL.createObjectURL(file);
				setPreview(objectUrl);
				const uploaded = await uploadImage(file);
				URL.revokeObjectURL(objectUrl);
				objectUrl = null;
				await setFleetImage(fleet.id, uploaded.url);
				setPreview(uploaded.url);
				notifySaved('Truck photo saved', fleet.plateNo);
			} catch (err) {
				if (objectUrl) URL.revokeObjectURL(objectUrl);
				setPreview(previous);
				notifyFailed('Couldn\u2019t save the photo', uploadErrorMessage(err));
			} finally {
				setBusy(false);
			}
		},
		[fleet.id, fleet.plateNo, preview],
	);

	return (
		<li className={`${CARD_FRAME} shadow-card flex flex-col overflow-hidden`}>
			{/* Main row: photo tile + clickable body */}
			<div className="flex items-stretch h-[160px]">
				{/* Photo tile — tap to pick/upload image */}
				<button
					type="button"
					onClick={() => fileInputRef.current?.click()}
					aria-label={`${fleet.plateNo} — ${preview ? 'change' : 'add'} truck photo`}
					className="relative w-32 shrink-0 overflow-hidden bg-muted/40 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
				>
					{preview ? (
						<img src={preview} alt="" className="size-full object-cover" />
					) : (
						<span className="flex size-full items-center justify-center">
							<Truck className="size-9 text-muted-foreground/70" strokeWidth={1.5} aria-hidden />
						</span>
					)}
					<span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
					{busy && (
						<span className="absolute inset-0 flex items-center justify-center bg-background/60">
							<Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
						</span>
					)}
				</button>

				{/* Clickable body — whole right column links to inventory */}
				<Link
					to={detailHref}
					aria-label={`${fleet.plateNo} — on-board inventory`}
					className="flex min-w-0 flex-1 flex-col justify-between p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
				>
					<div className="flex flex-col gap-1.5">
						{/* Row 1: the truck's identity — PLATE first and alone, then brand ·
						    unit · year, then the license place. The plate carries the display
						    face (`font-display`) as the card's own anchor, the same way the
						    item·model pair does on a SKU card. The wheel + length spec tags
						    sit on the PLATE'S OWN LINE, pinned to the top-right. */}
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<div className="min-w-0 flex-1 truncate font-display text-lg font-bold tracking-tight">{fleet.plateNo}</div>
								{(fleet.wheelLabel || fleet.feetLabel) && (
									<div className="flex shrink-0 items-center gap-1">
										{fleet.wheelLabel && <SpecChip label={fleet.wheelLabel} />}
										{fleet.feetLabel && <SpecChip label={fleet.feetLabel} />}
									</div>
								)}
							</div>
							{metaText && <div className="mt-0.5 min-w-0 truncate font-display text-sm font-medium text-muted-foreground">{metaText}</div>}
							{fleet.licenseLabel && <div className="mt-0.5 min-w-0 truncate text-sm text-muted-foreground">{fleet.licenseLabel}</div>}
						</div>

						{/* Care chips — horizontally scrollable */}
						<div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1.5 pr-1">
							{fleet.care?.engineOilKmLeft != null && (
								<CareChip
									icon={<Droplet className="size-3.5" aria-hidden />}
									label={FLUID_KIND_LABELS.engine_oil}
									kmLeft={fleet.care.engineOilKmLeft}
								/>
							)}
							{fleet.care?.gearOilKmLeft != null && (
								<CareChip
									icon={<Cog className="size-3.5" aria-hidden />}
									label={FLUID_KIND_LABELS.gear_oil}
									kmLeft={fleet.care.gearOilKmLeft}
								/>
							)}
						</div>
					</div>
				</Link>
			</div>

			<input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} aria-hidden />

			{editorFile ? (
				<ImageCropSheet file={editorFile} onClose={() => setEditorFile(null)} onApply={(edited) => void uploadEditedImage(edited)} />
			) : null}
		</li>
	);
});

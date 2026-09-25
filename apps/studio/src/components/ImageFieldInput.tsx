import { useRef, useState } from 'react';
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	Button,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
} from '@mmbix/design-system';
import { Camera, Image as ImageIcon, ImagePlus, Link as LinkIcon, MoreVertical, Pen, Upload, X } from 'lucide-react';

import { listMedia, isImageAsset, deleteMediaKey, clearUnusedMedia, type MediaAsset } from '../lib/api';
import { ImageEditorDialog, type ImageEditRequest } from './ImageEditorDialog';
import {
	CameraCaptureDialog,
	barcodeDetectorSupported,
	cameraSupported,
	decodeBarcodeFromFile,
	type CameraCaptureResult,
} from './CameraCaptureDialog';

/** Fixed preview tile — every hover/chrome action anchors to this square canvas,
 *  so the overlays are stable no matter the source image's aspect ratio. */
const TILE = 96;

/** The only URLs an image field may store (mirrors the server's accepted values). */
function isImageUrl(v: string): boolean {
	return /^(https?:\/\/|\/api\/media\/)/i.test(v.trim());
}

/** Small circular overlay control used on top of the image (kept lightweight —
 *  pixel-perfect chips rather than full Design-System buttons). */
function Chip({
	onClick,
	title,
	ariaLabel,
	children,
	disabled,
	size = 28,
	style,
}: {
	onClick: () => void;
	title: string;
	ariaLabel: string;
	children: React.ReactNode;
	disabled?: boolean;
	size?: number;
	style?: React.CSSProperties;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={title}
			aria-label={ariaLabel}
			disabled={!!disabled}
			style={{
				width: size,
				height: size,
				borderRadius: '50%',
				border: 'none',
				padding: 0,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				background: 'rgba(15,23,42,0.72)',
				color: '#fff',
				cursor: disabled ? 'not-allowed' : 'pointer',
				boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
				...style,
			}}
		>
			{children}
		</button>
	);
}

// Reveal helpers for the hover chrome: shown while the tile is hovered OR one of
// its controls has focus (so toggling the ⋯ menu doesn't hide the rest).
const overlayReveal = 'opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100';

/**
 * Record-create/edit control for `image`-typed schema fields.
 *
 * The field stores a URL string — either an R2-served asset (`/api/media/…`,
 * uploaded here or already in the `_media` library) or an external CDN URL.
 * This single value is exactly what the client app already renders via `<img>`, so
 * an image set here shows verbatim on the phones.
 *
 * Three sources, unified into the one string:
 *   - Upload  → POST /api/media/upload (R2). Needs the Studio auth `token`.
 *   - Gallery → GET /api/media?mime=image — pick an asset already in the library.
 *   - URL     → paste an external CDN `https://…` address.
 *
 * Compact avatar-style chrome: the image fills a square tile and the actions live
 * as on-hover chips — an edit ✏️ top-right and an upload/camera ✚ in the center;
 * the ⋯ menu (bottom-right) holds the gallery pick, URL paste and remove.
 * Falls back gracefully when no `token` is available (e.g. batch edit): the
 * image is still shown, URL entry works, and Upload/Gallery are disabled.
 */
export function ImageFieldInput({ value, onChange, token }: { value: unknown; onChange: (v: unknown) => void; token?: string }) {
	const normalized = typeof value === 'string' && value.trim() ? value.trim() : '';
	const src = normalized.startsWith('http') || normalized.startsWith('/') ? normalized : '';
	const fileRef = useRef<HTMLInputElement>(null);
	const [showGallery, setShowGallery] = useState(false);
	const [assets, setAssets] = useState<MediaAsset[] | null>(null);
	const [showUrl, setShowUrl] = useState(false);
	const [urlDraft, setUrlDraft] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// The library asset awaiting delete confirmation (per-asset ✕ button).
	const [pendingRemove, setPendingRemove] = useState<MediaAsset | null>(null);
	// The bulk “remove unused” only runs after its critical confirmation dialog.
	const [confirmClean, setConfirmClean] = useState(false);
	// Transient status/message shown inside the library dialog (remove results/errors).
	const [galleryNotice, setGalleryNotice] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
	// Image queued for the inline editor (crop/rotate/zoom/colour).
	const [editReq, setEditReq] = useState<ImageEditRequest | null>(null);
	// Camera capture dialog (a photo becomes the field value via the upload path).
	const [showCamera, setShowCamera] = useState(false);
	// Feature-detect once per render: no camera ⇒ no camera affordance; no native
	// BarcodeDetector ⇒ no scan promise (capture still works).
	const canUseCamera = cameraSupported();
	const canScanCodes = barcodeDetectorSupported();

	const clear = () => {
		// `null` = explicit clear — the form builders send it through so the server
		// wipes the column, instead of `undefined` which means "untouched" and gets
		// omitted (which would persist the removed image).
		onChange(null);
		setError(null);
	};

	/** Open a now object-URL source in the editor (deferred until Apply). */
	const openObjectUrl = (file: File) => {
		const url = URL.createObjectURL(file);
		setEditReq({ src: url, name: file.name });
	};

	const closeEditor = () => {
		// Release the temporary object URL when one pushed it here.
		if (editReq?.src.startsWith('blob:')) URL.revokeObjectURL(editReq.src);
		setEditReq(null);
	};

	const handleFile = async (file: File | undefined) => {
		if (!file) return;
		setError(null);
		if (!file.type || !/^image\//i.test(file.type)) {
			setError('Choose an image file (jpg, png, webp, gif, avif).');
			return;
		}
		if (!token) {
			setError('Media upload is unavailable here (no session token).');
			return;
		}
		// A QR/barcode in the image can fill the field directly (native decode only).
		acceptImage(file, await decodeBarcodeFromFile(file));
	};

	/** A decoded barcode/QR value fills the field ONLY when it is a storable URL;
	 *  anything else is surfaced (an image field cannot hold free text). */
	const acceptScannedCode = (code: string | null | undefined): boolean => {
		if (!code) return false;
		if (isImageUrl(code)) {
			setError(null);
			onChange(code);
			return true;
		}
		setError(`Scanned “${code}” — not an image URL, so it can't fill this field.`);
		return false;
	};

	/** Route a captured/selected image into the field: a scanned URL wins, else
	 *  the photo goes through the existing crop → upload editor. */
	const acceptImage = (file: File, code?: string | null) => {
		if (acceptScannedCode(code)) return;
		openObjectUrl(file);
	};

	const handleCapture = (result: CameraCaptureResult) => {
		setShowCamera(false);
		if (!token) {
			setError('Media upload is unavailable here (no session token).');
			return;
		}
		acceptImage(result.file, result.code);
	};

	const refreshGallery = async () => {
		if (!token) return;
		setError(null);
		setAssets(await listMedia(token, { mime: 'image', limit: 100 }));
	};

	const removeAsset = async () => {
		if (!pendingRemove) return;
		try {
			await deleteMediaKey(token ?? '', pendingRemove.key);
			await refreshGallery();
			setGalleryNotice({ type: 'info', text: `Removed “${pendingRemove.filename}” from the library.` });
		} catch (e) {
			setGalleryNotice({ type: 'error', text: e instanceof Error ? e.message : 'Could not remove that asset.' });
		} finally {
			setPendingRemove(null);
		}
	};

	/** Actually wipe images no record references. Guarded by `confirmClean`. */
	const cleanUnused = async () => {
		setConfirmClean(false);
		setGalleryNotice(null);
		try {
			const removed = await clearUnusedMedia(token ?? '');
			await refreshGallery();
			setGalleryNotice({
				type: 'info',
				text: removed > 0 ? `Removed ${removed} unused image${removed === 1 ? '' : 's'}.` : 'No unused images to remove.',
			});
		} catch (e) {
			setGalleryNotice({ type: 'error', text: e instanceof Error ? e.message : 'Could not clean unused images.' });
		}
	};

	const openGallery = async () => {
		if (!token) {
			setError('The media gallery is unavailable here (no session token).');
			return;
		}
		try {
			setError(null);
			// Load once, then reuse the cached library so re-opening is instant.
			if (!assets) setAssets(await listMedia(token, { mime: 'image', limit: 100 }));
			setGalleryNotice(null);
			setShowGallery(true);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Could not load the media library.');
		}
	};

	const commitUrl = (raw: string) => {
		const v = raw.trim();
		if (!v) return;
		// Only http(s) URLs or a relative /api/media path may be stored — never
		// `javascript:`/`blob:` etc.
		if (!isImageUrl(v)) {
			setError('Enter an http(s) URL or a /api/media asset path.');
			return;
		}
		setError(null);
		onChange(v);
		setShowUrl(false);
	};

	/** Re-open the inline editor on the CURRENT value (e.g. an already-set image)
	 *  so any image field can be re-touched after saving — applies wherever this
	 *  picker is rendered, not just one module. */
	const editCurrentValue = () => {
		if (!src) return;
		// Derive a sensible output name from the URL: /api/media/<key>.png → "image".
		const base = src.split('?')[0];
		const leaf = base.slice(base.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
		setEditReq({ src, name: leaf || 'image' });
	};

	const toggleUrl = () => {
		setShowUrl((s) => !s);
		// Pre-fill with the current http(s) value so editing the active image URL is easy.
		setUrlDraft(src.startsWith('http') ? src : '');
	};

	return (
		<>
			<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
				<div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
					{/* Preview tile — the whole control. Actions are overlay chips on hover. */}
					<div
						className="group"
						style={{
							position: 'relative',
							width: TILE,
							height: TILE,
							borderRadius: 8,
							border: '1px dashed #cbd5e1',
							overflow: 'hidden',
							background: '#f8fafc',
							flexShrink: 0,
						}}
					>
						{src ? (
							<img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
						) : (
							<div
								style={{
									position: 'absolute',
									inset: 0,
									display: 'flex',
									alignItems: 'center',
									justifyContent: 'center',
								}}
							>
								<ImageIcon size={20} style={{ color: '#94a3b8' }} />
							</div>
						)}

						{/* Hover scrim darkens the tile so light chips read clearly. */}
						<div className={`pointer-events-none absolute inset-0 bg-black/40 ${overlayReveal}`} style={{ zIndex: 1 }} />

						{/* Center — upload / pick a file (primary action, avatar-style). */}
						<div
							className={`absolute inset-0 flex items-center justify-center ${overlayReveal}`}
							style={{ zIndex: 3, pointerEvents: 'none' }}
						>
							<span style={{ pointerEvents: 'auto', display: 'flex', gap: 8 }}>
								<Chip
									onClick={() => fileRef.current?.click()}
									title={token ? 'Upload an image' : 'Media upload is unavailable here (no session token)'}
									ariaLabel="Upload an image"
									disabled={!token || busy}
									size={38}
									style={{ pointerEvents: 'auto' }}
								>
									<Upload size={18} />
								</Chip>
								{canUseCamera && (
									<Chip
										onClick={() => setShowCamera(true)}
										title={
											!token
												? 'Camera is unavailable here (no session token)'
												: canScanCodes
													? 'Take a photo or scan a QR/barcode'
													: 'Take a photo'
										}
										ariaLabel="Take a photo"
										disabled={!token || busy}
										size={38}
										style={{ pointerEvents: 'auto' }}
									>
										<Camera size={18} />
									</Chip>
								)}
							</span>
						</div>

						{/* Top-right — edit / crop the current image. */}
						{src && (
							<div className={`absolute ${overlayReveal}`} style={{ top: 6, right: 6, zIndex: 3, pointerEvents: 'none' }}>
								<span style={{ pointerEvents: 'auto' }}>
									<Chip
										onClick={editCurrentValue}
										title="Edit this image (crop / rotate / tune)"
										ariaLabel="Edit this image"
										style={{ pointerEvents: 'auto' }}
									>
										<Pen size={13} />
									</Chip>
								</span>
							</div>
						)}

						{/* Bottom-right — ⋯ menu: gallery pick, paste URL, remove. */}
						<div className={`absolute ${overlayReveal}`} style={{ bottom: 6, right: 6, zIndex: 4, pointerEvents: 'none' }}>
							<span style={{ pointerEvents: 'auto' }}>
								<DropdownMenu>
									<DropdownMenuTrigger
										disabled={busy}
										aria-label="Image options"
										title="More options"
										style={{
											width: 28,
											height: 28,
											borderRadius: '50%',
											border: 'none',
											padding: 0,
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
											background: 'rgba(15,23,42,0.72)',
											color: '#fff',
											cursor: 'pointer',
											boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
											pointerEvents: 'auto',
										}}
									>
										<MoreVertical size={14} />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" sideOffset={6} className="w-52">
										<DropdownMenuItem onClick={() => void openGallery()} className="cursor-pointer">
											<ImagePlus size={14} />
											Library…
										</DropdownMenuItem>
										<DropdownMenuItem onClick={toggleUrl} className="cursor-pointer">
											<LinkIcon size={14} />
											Paste URL…
										</DropdownMenuItem>
										{src && (
											<>
												<DropdownMenuSeparator />
												<DropdownMenuItem variant="destructive" onClick={clear} className="cursor-pointer">
													<X size={14} />
													Remove image
												</DropdownMenuItem>
											</>
										)}
									</DropdownMenuContent>
								</DropdownMenu>
							</span>
						</div>
					</div>

					{/* Side lane — transient URL input / busy / error text. */}
					<div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
						<input
							ref={fileRef}
							type="file"
							accept="image/*"
							style={{ display: 'none' }}
							onChange={(e) => {
								void handleFile(e.target.files?.[0]);
								e.target.value = '';
							}}
						/>
						{showUrl && (
							<div style={{ display: 'flex', gap: 6, width: 260, marginTop: 20 }}>
								<Input
									autoFocus
									type="text"
									value={urlDraft}
									onChange={(e) => setUrlDraft(e.target.value)}
									placeholder="https://cdn.example.com/img.png"
									style={{ fontSize: '0.78rem', height: 28 }}
									onKeyDown={(e) => {
										if (e.key === 'Enter') commitUrl(urlDraft);
									}}
								/>
								<button type="button" onClick={() => commitUrl(urlDraft)} style={{ fontSize: '0.78rem' }}>
									Set
								</button>
							</div>
						)}
						{busy && <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Uploading…</span>}
						{error && <span style={{ fontSize: '0.72rem', color: '#dc2626' }}>{error}</span>}
					</div>
				</div>

				{/* Image library — shown in a large modal (not inline under the field). */}
				<Dialog open={showGallery} onOpenChange={(open) => !open && setShowGallery(false)}>
					<DialogContent
						style={{ width: 'min(760px, calc(100vw - 2rem))', maxWidth: 760, maxHeight: 'calc(100dvh - 2rem)', overflowY: 'auto' }}
					>
						<DialogHeader>
							<DialogTitle>Image library</DialogTitle>
							<DialogDescription>
								Choose an image already in the media library. Tap a photo to crop/refine it before setting it on this field.
							</DialogDescription>
						</DialogHeader>

						{/* Toolbar — live count on the left; cleanup is behind a critical confirm. */}
						<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
							<span style={{ fontSize: '0.82rem', color: '#374151', fontWeight: 600 }}>
								{(assets ?? []).filter(isImageAsset).length} images
							</span>
							<span style={{ flex: 1 }} />
							<Button
								type="button"
								variant="outline"
								size="xs"
								disabled={busy}
								title="Permanently remove images no record references"
								onClick={() => setConfirmClean(true)}
								style={{ color: 'var(--destructive, #dc2626)', borderColor: 'var(--destructive, #dc2626)' }}
							>
								Remove unused
							</Button>
						</div>

						{galleryNotice && (
							<div
								style={{
									fontSize: '0.74rem',
									color: galleryNotice.type === 'error' ? '#dc2626' : '#374151',
								}}
							>
								{galleryNotice.text}
							</div>
						)}

						{assets && assets.length === 0 && (
							<div
								style={{
									padding: '2.5rem 1rem',
									textAlign: 'center',
									border: '1px dashed #cbd5e1',
									borderRadius: 8,
									color: '#94a3b8',
									fontSize: '0.82rem',
								}}
							>
								No images in the library yet — upload one from the field first.
							</div>
						)}

						<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: 10 }}>
							{(assets ?? []).filter(isImageAsset).map((a) => (
								<div key={a.id} style={{ position: 'relative' }}>
									<button
										type="button"
										title={`${a.filename} — tap to refine and use`}
										onClick={() => {
											setEditReq({ src: a.url, name: a.filename ?? 'image' });
											setShowGallery(false);
										}}
										style={{
											border: src === a.url ? '2px solid #2563eb' : '1px solid #e2e8f0',
											cursor: 'pointer',
											aspectRatio: '1',
											width: '100%',
											padding: 0,
											overflow: 'hidden',
											borderRadius: 8,
											background: '#f8fafc',
										}}
									>
										<img src={a.url} alt={a.filename} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
									</button>
									<button
										type="button"
										title="Remove from library (only if unused)"
										onClick={() => setPendingRemove(a)}
										style={{
											position: 'absolute',
											top: 4,
											right: 4,
											width: 20,
											height: 20,
											border: 'none',
											borderRadius: '50%',
											background: 'rgba(15,23,42,0.6)',
											color: '#fff',
											fontSize: 12,
											lineHeight: 1,
											cursor: 'pointer',
											display: 'flex',
											alignItems: 'center',
											justifyContent: 'center',
										}}
									>
										×
									</button>
								</div>
							))}
						</div>

						<div style={{ paddingTop: 4, fontSize: '0.72rem', color: '#94a3b8' }}>
							Remove unused permanently deletes images that no record references — images still in use are always kept.
						</div>

						<DialogFooter className="sm:justify-between">
							<span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
								{token ? `Connected to media library` : 'No session token — gallery is read-only'}
							</span>
							<DialogClose render={<Button variant="outline">Done</Button>} />
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>

			{/* Remove-from-library confirmation — destructive, so never fire on the ✕
			    tap alone; the server is ref-guarded but this protects against
			    accidental loss of an asset that IS referenced by other records. */}
			<AlertDialog open={pendingRemove !== null} onOpenChange={(open) => !open && setPendingRemove(null)}>
				<AlertDialogContent size="sm">
					<AlertDialogHeader>
						<AlertDialogTitle>Remove “{pendingRemove?.filename}” from the library?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes this image from the media library. It only succeeds when no record currently references it — images
							still in use are kept. This action cannot be undone.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={() => void removeAsset()}>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Remove-unused confirmation — bulk, permanent, and destructive. Never fires
			    on a single click; the whole point is to make the user stop and confirm. */}
			<AlertDialog open={confirmClean} onOpenChange={(open) => !open && setConfirmClean(false)}>
				<AlertDialogContent size="sm">
					<AlertDialogHeader>
						<AlertDialogTitle>Remove all unused images?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes every image in the library that no record currently references. Images that are still used are kept,
							but the removed ones cannot be recovered. Only continue if you are sure — there is no undo for this action.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction variant="destructive" onClick={() => void cleanUnused()}>
							Remove unused
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Camera capture — a photo becomes the field value via the same editor →
			    upload path as a file; a QR/barcode in the frame fills the field directly. */}
			<CameraCaptureDialog open={showCamera} onClose={() => setShowCamera(false)} onCapture={handleCapture} />

			{/* Inline crop / rotate / zoom / colour editor — fires on Upload (raw file)
			    and on Library picks; Apply exports + uploads a NEW derived asset whose
			    URL becomes this field's value (source/library asset never mutated). */}
			<ImageEditorDialog
				open={editReq !== null}
				request={editReq}
				token={token}
				onBusy={setBusy}
				onClose={closeEditor}
				onApply={(url) => {
					setError(null);
					onChange(url);
					closeEditor();
				}}
			/>
		</>
	);
}

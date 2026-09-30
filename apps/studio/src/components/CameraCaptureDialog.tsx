import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@mmbix/design-system';

/**
 * Camera capture for image fields.
 *
 * Opens the device's ENVIRONMENT (rear) camera, shows a live preview, and turns
 * the current frame into an image `File` for the caller's existing upload path —
 * so a phone camera becomes another source for an image value, alongside
 * Upload / Gallery / URL.
 *
 * Three properties this dialog guarantees, each with a corresponding spec:
 *   - It stops EVERY track on close (and on unmount), so the camera indicator
 *     never stays lit after the dialog is gone — the "camera light" leak guard.
 *   - A denied permission surfaces a clear, actionable message instead of a
 *     blank preview.
 *   - A missing `getUserMedia` (older/insecure-context browsers) degrades to a
 *     message that points the user at Upload, rather than throwing.
 *
 * Barcode/QR reading is native and dependency-free: where the browser exposes
 * `BarcodeDetector`, the captured frame is decoded and the value is handed back
 * with the file. When the API is absent, decoding is simply skipped — the
 * capture still works (feature-detect, never a hard failure).
 */

/** What a capture produces: the still image, plus a decoded code when one was found. */
export interface CameraCaptureResult {
	file: File;
	/** Decoded QR/barcode payload, when `BarcodeDetector` found one in the frame. */
	code?: string;
}

/** True when this browser can open a camera stream at all. */
export function cameraSupported(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** True when the browser ships the native Barcode Detection API. */
export function barcodeDetectorSupported(): boolean {
	return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

interface BarcodeDetectorLike {
	detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>>;
}

function barcodeDetectorCtor(): (new (options?: { formats?: string[] }) => BarcodeDetectorLike) | null {
	if (!barcodeDetectorSupported()) return null;
	return (window as unknown as { BarcodeDetector: new (options?: { formats?: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
}

/**
 * Decode the first QR/barcode in an image source, or `null` when unsupported or
 * nothing was found. Never throws: a detector failure means "no code", not a
 * broken capture.
 */
export async function decodeBarcode(source: CanvasImageSource): Promise<string | null> {
	const Ctor = barcodeDetectorCtor();
	if (!Ctor) return null;
	try {
		const codes = await new Ctor().detect(source);
		const value = String(codes?.[0]?.rawValue ?? '').trim();
		return value || null;
	} catch {
		return null;
	}
}

/** Decode an uploaded/captured `File`/`Blob` by loading it into an <img> first. */
export async function decodeBarcodeFromFile(file: Blob): Promise<string | null> {
	if (!barcodeDetectorSupported()) return null;
	const url = URL.createObjectURL(file);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error('unreadable image'));
			el.src = url;
		});
		return await decodeBarcode(img);
	} catch {
		return null;
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function CameraCaptureDialog({
	open,
	onClose,
	onCapture,
}: {
	open: boolean;
	onClose: () => void;
	onCapture: (result: CameraCaptureResult) => void;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	// The active stream lives in a ref so the close/unmount cleanup can always
	// reach it — even if the getUserMedia promise resolves mid-teardown.
	const streamRef = useRef<MediaStream | null>(null);
	const [stream, setStream] = useState<MediaStream | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);
	const [busy, setBusy] = useState(false);

	/** Stop every track so the camera device is released (the leak guard). */
	const stopStream = useCallback(() => {
		const active = streamRef.current;
		streamRef.current = null;
		setStream(null);
		setReady(false);
		if (active) for (const track of active.getTracks()) track.stop();
	}, []);

	// Acquire the environment camera while open; release it on close or unmount.
	useEffect(() => {
		if (!open) {
			stopStream();
			return;
		}
		let cancelled = false;
		setError(null);
		setReady(false);

		if (!cameraSupported()) {
			setError('This browser cannot open the camera (getUserMedia is unavailable). Use Upload instead.');
			return;
		}

		navigator.mediaDevices
			.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
			.then((acquired) => {
				// If we were closed while the prompt was open, release immediately.
				if (cancelled) {
					for (const track of acquired.getTracks()) track.stop();
					return;
				}
				streamRef.current = acquired;
				setStream(acquired);
				setReady(true);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				const name = (err as { name?: string })?.name ?? '';
				if (name === 'NotAllowedError' || name === 'SecurityError') {
					setError('Camera permission was denied. Allow camera access in your browser settings, or use Upload instead.');
				} else if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
					setError('No usable camera was found on this device. Use Upload instead.');
				} else {
					setError('Could not start the camera. Check the device and permissions, then try again — or use Upload.');
				}
			});

		return () => {
			cancelled = true;
			stopStream();
		};
	}, [open, stopStream]);

	// Attach the stream once both the element and the stream exist.
	useEffect(() => {
		const video = videoRef.current;
		if (!video || !stream) return;
		try {
			video.srcObject = stream;
		} catch {
			/* jsdom / older engines may not implement srcObject — capture is unaffected. */
		}
		try {
			const played = video.play?.();
			if (played && typeof played.catch === 'function') played.catch(() => {});
		} catch {
			/* autoplay may be blocked; the preview still appears on user gesture. */
		}
	}, [stream, ready]);

	const capture = async () => {
		const video = videoRef.current;
		if (!video) return;
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (!width || !height) {
			setError('The camera is still warming up — try again in a moment.');
			return;
		}
		setBusy(true);
		setError(null);
		try {
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) throw new Error('Canvas is not supported in this browser.');
			ctx.drawImage(video, 0, 0, width, height);

			const code = (await decodeBarcode(canvas)) ?? undefined;
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
			if (!blob) throw new Error('Could not capture the frame.');

			onCapture({ file: new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' }), code });
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Could not capture the frame.');
		} finally {
			setBusy(false);
		}
	};

	const handleClose = () => {
		// Release the device synchronously on the user's close gesture, before the
		// effect cleanup runs, so the camera light goes out the instant they dismiss.
		stopStream();
		onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
			<DialogContent style={{ width: 'min(560px, calc(100vw - 2rem))', maxWidth: 560 }}>
				<DialogHeader>
					<DialogTitle>Take a photo</DialogTitle>
					<DialogDescription>
						Point the camera at the subject and capture. The photo is uploaded through the same media path as a file upload.
						{barcodeDetectorSupported() ? ' A QR or barcode in the frame is scanned automatically.' : ''}
					</DialogDescription>
				</DialogHeader>

				<div
					style={{
						position: 'relative',
						width: '100%',
						aspectRatio: '4 / 3',
						borderRadius: 8,
						overflow: 'hidden',
						background: '#0f172a',
					}}
				>
					<video
						ref={videoRef}
						aria-label="Camera preview"
						playsInline
						muted
						style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
					/>
					{!ready && !error && (
						<div
							style={{
								position: 'absolute',
								inset: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								color: '#cbd5e1',
								fontSize: '0.82rem',
							}}
						>
							Starting camera…
						</div>
					)}
					{error && (
						<div
							role="alert"
							style={{
								position: 'absolute',
								inset: 0,
								display: 'flex',
								alignItems: 'center',
								justifyContent: 'center',
								gap: 8,
								padding: '1rem 1.25rem',
								textAlign: 'center',
								color: '#fecaca',
								fontSize: '0.82rem',
								background: 'rgba(15,23,42,0.92)',
							}}
						>
							<CameraOff size={16} style={{ flexShrink: 0 }} />
							<span>{error}</span>
						</div>
					)}
				</div>

				<DialogFooter className="sm:justify-between">
					<Button type="button" variant="outline" onClick={handleClose}>
						Cancel
					</Button>
					<Button type="button" onClick={() => void capture()} disabled={!ready || busy}>
						<Camera size={15} />
						{busy ? 'Capturing…' : 'Capture'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

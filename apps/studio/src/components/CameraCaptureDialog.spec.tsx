// @vitest-environment jsdom
/**
 * CameraCaptureDialog — the camera-track leak guard.
 *
 * The failure this suite exists to prevent is the "camera light that never goes
 * out": a dialog that opens a `MediaStream` and closes without stopping its
 * tracks leaves the device (and the browser's recording indicator) live. So the
 * central assertion is that CLOSING the dialog calls `stop()` on EVERY track.
 *
 * The other two paths — a denied permission and a browser without `getUserMedia`
 * — must degrade to a clear message rather than a blank preview or a throw.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraCaptureDialog } from './CameraCaptureDialog';

function fakeStream(trackCount = 2): { stream: MediaStream; stops: Array<ReturnType<typeof vi.fn>> } {
	const stops = Array.from({ length: trackCount }, () => vi.fn());
	const stream = { getTracks: () => stops.map((stop) => ({ stop, kind: 'video' })) } as unknown as MediaStream;
	return { stream, stops };
}

/** Install a `mediaDevices.getUserMedia` stub (jsdom ships none). */
function installGetUserMedia(impl: (constraints: MediaStreamConstraints) => Promise<MediaStream>) {
	const getUserMedia = vi.fn(impl);
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
	return getUserMedia;
}

function clearMediaDevices() {
	Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
}

afterEach(() => {
	cleanup();
	clearMediaDevices();
});

describe('CameraCaptureDialog', () => {
	it('requests the ENVIRONMENT camera and stops every track when closed', async () => {
		const { stream, stops } = fakeStream(2);
		const getUserMedia = installGetUserMedia(async () => stream);

		const { rerender } = render(<CameraCaptureDialog open onClose={vi.fn()} onCapture={vi.fn()} />);

		await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1));
		const constraints = getUserMedia.mock.calls[0][0] as MediaStreamConstraints;
		expect((constraints.video as MediaTrackConstraints).facingMode).toBe('environment');
		expect(constraints.audio).toBe(false);

		// Still open ⇒ no track may have been stopped yet.
		expect(stops.every((stop) => stop.mock.calls.length === 0)).toBe(true);

		// THE LEAK GUARD: closing must stop every track.
		rerender(<CameraCaptureDialog open={false} onClose={vi.fn()} onCapture={vi.fn()} />);
		await waitFor(() => expect(stops.every((stop) => stop.mock.calls.length === 1)).toBe(true));
	});

	it('releases the camera when the stream resolves AFTER the dialog was closed', async () => {
		// The user can dismiss the dialog while the permission prompt is still up;
		// the late-resolving stream must still be stopped, not leak.
		let resolve: ((s: MediaStream) => void) | undefined;
		installGetUserMedia(() => new Promise<MediaStream>((r) => (resolve = r)));
		const { stream, stops } = fakeStream(1);

		const { rerender } = render(<CameraCaptureDialog open onClose={vi.fn()} onCapture={vi.fn()} />);
		rerender(<CameraCaptureDialog open={false} onClose={vi.fn()} onCapture={vi.fn()} />);

		resolve?.(stream);
		await waitFor(() => expect(stops[0].mock.calls.length).toBe(1));
	});

	it('shows a clear message when camera permission is denied', async () => {
		installGetUserMedia(async () => {
			throw new DOMException('denied', 'NotAllowedError');
		});

		render(<CameraCaptureDialog open onClose={vi.fn()} onCapture={vi.fn()} />);

		expect(await screen.findByText(/permission was denied/i)).toBeTruthy();
	});

	it('degrades gracefully when getUserMedia is unavailable', async () => {
		clearMediaDevices();

		render(<CameraCaptureDialog open onClose={vi.fn()} onCapture={vi.fn()} />);

		expect(await screen.findByText(/cannot open the camera/i)).toBeTruthy();
	});
});

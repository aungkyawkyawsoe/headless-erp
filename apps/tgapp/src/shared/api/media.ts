import { sdk } from './sdk';

/**
 * The ONE media upload client for the mini app.
 *
 * A photo upload is a plain `POST /api/media/upload` (multipart, one `file`
 * part) that answers with the storable `/api/media/<key>` URL. It goes through
 * the same SDK transport as every read/write (auth + envelope); `FormData`
 * bodies are auto-exempt from the idempotency key and the offline queue.
 *
 * Because a `FormData` body cannot be re-serialized, the offline queue can never
 * replay an upload — so a single dropped connection on a phone would lose the
 * photo permanently. Retry the transport/5xx outcomes here instead, with a
 * FRESH `FormData` per attempt (a consumed body can never be re-sent).
 */

/** One uploaded asset as the media upload route returns it (`data` of
 *  `POST /api/media/upload`). */
export interface MediaUploadResult {
	/** The R2 object key (the `/api/media/<key>` path segment). */
	key: string;
	/** The storable media URL — store this in a record's `image` field. */
	url: string;
	filename: string;
	size: number;
	mime_type: string;
}

/** True when an upload failure is worth another attempt — a transport-level
 *  failure (no HTTP status) or a 408/429/5xx. A 4xx rejection (bad bytes, too
 *  large, unauthorized) is deterministic, so retrying it would only waste time. */
function isRetryableUploadError(err: unknown): boolean {
	const raw = err && typeof err === 'object' && 'status' in err ? (err as { status?: unknown }).status : undefined;
	const status = typeof raw === 'number' ? raw : undefined;
	if (status === undefined) return true; // NetworkError — no HTTP status at all
	if (status <= 0) return true; // aborted / opaque failure
	return status === 408 || status === 429 || status >= 500;
}

/** Upload attempts before giving up (1 initial + 2 retries). */
const UPLOAD_ATTEMPTS = 3;

/** Upload a photo to R2 and return the media URL to store in an `image` field. */
export async function uploadImage(file: File): Promise<MediaUploadResult> {
	let lastError: unknown;
	for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt++) {
		const form = new FormData();
		form.append('file', file, file.name);
		try {
			return await sdk.request<MediaUploadResult>('/media/upload', { method: 'POST', body: form });
		} catch (err) {
			lastError = err;
			if (attempt === UPLOAD_ATTEMPTS - 1 || !isRetryableUploadError(err)) throw err;
			await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
		}
	}
	throw lastError;
}

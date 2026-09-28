/**
 * Files (media) sub-API — uploads into the engine's R2 media library.
 *
 * Three paths, MECE:
 *   - `upload()`          direct multipart with the session bearer — a 401
 *                         heals through refresh-token rotation like any call
 *   - `presign()`         mint a single-use, user-bound upload token (15 min)
 *   - `uploadWithToken()` redeem that token with NO bearer — the delegated
 *                         path for uploaders that never hold the session
 *                         (background isolate, upload worker). The signed
 *                         token IS the credential and burns on first use.
 *
 * Deliberately NOT exposed here: the library list / delete / GC routes —
 * those are Studio admin surfaces, not app surfaces.
 */
import type { RequestOptions } from './client';

/** Per-asset privacy. `'public'` (the server default) serves anonymously — a
 *  stored value is rendered as `<img src>`, which cannot carry a bearer.
 *  `'private'` serves only its uploader or an admin. */
export type MediaVisibility = 'public' | 'private';

/** The upload response (`MediaUploadResult` on the wire). */
export interface MediaAsset {
	key: string;
	url: string;
	filename: string;
	size: number;
	mime_type: string;
}

/** A single-use delegated upload token (`POST /media/presign`). */
export interface PresignedUpload {
	token: string;
	expires_at: string;
	upload_url: string;
	max_bytes: number;
}

/** Per-upload options (shared by `upload` and `uploadWithToken`). */
export interface FileUploadOptions {
	/** `'private'` restricts serving to the uploader/admin; omitted ⇒ the
	 *  server default `'public'` (a capability URL). */
	visibility?: MediaVisibility;
	/** Override the multipart filename — a plain `Blob` carries none (a
	 *  `File` carries its own). The name decides the R2 key's extension. */
	filename?: string;
	/** Per-call timeout (ms) — uploads default to {@link UPLOAD_TIMEOUT_MS}. */
	timeoutMs?: number;
}

/** Default upload timeout — large camera files over a slow link. */
export const UPLOAD_TIMEOUT_MS = 120_000;

export interface FilesApi {
	/** Direct multipart upload — the session bearer rides along and a 401
	 *  heals (rotate + retry) exactly like any other authenticated call. */
	upload(file: Blob, options?: FileUploadOptions): Promise<MediaAsset>;
	/** Mint a single-use token bound to the current user (15 min TTL). */
	presign(): Promise<PresignedUpload>;
	/** Redeem a presigned token with NO bearer — the token itself is the
	 *  credential and is consumed on first use. */
	uploadWithToken(file: Blob, token: string, options?: FileUploadOptions): Promise<MediaAsset>;
}

/**
 * Build one multipart body for the media routes. The filename must ride on
 * the file part — the server derives the stored key's extension from it, and
 * a `File`'s own name is the fallback for a bare `Blob`. `visibility` is
 * appended only when set: absent ⇒ the server default (`public`).
 */
function uploadForm(file: Blob, options: FileUploadOptions | undefined): FormData {
	const form = new FormData();
	const fallback = typeof File !== 'undefined' && file instanceof File ? file.name : undefined;
	form.append('file', file, options?.filename ?? fallback);
	if (options?.visibility) form.append('visibility', options.visibility);
	return form;
}

export function createFilesApi(request: <T>(path: string, options?: RequestOptions) => Promise<T>): FilesApi {
	return {
		upload: (file, options = {}) =>
			request<MediaAsset>('/media/upload', {
				method: 'POST',
				body: uploadForm(file, options),
				timeoutMs: options.timeoutMs ?? UPLOAD_TIMEOUT_MS,
			}),
		presign: () =>
			request<PresignedUpload>('/media/presign', {
				method: 'POST',
				timeoutMs: 10_000,
				// A replayed presign would mint a token nobody can consume (the caller
				// already saw the failure) — never enqueue it for offline replay.
				noQueue: true,
			}),
		uploadWithToken: (file, token, options = {}) =>
			request<MediaAsset>(`/media/upload/${token}`, {
				method: 'POST',
				body: uploadForm(file, options),
				timeoutMs: options.timeoutMs ?? UPLOAD_TIMEOUT_MS,
			}),
	};
}

/**
 * R2 Client Wrapper
 *
 * Thin wrapper around Cloudflare R2 bucket operations.
 * Handles file uploads with proper metadata and URL generation.
 */

import type { R2Bucket, R2ObjectBody } from '@cloudflare/workers-types';

/** Body accepted by R2Bucket.put — referenced from the binding type directly so
 *  this wrapper's contract is identical under every consumer tsconfig (the DOM
 *  and workers-types Blob/ReadableStream definitions differ). */
type R2PutValue = NonNullable<Parameters<R2Bucket['put']>[1]>;

export interface R2UploadInput {
	/** File buffer/stream content */
	body: R2PutValue;
	/** Original filename for metadata */
	filename: string;
	/** MIME type of the file */
	contentType: string;
	/** Optional custom metadata key-value pairs */
	customMetadata?: Record<string, string>;
}

export interface R2UploadResult {
	key: string;
	url: string;
	size: number;
	etag: string;
}

export class R2Client {
	constructor(private bucket: R2Bucket) {}

	/**
	 * Upload a file to R2 with metadata.
	 * Returns the object key and public URL.
	 */
	async upload(input: R2UploadInput): Promise<R2UploadResult> {
		const { body, filename, contentType, customMetadata } = input;

		// Generate a unique object key: UUID + original extension
		const ext = this._extractExt(filename);
		const key = `${crypto.randomUUID()}${ext}`;

		const object = await this.bucket.put(key, body, {
			httpMetadata: { contentType },
			customMetadata,
		});

		return {
			key,
			url: `/api/media/${key}`,
			size: object.size,
			etag: object.etag,
		};
	}

	/**
	 * Delete an object from R2 by key.
	 */
	async delete(key: string): Promise<void> {
		await this.bucket.delete(key);
	}

	/**
	 * Get an object from R2 by key.
	 */
	async get(key: string): Promise<R2ObjectBody | null> {
		return this.bucket.get(key);
	}

	/**
	 * Generate a public URL for serving the file.
	 * Uses the bucket's public URL or a relative path.
	 */
	getPublicUrl(key: string): string {
		return `/api/media/${key}`;
	}

	/**
	 * Extract the file extension from a filename.
	 * Returns empty string if no extension found.
	 * Includes the dot, e.g. ".jpg"
	 */
	private _extractExt(filename: string): string {
		const dotIndex = filename.lastIndexOf('.');
		if (dotIndex === -1 || dotIndex === 0) return '';
		return filename.slice(dotIndex).toLowerCase();
	}
}

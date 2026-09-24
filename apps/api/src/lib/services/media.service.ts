/**
 * Media Service
 *
 * Business logic for media asset management (R2 + D1).
 *
 * Flow:
 *   Route → Validation → Service → R2Client + D1
 */

import { D1Client } from '@mmbix/core';
import { R2Client } from '@mmbix/core';
import { QueryBuilder } from '@mmbix/core';
import { MigrationRunner } from '@mmbix/core';
import { ValidationError, PayloadTooLargeError, UnsupportedMediaError } from '@mmbix/utils';
import type { MediaUploadResult } from '@mmbix/types';
import { MediaRefService } from '@/lib/services/media-ref.service';

/** A `_media` row exposed by the Studio library list endpoint. */
export interface MediaListItem {
	id: string;
	key: string;
	url: string;
	filename: string;
	mime_type: string;
	size: number;
	created_at?: string | null;
}

// ─── Config ────────────────────────────────────────────

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

const ALLOWED_MIME_TYPES: string[] = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/avif',
	// NOTE: image/svg+xml is deliberately NOT allowed — SVG can carry embedded
	// scripts and is served from the API origin as image/svg+xml (stored XSS).
	'application/pdf',
	'text/plain',
	'text/csv',
	'application/json',
	'video/mp4',
	'video/webm',
	'video/quicktime',
	'audio/mpeg',
	'audio/ogg',
	'audio/wav',
	'audio/webm',
	'application/zip',
	'application/gzip',
];

// ─── Magic-byte sniffing ────────────────────────────────
// The client-supplied file.type is UNTRUSTED. Verify the first bytes of the
// payload match the declared MIME type so a disguised payload (e.g. an SVG with
// embedded script uploaded as image/svg+xml, or an HTML file as text/plain)
// can never be stored and served from the API origin.

function ascii(bytes: Uint8Array, start: number, end: number): string {
	return String.fromCharCode(...bytes.slice(start, end));
}

/** Prefix length scanned for HTML/XML markup markers in text uploads.
 *  Real HTML documents place <html>/<script>/<!-- within the first ~100 bytes,
 *  so a 2KB prefix catches disguised HTML without scanning the whole file. */
const TEXT_SNIFF_PREFIX = 2048;

/** True when a text-ish payload looks like HTML/XML markup — an HTML file with
 *  embedded script disguised as text/plain|text/csv|application/json must never
 *  be stored and served from the API origin. */
function containsHtmlMarkup(head: Uint8Array): boolean {
	const lower = ascii(head, 0, head.length).toLowerCase();
	return /(<script|<html|<\?xml|<!--)/.test(lower);
}

/** Returns true when the first bytes of `head` match the declared MIME type. */
function sniffMime(type: string, head: Uint8Array): boolean {
	const len = head.length;
	switch (type) {
		case 'image/jpeg':
			return len >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
		case 'image/png':
			return (
				len >= 8 &&
				head[0] === 0x89 &&
				head[1] === 0x50 &&
				head[2] === 0x4e &&
				head[3] === 0x47 &&
				head[4] === 0x0d &&
				head[5] === 0x0a &&
				head[6] === 0x1a &&
				head[7] === 0x0a
			);
		case 'image/gif':
			return (len >= 6 && ascii(head, 0, 6) === 'GIF87a') || (len >= 6 && ascii(head, 0, 6) === 'GIF89a');
		case 'image/webp':
			return len >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP';
		case 'image/avif':
			// ISO BMFF: bytes 4-7 = 'ftyp', bytes 8-11 = brand (avif/avis)
			return len >= 12 && ascii(head, 4, 8) === 'ftyp' && (ascii(head, 8, 12) === 'avif' || ascii(head, 8, 12) === 'avis');
		case 'application/pdf':
			return len >= 5 && ascii(head, 0, 5) === '%PDF-';
		case 'video/mp4':
			// ISO BMFF ftyp box — brand may be isom/mp42/M4V/etc.
			return len >= 8 && ascii(head, 4, 8) === 'ftyp';
		case 'video/quicktime':
			return len >= 12 && ascii(head, 4, 8) === 'ftyp' && ascii(head, 8, 12) === 'qt  ';
		case 'video/webm':
			return len >= 4 && ascii(head, 0, 4) === '\x1aE\xdf\xa3';
		case 'audio/mpeg':
			// MPEG frame sync: 11 set bits (0xFF 0xE0)
			return len >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
		case 'audio/ogg':
			return len >= 4 && ascii(head, 0, 4) === 'OggS';
		case 'audio/wav':
			return len >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WAVE';
		case 'audio/webm':
			return len >= 4 && ascii(head, 0, 4) === '\x1aE\xdf\xa3';
		case 'application/zip':
			return len >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07);
		case 'application/gzip':
			return len >= 2 && head[0] === 0x1f && head[1] === 0x8b;
		case 'text/plain':
		case 'text/csv':
		case 'application/json':
			// Text-ish: must contain no NUL bytes (NUL is a strong binary signal),
			// and must not smuggle HTML/XML markup (stored-XSS guard, M10).
			return len > 0 && !head.includes(0) && !containsHtmlMarkup(head);
		default:
			return false;
	}
}

// ─── Media Service ─────────────────────────────────────

export class MediaService {
	private db: D1Client;
	private r2: R2Client;
	private runner: MigrationRunner;

	constructor(db: D1Client, bucket: R2Bucket) {
		this.db = db;
		this.r2 = new R2Client(bucket);
		this.runner = new MigrationRunner(db);
	}

	/**
	 * Ensure migrations are up-to-date.
	 */
	async ensureMigrations(): Promise<void> {
		await this.runner.runPending();
	}

	/**
	 * Upload a file to R2 and record metadata in D1.
	 */
	async upload(file: File): Promise<MediaUploadResult> {
		// Validate file
		if (!file || file.size === 0) {
			throw new ValidationError('Uploaded file is empty');
		}

		if (file.size > MAX_FILE_SIZE) {
			throw new PayloadTooLargeError(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB.`);
		}

		if (ALLOWED_MIME_TYPES.length > 0 && !ALLOWED_MIME_TYPES.includes(file.type)) {
			if (file.type === 'image/svg+xml') {
				throw new UnsupportedMediaError('SVG uploads are not allowed (stored-XSS risk) — convert to PNG/JPEG');
			}
			throw new UnsupportedMediaError(`Unsupported file type: "${file.type}". Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`);
		}

		// 🔒 Magic-byte sniffing — never trust client-supplied file.type. A file
		// whose bytes don't match the declared MIME type is rejected outright.
		// The prefix is larger than the 16 bytes the magic-byte checks need so
		// the text types can also be scanned for HTML/XML markup.
		const head = new Uint8Array(await file.slice(0, TEXT_SNIFF_PREFIX).arrayBuffer());
		if (!sniffMime(file.type, head)) {
			throw new ValidationError(`File content does not match the declared type "${file.type}"`);
		}

		// Upload to R2
		const uploadResult = await this.r2.upload({
			body: file,
			filename: file.name,
			contentType: file.type || 'application/octet-stream',
			customMetadata: { originalName: file.name },
		});

		// Record in D1 (id is required by the _media schema)
		const mediaEntry = {
			id: crypto.randomUUID(),
			key: uploadResult.key,
			filename: file.name,
			size: file.size,
			mime_type: file.type || 'application/octet-stream',
			url: uploadResult.url,
		};

		const insertStmt = QueryBuilder.from('_media').toInsert(mediaEntry);
		await this.db.run(insertStmt);

		return {
			key: uploadResult.key,
			url: uploadResult.url,
			filename: file.name,
			size: file.size,
			mime_type: file.type || 'application/octet-stream',
		};
	}

	/**
	 * List media assets (auth'd) — powers the Studio media-library gallery.
	 * Newest-first with LIMIT/OFFSET (internal authoring tool, bounded pages), an
	 * optional `imageOnly` filter (mime_type LIKE 'image/%') and image-safe shape.
	 */
	async list(opts: { limit?: number; offset?: number; imageOnly?: boolean } = {}): Promise<MediaListItem[]> {
		const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? 50), 100));
		const offset = Math.max(0, Math.floor(opts.offset ?? 0));

		let qb = QueryBuilder.from('_media')
			.select('id', 'key', 'url', 'filename', 'mime_type', 'size', 'created_at')
			.orderBy('created_at', 'desc');
		if (opts.imageOnly) qb = qb.where('mime_type', 'LIKE', 'image/%');
		qb = qb.limit(limit).offset(offset);
		return this.db.all<MediaListItem>(qb.toSelect());
	}

	/**
	 * Serve a media file from R2.
	 * Returns the raw response body + headers.
	 */
	async serve(key: string): Promise<{ body: ArrayBuffer; contentType: string; contentLength: number; etag: string } | null> {
		// Validate key — prevent path traversal
		if (!key || typeof key !== 'string') {
			throw new ValidationError('Missing or invalid media key');
		}
		if (key.includes('..') || key.includes('/')) {
			throw new ValidationError('Invalid media key');
		}

		const object = await this.r2.get(key);
		if (!object) {
			return null;
		}

		const body = await object.arrayBuffer();
		return {
			body,
			contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
			contentLength: object.size,
			etag: object.httpEtag,
		};
	}

	/** Ref-guarded delete of one asset.
	 *  Deletes the R2 object + `_media` row ONLY when nothing in the reference
	 *  registry still points at it (so a library asset re-used on another record
	 *  — or in a rich-text/markdown body still in use — is never destroyed by
	 *  clearing one field). Returns 'deleted' | 'in_use' | 'not_found'. */
	async deleteIfUnused(key: string): Promise<'deleted' | 'in_use' | 'not_found'> {
		if (!key || typeof key !== 'string') return 'not_found';
		const refs = new MediaRefService(this.db);
		if (await refs.isReferenced(key)) return 'in_use';

		const row = await this.db.first<{ id: string }>(QueryBuilder.from('_media').select('id').where('key', key).toSelect());
		if (!row) return 'not_found';
		await this.db.run(QueryBuilder.from('_media').where('key', key).toDelete());
		try {
			await this.r2.delete(key);
		} catch (err) {
			console.error(`[media] r2 delete failed for key ${key}:`, err instanceof Error ? err.message : err);
		}
		return 'deleted';
	}

	/** Garbage-collect assets with zero references (ref-guarded per key).
	 *  Returns the number of objects removed. Admin-triggered. */
	async gcUnused(): Promise<number> {
		const rows = await this.db.all<{ key: string }>({
			sql: 'SELECT m.key FROM _media m LEFT JOIN _media_refs r ON r.media_key = m.key WHERE r.media_key IS NULL',
			bindings: [],
		});
		let removed = 0;
		const refs = new MediaRefService(this.db);
		for (const row of rows) {
			if (await refs.isReferenced(row.key)) continue; // safety re-check
			await this.db.run(QueryBuilder.from('_media').where('key', row.key).toDelete());
			try {
				await this.r2.delete(row.key);
				removed++;
			} catch (err) {
				console.error(`[media] r2 delete failed for key ${row.key}:`, err instanceof Error ? err.message : err);
			}
		}
		return removed;
	}
}

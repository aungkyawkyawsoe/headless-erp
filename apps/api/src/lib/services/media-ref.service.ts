import { QueryBuilder } from '@mmbix/core';
import type { D1Client } from '@mmbix/core';

/**
 * Media reference registry.
 *
 * Entity rows can store R2 media assets as plain `/api/media/<key>` URL strings
 * (image/file fields, and any text-bearing column). `_media_refs` records which
 * media_key each document references so an asset can be removed/garbage-collected
 * only once NOTHING references it — protecting images that are intentionally
 * shared (picked from the library onto more than one record).
 *
 * Kept DB-only (no R2 binding) so the write pipeline can maintain it; actual
 * object deletion lives in MediaService (which holds the bucket).
 */

/** Extract distinct `/api/media/<key>` keys from any value (string/nested). */
export function extractMediaKeys(value: unknown): string[] {
	const out = new Set<string>();
	collect(value, out);
	return [...out];
}

function collect(value: unknown, out: Set<string>): void {
	if (value == null) return;
	if (typeof value === 'string') {
		const re = /\/api\/media\/([\w.-]+)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(value)) !== null) out.add(m[1]);
		return;
	}
	if (Array.isArray(value)) {
		for (const v of value) collect(v, out);
		return;
	}
	if (typeof value === 'object') {
		for (const k of Object.keys(value as Record<string, unknown>)) collect((value as Record<string, unknown>)[k], out);
	}
}

export class MediaRefService {
	constructor(private db: D1Client) {}

	/** Registered media keys for one document. */
	async refsOf(collection: string, docId: string): Promise<string[]> {
		const rows = await this.db.all<{ media_key: string }>(
			QueryBuilder.from('_media_refs').select('media_key').where('collection', collection).where('doc_id', docId).toSelect(),
		);
		return rows.map((r) => r.media_key);
	}

	/** Replace a document's registered refs with those found in `snapshot`.
	 *  Returns the keys that were previously registered but are now gone (the
	 *  candidate orphans released by this write). */
	async syncDoc(collection: string, docId: string, snapshot: unknown): Promise<string[]> {
		const next = new Set(extractMediaKeys(snapshot));
		const prior = new Set(await this.refsOf(collection, docId));
		/** Keys that no longer belong to this doc (cleared/replaced value). */
		const released = [...prior].filter((k) => !next.has(k));
		if (prior.size === 0 && next.size === 0) return released;

		const stmts: Array<{ sql: string; bindings: unknown[] }> = [];
		for (const k of prior) {
			stmts.push(QueryBuilder.from('_media_refs').where('media_key', k).where('collection', collection).where('doc_id', docId).toDelete());
		}
		for (const k of next) {
			stmts.push(QueryBuilder.from('_media_refs').toInsert({ media_key: k, collection, doc_id: docId }));
		}
		if (stmts.length > 0) await this.db.batch(stmts);
		return released;
	}

	async refCount(key: string): Promise<number> {
		const rows = await this.db.all<{ media_key: string }>(
			QueryBuilder.from('_media_refs').select('media_key').where('media_key', key).limit(1000).toSelect(),
		);
		return rows.length;
	}

	async isReferenced(key: string): Promise<boolean> {
		return (await this.refCount(key)) > 0;
	}
}

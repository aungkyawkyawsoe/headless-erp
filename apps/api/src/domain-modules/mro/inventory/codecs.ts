import {
	MRO_ASSET_CONDITIONS,
	MRO_ASSET_REQUEST_STATUSES,
	MRO_INBOUND_TYPES,
	MRO_LOCATIONS,
	MRO_OUTBOUND_TYPES,
	MRO_REQUISITION_CLOSE_REASONS,
	MroError,
} from './types';
import type { MroAssetCondition, MroInboundType, MroLocation, MroOutboundType, MroTracking, MovementLedgerAggRow } from './types';

export function isAssetRequestStatus(v: unknown): v is string {
	return typeof v === 'string' && MRO_ASSET_REQUEST_STATUSES.includes(v);
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function changesOf(r: { meta?: { changes?: number } }): number {
	return r.meta?.changes ?? 0;
}

export function isLocation(v: unknown): v is MroLocation {
	return typeof v === 'string' && (MRO_LOCATIONS as string[]).includes(v);
}

export function isCondition(v: unknown): v is MroAssetCondition {
	return typeof v === 'string' && (MRO_ASSET_CONDITIONS as string[]).includes(v);
}

export function isTracking(v: unknown): MroTracking {
	return v === 'batch' || v === 'serial' ? v : 'standard';
}

export function isOutboundType(v: unknown): v is MroOutboundType {
	return typeof v === 'string' && (MRO_OUTBOUND_TYPES as string[]).includes(v);
}

export function isInboundType(v: unknown): v is MroInboundType {
	return typeof v === 'string' && (MRO_INBOUND_TYPES as string[]).includes(v);
}

export function dateOrNull(v: unknown): string | null {
	return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Resolve a valid close_reason; empty/absent → fallback ('cancelled'), invalid value → 400. */
export function closeReasonOf(v: unknown, fallback = 'cancelled'): string {
	if (v === undefined || v === null || v === '') return fallback;
	const s = String(v).trim();
	if (!(MRO_REQUISITION_CLOSE_REASONS as string[]).includes(s))
		throw new MroError(400, `close_reason must be one of: ${MRO_REQUISITION_CLOSE_REASONS.join(', ')}`);
	return s;
}

export function qtyOf(v: unknown, label = 'qty'): number {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) throw new MroError(400, `${label} must be a positive number`);
	return n;
}

export function strId(v: unknown, label: string): string {
	const s = typeof v === 'string' ? v.trim() : '';
	if (!s) throw new MroError(400, `${label} is required`);
	return s;
}

export function uid(): string {
	return crypto.randomUUID();
}

/**
 * Normalize an operator-chosen physical event date to `YYYY-MM-DD`, or null when
 * omitted. A non-date or an impossible calendar day (2026-02-31) is a hard 400 so
 * a typo can never land a bogus wear/un-wear date in the immutable history.
 */
export function normalizeEventDate(value: string | null | undefined): string | null {
	const raw = (value ?? '').trim();
	if (!raw) return null;
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new MroError(400, 'event_date must be YYYY-MM-DD');
	const parsed = new Date(`${raw}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw)
		throw new MroError(400, 'event_date is not a real calendar date');
	return raw;
}

/** `serials` json column → string[] (already valid when it is a JSON array). */
/** `YYYY-MM-DD~<line uuid>` — the movement ledger's opaque keyset cursor. */
export function encodeMovementCursor(date: string | null, lineId: string): string {
	return `${date ?? ''}~${lineId}`;
}

export function decodeMovementCursor(cursor: string): { date: string; lineId: string } {
	const sep = cursor.indexOf('~');
	if (sep <= 0) throw new MroError(400, 'invalid movement cursor');
	return { date: cursor.slice(0, sep), lineId: cursor.slice(sep + 1) };
}

/** `name_en~<master id>` — the groups directory's opaque keyset cursor. The name
 *  is URL-encoded so a literal `~` can never split the key. */
export function encodeGroupCursor(name: string | null, id: string): string {
	return `${encodeURIComponent(name ?? '')}~${id}`;
}
export function decodeGroupCursor(cursor: string): { name: string; id: string } {
	const sep = cursor.indexOf('~');
	if (sep <= 0) throw new MroError(400, 'invalid movement groups cursor');
	let name: string;
	try {
		name = decodeURIComponent(cursor.slice(0, sep));
	} catch {
		throw new MroError(400, 'invalid movement groups cursor');
	}
	return { name, id: cursor.slice(sep + 1) };
}

/** `YYYY-MM-DD~<model id>` — Screen 2's model-row keyset cursor (the day the SKU
 *  last moved, then its id). Both halves are `~`-free by construction. */
export function encodeModelCursor(lastDate: string, model: string): string {
	return `${lastDate}~${model}`;
}

export function decodeModelCursor(cursor: string): { lastDate: string; model: string } {
	const sep = cursor.indexOf('~');
	if (sep < 0) throw new MroError(400, 'invalid movement models cursor');
	return { lastDate: cursor.slice(0, sep), model: cursor.slice(sep + 1) };
}

/** `created_at~id` — the transfer-request feed's opaque keyset cursor. The
 *  timestamp is URL-encoded so a literal `~` can never split the key. */
export function encodeAssetRequestCursor(createdAt: string | null, id: string): string {
	return `${encodeURIComponent(createdAt ?? '')}~${id}`;
}

export function decodeAssetRequestCursor(cursor: string): { createdAt: string; id: string } {
	const sep = cursor.indexOf('~');
	if (sep <= 0) throw new MroError(400, 'invalid asset request cursor');
	let createdAt: string;
	try {
		createdAt = decodeURIComponent(cursor.slice(0, sep));
	} catch {
		throw new MroError(400, 'invalid asset request cursor');
	}
	return { createdAt, id: cursor.slice(sep + 1) };
}

/** A raw movement-lines row → the ledger projection both line feeds share. */
export function movementAggRowOf(r: Record<string, unknown>): MovementLedgerAggRow {
	return {
		direction: r.direction === 'in' || r.direction === 'out' || r.direction === 'trf' ? r.direction : 'in',
		line_id: String(r.line_id ?? ''),
		model: r.model == null ? null : String(r.model),
		kind: r.kind == null ? null : String(r.kind),
		doc_no: r.doc_no == null ? null : String(r.doc_no),
		// The source doc's id — lets a ledger row open its own document instead of
		// being a dead end (a `doc_no` alone cannot route).
		doc_id: r.doc_id == null ? null : String(r.doc_id),
		date: r.date == null ? null : String(r.date),
		location: r.location == null ? null : String(r.location),
		from_location: r.from_location == null ? null : String(r.from_location),
		to_location: r.to_location == null ? null : String(r.to_location),
		model_name: r.model_name == null ? null : String(r.model_name),
		qty: r.qty == null ? null : Number(r.qty),
		unit_price: r.unit_price == null ? null : Number(r.unit_price),
		batch_no: r.batch_no == null ? null : String(r.batch_no),
		serials: r.serials == null ? null : String(r.serials),
		note: r.note == null ? null : String(r.note),
		created_name: r.created_name == null ? null : String(r.created_name),
	};
}

export function parseSerials(v: unknown, label: string): string[] {
	if (v === undefined || v === null || v === '') return [];
	let raw: unknown = v;
	if (typeof v === 'string') {
		try {
			raw = JSON.parse(v);
		} catch {
			throw new MroError(400, `${label} must be a JSON array of serial numbers`);
		}
	}
	if (!Array.isArray(raw)) throw new MroError(400, `${label} must be a JSON array of serial numbers`);
	return raw.map((s) => String(s).trim()).filter(Boolean);
}

/**
 * Fluent typed CRUD over the entity engine: `client.items('records')`.
 *
 * Write operations are replay-safe by design:
 *   - `create` attaches a client-generated UUID — a retried/replayed POST can
 *     never duplicate a row (the API is idempotent on the primary key).
 *   - `idempotencyKey` rides along for server-side dedupe of whole batches.
 *   - `ifMatch` (optimistic concurrency) makes the API 409 a stale overwrite.
 */
import type { ListQuery, ListResult, PageSizePolicy } from './query';
import { DEFAULT_PAGE_SIZE_POLICY, normalizePageSize, serializeQuery } from './query';

export interface MutateOptions {
	/** Client-generated UUID — replay-safe creates. Defaults to a random UUID. */
	id?: string;
	/** Server-side idempotency key (Stripe-style replay protection). */
	idempotencyKey?: string;
	/** Expected `updated_at` — the API 409s when the row changed since. */
	ifMatch?: string;
	/**
	 * Acknowledges a guard WARNING the server already showed the caller (e.g. the
	 * MRO same-day duplicate requisition), letting the write proceed where the
	 * unacknowledged one is refused. The token comes from the guard's own pre-flight
	 * read — never hardcode one — and rides as the `X-Write-Ack` header, so it can
	 * never leak into the record (see `apps/api` `lib/write-ack.ts`).
	 */
	ack?: string;
	/** Runtime validation (e.g. a typegen-generated Zod schema). */
	validate?: { parse(data: unknown): unknown };
}

export interface ItemsApi<T extends Record<string, unknown>> {
	/** One cursor-paginated page. */
	list(query?: ListQuery<T>): Promise<ListResult<T>>;
	/** Total rows matching a filter (COUNT only — no page SELECT). */
	count(query?: Pick<ListQuery<T>, 'filter' | 'search'>): Promise<number>;
	/** A single row by id (lean projection via `fields`). */
	get(id: string, query?: { fields?: ListQuery<T>['fields'] }): Promise<T>;
	/** Create — client-generated UUID + optional idempotency key. */
	create(body: Partial<T>, options?: MutateOptions): Promise<T>;
	/** Update — pass `ifMatch` to guard against clobbering concurrent edits. */
	update(id: string, body: Partial<T>, options?: Omit<MutateOptions, 'id'>): Promise<T>;
	/** Soft delete. */
	remove(id: string, options?: { ifMatch?: string }): Promise<{ id: string }>;
}

export interface RequestFn {
	<T = unknown>(path: string, options?: RequestOptionsLike): Promise<{ data: T; meta?: Record<string, unknown> }>;
}

/** The header a guard-warning acknowledgement rides on — the wire name the API
 *  reads (`apps/api` `lib/write-ack.ts`). Header names are case-insensitive. */
export const WRITE_ACK_HEADER = 'X-Write-Ack';

/** The headers ONE write needs — currently only a confirmed guard warning. */
function ackHeaders(ack: string | undefined): Record<string, string> | undefined {
	return ack ? { [WRITE_ACK_HEADER]: ack } : undefined;
}

// Minimal structural type — avoids a circular import with client.ts.
export interface RequestOptionsLike {
	method?: string;
	query?: URLSearchParams | Record<string, string | number | boolean | undefined>;
	body?: unknown;
	headers?: Record<string, string>;
	idempotencyKey?: string;
	ifMatch?: string;
	noQueue?: boolean;
	validate?: { parse(data: unknown): unknown };
}

/** RFC 4122 v4 UUID — crypto.randomUUID() where available (secure contexts). */
export function uuid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
		const r = (Math.random() * 16) | 0;
		return ch === 'x' ? r.toString(16) : ((r & 0x3) | 0x8).toString(16);
	});
}

export function createItemsApi<T extends Record<string, unknown>>(
	collection: string,
	request: RequestFn,
	pageSize: PageSizePolicy | (() => PageSizePolicy) = DEFAULT_PAGE_SIZE_POLICY,
): ItemsApi<T> {
	const entity = (id: string) => `/entities/${collection}/${encodeURIComponent(id)}`;
	return {
		async list(query) {
			// Page-size policy is resolved PER CALL — a getter can be passed so a
			// policy adopted later (client.loadLimits()) is honored by an ItemsApi
			// that was created before the policy changed.
			const policy = typeof pageSize === 'function' ? pageSize() : pageSize;
			// An unspecified limit becomes the policy default (25); anything above
			// the policy max (100) is clamped — the server truncates there anyway.
			// Callers that need more rows must cursor-walk.
			const limit = normalizePageSize(query?.limit, policy);
			// Wire contract: `{ success, data: T[], meta: { limit, has_more, cursor… } }`.
			const { data, meta } = await request<T[]>(`/entities/${collection}`, {
				query: serializeQuery({ ...query, limit }),
			});
			return { data, meta: (meta ?? {}) as ListResult<T>['meta'] };
		},
		async count(query) {
			const params = serializeQuery({ filter: query?.filter, search: query?.search, countOnly: true, limit: 1 });
			const { meta } = await request<unknown[]>(`/entities/${collection}`, { query: params });
			return Number((meta as { total?: number } | undefined)?.total ?? 0);
		},
		async get(id, query) {
			const { data } = await request<T>(entity(id), {
				query: query?.fields !== undefined ? new URLSearchParams({ fields: String(query.fields) }) : undefined,
			});
			return data;
		},
		async create(body, options = {}) {
			const { data } = await request<T>(`/entities/${collection}`, {
				method: 'POST',
				body: { id: options.id ?? uuid(), ...body },
				headers: ackHeaders(options.ack),
				idempotencyKey: options.idempotencyKey,
				validate: options.validate,
			});
			return data;
		},
		async update(id, body, options = {}) {
			const { data } = await request<T>(entity(id), {
				method: 'PUT',
				body,
				headers: ackHeaders(options.ack),
				idempotencyKey: options.idempotencyKey,
				ifMatch: options.ifMatch,
				validate: options.validate,
			});
			return data;
		},
		async remove(id, options = {}) {
			const { data } = await request<{ id: string }>(entity(id), { method: 'DELETE', ifMatch: options.ifMatch });
			return data;
		},
	};
}

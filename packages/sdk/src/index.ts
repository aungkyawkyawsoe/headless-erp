/**
 * @mmbix/sdk — typed client for the Mmbix headless entity engine.
 *
 * Zero-waste by construction:
 *   - typed query builder (fields/filter/sort/cursor) — no hand-rolled URLs
 *   - expired tokens cleared up front; 401 self-heal via refreshSession
 *   - transient retry, typed errors, replay-safe writes (UUID + idempotency)
 *   - typegen: schema → types + Zod schemas in one generated file
 */
export { MmbixClient, createClient, parseChangeEnvelope } from './client';
export type { ChangeEnvelope, ClientFeature, ClientOptions, RequestOptions, SessionUser, TelegramLoginResult } from './client';
export { rest, staticToken, authenticate } from './composables';
export { SdkError, HttpError, NetworkError, isSdkError, apiErrorCodeOf, KNOWN_ERROR_CODES } from './errors';
export type { ApiEnvelopeError } from './errors';
export { memoryTokenStorage, localStorageTokenStorage, tokenExpiryMs, tokenSubjectOf, isTokenExpired } from './auth';
export type { TokenStorage } from './auth';
export {
	serializeFilter,
	serializeQuery,
	stringifyFilterValue,
	aggregateAlias,
	normalizePageSize,
	DEFAULT_PAGE_SIZE,
	MAX_PAGE_SIZE,
	MAX_QUERIES_PER_BATCH,
} from './query';
export type { AggregateMeasure, AggregateOp, Filter, FilterCondition, ListQuery, ListResult, PageSizePolicy } from './query';
export { fieldsToArray, restrictFields } from './permissions';
export { createItemsApi, uuid } from './items';
export type { ItemsApi, MutateOptions, RequestFn, RequestOptionsLike } from './items';
export { createOfflineQueue, memoryQueueStorage, localStorageQueueStorage, fingerprint } from './offline';
export type { OfflineQueue, OfflineQueueOptions, QueuedMutation, QueueStorage } from './offline';
export { ConditionalResponseCache, memoryResponseCacheStorage, localStorageResponseStorage } from './conditional-cache';
export type { CachedResponse, PersistedResponse, ResponseCacheStorage, ConcreteResponseCacheStorage } from './conditional-cache';
// Typegen (schema → types/Zod) lives behind the '@mmbix/sdk/typegen' subpath — it
// pulls node:fs (schema-file reading) and must never leak into browser bundles.

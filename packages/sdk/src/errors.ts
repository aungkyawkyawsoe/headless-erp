/**
 * Error hierarchy for the Mmbix SDK.
 *
 * Every SDK failure is a typed error so callers can branch precisely:
 *   - NetworkError   — the request never reached the server (offline, DNS, abort)
 *   - HttpError      — the server answered with a non-2xx (401/403/404/409/422/429/5xx)
 *   - SdkError       — base class (also used for malformed envelopes)
 *
 * Error CODES come from the canonical catalog in `@mmbix/types` (ERROR_CODES) —
 * the SAME source the API validates its `fail()`/error-handler against — so a
 * backend code can never silently drift from what SDK clients match on.
 */
import { ERROR_CODES, isErrorCode } from '@mmbix/types';
import type { ApiErrorCode } from '@mmbix/types';

export const KNOWN_ERROR_CODES = ERROR_CODES;

export interface ApiEnvelopeError {
	message?: string;
	code?: string;
	[key: string]: unknown;
}

/** Extract a human message + machine code from the API's error envelope. */
function envelopeParts(error: unknown): { message: string; code: string } {
	if (typeof error === 'string') return { message: error, code: 'API_ERROR' };
	if (error && typeof error === 'object') {
		const e = error as ApiEnvelopeError;
		const message =
			typeof e.message === 'string' ? e.message : e.error ? (typeof e.error === 'string' ? e.error : 'Request failed') : 'Request failed';
		return { message, code: typeof e.code === 'string' ? e.code : 'API_ERROR' };
	}
	return { message: 'Request failed', code: 'API_ERROR' };
}

export class SdkError extends Error {
	readonly status: number;
	/** The error code — the canonical `ErrorCode` union when known, or the raw
	 *  server/legacy code otherwise (kept for backward compat). */
	readonly code: string;

	constructor(message: string, status = 0, code: string) {
		super(message);
		this.name = 'SdkError';
		this.status = status;
		this.code = code;
	}
}

/** The server answered with a non-2xx response. */
export class HttpError extends SdkError {
	readonly body: unknown;
	/** The code narrowed to the canonical API surface when it matches one of the
	 *  known `ERROR_CODES`; otherwise `'API_ERROR'`. Use `apiErrorCodeOf(e)` to
	 *  branch without guessing at string literals. */
	readonly apiCode: ApiErrorCode | 'API_ERROR';
	readonly requestId?: string;

	constructor(message: string, status: number, code: string, body?: unknown) {
		super(message, status, code);
		this.name = 'HttpError';
		this.body = body;
		this.apiCode = isErrorCode(code) ? code : 'API_ERROR';
		this.requestId =
			body && typeof body === 'object' && typeof (body as { request_id?: unknown }).request_id === 'string'
				? (body as { request_id: string }).request_id
				: undefined;
	}

	/** Build from a raw fetch Response + parsed body.
	 *
	 *  The real backend envelope is `{ success: false, error: string, code: string, request_id? }`
	 *  with `code` a TOP-LEVEL sibling of `error` — read it first so backend codes
	 *  (NOT_FOUND / CONFLICT / UNAUTHORIZED / RATE_LIMIT_EXCEEDED / …) survive.
	 *  Older envelopes may still nest the error object (`{ success: false, error: { message, code } }`)
	 *  or pass the error object directly — the nested fallback keeps those working.
	 *
	 *  `.code` is preserved AS RECEIVED (a host may emit a code outside the
	 *  canonical catalog); `.apiCode` additionally narrows to the canonical code
	 *  when it matches (`API_ERROR` otherwise). */
	static fromResponse(res: { status: number; statusText: string }, body: unknown): HttpError {
		const topCode =
			body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string'
				? (body as { code: string }).code
				: undefined;
		const nested =
			body && typeof body === 'object' && (body as { error?: unknown }).error !== undefined ? (body as { error?: unknown }).error : body;
		const parsed = envelopeParts(nested);
		const message = parsed.message !== 'Request failed' ? parsed.message : `${res.status} ${res.statusText}`;
		const code = topCode ?? parsed.code;
		return new HttpError(message, res.status, code, body);
	}
}

/** The request never reached the server (offline, DNS failure, aborted). */
export class NetworkError extends SdkError {
	readonly cause?: unknown;

	constructor(cause?: unknown) {
		super('Network error — the server could not be reached', 0, 'NETWORK_ERROR');
		this.name = 'NetworkError';
		this.cause = cause;
	}
}

/** True when `e` is any SDK error. */
export function isSdkError(e: unknown): e is SdkError {
	return e instanceof SdkError;
}

/** Narrow an SDK error to the canonical API error code when it matches one.
 *  Returns `null` when the code isn't one of the known `ERROR_CODES` (e.g.
 *  a legacy/unknown server code) so callers can branch without literals. */
export function apiErrorCodeOf(e: unknown): ApiErrorCode | null {
	const c = e instanceof HttpError ? e.apiCode : null;
	return c === 'API_ERROR' ? null : c;
}

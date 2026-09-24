/**
 * Enterprise-Grade Error System
 *
 * Hierarchical error classes with HTTP status codes,
 * error codes, and structured serialization for API responses.
 *
 * Usage:
 *   throw new NotFoundError('Collection', slug)
 *   throw new ValidationError('Invalid field name')
 *   throw new AppError(409, 'CONFLICT', 'Duplicate entry')
 */

// ─── Base Error ────────────────────────────────────────

export class AppError extends Error {
	public readonly statusCode: number;
	public readonly code: string;
	public readonly details?: unknown;
	public readonly field?: string;
	public readonly timestamp: string;

	constructor(statusCode: number, code: string, message: string, details?: unknown, field?: string) {
		super(message);
		this.name = 'AppError';
		this.statusCode = statusCode;
		this.code = code;
		this.details = details;
		this.field = field;
		this.timestamp = new Date().toISOString();

		// Maintain proper prototype chain
		Object.setPrototypeOf(this, AppError.prototype);
	}

	/** Serialize to API response format */
	toJSON() {
		return {
			success: false as const,
			error: this.message,
			code: this.code,
			...(this.details !== undefined && { details: this.details }),
			...(this.field !== undefined && { field: this.field }),
		};
	}
}

// ─── 4xx Client Errors ─────────────────────────────────

/** 400 Bad Request — Invalid input */
export class ValidationError extends AppError {
	constructor(message: string, details?: unknown, field?: string) {
		super(400, 'VALIDATION_ERROR', message, details, field);
		this.name = 'ValidationError';
		Object.setPrototypeOf(this, ValidationError.prototype);
	}
}

/** 401 Unauthorized — Missing or invalid credentials */
export class UnauthorizedError extends AppError {
	constructor(message = 'Authentication required') {
		super(401, 'UNAUTHORIZED', message);
		this.name = 'UnauthorizedError';
		Object.setPrototypeOf(this, UnauthorizedError.prototype);
	}
}

/** 403 Forbidden — Authenticated but not allowed */
export class ForbiddenError extends AppError {
	constructor(message = 'Access denied') {
		super(403, 'FORBIDDEN', message);
		this.name = 'ForbiddenError';
		Object.setPrototypeOf(this, ForbiddenError.prototype);
	}
}

/** 404 Not Found — Resource doesn't exist */
export class NotFoundError extends AppError {
	constructor(resource: string, identifier?: string) {
		const msg = identifier ? `${resource} "${identifier}" not found` : `${resource} not found`;
		super(404, 'NOT_FOUND', msg);
		this.name = 'NotFoundError';
		Object.setPrototypeOf(this, NotFoundError.prototype);
	}
}

/** 409 Conflict — Duplicate or state conflict */
export class ConflictError extends AppError {
	constructor(message: string) {
		super(409, 'CONFLICT', message);
		this.name = 'ConflictError';
		Object.setPrototypeOf(this, ConflictError.prototype);
	}
}

/** 413 Payload Too Large — File/request too big */
export class PayloadTooLargeError extends AppError {
	constructor(message: string) {
		super(413, 'PAYLOAD_TOO_LARGE', message);
		this.name = 'PayloadTooLargeError';
		Object.setPrototypeOf(this, PayloadTooLargeError.prototype);
	}
}

/** 415 Unsupported Media Type — Bad content type */
export class UnsupportedMediaError extends AppError {
	constructor(message: string) {
		super(415, 'UNSUPPORTED_MEDIA_TYPE', message);
		this.name = 'UnsupportedMediaError';
		Object.setPrototypeOf(this, UnsupportedMediaError.prototype);
	}
}

/** 429 Too Many Requests — Rate limited */
export class RateLimitError extends AppError {
	constructor(message = 'Too many requests, please try again later') {
		super(429, 'RATE_LIMIT_EXCEEDED', message);
		this.name = 'RateLimitError';
		Object.setPrototypeOf(this, RateLimitError.prototype);
	}
}

// ─── 5xx Server Errors ─────────────────────────────────

/** 500 Internal Server Error */
export class InternalError extends AppError {
	constructor(message = 'Internal server error', details?: unknown) {
		super(500, 'INTERNAL_ERROR', message, details);
		this.name = 'InternalError';
		Object.setPrototypeOf(this, InternalError.prototype);
	}
}

// ─── Error Helpers ─────────────────────────────────────

/** Check if an error is one of our known AppErrors */
export function isAppError(error: unknown): error is AppError {
	return error instanceof AppError;
}

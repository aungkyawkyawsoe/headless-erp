/// Typed-error contract — the 1:1 Dart port of `test/errors.test.ts`, plus a
/// drift check against the canonical TS catalog (`packages/utils/src/errors/codes.ts`).
///
/// Pins:
///   - `.code` preserves the raw server code (backward compat, incl. legacy).
///   - `.apiCode` narrows to the canonical code (or 'API_ERROR').
///   - `apiErrorCodeOf()` returns a typed canonical code (null for unknown).
///   - the compiled catalog mirrors the canonical source (no drift).
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

void main() {
	group('typed error contract (canonical codes)', () {
		test('errorCodes mirrors the canonical catalog exactly', () {
			expect(errorCodes, const [
				'VALIDATION_ERROR',
				'INVALID_JSON',
				'UNAUTHORIZED',
				'FORBIDDEN',
				'NOT_FOUND',
				'CONFLICT',
				'PAYLOAD_TOO_LARGE',
				'UNSUPPORTED_MEDIA_TYPE',
				'RATE_LIMIT_EXCEEDED',
				'NOT_CONFIGURED',
				'DATABASE_ERROR',
				'INTERNAL_ERROR',
				'NETWORK_ERROR',
				'SDK_ERROR',
				'API_ERROR',
				'BAD_ENVELOPE',
			]);
			// apiErrorCodes = errorCodes minus the SDK-only tail.
			expect(apiErrorCodes, errorCodes.sublist(0, 12));
		});

		test('the catalog mirrors the canonical TS source (no drift)', () {
			// The SINGLE source of truth is `packages/utils/src/errors/codes.ts`
			// (re-exported by `@mmbix/types`). Running from the package root, the
			// monorepo sibling is one level up; outside the monorepo the check is
			// skipped (the API-side contract test compares against `/api/meta`).
			final file = File('../utils/src/errors/codes.ts');
			if (!file.existsSync()) {
				markTestSkipped('canonical catalog not present — skipped outside the monorepo');
				return;
			}
			final source = file.readAsStringSync();
			final block = RegExp(r'export const ERROR_CODES = \[(.*?)\] as const;', dotAll: true)
				.firstMatch(source);
			expect(block, isNotNull, reason: 'ERROR_CODES array not found in codes.ts');
			final codes = RegExp("'([A-Z_]+)'")
				.allMatches(block!.group(1)!)
				.map((match) => match.group(1)!)
				.toList();
			expect(errorCodes, codes);
			const sdkOnly = {'NETWORK_ERROR', 'SDK_ERROR', 'API_ERROR', 'BAD_ENVELOPE'};
			expect(apiErrorCodes, codes.where((code) => !sdkOnly.contains(code)).toList());
		});

		test('ErpHttpException.fromResponse preserves the raw top-level code AND narrows apiCode', () {
			const body = {
				'success': false,
				'error': 'Row changed',
				'code': 'CONFLICT',
				'request_id': 'req-123',
			};
			final e = ErpHttpException.fromResponse(409, 'Conflict', body);
			expect(e.code, 'CONFLICT');
			expect(e.apiCode, 'CONFLICT');
			expect(e.requestId, 'req-123');
			expect(apiErrorCodeOf(e), 'CONFLICT');
		});

		test('a legacy/unknown code is preserved in .code but apiCodeOf returns null', () {
			final e = ErpHttpException.fromResponse(409, 'Conflict', const {
				'error': {'message': 'v', 'code': 'VERSION_CONFLICT'},
			});
			expect(e.code, 'VERSION_CONFLICT');
			expect(e.apiCode, 'API_ERROR');
			expect(apiErrorCodeOf(e), isNull);
		});

		test('a 429 with RATE_LIMIT_EXCEEDED narrows to the canonical code', () {
			final e = ErpHttpException.fromResponse(429, 'Too Many Requests', const {
				'success': false,
				'error': 'slow down',
				'code': 'RATE_LIMIT_EXCEEDED',
			});
			expect(apiErrorCodeOf(e), 'RATE_LIMIT_EXCEEDED');
		});

		test('a well-formed ErpHttpException re-emits its apiCode even when constructed directly', () {
			final e = ErpHttpException('forbidden', 403, 'FORBIDDEN');
			expect(e.apiCode, 'FORBIDDEN');
			expect(apiErrorCodeOf(e), 'FORBIDDEN');
		});
	});
}

/// Auth helpers — the 1:1 Dart port of `test/auth.test.ts`.
///
/// Pins the custom-token decode (`base64(payload + '.' + sig)`, NOT a standard
/// 3-part JWT), the conservative expiry rules, and per-ACCOUNT subject
/// extraction (a re-minted token is the same human).
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:mex_flutter_sdk/mex_flutter_sdk.dart';

import 'support.dart';

void main() {
	group('tokenExpiryMs / isTokenExpired', () {
		test('decodes the exp claim from a server-shaped token', () {
			final exp = DateTime.now().millisecondsSinceEpoch + 3600000;
			final token = makeToken(exp);
			expect(tokenExpiryMs(token), exp);
		});

		test('treats an unparseable token as NOT expired (conservative)', () {
			expect(tokenExpiryMs('garbage'), isNull);
			expect(isTokenExpired('garbage'), isFalse);
		});

		test('flags expired tokens (with skew tolerance)', () {
			expect(isTokenExpired(makeToken(DateTime.now().millisecondsSinceEpoch - 3600000)), isTrue);
			expect(isTokenExpired(makeToken(DateTime.now().millisecondsSinceEpoch + 3600000)), isFalse);
		});

		test('flags tokens expiring within the skew window (re-auth up front)', () {
			// exp in 10s < 30s skew → treat as expired so login happens first.
			expect(isTokenExpired(makeToken(DateTime.now().millisecondsSinceEpoch + 10000)), isTrue);
		});
	});

	group('tokenSubjectOf', () {
		/// A re-mint of the SAME account — identical claims except jti/iat/exp.
		String minted(String userId, String jti) {
			final payload = jsonEncode({'jti': jti, 'user_id': userId, 'iat': 1, 'exp': 2});
			return base64.encode(utf8.encode('$payload.deadbeef'));
		}

		test('reads the SAME account from two re-minted tokens (never one human per token)', () {
			final first = minted('u-1', 'jti-1');
			final second = minted('u-1', 'jti-2');
			expect(first, isNot(second)); // the bytes differ on every login/refresh
			expect(tokenSubjectOf(first), 'u-1');
			expect(tokenSubjectOf(second), 'u-1');
		});

		test('separates two accounts', () {
			expect(tokenSubjectOf(minted('u-1', 'a')), isNot(tokenSubjectOf(minted('u-2', 'b'))));
		});

		test('falls back to sub, then to the token itself (an opaque token stays per-token)', () {
			expect(tokenSubjectOf(base64.encode(utf8.encode('${jsonEncode({'sub': 's-1'})}.sig'))), 's-1');
			expect(tokenSubjectOf('dev-token'), 'dev-token');
			expect(tokenSubjectOf(''), '');
		});
	});

	group('memoryTokenStorage', () {
		test('stores, reads and clears the token', () {
			final storage = MemoryTokenStorage();
			expect(storage.get(), isNull);
			storage.set('tok');
			expect(storage.get(), 'tok');
			storage.clear();
			expect(storage.get(), isNull);
		});

		test('keeps the refresh token in its own slot — clear() ends the whole session', () {
			final storage = MemoryTokenStorage();
			storage.set('tok');
			storage.setRefresh('refresh-1');
			expect(storage.getRefresh(), 'refresh-1');
			storage.clear();
			expect(storage.get(), isNull);
			expect(storage.getRefresh(), isNull);
		});
	});
}
